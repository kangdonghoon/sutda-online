// 섯다 서버 — 서버가 딜러(셔플·패 보관·판정)를 맡고, 계정·칩은 DB에 저장한다.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Sutda = require('./public/core.js');
const { createStore, START_CHIPS } = require('./store.js');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMINS = new Set((process.env.ADMIN_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const ROOM_IDLE_MS = 30 * 60 * 1000;    // 아무도 없는 방은 30분 뒤 삭제
const AWAY_GRACE_MS = 4000;             // 연결이 끊기고 이 시간이 지나면 '자리비움'
const TURN_MS = 30000;
const REJOIN_MS = 12000;   // 구사 재경기 때 다이한 사람이 참가 여부를 정하는 시간
const SESSION_MS = 30 * 24 * 3600 * 1000; // 로그인 유지 30일

const store = createStore();
// 수수료 설정 (관리자 페이지에서 변경, DB settings 테이블에 저장)
const RAKE_DEFAULT = { rate: 5, cap: 2000, min: 500, folds: false };
let RAKE = Object.assign({}, RAKE_DEFAULT);
function cleanRake(r) {
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    rate: Math.round(num(r && r.rate, 0, 20, RAKE_DEFAULT.rate) * 10) / 10,
    cap: Math.floor(num(r && r.cap, 0, 1e9, RAKE_DEFAULT.cap)),
    min: Math.floor(num(r && r.min, 0, 1e9, RAKE_DEFAULT.min)),
    folds: !!(r && r.folds),
  };
}
// 칩 충전 요청 (관리자 승인)
const REQ_AMOUNTS = [10000, 30000, 50000, 100000];
const pendingByUid = new Map(); // uid → { id, amount, createdAt }  (DB의 대기 요청을 메모리에도 들고 있음)
// 한국 시간 기준 오늘 0시
function kstDayStart(now) { const k = new Date(now + 9 * 3600e3); return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600e3; }
const rng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const rid = n => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < n; i++) s += a[crypto.randomInt(0, a.length)]; return s; };
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const log = (...a) => console.log(new Date().toISOString(), ...a);
const dbErr = e => console.error('[db]', e && e.message || e);

// ───────── 계정 ─────────
const pid = uid => 'a' + uid;                 // 게임 안에서 쓰는 플레이어 id
const uidOf = id => (/^a\d+$/.test(id) ? Number(id.slice(1)) : null);
const isAdmin = u => !!u && ADMINS.has(u.username);
const publicUser = u => u && ({ id: u.id, username: u.username, nick: u.nick, chips: u.chips, hands: u.hands, wins: u.wins, best: u.best, rebuys: u.rebuys, bought: u.bought, admin: isAdmin(u) });

function scrypt(pw, salt) {
  return new Promise((res, rej) => crypto.scrypt(String(pw), salt, 64, (e, k) => e ? rej(e) : res(k.toString('hex'))));
}
async function verifyPw(u, pw) {
  const h = await scrypt(pw, u.salt);
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(u.pwHash, 'hex'));
}
async function newSession(u) {
  const token = crypto.randomBytes(32).toString('base64url');
  await store.createSession(sha(token), u.id, Date.now() + SESSION_MS);
  return token;
}
// 세션 → 사용자. 매 요청마다 DB를 치지 않도록 1분 캐시
const sessCache = new Map(); // sha(token) → { user, at }
async function authed(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const h = sha(token), c = sessCache.get(h);
  if (c && Date.now() - c.at < 60000) return c.user;
  const u = await store.sessionUser(h);
  if (!u || u.banned) { sessCache.delete(h); return null; }
  sessCache.set(h, { user: u, at: Date.now() });
  return u;
}
function forgetUser(uid) { for (const [h, c] of sessCache) if (c.user.id === uid) sessCache.delete(h); }
setInterval(() => { const now = Date.now(); for (const [h, c] of sessCache) if (now - c.at > 120000) sessCache.delete(h); }, 60000);
setInterval(() => store.purgeSessions().catch(dbErr), 6 * 3600 * 1000);

// ───────── 방 ─────────
const rooms = new Map();
const userRoom = new Map(); // uid → 방 코드 (한 계정은 한 방에만)
const ANTES = [100, 500, 1000, 5000];
const PRACTICE_CHIPS = 10000; // 봇 연습방 전용 칩 (계정 칩과 무관)
function roomRules(body) {
  const ante = Number(body && body.ante);
  return {
    ante: ANTES.includes(ante) ? ante : 100,
    mode: body && body.mode === 'two' ? 'two' : 'one',
    ttaeng: body && body.ttaeng === false ? 0 : 1,
    tie: body && body.tie === 'split' ? 'split' : 'replay',
  };
}
function createRoom(hostId, rules, practice) {
  rules = rules || roomRules({});
  let code; do code = rid(4); while (rooms.has(code));
  const room = {
    code, G: Sutda.createGame({ ante: rules.ante, startChips: START_CHIPS, rake: practice ? null : Object.assign({}, RAKE), mode: rules.mode, ttaeng: rules.ttaeng, tie: rules.tie }), host: hostId,
    practice: !!practice, owner: hostId,   // 연습방: 연습 칩 사용, DB 저장·수수료 없음, 비공개
    autoNext: true, banned: new Set(), conns: new Map(), lastSeen: new Map(),
    lastActive: Date.now(), botKey: '', botDue: 0, showKey: '', showDue: 0, dirty: false, savedKey: '', leaving: new Set(), credits: new Map(),
  };
  rooms.set(code, room);
  return room;
}
const player = (room, id) => room.G.players.find(p => p.id === id);
const humans = room => room.G.players.filter(p => !p.bot);
const connected = (room, id) => { const s = room.conns.get(id); return !!(s && s.size); };
const liveInHand = (room, id) => { const G = room.G, h = G.hand; return G.phase === 'bet' && h && h.seats.includes(id) && !h.folded[id]; };

function pickHost(room) {
  const cur = room.host && player(room, room.host);
  if (cur && !cur.away) return;
  const next = humans(room).find(p => !p.away && connected(room, p.id));
  if (next && next.id !== room.host) { room.host = next.id; room.G.log.push(`${next.name} 님이 방장이 됐어요`); room.G.v++; }
}
function addBot(room) {
  const G = room.G;
  const names = ['고니', '평경장', '정마담', '고광렬', '아귀', '짝귀', '곽철용', '호구'];
  const used = new Set(G.players.map(p => p.name));
  const nm = names.map(n => '봇 ' + n).find(n => !used.has(n)) || '봇 ' + rid(3);
  return Sutda.addPlayer(G, 'b' + rid(8), nm, true);
}
// 방에서 사람을 빼면서 칩을 저장. 진행 중인 판에 살아 있으면 false
function removeFromRoom(room, id) {
  const p = player(room, id); if (!p) return true;
  if (liveInHand(room, id)) return false;
  const uid = uidOf(id);
  if (uid && !room.practice) { store.setChips(uid, p.chips).catch(dbErr); if (userRoom.get(uid) === room.code) userRoom.delete(uid); }
  Sutda.removePlayer(room.G, id);
  return true;
}

// 판이 끝나면 사람들의 칩·전적 저장
function persistHand(room) {
  const G = room.G, h = G.hand;
  if (G.phase !== 'show' || !h || !h.result || h.result.type === 'redeal') return;
  const key = h.no + ':' + h.deal;
  if (room.savedKey === key) return;
  room.savedKey = key;
  if (room.practice) return; // 연습방은 계정에 아무것도 저장하지 않음
  // 판 도중에 승인된 충전은 판이 끝난 지금 지급
  for (const [id, amt] of room.credits) {
    const p = player(room, id);
    if (p) { p.chips += amt; G.log.push(`${p.name} 칩 충전 +${amt.toLocaleString()} (승인)`); }
  }
  room.credits.clear();
  for (const id of h.seats) {
    const uid = uidOf(id), p = player(room, id);
    if (!uid || !p) continue;
    const gain = ((h.result.pay && h.result.pay[id]) || 0) + (h.result.tg && h.result.tg.to === id ? h.result.tg.total : 0);
    store.recordHand(uid, p.chips, h.result.winners.includes(id), gain).catch(dbErr);
  }
  if (h.result.rake > 0) {
    const winners = h.result.winners.map(id => (player(room, id) || {}).name).filter(Boolean).join(', ');
    store.logRake({ at: Date.now(), room: room.code, hand: h.no, pot: h.pot, rake: h.result.rake, winners }).catch(dbErr);
  }
  // 판 도중에 나간 사람은 판이 끝나면 자리에서 뺀다 (칩은 위에서 저장됨)
  for (const id of room.leaving) {
    const p = player(room, id), uid = uidOf(id);
    if (p) Sutda.removePlayer(G, id);
    if (uid && userRoom.get(uid) === room.code) userRoom.delete(uid);
    if (room.host === id) { room.host = null; pickHost(room); }
  }
  room.leaving.clear();
}

// ───────── 상태 전송 (SSE) ─────────
function viewFor(room, id) {
  const G = room.G, now = Date.now();
  const s = Sutda.publicState(G, now);
  s.code = room.code; s.host = room.host; s.auto = room.autoNext; s.turnMs = TURN_MS; s.you = id; s.practice = !!room.practice;
  if (s.h && s.h.rj) { s.h.rj.left = Math.max(0, room.showDue - now); s.h.rj.total = REJOIN_MS; }
  if (s.h && s.h.res) delete s.h.res.rake; // 수수료는 플레이어에게 보이지 않음 (관리자 페이지에서만)
  const rq = pendingByUid.get(uidOf(id)); s.req = rq ? { amount: rq.amount } : null;
  s.canStart = Sutda.canStart(G);
  const h = G.hand;
  if (h && h.cards[id] && h.seats.includes(id)) s.me = { no: h.no, dl: h.deal, cards: h.cards[id] };
  if (h && s.h && G.phase === 'bet' && h.toAct === id) s.h.lg = Sutda.legal(G, id);
  return s;
}
function send(res, event, data) { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) {} }
function pushState(room) {
  for (const [id, set] of room.conns) {
    if (!set.size) continue;
    const v = viewFor(room, id);
    for (const res of set) send(res, 'st', v);
  }
}
function changed(room) {
  room.lastActive = Date.now();
  persistHand(room);
  if (room.dirty) return;
  room.dirty = true;
  setImmediate(() => { room.dirty = false; pushState(room); });
}
function broadcast(room, event, data) { for (const set of room.conns.values()) for (const res of set) send(res, event, data); }
function dropConns(room, id, event) {
  const set = room.conns.get(id);
  if (set) for (const res of set) { send(res, event, {}); try { res.end(); } catch (e) {} }
}

// ───────── 게임 진행 루프 ─────────
function next(room) {
  const G = room.G, now = Date.now();
  if (G.phase === 'show' && G.hand && G.hand.result && G.hand.result.type === 'redeal') Sutda.redeal(G, rng, now);
  else if (Sutda.canStart(G)) Sutda.startHand(G, rng, now);
  else { G.phase = 'lobby'; G.v++; }
  if (G.hand && G.phase === 'bet') G.hand.deadline = Math.max(G.hand.deadline, now + 1000);
}
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const G = room.G, h = G.hand;
    let dirty = false;
    for (const p of humans(room)) {
      const away = !connected(room, p.id) && now - (room.lastSeen.get(p.id) || 0) > AWAY_GRACE_MS;
      if (p.away !== away) { p.away = away; dirty = true; }
    }
    const oldHost = room.host; pickHost(room); if (room.host !== oldHost) dirty = true;
    if (G.phase === 'bet' && h && h.toAct) {
      const p = player(room, h.toAct), k = h.toAct + ':' + G.v;
      if (p && p.bot) {
        if (room.botKey !== k) { room.botKey = k; room.botDue = now + 800 + rng() * 900; }
        else if (now >= room.botDue) { room.botKey = ''; Sutda.act(G, p.id, Sutda.botDecide(G, p.id, rng), now); dirty = true; }
      } else if (p && p.away && h.deadline - now > 6000) { h.deadline = now + 6000; dirty = true; }
      else if (now > h.deadline) { Sutda.autoAct(G, now); dirty = true; }
    }
    if (G.phase === 'show' && h) {
      const redeal = h.result && h.result.type === 'redeal';
      const k = h.no + ':' + h.deal + ':' + (h.result && h.result.type);
      if (room.showKey !== k) {
        room.showKey = k; room.showDue = now + (redeal ? 4000 : 6500);
        room.botRj = new Map();
        if (redeal && h.rejoin) {                       // 다이한 사람에게 참가 여부를 묻는 동안 기다림
          room.showDue = now + REJOIN_MS;
          for (const id of Sutda.rejoinPending(G)) {
            const p = player(room, id);
            if (p && p.bot) room.botRj.set(id, now + 1000 + rng() * 2500);
            else if (!p || p.away) Sutda.rejoinAnswer(G, id, false);
          }
          dirty = true;
        }
      }
      if (redeal && h.rejoin) {
        for (const [id, due] of room.botRj) {
          if (now < due) continue;
          room.botRj.delete(id);
          const p = player(room, id), cost = h.rejoin.cost[id] || 0;
          if (p) { Sutda.rejoinAnswer(G, id, rng() < (cost <= p.chips * 0.3 ? 0.6 : 0.2)); dirty = true; }
        }
        if (!Sutda.rejoinPending(G).length && room.showDue - now > 1500) { room.showDue = now + 1500; dirty = true; }
      }
      if (now >= room.showDue && (redeal || (room.autoNext && Sutda.canStart(G)))) { room.showKey = ''; next(room); dirty = true; }
    }
    if (dirty) changed(room);
    const anyone = [...room.conns.values()].some(s => s.size);
    if (!anyone && now - room.lastActive > ROOM_IDLE_MS) {
      if (!room.practice) for (const p of humans(room)) { const uid = uidOf(p.id); if (uid) { store.setChips(uid, p.chips).catch(dbErr); if (userRoom.get(uid) === room.code) userRoom.delete(uid); } }
      rooms.delete(room.code);
    }
  }
}, 250);
setInterval(() => {
  for (const room of rooms.values()) for (const set of room.conns.values()) for (const res of set) { try { res.write(': ping\n\n'); } catch (e) {} }
}, 20000);

function roomOf(uid) { const code = userRoom.get(uid), r = code && rooms.get(code); return r && player(r, pid(uid)) ? r : null; }
function notifyUser(uid, data) {
  const r = roomOf(uid); if (!r) return;
  const set = r.conns.get(pid(uid)); if (set) for (const res of set) send(res, 'chip', data);
}
// 이 계정이 다른 방에 앉아 있으면 빼낸다. 판 진행 중이면 오류 메시지
function leaveOtherRoom(uid, code) {
  const other = userRoom.get(uid);
  if (!other || other === code) return null;
  const r = rooms.get(other);
  if (!r || !player(r, pid(uid))) { userRoom.delete(uid); return null; }
  if (!removeFromRoom(r, pid(uid))) return `다른 방(${other.toUpperCase()})에서 게임 중이에요. 그 판이 끝난 뒤에 옮길 수 있어요.`;
  if (r.host === pid(uid)) { r.host = null; pickHost(r); }
  changed(r);
  return null;
}
async function seat(room, u) {
  const id = pid(u.id);
  let p = player(room, id);
  if (!p) {
    if (room.practice) { p = Sutda.addPlayer(room.G, id, u.nick, false); if (p) p.chips = PRACTICE_CHIPS; }
    else {
      const fresh = await store.userById(u.id);
      p = Sutda.addPlayer(room.G, id, u.nick, false);
      if (p) p.chips = fresh ? fresh.chips : START_CHIPS;
    }
  } else { p.name = u.nick; p.away = false; room.leaving.delete(id); }
  if (p && !room.practice) userRoom.set(u.id, room.code); // 연습방은 계정 칩과 연결하지 않음
  room.lastSeen.set(id, Date.now());
  return p;
}

// ───────── API ─────────
const okUser = s => /^[a-z0-9_]{3,16}$/.test(s);
async function handle(body, ip) {
  const t = String(body.t || '');

  // 로그인 없이 되는 것
  if (t === 'signup' || t === 'login') {
    if (limited('login:' + ip, 10, 60000)) return [429, { error: '잠시 후 다시 시도하세요' }];
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!okUser(username)) return [400, { error: '아이디는 영문 소문자·숫자·_ 3~16자예요' }];
    if (password.length < 6 || password.length > 64) return [400, { error: '비밀번호는 6자 이상이에요' }];
    if (t === 'signup') {
      const nick = clean(body.nick, 10);
      if (!nick) return [400, { error: '닉네임을 입력하세요' }];
      const salt = crypto.randomBytes(16).toString('hex');
      const u = await store.createUser({ username, nick, pwHash: await scrypt(password, salt), salt });
      if (!u) return [409, { error: '이미 있는 아이디예요' }];
      log('signup', username);
      return [200, { sess: await newSession(u), user: publicUser(u) }];
    }
    const u = await store.userByName(username);
    if (!u || !(await verifyPw(u, password))) return [401, { error: '아이디 또는 비밀번호가 틀렸어요' }];
    if (u.banned) return [403, { error: '이용이 정지된 계정이에요' }];
    store.touch(u.id).catch(dbErr);
    return [200, { sess: await newSession(u), user: publicUser(u) }];
  }

  const u = await authed(body.sess);
  if (!u) return [401, { error: '다시 로그인해 주세요' }];
  const myId = pid(u.id);

  switch (t) {
    case 'logout': { const h = sha(body.sess); sessCache.delete(h); await store.deleteSession(h); return [200, { ok: true }]; }
    case 'me': {
      const fresh = await store.userById(u.id);
      const code = userRoom.get(u.id), r = code && rooms.get(code), p = r && player(r, myId);
      if (p) fresh.chips = p.chips; // 게임 중이면 방에 있는 칩이 최신
      const rq = pendingByUid.get(u.id);
      return [200, { user: publicUser(fresh), room: p ? code : null, req: rq ? { amount: rq.amount, createdAt: rq.createdAt } : null }];
    }
    case 'nick': {
      const nick = clean(body.nick, 10); if (!nick) return [400, { error: '닉네임을 입력하세요' }];
      await store.setNick(u.id, nick); forgetUser(u.id);
      const code = userRoom.get(u.id), r = code && rooms.get(code), p = r && player(r, myId);
      if (p) { p.name = nick; r.G.v++; changed(r); }
      return [200, { ok: true }];
    }
    case 'create': {
      const err = leaveOtherRoom(u.id, null); if (err) return [409, { error: err }];
      const rules = roomRules(body);
      const room = createRoom(myId, rules, !!body.solo);
      await seat(room, u);
      if (room.practice) room.G.log.push(`연습 모드 — 연습 칩 ${PRACTICE_CHIPS.toLocaleString()}으로 시작해요. 계정 칩은 그대로예요`);
      room.G.log.push(`방 규칙: 판돈 ${rules.ante.toLocaleString()} · ${rules.mode === 'two' ? '두 장 받고 한 번 베팅' : '한 장씩 두 번 베팅'} · 땡값 ${rules.ttaeng ? '있음' : '없음'} · 동점 ${rules.tie === 'split' ? '나눠 갖기' : '재경기'}`);
      if (body.solo) { addBot(room); addBot(room); }
      log('room', room.code, 'by', u.username);
      return [200, { code: room.code }];
    }
  }

  if (t === 'chipReq') {
    const amount = Number(body.amount);
    if (!REQ_AMOUNTS.includes(amount)) return [400, { error: '충전 금액을 골라주세요' }];
    const req = await store.createChipRequest(u.id, amount, clean(body.note, 40));
    if (!req) return [409, { error: '이미 기다리는 충전 요청이 있어요' }];
    pendingByUid.set(u.id, { id: req.id, amount, createdAt: req.createdAt });
    const r = roomOf(u.id);
    if (r) { r.G.log.push(`${u.nick} 칩 충전 요청 (${amount.toLocaleString()})`); r.G.v++; changed(r); }
    log('chip request', u.username, amount);
    return [200, { ok: true, req: { amount } }];
  }
  if (t === 'chipCancel') {
    const req = await store.cancelChipRequest(u.id);
    pendingByUid.delete(u.id);
    const r = roomOf(u.id); if (r) { r.G.v++; changed(r); }
    return req ? [200, { ok: true }] : [404, { error: '취소할 요청이 없어요' }];
  }
  if (t.startsWith('admin.')) return admin(t, body, u);

  const room = rooms.get(String(body.room || '').toLowerCase());
  if (!room) return [404, { error: '방이 없어요. 코드를 확인하세요.' }];
  const G = room.G, now = Date.now();
  const ok = r => { changed(room); return [200, r || { ok: true }]; };

  switch (t) {
    case 'join': {
      if (room.banned.has(u.id)) return [403, { error: '이 방에서 내보내졌어요.' }];
      if (room.practice && room.owner !== myId) return [403, { error: '혼자 하는 연습방이라 들어갈 수 없어요.' }];
      const err = leaveOtherRoom(u.id, room.code); if (err) return [409, { error: err }];
      const p = await seat(room, u);
      if (!room.host || !player(room, room.host)) room.host = myId;
      return ok({ seated: !!p });
    }
    case 'rejoin':
      if (!Sutda.rejoinAnswer(G, myId, !!body.yes)) return [409, { error: '지금은 정할 수 없어요' }];
      return ok();
    case 'practiceRefill': {
      const p = player(room, myId);
      if (!room.practice || !p) return [400, { error: '연습방에서만 쓸 수 있어요' }];
      if (liveInHand(room, myId) || p.chips >= G.ante) return [409, { error: '연습 칩이 판돈보다 적을 때 충전할 수 있어요' }];
      p.chips = PRACTICE_CHIPS; G.log.push(`연습 칩 충전 (${PRACTICE_CHIPS.toLocaleString()})`); G.v++;
      return ok();
    }
    case 'act':
      if (!Sutda.act(G, myId, String(body.k), now)) return [409, { error: '지금은 할 수 없어요' }];
      return ok();
    case 'chat': {
      const p = player(room, myId), x = clean(body.x, 80);
      if (!x) return [400, { error: 'empty' }];
      broadcast(room, 'ch', { nm: p ? p.name : u.nick, x });
      return [200, { ok: true }];
    }
    case 'leave': {
      if (room.practice && room.owner === myId) { for (const p of humans(room)) dropConns(room, p.id, 'closed'); rooms.delete(room.code); return [200, { ok: true }]; }
      if (!removeFromRoom(room, myId)) {
        const p = player(room, myId); if (p) p.away = true;
        room.leaving.add(myId);
        // 내 차례면 바로 다이
        if (G.hand && G.hand.toAct === myId) Sutda.act(G, myId, 'die', now);
      }
      room.lastSeen.delete(myId);
      if (room.host === myId) { room.host = null; pickHost(room); }
      return ok();
    }
  }

  if (room.host !== myId) return [403, { error: '방장만 할 수 있어요' }];
  switch (t) {
    case 'start':
      if (G.phase === 'bet') return [409, { error: '게임 중이에요' }];
      if (G.phase === 'show' && G.hand && G.hand.result && G.hand.result.type === 'redeal') return [409, { error: '재경기 대기 중' }];
      if (!Sutda.canStart(G)) return [409, { error: '2명 이상 필요해요' }];
      room.showKey = ''; next(room); return ok();
    case 'bot':
      if (G.players.length >= Sutda.MAX_PLAYERS) return [409, { error: '자리가 꽉 찼어요' }];
      addBot(room); return ok();
    case 'kick': {
      const target = player(room, String(body.target));
      if (!target || target.id === myId) return [404, { error: '없는 사람' }];
      if (!removeFromRoom(room, target.id)) return [409, { error: '진행 중인 판에 있는 사람은 판이 끝난 뒤에 내보낼 수 있어요' }];
      const tu = uidOf(target.id);
      if (tu) { room.banned.add(tu); dropConns(room, target.id, 'kick'); }
      return ok();
    }
    case 'auto': room.autoNext = !!body.on; G.v++; return ok();
  }
  return [400, { error: 'unknown' }];
}

// ───────── 관리자 ─────────
async function admin(t, body, u) {
  if (!isAdmin(u)) return [403, { error: '관리자만 쓸 수 있어요' }];
  const target = body.id != null ? await store.userById(Number(body.id)) : null;
  const where = uid => { const code = userRoom.get(uid), r = code && rooms.get(code); return r && player(r, pid(uid)) ? r : null; };
  switch (t) {
    case 'admin.users': {
      const list = await store.listUsers(clean(body.search, 30));
      return [200, list.map(x => {
        const r = where(x.id), p = r && player(r, pid(x.id));
        return Object.assign(publicUser(x), { chips: p ? p.chips : x.chips, banned: x.banned, room: r ? r.code : null, createdAt: x.createdAt, lastSeen: x.lastSeen });
      })];
    }
    case 'admin.chips': {
      if (!target) return [404, { error: '없는 회원' }];
      const chips = Math.floor(Number(body.chips));
      if (!Number.isFinite(chips) || chips < 0 || chips > 1e12) return [400, { error: '칩 값이 이상해요' }];
      const r = where(target.id);
      if (r && liveInHand(r, pid(target.id))) return [409, { error: '지금 판에 참여 중이에요. 판이 끝난 뒤 다시 해주세요.' }];
      await store.setChips(target.id, chips);
      if (r) { const p = player(r, pid(target.id)); p.chips = chips; r.G.log.push(`관리자가 ${p.name}의 칩을 ${chips.toLocaleString()}로 설정`); r.G.v++; changed(r); }
      log('admin chips', u.username, '→', target.username, chips);
      return [200, { ok: true }];
    }
    case 'admin.ban': {
      if (!target) return [404, { error: '없는 회원' }];
      if (isAdmin(target)) return [400, { error: '관리자는 정지할 수 없어요' }];
      const banned = !!body.banned;
      await store.setBanned(target.id, banned);
      if (banned) {
        await store.deleteUserSessions(target.id); forgetUser(target.id);
        const r = where(target.id);
        if (r) {
          const id = pid(target.id);
          if (!removeFromRoom(r, id)) { const p = player(r, id); if (p) p.away = true; }
          dropConns(r, id, 'kick'); changed(r);
        }
      }
      log('admin ban', u.username, '→', target.username, banned);
      return [200, { ok: true }];
    }
    case 'admin.rake': {
      const now = Date.now();
      const stats = await store.rakeStats({ today: kstDayStart(now), week: now - 7 * 864e5 });
      return [200, { settings: RAKE, stats }];
    }
    case 'admin.rakeSet': {
      RAKE = cleanRake(body);
      await store.setSetting('rake', JSON.stringify(RAKE));
      for (const r of rooms.values()) {
        r.G.rake = Object.assign({}, RAKE);
        r.G.v++;
      }
      log('admin rake', u.username, JSON.stringify(RAKE));
      return [200, { ok: true, settings: RAKE }];
    }
    case 'admin.requests': {
      const [pending, recent] = await Promise.all([store.pendingRequests(), store.recentRequests(20)]);
      return [200, { pending: pending.map(q => { const r = roomOf(q.userId), p = r && player(r, pid(q.userId)); return Object.assign(q, { chips: p ? p.chips : q.userChips, room: r ? r.code : null, inHand: !!(r && liveInHand(r, pid(q.userId))) }); }), recent }];
    }
    case 'admin.approve': {
      const amount = Math.floor(Number(body.amount));
      if (!Number.isFinite(amount) || amount < 1 || amount > 10000000) return [400, { error: '금액은 1 ~ 10,000,000 사이로 넣어주세요' }];
      const req = await store.decideChipRequest(Number(body.id), 'approved', amount, u.username);
      if (!req) return [409, { error: '이미 처리됐거나 취소된 요청이에요' }];
      pendingByUid.delete(req.userId);
      const r = roomOf(req.userId), id = pid(req.userId), p = r && player(r, id);
      let later = false;
      if (!p) await store.grantChips(req.userId, amount, null);
      else if (liveInHand(r, id)) {                       // 판 진행 중: 판이 끝나면 지급
        later = true;
        r.credits.set(id, (r.credits.get(id) || 0) + amount);
        await store.grantChips(req.userId, amount, null);
        r.G.log.push(`${p.name} 칩 충전 승인 — 이번 판이 끝나면 +${amount.toLocaleString()}`);
      } else {
        p.chips += amount;
        await store.grantChips(req.userId, amount, p.chips);
        r.G.log.push(`${p.name} 칩 충전 +${amount.toLocaleString()} (승인)`);
      }
      if (r) { r.G.v++; changed(r); }
      notifyUser(req.userId, { status: 'approved', amount, later });
      log('chip approve', u.username, '→', req.username, amount);
      return [200, { ok: true }];
    }
    case 'admin.reject': {
      const req = await store.decideChipRequest(Number(body.id), 'rejected', null, u.username);
      if (!req) return [409, { error: '이미 처리됐거나 취소된 요청이에요' }];
      pendingByUid.delete(req.userId);
      const r = roomOf(req.userId); if (r) { r.G.v++; changed(r); }
      notifyUser(req.userId, { status: 'rejected', amount: req.amount });
      log('chip reject', u.username, '→', req.username);
      return [200, { ok: true }];
    }
    case 'admin.rooms':
      return [200, [...rooms.values()].map(r => ({
        code: r.code, phase: r.G.phase, hands: r.G.handNo, practice: !!r.practice,
        players: r.G.players.map(p => ({ name: p.name, chips: p.chips, bot: p.bot, away: p.away, host: p.id === r.host })),
      }))];
    case 'admin.close': {
      const r = rooms.get(String(body.code || '').toLowerCase());
      if (!r) return [404, { error: '없는 방' }];
      for (const p of humans(r)) {
        const uid = uidOf(p.id);
        if (uid && !r.practice) { store.setChips(uid, p.chips + (r.credits.get(p.id) || 0)).catch(dbErr); if (userRoom.get(uid) === r.code) userRoom.delete(uid); }
        dropConns(r, p.id, 'closed');
      }
      rooms.delete(r.code);
      log('admin close', u.username, r.code);
      return [200, { ok: true }];
    }
  }
  return [400, { error: 'unknown' }];
}

// ───────── HTTP ─────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath === '/admin' ? '/admin.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(data);
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
const buckets = new Map();
function limited(key, max, win) {
  const now = Date.now(); const b = buckets.get(key) || { t: now, n: 0 };
  if (now - b.t > win) { b.t = now; b.n = 0; }
  b.n++; buckets.set(key, b);
  return b.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 120000) buckets.delete(k); }, 60000);
const clientIp = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/events') {
      const u = await authed(url.searchParams.get('sess'));
      const room = rooms.get(String(url.searchParams.get('room') || '').toLowerCase());
      if (!u) return json(res, 401, { error: 'auth' });
      if (!room) return json(res, 404, { error: 'no room' });
      const id = pid(u.id);
      if (room.banned.has(u.id)) return json(res, 403, { error: 'banned' });
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write('retry: 2000\n\n');
      if (!room.conns.has(id)) room.conns.set(id, new Set());
      room.conns.get(id).add(res);
      room.lastSeen.set(id, Date.now());
      const p = player(room, id); if (p && p.away) { p.away = false; room.G.v++; }
      send(res, 'st', viewFor(room, id));
      changed(room);
      req.on('close', () => { const set = room.conns.get(id); if (set) set.delete(res); room.lastSeen.set(id, Date.now()); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/rooms') {
      const list = [...rooms.values()]
        .filter(r => !r.practice && [...r.conns.values()].some(s => s.size))
        .map(r => { const h = player(r, r.host); return { code: r.code, host: h ? h.name : '', n: r.G.players.length, st: r.G.phase, ante: r.G.ante, mode: r.G.mode, tg: r.G.ttaeng, tie: r.G.tie }; })
        .slice(0, 20);
      return json(res, 200, list);
    }
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size, db: store.kind });
    if (req.method === 'POST' && url.pathname === '/api') {
      let raw = '';
      req.on('data', c => { raw += c; if (raw.length > 4096) req.destroy(); });
      req.on('end', async () => {
        let body; try { body = JSON.parse(raw); } catch (e) { return json(res, 400, { error: 'bad json' }); }
        if (!body || typeof body !== 'object') return json(res, 400, { error: 'bad body' });
        const ip = clientIp(req);
        if (limited('rq:' + String(body.sess || ip).slice(0, 60), 20, 1000)) return json(res, 429, { error: '너무 빨라요' });
        try { const [code, out] = await handle(body, ip); json(res, code, out); }
        catch (e) { console.error(e); json(res, 500, { error: '서버 오류가 났어요. 잠시 후 다시 해주세요.' }); }
      });
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
    res.writeHead(405); res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: '서버 오류' });
  }
});

store.init()
  .then(async () => {
    try { const v = await store.getSetting('rake'); if (v) RAKE = cleanRake(JSON.parse(v)); } catch (e) { dbErr(e); }
    for (const q of await store.pendingRequests()) pendingByUid.set(q.userId, { id: q.id, amount: q.amount, createdAt: q.createdAt });
  })
  .then(() => server.listen(PORT, HOST, () => log(`섯다 서버 실행 중: http://localhost:${PORT} (저장소: ${store.kind}, 관리자: ${[...ADMINS].join(', ') || '없음'}, 수수료: ${RAKE.rate}%)`)))
  .catch(e => { console.error('DB 연결 실패:', e.message); process.exit(1); });

module.exports = { server, store }; // 테스트용

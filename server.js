// 섯다 서버 — 외부 의존성 없음. 서버가 딜러(셔플·패 보관·판정)를 맡는다.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Sutda = require('./public/core.js');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOM_IDLE_MS = 30 * 60 * 1000;   // 아무도 없는 방은 30분 뒤 삭제
const AWAY_GRACE_MS = 4000;            // 연결이 끊기고 이 시간이 지나면 '자리비움'
const TURN_MS = 30000;

const rng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const rid = n => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < n; i++) s += a[crypto.randomInt(0, a.length)]; return s; };
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);

// ───────── 신원: pid + 비밀 토큰 ─────────
// 브라우저가 처음 만든 토큰을 pid에 묶는다. 이후 같은 pid는 같은 토큰으로만 쓸 수 있다.
const tokens = new Map(); // pid → sha256(tok)
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
function auth(pid, tok) {
  if (typeof pid !== 'string' || !/^u[a-z0-9]{8,24}$/.test(pid)) return false;
  if (typeof tok !== 'string' || tok.length < 16 || tok.length > 64) return false;
  const h = hash(tok), cur = tokens.get(pid);
  if (!cur) { tokens.set(pid, h); return true; }
  return cur === h;
}

// ───────── 방 ─────────
const rooms = new Map();
function createRoom(hostPid) {
  let code; do code = rid(4); while (rooms.has(code));
  const room = {
    code, G: Sutda.createGame({ ante: 100, startChips: 10000 }), host: hostPid,
    autoNext: true, banned: new Set(), conns: new Map(), lastSeen: new Map(),
    lastActive: Date.now(), botKey: '', botDue: 0, showKey: '', showDue: 0, dirty: false, created: Date.now(),
  };
  rooms.set(code, room);
  return room;
}
const player = (room, pid) => room.G.players.find(p => p.id === pid);
const humans = room => room.G.players.filter(p => !p.bot);
function connected(room, pid) { const s = room.conns.get(pid); return !!(s && s.size); }

function pickHost(room) {
  const cur = room.host && player(room, room.host);
  if (cur && !cur.away) return;
  const next = humans(room).find(p => !p.away && connected(room, p.id));
  if (next && next.id !== room.host) {
    room.host = next.id;
    room.G.log.push(`${next.name} 님이 방장이 됐어요`); room.G.v++;
  }
}

function addBot(room) {
  const G = room.G;
  const names = ['고니', '평경장', '정마담', '고광렬', '아귀', '짝귀', '곽철용', '호구'];
  const used = new Set(G.players.map(p => p.name));
  const nm = names.map(n => '봇 ' + n).find(n => !used.has(n)) || '봇 ' + rid(3);
  return Sutda.addPlayer(G, 'b' + rid(8), nm, true);
}

// ───────── 상태 전송 (SSE) ─────────
function viewFor(room, pid) {
  const G = room.G, now = Date.now();
  const s = Sutda.publicState(G, now);
  s.code = room.code; s.host = room.host; s.auto = room.autoNext; s.turnMs = TURN_MS;
  s.canStart = Sutda.canStart(G);
  const h = G.hand;
  if (h && h.cards[pid] && h.seats.includes(pid)) s.me = { no: h.no, dl: h.deal, cards: h.cards[pid] };
  if (h && s.h && G.phase === 'bet' && h.toAct === pid) s.h.lg = Sutda.legal(G, pid);
  return s;
}
function send(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) { /* 끊긴 연결 */ }
}
function pushState(room) {
  for (const [pid, set] of room.conns) {
    if (!set.size) continue;
    const v = viewFor(room, pid);
    for (const res of set) send(res, 'st', v);
  }
}
function changed(room) {
  room.lastActive = Date.now();
  if (room.dirty) return;
  room.dirty = true;
  setImmediate(() => { room.dirty = false; pushState(room); });
}
function broadcast(room, event, data) {
  for (const set of room.conns.values()) for (const res of set) send(res, event, data);
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
    // 자리비움 판정
    let dirty = false;
    for (const p of humans(room)) {
      const away = !connected(room, p.id) && now - (room.lastSeen.get(p.id) || 0) > AWAY_GRACE_MS;
      if (p.away !== away) { p.away = away; dirty = true; }
    }
    const oldHost = room.host; pickHost(room); if (room.host !== oldHost) dirty = true;

    if (G.phase === 'bet' && h && h.toAct) {
      const p = player(room, h.toAct);
      const k = h.toAct + ':' + G.v;
      if (p && p.bot) {
        if (room.botKey !== k) { room.botKey = k; room.botDue = now + 800 + rng() * 900; }
        else if (now >= room.botDue) { room.botKey = ''; Sutda.act(G, p.id, Sutda.botDecide(G, p.id, rng), now); dirty = true; }
      } else if (p && p.away && h.deadline - now > 6000) { h.deadline = now + 6000; dirty = true; }
      else if (now > h.deadline) { Sutda.autoAct(G, now); dirty = true; }
    }
    if (G.phase === 'show' && h) {
      const redeal = h.result && h.result.type === 'redeal';
      const k = h.no + ':' + h.deal + ':' + (h.result && h.result.type);
      if (room.showKey !== k) { room.showKey = k; room.showDue = now + (redeal ? 4000 : 6500); }
      else if (now >= room.showDue && (redeal || (room.autoNext && Sutda.canStart(G)))) { room.showKey = ''; next(room); dirty = true; }
    }
    if (dirty) changed(room);

    // 빈 방 정리
    const anyone = [...room.conns.values()].some(s => s.size);
    if (!anyone && now - room.lastActive > ROOM_IDLE_MS) rooms.delete(room.code);
  }
}, 250);

// 프록시가 연결을 끊지 않도록 주기적으로 핑
setInterval(() => {
  for (const room of rooms.values()) for (const set of room.conns.values()) for (const res of set) { try { res.write(': ping\n\n'); } catch (e) {} }
}, 20000);

// ───────── 액션 처리 ─────────
function handle(body) {
  const { pid, tok } = body;
  if (!auth(pid, tok)) return [403, { error: '인증 실패. 새로고침해 주세요.' }];
  const t = body.t;

  if (t === 'create') {
    const nm = clean(body.nm, 10) || '방장';
    const room = createRoom(pid);
    Sutda.addPlayer(room.G, pid, nm, false);
    room.lastSeen.set(pid, Date.now());
    if (body.solo) { addBot(room); addBot(room); }
    return [200, { code: room.code }];
  }

  const room = rooms.get(String(body.room || '').toLowerCase());
  if (!room) return [404, { error: '방이 없어요. 코드를 확인하세요.' }];
  const G = room.G, now = Date.now();
  const isHost = room.host === pid;
  const ok = r => { changed(room); return [200, r || { ok: true }]; };

  switch (t) {
    case 'join': {
      if (room.banned.has(pid)) return [403, { error: '이 방에서 내보내졌어요.' }];
      const nm = clean(body.nm, 10) || '손님';
      room.lastSeen.set(pid, now);
      const p = Sutda.addPlayer(G, pid, nm, false);
      if (!room.host || !player(room, room.host)) room.host = pid;
      return ok({ seated: !!p });
    }
    case 'act': {
      if (!Sutda.act(G, pid, String(body.k), now)) return [409, { error: '지금은 할 수 없어요' }];
      return ok();
    }
    case 'chat': {
      const p = player(room, pid); const x = clean(body.x, 80);
      if (!x) return [400, { error: 'empty' }];
      broadcast(room, 'ch', { nm: p ? p.name : '관전자', x });
      return [200, { ok: true }];
    }
    case 'rebuy': {
      const p = player(room, pid); if (!p) return [404, { error: '자리가 없어요' }];
      const inHand = G.phase === 'bet' && G.hand && G.hand.seats.includes(pid) && !G.hand.folded[pid];
      if (inHand || p.chips >= G.ante) return [409, { error: '칩이 판돈보다 적을 때만 충전할 수 있어요' }];
      p.chips = G.startChips; G.log.push(`${p.name} 칩 충전 (${G.startChips.toLocaleString()})`); G.v++;
      return ok();
    }
    case 'leave': {
      if (!Sutda.removePlayer(G, pid)) { const p = player(room, pid); if (p) p.away = true; }
      room.lastSeen.delete(pid);
      if (room.host === pid) { room.host = null; pickHost(room); }
      return ok();
    }
  }

  // 이하 방장 전용
  if (!isHost) return [403, { error: '방장만 할 수 있어요' }];
  switch (t) {
    case 'start': {
      if (G.phase === 'bet') return [409, { error: '게임 중이에요' }];
      if (G.phase === 'show' && G.hand && G.hand.result && G.hand.result.type === 'redeal') return [409, { error: '재경기 대기 중' }];
      if (!Sutda.canStart(G)) return [409, { error: '2명 이상 필요해요' }];
      room.showKey = ''; next(room); return ok();
    }
    case 'bot': {
      if (G.players.length >= Sutda.MAX_PLAYERS) return [409, { error: '자리가 꽉 찼어요' }];
      addBot(room); return ok();
    }
    case 'kick': {
      const target = player(room, String(body.target));
      if (!target || target.id === pid) return [404, { error: '없는 사람' }];
      if (!Sutda.removePlayer(G, target.id)) return [409, { error: '진행 중인 판에 있는 사람은 판이 끝난 뒤에 내보낼 수 있어요' }];
      if (!target.bot) {
        room.banned.add(target.id);
        const set = room.conns.get(target.id);
        if (set) for (const res of set) { send(res, 'kick', {}); try { res.end(); } catch (e) {} }
      }
      return ok();
    }
    case 'ante': {
      const a = Number(body.ante);
      if (![100, 500, 1000, 5000].includes(a) || G.phase === 'bet') return [400, { error: 'bad ante' }];
      G.ante = a; G.log.push(`판돈 ${a.toLocaleString()}로 변경`); G.v++; return ok();
    }
    case 'auto': { room.autoNext = !!body.on; G.v++; return ok(); }
  }
  return [400, { error: 'unknown' }];
}

// ───────── HTTP ─────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// 간단한 요청 제한: pid(또는 IP)당 초당 20회
const buckets = new Map();
function limited(key) {
  const now = Date.now(); const b = buckets.get(key) || { t: now, n: 0 };
  if (now - b.t > 1000) { b.t = now; b.n = 0; }
  b.n++; buckets.set(key, b);
  return b.n > 20;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 60000) buckets.delete(k); }, 60000);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/events') {
    const pid = url.searchParams.get('pid'), tok = url.searchParams.get('tok');
    const room = rooms.get(String(url.searchParams.get('room') || '').toLowerCase());
    if (!auth(pid, tok)) return json(res, 403, { error: 'auth' });
    if (!room) return json(res, 404, { error: 'no room' });
    if (room.banned.has(pid)) return json(res, 403, { error: 'banned' });
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 2000\n\n');
    if (!room.conns.has(pid)) room.conns.set(pid, new Set());
    room.conns.get(pid).add(res);
    room.lastSeen.set(pid, Date.now());
    const p = player(room, pid); if (p && p.away) { p.away = false; room.G.v++; }
    send(res, 'st', viewFor(room, pid));
    changed(room);
    req.on('close', () => {
      const set = room.conns.get(pid); if (set) set.delete(res);
      room.lastSeen.set(pid, Date.now());
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/rooms') {
    const list = [...rooms.values()]
      .filter(r => [...r.conns.values()].some(s => s.size))
      .map(r => { const h = player(r, r.host); return { code: r.code, host: h ? h.name : '', n: r.G.players.length, st: r.G.phase }; })
      .slice(0, 20);
    return json(res, 200, list);
  }

  if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size });

  if (req.method === 'POST' && url.pathname === '/api') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 4096) req.destroy(); });
    req.on('end', () => {
      let body; try { body = JSON.parse(raw); } catch (e) { return json(res, 400, { error: 'bad json' }); }
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'bad body' });
      if (limited(String(body.pid || req.socket.remoteAddress))) return json(res, 429, { error: '너무 빨라요' });
      try { const [code, out] = handle(body); json(res, code, out); }
      catch (e) { console.error(e); json(res, 500, { error: 'server error' }); }
    });
    return;
  }

  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  res.writeHead(405); res.end();
});

server.listen(PORT, HOST, () => console.log(`섯다 서버 실행 중: http://localhost:${PORT}`));

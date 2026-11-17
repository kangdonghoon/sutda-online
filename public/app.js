(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won = n => (n || 0).toLocaleString('ko-KR');
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch(e){ return null; } },
  set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} },
  del(k){ try { localStorage.removeItem(k); } catch(e){} },
};
const rid = n => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; const b = crypto.getRandomValues(new Uint8Array(n)); let s=''; for (let i=0;i<n;i++) s += a[b[i] % a.length]; return s; };

// ───────── 계정 ─────────
let sess = store.get('sutda-sess');
let user = null;           // 로그인한 내 정보
let pendingJoin = null;    // 로그인 후 들어갈 방
let myReq = null;          // 대기 중인 내 칩 충전 요청 {amount}

// ───────── 상태 ─────────
let code = null, es = null, PS = null, psAt = 0, inGame = false;
let chatLines = [];

async function api(d, quiet){
  try {
    const r = await fetch('/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ sess, room: code }, d)) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && sess && d.t !== 'login' && d.t !== 'signup') { setLoggedOut(); if (!quiet) toast('다시 로그인해 주세요'); return { ok: false, status: 401 }; }
    if (!r.ok) { if (!quiet && j.error) toast(j.error); return { ok: false, status: r.status, ...j }; }
    return { ok: true, data: j, ...(Array.isArray(j) ? {} : j) };
  } catch(e){ if (!quiet) toast('서버에 연결할 수 없어요'); return { ok: false, status: 0 }; }
}

// ───────── 로그인 / 가입 ─────────
let authMode = 'login';
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  authMode = b.dataset.tab;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.signup-only').forEach(x => x.classList.toggle('hidden', authMode !== 'signup'));
  $('#aSubmit').textContent = authMode === 'login' ? '로그인' : '가입하고 시작';
  $('#aPw').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
});
$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const username = $('#aUser').value.trim().toLowerCase(), password = $('#aPw').value;
  if (authMode === 'signup') {
    if (password !== $('#aPw2').value) return toast('비밀번호 확인이 달라요');
    if (!$('#aNick').value.trim()) return toast('닉네임을 입력하세요');
  }
  const btn = $('#aSubmit'); btn.disabled = true;
  const r = await api({ t: authMode, username, password, nick: $('#aNick').value.trim() });
  btn.disabled = false;
  if (!r.ok) return;
  sess = r.sess; store.set('sutda-sess', sess); user = r.user;
  $('#aPw').value = ''; $('#aPw2').value = '';
  setLoggedIn();
  if (pendingJoin) { const c = pendingJoin; pendingJoin = null; joinTable(c); }
});
function setLoggedOut(){
  sess = null; user = null; store.del('sutda-sess');
  if (inGame) leaveGame(true);
  renderEntry();
}
function setLoggedIn(){ renderEntry(); }
async function refreshMe(){
  if (!sess) return null;
  const r = await api({ t: 'me' }, true);
  if (!r.ok) { if (r.status === 401) setLoggedOut(); return null; }
  user = r.user; myReq = r.req || null; renderEntry(); return r;
}
function renderEntry(){
  const li = !!(sess && user);
  $('#authBox').classList.toggle('hidden', li);
  $('#lobbyBoxes').classList.toggle('hidden', !li);
  const pb = $('#profileBox');
  pb.classList.toggle('hidden', !li);
  if (li) {
    pb.innerHTML = `<div class="prof"><div class="who"><b>${esc(user.nick)}</b> <span class="muted">@${esc(user.username)}</span>
        <div class="stats"><span>칩 <b>${won(user.chips)}</b></span><span>${won(user.hands)}판 ${won(user.wins)}승</span><span>최고 <b>${won(user.best)}</b></span></div>
        ${myReq ? `<div class="reqline">칩 ${won(myReq.amount)} 충전 요청을 관리자가 확인하고 있어요</div>` : ''}</div>
      <div class="row" style="flex:0 0 auto">${user.admin ? '<a class="hbtn" href="/admin" style="text-decoration:none;color:var(--red);font-weight:700">관리자</a>' : ''}<button class="hbtn" id="btnChip">${myReq ? '충전 대기 중' : '칩 충전'}</button><button class="hbtn" id="btnNick">닉네임 변경</button><button class="hbtn" id="btnLogout">로그아웃</button></div></div>`;
    $('#btnLogout').onclick = async () => { await api({ t: 'logout' }, true); setLoggedOut(); };
    $('#btnChip').onclick = openChipModal;
    $('#btnNick').onclick = () => {
      openModal(`<h2>닉네임 변경</h2><input id="nNick" class="inp" maxlength="10" value="${esc(user.nick)}"><div class="row" style="margin-top:14px"><button class="btn" data-close>취소</button><button class="btn gold" id="nOk">변경</button></div>`);
      $('#nOk').onclick = async () => { const v = $('#nNick').value.trim(); if (!v) return; const r = await api({ t: 'nick', nick: v }); if (r.ok) { closeModal(); refreshMe(); } };
    };
  }
  showInvite();
}

// ───────── 방 만들기 / 목록 ─────────
async function create(solo){
  if (!user) return toast('먼저 로그인하세요');
  const r = await api({ t: 'create', solo: !!solo });
  if (r.ok) joinTable(r.code);
}
$('#btnCreate').onclick = () => create(false);
$('#btnSolo').onclick = () => create(true);
$('#btnJoin').onclick = () => { const c = $('#joinCode').value.trim().toLowerCase(); if (!/^[a-z0-9]{4}$/.test(c)) return toast('방 코드 4자리를 입력하세요'); joinTable(c); };
$('#joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnJoin').click(); });
$('#tables').addEventListener('click', e => { const c = e.target.closest('[data-join]'); if (c) joinTable(c.dataset.join); });

async function loadTables(){
  if (inGame) return;
  try {
    const list = await (await fetch('/api/rooms')).json();
    const t = $('#tables');
    if (!list.length) { t.innerHTML = '<div class="muted">지금 열린 방이 없어요.</div>'; return; }
    t.innerHTML = list.map(r => `<div class="tbl-item"><div><b>${esc(r.host)}</b>의 방 <span class="code" style="font-size:12px">${esc(r.code.toUpperCase())}</span>
      <div class="muted">${Number(r.n)||0}명 · ${r.st === 'bet' ? '게임 중' : '대기 중'}</div></div>
      <button class="btn gold" data-join="${esc(r.code)}">입장</button></div>`).join('');
  } catch(e){ $('#tables').innerHTML = '<div class="muted">서버에 연결할 수 없어요.</div>'; }
}
setInterval(loadTables, 4000);

function inviteCode(){ const m = /^#([a-z0-9]{4})$/i.exec(location.hash); return m ? m[1].toLowerCase() : null; }
function showInvite(){
  const c = inviteCode(), box = $('#inviteBox');
  if (!c || inGame) { box.classList.add('hidden'); return false; }
  box.innerHTML = `<h3>초대받은 방 <span class="code">${esc(c.toUpperCase())}</span></h3>
    <div class="muted" style="margin-bottom:10px">${user ? '아래 버튼을 눌러 입장하세요.' : '로그인하면 바로 이 방으로 들어가요. 계정이 없으면 회원가입부터 해주세요.'}</div>
    ${user ? '<button class="btn gold" id="btnInvite" style="width:100%">이 방으로 입장</button>' : ''}`;
  box.classList.remove('hidden');
  if (user) $('#btnInvite').onclick = () => joinTable(c);
  else pendingJoin = c;
  $('#joinCode').value = c;
  return true;
}
function showResume(roomCode){
  const box = $('#resumeBox');
  box.classList.add('hidden');
  if (!roomCode || inviteCode()) return;
  box.innerHTML = `<h3>이어하기</h3><div class="row" style="align-items:center"><div class="muted" style="flex:2">앉아 있던 방 <span class="code">${esc(roomCode.toUpperCase())}</span></div><button class="btn gold" id="btnRejoin">돌아가기</button></div>`;
  box.classList.remove('hidden');
  $('#btnRejoin').onclick = () => joinTable(roomCode);
}

// ───────── 방 입장 / 연결 ─────────
async function joinTable(c){
  if (!user) { pendingJoin = c; return toast('먼저 로그인하세요'); }
  code = c.toLowerCase();
  const r = await api({ t: 'join' });
  if (!r.ok) { code = null; return; }
  try { history.replaceState(null, '', '#' + code); } catch(e){ location.hash = code; }
  inGame = true; PS = null; chatLines = []; resetFx();
  $('#entry').classList.add('hidden'); $('#game').classList.remove('hidden');
  $('#hCode').textContent = code.toUpperCase();
  if (!r.seated) toast('자리가 꽉 차서 관전으로 들어왔어요');
  openStream();
  render();
}
function openStream(){
  if (es) es.close();
  es = new EventSource(`/events?room=${encodeURIComponent(code)}&sess=${encodeURIComponent(sess)}`);
  es.onopen = () => netState(true);
  es.addEventListener('st', e => {
    try { PS = JSON.parse(e.data); psAt = Date.now(); } catch(err){ return; }
    netState(true); render();
  });
  es.addEventListener('ch', e => { try { const d = JSON.parse(e.data); chatLines.push({ nm: d.nm, x: d.x }); if (chatLines.length > 60) chatLines.shift(); renderLog(); } catch(err){} });
  es.addEventListener('kick', () => { toast('방에서 내보내졌어요'); leaveGame(true); });
  es.addEventListener('chip', e => {
    let d; try { d = JSON.parse(e.data); } catch(err){ return; }
    myReq = null;
    if (d.status === 'approved') toast(d.later ? `칩 ${won(d.amount)} 충전이 승인됐어요. 이번 판이 끝나면 들어와요` : `칩 ${won(d.amount)} 충전이 승인됐어요!`);
    else toast('칩 충전 요청이 거절됐어요');
  });
  es.addEventListener('closed', () => { toast('관리자가 방을 닫았어요'); leaveGame(true); });
  es.onerror = async () => {
    netState(false);
    if (es && es.readyState === 2) {
      const r = await api({ t: 'join' }, true);
      if (!r.ok && (r.status === 404 || r.status === 403)) { toast(r.status === 404 ? '방이 닫혔어요' : '들어갈 수 없는 방이에요'); leaveGame(true); }
      else if (r.ok && inGame) setTimeout(openStream, 1500);
    }
  };
}
function netState(c){ const el = $('#hNet'); el.textContent = c ? '연결됨' : '재연결 중…'; el.className = 'chip-s ' + (c ? 'ok' : 'bad'); }
function leaveGame(silent){
  if (!silent && code) api({ t: 'leave' }, true);
  if (es) { es.close(); es = null; }
  inGame = false; code = null; PS = null; resetFx();
  try { history.replaceState(null, '', location.pathname); } catch(e){}
  $('#game').classList.add('hidden'); $('#entry').classList.remove('hidden');
  $('#resumeBox').classList.add('hidden');
  setTimeout(() => { refreshMe(); }, 300);
  renderEntry(); loadTables();
}
$('#btnLeave').onclick = () => confirmBox('방에서 나갈까요?', '진행 중인 판이 있으면 다이 처리돼요. 칩은 계정에 저장돼요.', '나가기', () => leaveGame(false));
$('#btnCopy').onclick = async () => {
  const link = location.origin + location.pathname + '#' + code;
  try { await navigator.clipboard.writeText(link); toast('초대 링크를 복사했어요'); } catch(e){ toast(link); }
};
$('#btnRebuy').onclick = openChipModal;
$('#btnRanks').onclick = showRanks;
const soundBtn = () => { $('#btnSound').textContent = FX.muted() ? '🔇' : '🔊'; };
$('#btnSound').onclick = () => { FX.setMuted(!FX.muted()); soundBtn(); };
soundBtn();
window.addEventListener('resize', () => { if (inGame) render(); });
window.addEventListener('hashchange', () => { if (!inGame) showInvite(); });

// 채팅
const EMOTES = ['ㅋㅋㅋ', '아 ㅡㅡ', '쫄?', '올인 각', '굿굿', 'ㅠㅠ'];
$('#emotes').innerHTML = EMOTES.map(e => `<button type="button" data-e="${esc(e)}">${esc(e)}</button>`).join('');
$('#emotes').addEventListener('click', e => { const b = e.target.closest('[data-e]'); if (b) api({ t: 'chat', x: b.dataset.e }, true); });
$('#chatForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#chatIn').value.trim(); if (v) { api({ t: 'chat', x: v.slice(0, 80) }, true); $('#chatIn').value = ''; } });

// ───────── 렌더 ─────────
// public/cards/01-1.png ~ 10-2.png 가 있으면 그 이미지를 카드로 쓴다 (1 = 광·열끗, 2 = 띠·피)
let cardImages = false;
const cardFile = c => `cards/${String((c >> 1) + 1).padStart(2, '0')}-${c % 2 === 0 ? 1 : 2}.png`;
fetch(cardFile(0), { method: 'HEAD' }).then(r => {
  if (r.ok && /^image\//.test(r.headers.get('content-type') || '')) { cardImages = true; heroFan(); render(); }
}).catch(() => {});
function cardHTML(c, o){
  o = o || {};
  const cls = 'hw' + (o.lg ? ' lg' : '') + (o.incoming ? ' incoming' : '') + (o.flip ? ' flip' : '');
  const attrs = (o.key ? ` data-ck="${o.key}"` : '') + (o.flip ? ` style="animation-delay:-${o.flipAgo || 0}ms"` : '');
  if (c == null) return `<div class="${cls}"${attrs}>${HwatuArt.back()}</div>`;
  const inner = cardImages ? `<img class="hwsvg" src="${cardFile(c)}" alt="">` : HwatuArt.face(c);
  return `<div class="${cls}" title="${HwatuArt.label(c)}"${attrs}>${inner}</div>`;
}
function heroFan(){ const f = $('#heroFan'); if (f) f.innerHTML = cardHTML(4) + cardHTML(14); }
heroFan();

function stackHTML(amount, maxCols){
  let rem = Math.max(0, amount || 0); const cols = [];
  for (const [v, cls] of [[5000, 'c5'], [1000, 'c4'], [500, 'c3'], [100, 'c2'], [1, 'c1']]) {
    const k = Math.floor(rem / v);
    if (k > 0) { rem -= k * v; cols.push(`<div class="col">${`<div class="chip ${cls}"></div>`.repeat(Math.min(k, 6))}</div>`); }
  }
  return `<div class="stack">${cols.slice(0, maxCols || 3).join('')}</div>`;
}

// 애니메이션 상태: 리렌더가 와도 연출이 끊기지 않게 key로 기억
const seenCards = new Set(), pendingCards = new Set(), firstSeen = new Map();
const since = k => { const n = Date.now(); if (!firstSeen.has(k)) firstSeen.set(k, n); return n - firstSeen.get(k); };
let prevSnap = null;
function resetFx(){ seenCards.clear(); pendingCards.clear(); firstSeen.clear(); prevSnap = null; }

const ACT_LABEL = { die: '다이', check: '체크', call: '콜', bbing: '삥', half: '하프', ddadang: '따당' };
function seatLayout(n){
  const wrap = $('#tableWrap'), W = wrap.clientWidth || 800;
  const seatW = matchMedia('(max-width:860px)').matches ? 100 : 132;
  const rx = Math.min(43, 50 - (seatW / 2 + 6) / W * 100), ry = 33;
  return Array.from({ length: n }, (_, i) => {
    const a = (150 + 240 * (i + .5) / n) * Math.PI / 180;
    return { x: 50 + rx * Math.cos(a), y: 49 + ry * Math.sin(a) };
  });
}

function render(){
  if (!inGame) return;
  const s = PS;
  const myId = s ? s.you : null;
  if (s) myReq = s.req || null;
  $('#btnRebuy').textContent = myReq ? '충전 대기 중' : '칩 충전';
  renderHostbar();
  if (!s) {
    $('#seats').innerHTML = ''; $('#bets').innerHTML = '';
    $('#center').innerHTML = `<div class="banner"><span class="big">자리 잡는 중…</span></div>`;
    $('#me').innerHTML = ''; renderLog(); return;
  }
  const h = s.h, ph = s.ph, now = Date.now();
  const players = (s.pl || []).map(([id, name, chips, f]) => ({ id, name, chips, bot: !!(f & 1), away: !!(f & 2) }));
  const byId = Object.fromEntries(players.map(p => [p.id, p]));
  const meIdx = players.findIndex(p => p.id === myId);
  const others = meIdx >= 0 ? players.slice(meIdx + 1).concat(players.slice(0, meIdx)) : players;
  const res = h && h.res;
  const inHand = id => !!(h && h.seats.includes(id));
  const folded = id => !!(h && (h.fo || []).includes(id));
  const allin = id => !!(h && (h.ai || []).includes(id));
  const winners = res && res.winners || [];
  const revealed = res && res.cards || {};
  const ev = res && res.ev || {};
  const isHost = s.host === myId;
  const handKey = h ? h.no + ':' + h.dl : '';
  const skipAnim = !prevSnap; // 막 들어왔을 땐 연출 없이 현재 상태만
  if (h && prevSnap && prevSnap.no !== h.no) { seenCards.clear(); pendingCards.clear(); firstSeen.clear(); }
  const newCards = [];
  const cardOpts = (id, k) => {
    const key = `${handKey}:${id}:${k}`;
    if (!seenCards.has(key)) { seenCards.add(key); if (!skipAnim) { pendingCards.add(key); newCards.push({ key, order: k * 10 + h.seats.indexOf(id) }); } }
    return { key, incoming: pendingCards.has(key) };
  };
  const initial = n => esc(String(n || '?').trim().slice(0, 1));

  // 좌석
  const pos = seatLayout(others.length);
  $('#seats').innerHTML = others.map((p, i) => {
    const cl = ['seat'];
    const turn = h && ph === 'bet' && h.ta === p.id;
    if (turn) cl.push('turn');
    if (folded(p.id)) cl.push('folded');
    if (p.away) cl.push('away');
    if (ph === 'show' && winners.includes(p.id) && res.type !== 'redeal') cl.push('win');
    let cards = '';
    if (inHand(p.id) && (!folded(p.id) || revealed[p.id])) {
      if (revealed[p.id]) cards = revealed[p.id].map((c, k) => cardHTML(c, { key: `${handKey}:${p.id}:${k}`, flip: true, flipAgo: since('rv:' + handKey + p.id) })).join('');
      else cards = Array.from({ length: h.nc }, (_, k) => cardHTML(null, cardOpts(p.id, k))).join('');
    }
    let st = '';
    if (!inHand(p.id)) st = p.chips <= 0 ? '칩 없음' : (ph === 'bet' ? '다음 판부터' : '');
    else if (folded(p.id)) st = '다이';
    else if (ph === 'show' && ev[p.id]) st = `<span class="hn">${esc(ev[p.id])}</span>`;
    else if (allin(p.id)) st = '<b>올인</b>';
    else if (turn) st = '<b>고민 중…</b>';
    if (ph === 'show' && res && res.pay && res.pay[p.id]) st += ` <b>+${won(res.pay[p.id])}</b>`;
    const la = h && ph === 'bet' && h.la && h.la[p.id];
    const bub = la ? `<div class="bubble ${la === 'die' ? 'die' : /bbing|half|ddadang/.test(la) ? 'raise' : ''}" style="animation-delay:-${since('la:' + handKey + h.rd + p.id + la)}ms">${ACT_LABEL[la] || ''}</div>` : '';
    const canKick = isHost && !(ph === 'bet' && inHand(p.id) && !folded(p.id));
    return `<div class="${cl.join(' ')}" style="left:${pos[i].x}%;top:${pos[i].y}%" data-seat="${esc(p.id)}">
      ${canKick ? `<button class="x" data-kick="${esc(p.id)}" title="내보내기">✕</button>` : ''}
      ${bub}
      <div class="cards">${cards}</div>
      <div class="plate"><div class="ava${p.bot ? ' bot' : ''}">${initial(p.name)}</div>
        <div class="who"><div class="nm">${esc(p.name)}</div><div class="ch">${won(p.chips)}</div></div>
        <div class="tags">${s.sun === p.id && h ? '<span class="tag sun">선</span>' : ''}${s.host === p.id ? '<span class="tag host">방장</span>' : ''}${p.bot ? '<span class="tag bot">봇</span>' : ''}${p.away ? '<span class="tag">자리비움</span>' : ''}</div>
      </div>
      <div class="st">${st}</div>
    </div>`;
  }).join('') || `<div class="banner" style="position:absolute;left:50%;top:22%;transform:translateX(-50%);width:80%;text-align:center">아직 아무도 없어요.<br>[초대 링크 복사]로 친구를 부르세요.</div>`;

  // 베팅 칩 (자리마다 위치를 잡아둬야 칩이 날아갈 수 있다)
  const betSpots = others.map((p, i) => ({ id: p.id, x: 50 + (pos[i].x - 50) * .62, y: 49 + (pos[i].y - 49) * .62 }));
  if (myId) betSpots.push({ id: myId, x: 50, y: 82 });
  $('#bets').innerHTML = betSpots.map(b => {
    const amt = h && ph === 'bet' && h.bet ? (h.bet[b.id] || 0) : 0;
    return `<div class="bet" data-bet="${esc(b.id)}" style="left:${b.x}%;top:${b.y}%">${amt ? stackHTML(amt, 2) + `<span>${won(amt)}</span>` : ''}</div>`;
  }).join('');

  // 가운데: 덱 · 판돈 · 안내
  let banner = '';
  if (ph === 'lobby' || !h) {
    const n = players.filter(p => p.chips > 0 && !p.away).length;
    const rk = s.rake && s.rake.rate > 0 ? ` · 수수료 ${s.rake.rate}%${s.rake.cap ? `(최대 ${won(s.rake.cap)})` : ''}` : '';
    banner = `<span class="big">${n >= 2 ? '시작 대기' : '사람 모으는 중'}</span>${n}명 · 판돈 ${won(s.ante)}${rk}<br>${isHost ? (n >= 2 ? '위의 [게임 시작]을 누르세요' : '2명 이상 필요해요. 봇을 넣어도 돼요') : '방장이 시작하면 패가 돌아가요'}`;
  } else if (ph === 'bet') {
    const tn = byId[h.ta];
    banner = `<span class="big">${h.rd === 1 ? '첫 장' : '두 번째 장'}</span>${tn ? (tn.id === myId ? '내 차례예요' : esc(tn.name) + ' 차례') : ''}${h.cur ? ` · 현재 ${won(h.cur)}` : ''}`;
  } else if (ph === 'show' && res) {
    const ago = since('res:' + handKey + res.type);
    if (res.type === 'redeal') {
      const by = byId[res.by];
      banner = `<div class="seal" style="animation-delay:-${ago}ms">${esc(res.name)} 재경기</div><div style="margin-top:8px">${esc(by ? by.name : '')}의 ${esc(res.name)} — 판돈 그대로 다시 돌려요</div>`;
    } else {
      const wn = winners.map(id => (byId[id] || {}).name).filter(Boolean).map(esc).join(', ');
      const wh = res.type === 'show' && winners[0] && ev[winners[0]] ? ev[winners[0]] : '';
      banner = `${wh ? `<div class="seal" style="animation-delay:-${ago}ms">${esc(wh)}</div>` : ''}<span class="big" style="margin-top:6px">${wn} 승!</span>${res.type === 'fold' ? '모두 다이' : (res.catchBy ? `${esc(res.catchBy)}로 잡았어요` : '')}${res.rake ? ` · 수수료 ${won(res.rake)}` : ''}${s.auto && s.canStart ? ' · 곧 다음 판' : ''}`;
    }
  }
  const pot = h ? h.pot : 0;
  $('#center').innerHTML = `<div class="potRow">
      <div class="deck" id="deck">${cardHTML(null)}${cardHTML(null)}${cardHTML(null)}</div>
      <div class="pot" id="pot">${pot ? stackHTML(pot, 4) : ''}<div class="amt">${won(pot)}</div><small>${h ? `판돈 · ${h.no}판` : '판돈'}</small></div>
    </div><div class="banner">${banner}</div>`;

  // 내 자리
  const mp = byId[myId];
  const meEl = $('#me');
  if (!mp) {
    meEl.classList.remove('turn');
    meEl.innerHTML = `<div class="info"><div class="myname">관전 중</div><div class="mychips">${players.length >= Sutda.MAX_PLAYERS ? '자리가 꽉 찼어요 (최대 6명).' : '자리에 앉는 중…'}</div></div>`;
  } else {
    const myTurn = !!(h && ph === 'bet' && h.ta === myId);
    meEl.classList.toggle('turn', myTurn);
    const mine = (res && revealed[myId]) || (s.me && h && s.me.no === h.no ? s.me.cards : null);
    let mc = '';
    if (inHand(myId)) {
      const n = folded(myId) ? (mine ? mine.length : 0) : Math.max(h.nc, mine ? mine.length : 0);
      mc = Array.from({ length: n }, (_, k) => cardHTML(mine && mine[k] != null ? mine[k] : null, Object.assign({ lg: true }, folded(myId) ? {} : cardOpts(myId, k)))).join('');
    }
    let hn = '';
    if (mine && mine.length === 2) hn = Sutda.evalHand(mine).name;
    else if (mine && mine.length === 1) { const k = Sutda.card(mine[0]); hn = `${k.m}월${k.kind === 'gwang' ? ' 광' : ''}`; }
    if (h && [0, 1].some(k => pendingCards.has(`${handKey}:${myId}:${k}`))) hn = ''; // 카드가 도착한 뒤에 족보 공개
    let status = '';
    if (!inHand(myId)) status = mp.chips <= 0 ? (myReq ? '칩 충전 승인을 기다리는 중' : '칩이 없어요 — 위의 [칩 충전]으로 요청하세요') : (ph === 'bet' ? '다음 판부터 참여해요' : '');
    else if (folded(myId)) status = '다이했어요';
    else if (allin(myId)) status = '올인!';
    else if (myTurn) status = '<b style="color:var(--red)">내 차례</b>';
    if (ph === 'show' && res && res.pay && res.pay[myId]) status = `<b style="color:var(--red)">+${won(res.pay[myId])} 획득!</b>`;
    const lg = myTurn ? (h.lg || {}) : {};
    const need = h ? Math.max(0, h.cur - ((h.bet && h.bet[myId]) || 0)) : 0;
    const B = (k, label, cls) => {
      const ok = k in lg, cost = ok ? lg[k] : null;
      const sub = k === 'die' ? '포기' : k === 'check' ? '그냥 넘김' : ok ? won(cost) + (cost >= mp.chips && cost > 0 ? ' 올인' : '') : (k === 'call' && need ? won(need) : '');
      return `<button class="act ${cls}" data-act="${k}" ${ok ? '' : 'disabled'}>${label}<small>${sub}</small></button>`;
    };
    const showCheck = 'check' in lg || (!myTurn && need === 0);
    meEl.innerHTML = `
      <div class="mycards${folded(myId) ? ' folded' : ''}">${mc || '<span class="muted">패 없음</span>'}</div>
      <div class="info">
        <div class="meRow"><div class="ava">${initial(mp.name)}</div>
          <div><div class="myname">${esc(mp.name)} ${s.sun === myId && h ? '<span class="tag sun">선</span>' : ''}${isHost ? ' <span class="tag host">방장</span>' : ''}</div>
          <div class="mychips">보유 <b>${won(mp.chips)}</b>${status ? ' · ' + status : ''}</div></div></div>
        <div class="myhand">${esc(hn)}</div>
        ${myTurn ? '<div class="timer"><i data-timer></i></div>' : ''}
      </div>
      <div id="actions">
        ${B('die', '다이', 'die')}
        ${showCheck ? B('check', '체크', 'call') : B('call', '콜', 'call')}
        ${B('bbing', '삥', 'raise')}
        ${B('half', '하프', 'raise')}
        ${B('ddadang', '따당', 'raise')}
        <button class="act" data-act="ranks">족보<small>보기</small></button>
      </div>`;
  }

  // ── 연출 ──
  const deckEl = () => { const d = $('#deck'); return d && d.getBoundingClientRect().width ? d : $('#pot'); };
  newCards.sort((a, b) => a.order - b.order).forEach((c, i) => {
    FX.flyCard(deckEl(), document.querySelector(`[data-ck="${c.key}"]`), i * 120, () => {
      pendingCards.delete(c.key);
      const e = document.querySelector(`[data-ck="${c.key}"]`); if (e) e.classList.remove('incoming');
      if (!pendingCards.size) render();
    });
  });
  const seatEl = id => id === myId ? document.querySelector('#me .ava') : document.querySelector(`[data-seat="${CSS.escape(id)}"] .plate`);
  const betEl = id => document.querySelector(`[data-bet="${CSS.escape(id)}"]`);
  const potEl = $('#pot');
  const P = prevSnap;
  if (h && P && !skipAnim) {
    if (P.no !== h.no) h.seats.forEach((id, i) => FX.flyChips(seatEl(id), potEl, 1, i * 70));               // 판돈 걷기
    else {
      const sameRound = P.dl === h.dl && P.rd === h.rd;
      for (const id of h.seats) {
        const was = (P.bet && P.bet[id]) || 0, cur = (h.bet && h.bet[id]) || 0;
        if (sameRound && cur > was) FX.flyChips(seatEl(id), betEl(id), Math.ceil((cur - was) / Math.max(1, s.ante) / 2) + 1, 0);
        if (!sameRound && was > 0) FX.flyChips(betEl(id), potEl, 3, 0);                                        // 라운드 끝: 베팅 → 판돈
      }
      if (ph === 'bet' && P.ph === 'bet' && sameRound) {
        const newFold = (h.fo || []).filter(id => !(P.fo || []).includes(id));
        if (newFold.length) FX.sound.die();
      }
    }
    if (ph === 'bet' && h.ta === myId && P.ta !== myId) FX.sound.turn();
    const rk = res ? handKey + ':' + res.type : '';
    if (res && P.rk !== rk) {
      FX.sound.stamp();
      if (res.type !== 'redeal') {
        winners.forEach((w, i) => { FX.flyChips(potEl, seatEl(w), 6, 500 + i * 150); setTimeout(() => FX.burst(seatEl(w), w === myId), 650); });
        if (inHand(myId)) setTimeout(() => (winners.includes(myId) ? FX.sound.win() : FX.sound.lose()), 450);
      }
    }
  }
  prevSnap = h ? { no: h.no, dl: h.dl, rd: h.rd, bet: Object.assign({}, h.bet), fo: (h.fo || []).slice(), ta: h.ta, ph, rk: res ? handKey + ':' + res.type : '' } : { ph };
  if (firstSeen.size > 400) firstSeen.clear();
  renderLog();
  renderTimers();
}
function renderHostbar(){
  const hb = $('#hostbar'), s = PS;
  if (!s || s.host !== s.you) { hb.classList.add('hidden'); hb.dataset.sig = ''; return; }
  hb.classList.remove('hidden');
  const redealPending = s.ph === 'show' && s.h && s.h.res && s.h.res.type === 'redeal';
  const sig = [s.ph, s.ante, s.auto, s.pl.length, s.canStart, redealPending].join('|');
  if (hb.dataset.sig === sig) return; hb.dataset.sig = sig;
  const betting = s.ph === 'bet';
  hb.innerHTML = `<span class="lbl">방장</span>
    <button class="btn gold" id="hbStart" ${betting || redealPending || !s.canStart ? 'disabled' : ''}>${s.ph === 'show' ? '다음 판' : '게임 시작'}</button>
    <button class="btn" id="hbBot" ${s.pl.length >= Sutda.MAX_PLAYERS ? 'disabled' : ''}>봇 추가</button>
    <select id="hbAnte" ${betting ? 'disabled' : ''} title="판돈">${[100, 500, 1000, 5000].map(a => `<option value="${a}" ${s.ante === a ? 'selected' : ''}>판돈 ${won(a)}</option>`).join('')}</select>
    <label class="chk"><input type="checkbox" id="hbAuto" ${s.auto ? 'checked' : ''}> 자동으로 다음 판</label>`;
  $('#hbStart').onclick = () => api({ t: 'start' });
  $('#hbBot').onclick = () => api({ t: 'bot' });
  $('#hbAnte').onchange = e => api({ t: 'ante', ante: Number(e.target.value) });
  $('#hbAuto').onchange = e => api({ t: 'auto', on: e.target.checked });
}
function renderLog(){
  if (!inGame) return;
  const sys = (PS && PS.log || []).map(l => `<div class="sys">${esc(l)}</div>`);
  const chats = chatLines.slice(-30).map(c => `<div class="chat"><b>${esc(c.nm)}</b> ${esc(c.x)}</div>`);
  const el = $('#log');
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.innerHTML = sys.join('') + (chats.length ? '<div class="sys" style="margin-top:6px">— 채팅 —</div>' + chats.join('') : '');
  if (atBottom) el.scrollTop = el.scrollHeight;
}
function renderTimers(){
  if (!PS || !PS.h || PS.ph !== 'bet') return;
  const left = PS.h.left - (Date.now() - psAt);
  const pct = Math.max(0, Math.min(100, left / (PS.turnMs || 30000) * 100));
  document.querySelectorAll('[data-timer]').forEach(el => { el.style.width = pct + '%'; });
  document.querySelectorAll('.seat.turn .ava, #me.turn .ava').forEach(el => el.style.setProperty('--p', pct.toFixed(1)));
}
setInterval(renderTimers, 250);
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (a && !a.disabled) {
    const k = a.dataset.act;
    if (k === 'ranks') return showRanks();
    document.querySelectorAll('#actions .act').forEach(b => { if (b.dataset.act !== 'ranks') b.disabled = true; });
    api({ t: 'act', k }).then(r => { if (!r.ok) render(); });
    return;
  }
  const kk = e.target.closest('[data-kick]');
  if (kk) api({ t: 'kick', target: kk.dataset.kick });
});

// ───────── 칩 충전 요청 ─────────
const REQ_AMOUNTS = [10000, 30000, 50000, 100000];
function openChipModal(){
  if (!user) return toast('먼저 로그인하세요');
  if (myReq) {
    openModal(`<h2>칩 충전 요청</h2><p>칩 <b>${won(myReq.amount)}</b> 충전 요청을 관리자가 확인하고 있어요.<br><span class="muted">승인되면 바로 알려드려요.</span></p>
      <div class="row"><button class="btn" data-close>닫기</button><button class="btn red" id="crCancel">요청 취소</button></div>`);
    $('#crCancel').onclick = async () => {
      const r = await api({ t: 'chipCancel' });
      if (r.ok || r.status === 404) { myReq = null; closeModal(); toast('충전 요청을 취소했어요'); renderEntry(); render(); }
    };
    return;
  }
  openModal(`<h2>칩 충전 요청</h2>
    <p class="muted" style="margin-top:0">관리자가 승인하면 칩이 들어와요. 게임 중이면 그 판이 끝난 뒤에 들어와요.</p>
    <div class="amts">${REQ_AMOUNTS.map((a, i) => `<label class="amt"><input type="radio" name="amt" value="${a}" ${i === 0 ? 'checked' : ''}><span>${won(a)}</span></label>`).join('')}</div>
    <input id="crNote" class="inp" maxlength="40" placeholder="관리자에게 한마디 (선택)">
    <div class="row" style="margin-top:14px"><button class="btn" data-close>취소</button><button class="btn gold" id="crSend">요청 보내기</button></div>`);
  $('#crSend').onclick = async () => {
    const amount = Number(document.querySelector('input[name=amt]:checked').value);
    $('#crSend').disabled = true;
    const r = await api({ t: 'chipReq', amount, note: $('#crNote').value.trim() });
    $('#crSend').disabled = false;
    if (r.ok) { myReq = { amount }; closeModal(); toast('충전 요청을 보냈어요. 관리자가 확인하면 알려드려요'); renderEntry(); render(); }
  };
}
// 입장 화면에 있을 때는 대기 중인 요청이 처리됐는지 가끔 확인
setInterval(async () => {
  if (inGame || !user || !myReq) return;
  const before = user.chips, r = await refreshMe();
  if (r && !r.req) toast(user.chips > before ? `칩 충전이 승인됐어요! (+${won(user.chips - before)})` : '칩 충전 요청이 처리됐어요');
}, 12000);

// ───────── 모달 / 토스트 ─────────
function openModal(html){ $('#modalBox').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal(){ $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
function confirmBox(title, body, okLabel, fn){
  openModal(`<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="row"><button class="btn" data-close>취소</button><button class="btn red" id="cfOk">${esc(okLabel)}</button></div>`);
  $('#cfOk').onclick = () => { closeModal(); fn(); };
}
function showRanks(){
  const R = [
    ['38광땡', '3월 광 + 8월 광. 최강'], ['13·18광땡', '1월 광 + 3월 광 / 1월 광 + 8월 광'],
    ['땡', '같은 월 두 장. 장땡(10) > 9땡 > … > 1땡'],
    ['알리', '1 + 2'], ['독사', '1 + 4'], ['구삥', '1 + 9'], ['장삥', '1 + 10'], ['장사', '4 + 10'], ['세륙', '4 + 6'],
    ['끗', '두 장 합의 일의 자리. 갑오(9끗) > 8끗 > … > 1끗 > 망통(0)'],
    ['암행어사', '4월 열끗 + 7월 열끗. 13·18광땡을 잡음 (아니면 1끗)'],
    ['땡잡이', '3월 광 + 7월 열끗. 1~9땡을 잡음 (아니면 망통)'],
    ['구사', '4 + 9. 상대 최고가 알리 이하면 재경기 (아니면 3끗)'],
    ['멍텅구리구사', '4월 열끗 + 9월 열끗. 상대가 장땡 이하면 재경기'],
  ];
  const A = [['삥', '첫 베팅을 판돈만큼'], ['하프', '콜하고 판 전체의 절반만큼 더'], ['따당', '앞 사람 베팅의 두 배로'], ['콜 / 체크', '맞추기 / 그냥 넘기기'], ['다이', '포기']];
  openModal(`<h2>족보</h2><table class="rank-t">${R.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
    <h2 style="margin-top:18px">베팅</h2><table class="rank-t">${A.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
    <p class="muted">한 장 받고 한 번, 두 장째 받고 한 번 베팅해요. 같은 족보면 판돈을 나눠요. 올인한 사람은 자기가 건 만큼만 먹어요(사이드팟).</p>
    <div style="text-align:right"><button class="btn gold" data-close>닫기</button></div>`);
}
let toastT = 0;
function toast(t){
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = t; clearTimeout(toastT); toastT = setTimeout(() => el.remove(), 2600);
}

// ───────── 시작 ─────────
(async () => {
  renderEntry(); loadTables();
  if (!sess) { $('#authBox').classList.remove('hidden'); return; }
  const r = await refreshMe();
  if (!r) { renderEntry(); return; }
  const c = inviteCode();
  if (c) joinTable(c);
  else if (r.room) showResume(r.room);
})();
})();

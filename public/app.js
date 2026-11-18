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
let myReq = null;          // 대기 중인 내 칩 요청 {amount, kind: 'charge'|'return'}

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
        <div class="stats"><span>칩 <b>${won(user.chips)}</b></span>${heldText() ? `<span class="held">${heldText()}</span>` : ''}</div>
        ${myReq ? `<div class="reqline">칩 ${won(myReq.amount)} ${reqWord()} 요청을 관리자가 확인하고 있어요</div>` : ''}</div>
      <div class="row" style="flex:0 0 auto">${user.admin ? '<a class="hbtn" href="/admin" style="text-decoration:none;color:var(--red);font-weight:700">관리자</a>' : ''}<button class="hbtn" id="btnChip">${myReq ? reqWord() + ' 대기 중' : '칩 충전·반납'}</button><button class="hbtn" id="btnNick">닉네임 변경</button><button class="hbtn" id="btnLogout">로그아웃</button></div></div>`;
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
// 방 규칙은 방을 만들 때 정하고, 그 방에서는 바꿀 수 없음
const ANTES = [100, 500, 1000, 5000];
const blindText = bb => `${won(Math.max(1, Math.floor(bb / 2)))}/${won(bb)}`;
const ruleText = r => r.kind === 'holdem'
  ? `홀덤 · 블라인드 ${blindText(r.bb || r.ante)} · ${r.lim === 'pl' ? '팟리밋' : '노리밋'} · 땡값 ${r.tg ? '있음' : '없음'}`
  : `섯다 · 판돈 ${won(r.ante)} · ${r.mode === 'two' ? '두 장 받고 한 번 베팅' : '한 장씩 두 번 베팅'} · 땡값 ${r.tg ? '있음' : '없음'} · 동점 ${r.tie === 'split' ? '나눠 갖기' : '재경기'}`;
function create(solo, kind){
  if (!user) return toast('먼저 로그인하세요');
  const last = Object.assign({ kind: 'sutda', ante: 100, mode: 'one', ttaeng: true, tie: 'replay', bb: 100, lim: 'nl', hTg: true }, store.get('sutda-rules') || {});
  kind = kind || last.kind || 'sutda';
  const pill = (name, val, label, on) => `<label class="pill"><input type="radio" name="${name}" value="${val}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
  const opts = kind === 'holdem' ? `
    <div class="opt"><div class="olbl">블라인드 (스몰/빅)</div><div class="seg">${ANTES.map(a => pill('rBB', a, blindText(a), last.bb === a)).join('')}</div></div>
    <div class="opt"><div class="olbl">베팅 방식</div><div class="seg">${pill('rLim', 'nl', '노리밋', last.lim !== 'pl')}${pill('rLim', 'pl', '팟리밋', last.lim === 'pl')}</div>
      <div class="muted" style="margin-top:6px">노리밋: 언제든 가진 칩까지 올릴 수 있어요 · 팟리밋: 한 번에 판돈 크기까지만</div></div>
    <div class="opt"><div class="olbl">땡값</div><div class="seg">${pill('rTg', '1', '있음', last.hTg)}${pill('rTg', '0', '없음', !last.hTg)}</div>
      <div class="muted" style="margin-top:6px">이긴 사람이 건 금액 × 로티플 3배 · 스티플(백티플) 2배 · 포카드 1배 (끝까지 남은 사람만 냄)</div></div>` : `
    <div class="opt"><div class="olbl">판돈</div><div class="seg">${ANTES.map(a => pill('rAnte', a, won(a), last.ante === a)).join('')}</div></div>
    <div class="opt"><div class="olbl">진행 방식</div><div class="seg">${pill('rMode', 'one', '한 장씩 · 2번 베팅', last.mode !== 'two')}${pill('rMode', 'two', '두 장 받고 · 1번 베팅', last.mode === 'two')}</div></div>
    <div class="opt"><div class="olbl">땡값</div><div class="seg">${pill('rTg', '1', '있음', last.ttaeng)}${pill('rTg', '0', '없음', !last.ttaeng)}</div>
      <div class="muted" style="margin-top:6px">장땡 판돈 100% · 13·18광땡 150% · 38광땡 200% (끝까지 남은 사람만 냄)</div></div>
    <div class="opt"><div class="olbl">패가 같을 때</div><div class="seg">${pill('rTie', 'replay', '동점자끼리 재경기', last.tie !== 'split')}${pill('rTie', 'split', '나눠 갖기', last.tie === 'split')}</div>
      <div class="muted" style="margin-top:6px">재경기는 판돈 그대로 동점인 사람끼리 다시 겨뤄요 (최대 3번)</div></div>`;
  openModal(`<h2>${solo ? '봇이랑 연습' : '방 만들기'}</h2>
    <div class="opt"><div class="olbl">게임</div><div class="seg">${pill('rKind', 'sutda', '섯다', kind !== 'holdem')}${pill('rKind', 'holdem', '텍사스 홀덤', kind === 'holdem')}</div></div>
    ${opts}
    <p class="muted">${solo ? `봇 연습은 <b>연습 칩 10,000</b>으로 해요. 따거나 잃어도 계정 칩은 그대로예요. ` : ''}방을 만든 뒤에는 규칙을 바꿀 수 없어요.</p>
    <div class="row"><button class="btn" data-close>취소</button><button class="btn gold" id="rOk">${solo ? '연습 시작' : '방 만들기'}</button></div>`);
  document.querySelectorAll('input[name=rKind]').forEach(el => el.onchange = () => {
    store.set('sutda-rules', Object.assign(last, { kind: el.value })); create(solo, el.value);
  });
  $('#rOk').onclick = async () => {
    const val = n => document.querySelector(`input[name=${n}]:checked`).value;
    let rules;
    if (kind === 'holdem') { rules = { kind, ante: Number(val('rBB')), lim: val('rLim'), ttaeng: val('rTg') === '1' }; Object.assign(last, { kind, bb: rules.ante, lim: rules.lim, hTg: rules.ttaeng }); }
    else { rules = { kind, ante: Number(val('rAnte')), mode: val('rMode'), ttaeng: val('rTg') === '1', tie: val('rTie') }; Object.assign(last, rules); }
    store.set('sutda-rules', last);
    $('#rOk').disabled = true;
    const r = await api(Object.assign({ t: 'create', solo: !!solo }, rules));
    $('#rOk').disabled = false;
    if (r.ok) { closeModal(); joinTable(r.code); }
  };
}
$('#btnCreate').onclick = () => create(false);
$('#btnSolo').onclick = () => create(true);
$('#btnJoin').onclick = () => { const c = $('#joinCode').value.trim().toLowerCase(); if (!/^[a-z0-9]{4}$/.test(c)) return toast('방 코드 4자리를 입력하세요'); joinTable(c); };
$('#joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnJoin').click(); });
$('#tables').addEventListener('click', e => {
  const c = e.target.closest('[data-join]'); if (c) return joinTable(c.dataset.join);
  const w = e.target.closest('[data-watch]'); if (w) joinTable(w.dataset.watch, true);
});

async function loadTables(){
  if (inGame) return;
  try {
    const list = await (await fetch('/api/rooms')).json();
    const t = $('#tables');
    if (!list.length) { t.innerHTML = '<div class="muted">지금 열린 방이 없어요.</div>'; return; }
    t.innerHTML = list.map(r => `<div class="tbl-item"><div><b>${esc(r.host)}</b>의 방 <span class="code" style="font-size:12px">${esc(r.code.toUpperCase())}</span>
      <div class="muted">${Number(r.n)||0}명${r.w ? ` · 관전 ${Number(r.w)}명` : ''} · ${r.st === 'bet' ? '게임 중' : '대기 중'}</div>
      <div class="muted">${ruleText({ kind: r.kind, ante: Number(r.ante) || 100, bb: Number(r.ante) || 100, lim: r.lim, mode: r.mode, tg: r.tg, tie: r.tie })}</div></div>
      <div class="tbl-btns"><button class="btn" data-watch="${esc(r.code)}">관전</button><button class="btn gold" data-join="${esc(r.code)}">입장</button></div></div>`).join('');
  } catch(e){ $('#tables').innerHTML = '<div class="muted">서버에 연결할 수 없어요.</div>'; }
}
setInterval(loadTables, 4000);

function inviteCode(){ const m = /^#([a-z0-9]{4})$/i.exec(location.hash); return m ? m[1].toLowerCase() : null; }
function showInvite(){
  const c = inviteCode(), box = $('#inviteBox');
  if (!c || inGame) { box.classList.add('hidden'); return false; }
  box.innerHTML = `<h3>초대받은 방 <span class="code">${esc(c.toUpperCase())}</span></h3>
    <div class="muted" style="margin-bottom:10px">${user ? '아래 버튼을 눌러 입장하세요.' : '로그인하면 바로 이 방으로 들어가요. 계정이 없으면 회원가입부터 해주세요.'}</div>
    ${user ? '<div class="row"><button class="btn" id="btnInviteWatch" style="flex:0 0 110px">관전만</button><button class="btn gold" id="btnInvite">이 방으로 입장</button></div>' : ''}`;
  box.classList.remove('hidden');
  if (user) { $('#btnInvite').onclick = () => joinTable(c); $('#btnInviteWatch').onclick = () => joinTable(c, true); }
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
async function joinTable(c, watch){
  if (!user) { pendingJoin = c; return toast('먼저 로그인하세요'); }
  code = c.toLowerCase();
  const r = await api({ t: 'join', watch: !!watch });
  if (!r.ok) { code = null; return; }
  try { history.replaceState(null, '', '#' + code); } catch(e){ location.hash = code; }
  inGame = true; PS = null; chatLines = []; resetFx(); unread = 0; applyChat();
  $('#entry').classList.add('hidden'); $('#game').classList.remove('hidden');
  $('#hCode').textContent = code.toUpperCase();
  if (!r.seated) toast(watch ? '관전으로 들어왔어요. 빈자리가 있으면 [자리에 앉기]로 참가할 수 있어요' : '자리가 꽉 차서 관전으로 들어왔어요');
  openStream();
  render();
  setHdrH();
}
function openStream(){
  if (es) es.close();
  es = new EventSource(`/events?room=${encodeURIComponent(code)}&sess=${encodeURIComponent(sess)}`);
  es.onopen = () => netState(true);
  es.addEventListener('st', e => {
    try { PS = JSON.parse(e.data); psAt = Date.now(); } catch(err){ return; }
    netState(true); render();
  });
  es.addEventListener('ch', e => { try { const d = JSON.parse(e.data); chatLines.push({ nm: d.nm, x: d.x, w: !!d.w }); if (chatLines.length > 60) chatLines.shift(); renderLog(); if (!(user && d.nm.replace(' (관전)', '') === user.nick)) chatArrived(d.nm, d.x); } catch(err){} });
  es.addEventListener('kick', () => { toast('방에서 내보내졌어요'); leaveGame(true); });
  es.addEventListener('chip', e => {
    let d; try { d = JSON.parse(e.data); } catch(err){ return; }
    myReq = null;
    const w = d.kind === 'return' ? '반납' : '충전';
    if (d.status === 'approved') toast(d.kind === 'return' ? `칩 ${won(d.amount)} 반납이 처리됐어요${d.back ? ` (나머지 ${won(d.back)}은 돌아왔어요)` : ''}` : d.later ? `칩 ${won(d.amount)} 충전이 승인됐어요. 이번 판이 끝나면 들어와요` : `칩 ${won(d.amount)} 충전이 승인됐어요!`);
    else toast(d.kind === 'return' ? '칩 반납 요청이 거절돼서 떼어 둔 칩이 돌아왔어요' : `칩 ${w} 요청이 거절됐어요`);
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
$('#btnLeave').onclick = () => {
  const seated = PS && (PS.pl || []).some(p => p[0] === PS.you);
  if (!seated || PS.practice) return confirmBox('방에서 나갈까요?', seated ? '진행 중인 판이 있으면 다이 처리돼요.' : '관전을 그만두고 나가요.', '나가기', () => leaveGame(false));
  openModal(`<h2>자리에서 일어날까요?</h2><p>진행 중인 판이 있으면 다이 처리돼요. 칩은 계정에 저장돼요.<br><span class="muted">관전으로 바꾸면 방에 남아서 계속 보고 채팅할 수 있어요.</span></p>
    <div class="row"><button class="btn" data-close>취소</button><button class="btn" id="lvWatch">관전으로 바꾸기</button><button class="btn red" id="lvGo">나가기</button></div>`);
  $('#lvWatch').onclick = async () => { closeModal(); const r = await api({ t: 'stand' }); if (r.ok) toast('관전으로 바꿨어요. [자리에 앉기]로 다시 참가할 수 있어요'); };
  $('#lvGo').onclick = () => { closeModal(); leaveGame(false); };
};
$('#btnCopy').onclick = async () => {
  const link = location.origin + location.pathname + '#' + code;
  try { await navigator.clipboard.writeText(link); toast('초대 링크를 복사했어요'); } catch(e){ toast(link); }
};
$('#btnRebuy').onclick = () => (PS && PS.practice ? api({ t: 'practiceRefill' }) : openChipModal());
$('#btnRanks').onclick = showRanks;
// 소리: 효과음+음성 → 효과음만 → 끔
const soundMode = () => FX.muted() ? 'off' : (FX.voiceOn() ? 'all' : 'fx');
const soundBtn = () => {
  const m = soundMode(), b = $('#btnSound');
  b.textContent = m === 'off' ? '🔇' : (m === 'all' ? '🔊' : '🔉');
  b.title = m === 'off' ? '소리 꺼짐' : (m === 'all' ? '효과음 + 음성' : '효과음만');
};
$('#btnSound').onclick = () => {
  const m = soundMode();
  if (!FX.voiceSupported()) { FX.setMuted(m !== 'off'); }
  else if (m === 'all') { FX.setVoice(false); }
  else if (m === 'fx') { FX.setMuted(true); }
  else { FX.setMuted(false); FX.setVoice(true); }
  soundBtn(); toast($('#btnSound').title);
  if (soundMode() === 'all') FX.say('따당!', 1.05);
};
soundBtn();

// 전체 화면 (안드로이드는 가로 고정까지)
const fsEl = document.documentElement;
const canFull = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
const isTouch = matchMedia('(pointer:coarse)').matches;
async function goFull(){
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen()); return;
    }
    await (fsEl.requestFullscreen ? fsEl.requestFullscreen({ navigationUI: 'hide' }) : fsEl.webkitRequestFullscreen());
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
  } catch(e){ toast('이 브라우저는 전체 화면을 지원하지 않아요. 휴대폰을 직접 가로로 돌려주세요'); }
}
$('#btnFull').classList.toggle('hidden', !(canFull && isTouch));
$('#btnFull').onclick = goFull;
$('#btnRotFull').classList.toggle('hidden', !canFull);
$('#btnRotFull').onclick = goFull;

// 채팅창 열기/닫기
let chatOff = false, unread = 0, peekT = 0;
try { chatOff = localStorage.getItem('sutda-chat') === 'off'; } catch(e){}
function applyChat(){
  document.body.classList.toggle('chat-off', chatOff);
  $('#btnChat').classList.toggle('on', !chatOff);
  if (!chatOff) { unread = 0; $('#chatPeek').classList.add('hidden'); }
  $('#chatBadge').textContent = unread > 9 ? '9+' : unread;
  $('#chatBadge').classList.toggle('hidden', !unread);
}
$('#btnChat').onclick = () => {
  chatOff = !chatOff; try { localStorage.setItem('sutda-chat', chatOff ? 'off' : 'on'); } catch(e){}
  applyChat(); setHdrH(); if (inGame) render();
  if (!chatOff) { const el = $('#log'); el.scrollTop = el.scrollHeight; }
};
function chatArrived(nm, x){
  if (!chatOff) return;
  unread++; applyChat();
  const pk = $('#chatPeek');
  pk.innerHTML = `<b>${esc(nm)}</b> ${esc(x)}`; pk.classList.remove('hidden');
  pk.style.animation = 'none'; void pk.offsetWidth; pk.style.animation = '';
  clearTimeout(peekT); peekT = setTimeout(() => pk.classList.add('hidden'), 3500);
}
$('#chatPeek').onclick = () => $('#btnChat').click();
applyChat();

// 가로 폰: 방장 버튼을 상단바로 (채팅을 닫아도 남게)
const landMQ = matchMedia('(orientation:landscape) and (max-height:520px)');
function placeHostbar(){
  const hb = $('#hostbar');
  if (landMQ.matches) { if (hb.parentElement.tagName !== 'HEADER') $('#hdrSp').before(hb); }
  else if (hb.parentElement.id !== 'main') $('#main').prepend(hb);
}
placeHostbar();
landMQ.addEventListener ? landMQ.addEventListener('change', placeHostbar) : landMQ.addListener(placeHostbar);
const setHdrH = () => { const hd = document.querySelector('#game header'); if (hd && hd.offsetHeight) document.documentElement.style.setProperty('--hdrH', hd.offsetHeight + 'px'); };
window.addEventListener('resize', () => { setHdrH(); if (inGame) render(); });
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
// 트럼프 카드 (홀덤). 크기·애니메이션은 화투 카드(.hw)와 같은 규칙을 따름
function pcardHTML(c, o){
  o = o || {};
  const cls = 'hw pc' + (o.lg ? ' lg' : '') + (o.incoming ? ' incoming' : '') + (o.flip ? ' flip' : '') + (o.hi ? ' hi' : '') + (o.dim ? ' dim' : '');
  const attrs = (o.key ? ` data-ck="${o.key}"` : '') + (o.flip ? ` style="animation-delay:-${o.flipAgo || 0}ms"` : '');
  if (c == null) return `<div class="${cls}"${attrs}><div class="pcb"></div></div>`;
  // 카드 그림: public/pcards/As.webp 처럼 숫자+무늬 (퍼블릭 도메인 트럼프 그림을 잘라 쓴 것)
  return `<div class="${cls}" title="${Holdem.cardName(c)}"${attrs}><img class="pcimg" src="/pcards/${Holdem.cardCode(c)}.webp" alt="${Holdem.cardName(c)}" draggable="false"></div>`;
}
function preflopName(cs){
  const [a, b] = cs.slice().sort((x, y) => Holdem.rankOf(y) - Holdem.rankOf(x));
  const ra = Holdem.RANK_KO[Holdem.rankOf(a)], rb = Holdem.RANK_KO[Holdem.rankOf(b)];
  if (Holdem.rankOf(a) === Holdem.rankOf(b)) return `포켓 ${ra}`;
  return `${ra}·${rb}${Holdem.suitOf(a) === Holdem.suitOf(b) ? ' 수티드' : ''}`;
}
let raiseUI = null; // 레이즈 금액 고르는 창 상태 {key, amt, min, max, k, ...}
// 첫 화면 부채꼴: 3월 광 · 스페이드 A · 8월 광
function heroFan(){ const f = $('#heroFan'); if (f) f.innerHTML = cardHTML(4) + pcardHTML(48) + cardHTML(14); }
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
let prevSnap = null, lastEvN = null;
function resetFx(){ seenCards.clear(); pendingCards.clear(); firstSeen.clear(); prevSnap = null; lastEvN = null; }
// 베팅 음성: 다이·체크·콜·삥·하프·따당
const VOICE_WORDS = { die: '다이', check: '체크', call: '콜', bbing: '삥', half: '하프', ddadang: '따당!', fold: '폴드', bet: '벳', raise: '레이즈', allin: '올인!' };
const VOICE_PITCH = [1.05, 0.75, 1.35, 0.9, 1.2, 0.65];
function voiceEvent(s){
  const ev = s.ev;
  if (!ev) { if (lastEvN === null) lastEvN = 0; return; }
  if (lastEvN !== null && ev.n !== lastEvN && VOICE_WORDS[ev.k]) {
    const idx = Math.max(0, (s.pl || []).findIndex(p => p[0] === ev.id));
    const word = ev.ai && !/^(die|fold|allin)$/.test(ev.k) ? VOICE_WORDS[ev.k].replace('!', '') + ', 올인!' : VOICE_WORDS[ev.k];
    FX.say(word, VOICE_PITCH[idx % VOICE_PITCH.length]);
  }
  lastEvN = ev.n;
}

const ACT_LABEL = { die: '다이', check: '체크', call: '콜', bbing: '삥', half: '하프', ddadang: '따당', fold: '폴드', bet: '벳', raise: '레이즈', allin: '올인' };
function seatLayout(n){
  const wrap = $('#tableWrap'), W = wrap.clientWidth || 800;
  // 좌석 폭·세로 반지름은 CSS 변수로 (PC / 세로 폰 / 가로 폰마다 다름)
  const cs = getComputedStyle($('#game')); // 홀덤 방은 #game.hd에서 좌석 폭을 따로 줄 수 있음
  const seatW = parseFloat(cs.getPropertyValue('--seatW')) || 132;
  const ry = parseFloat(cs.getPropertyValue('--seatRy')) || 33;
  const rx = Math.min(43, 50 - (seatW / 2 + 6) / W * 100);
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
  const practice = !!(s && s.practice);
  const rb = practice ? ['연습 칩 충전', '연습 충전'] : (myReq ? [reqWord() + ' 대기 중', '대기 중'] : ['칩 충전·반납', '칩']);
  $('#btnRebuy .t-l').textContent = rb[0]; $('#btnRebuy .t-s').textContent = rb[1];
  $('#btnCopy').classList.toggle('hidden', practice);
  $('#hCode').textContent = practice ? '봇 연습' : (code || '').toUpperCase();
  $('#hKind').textContent = s ? (s.kind === 'holdem' ? '홀덤' : '섯다') : '';
  const wl = (s && s.watch) || [];
  $('#hWatch').classList.toggle('hidden', !wl.length);
  $('#hWatch').textContent = `👀 ${wl.length}`;
  $('#hWatch').title = wl.length ? '관전 중: ' + wl.join(', ') : '';
  renderHostbar();
  if (!s) {
    $('#seats').innerHTML = ''; $('#bets').innerHTML = '';
    $('#center').innerHTML = `<div class="banner"><span class="big">자리 잡는 중…</span></div>`;
    $('#me').innerHTML = ''; renderLog(); return;
  }
  voiceEvent(s);
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
  const HD = s.kind === 'holdem';            // 홀덤 방
  const CH = HD ? pcardHTML : cardHTML;
  const rdNo = h ? (HD ? h.st : h.rd) : 0;   // 베팅 라운드 번호
  const ncards = h ? (HD ? 2 : h.nc) : 0;
  const board = HD && h ? (h.board || []) : [];
  const fiveW = HD && res && res.five && winners.length ? new Set(winners.flatMap(w => res.five[w] || [])) : null;
  const roleTags = id => HD
    ? (h ? `${s.btn === id ? '<span class="tag btn">D</span>' : ''}${h.sbId === id ? '<span class="tag blind">SB</span>' : ''}${h.bbId === id ? '<span class="tag blind">BB</span>' : ''}` : '')
    : (s.sun === id && h ? '<span class="tag sun">선</span>' : '');
  $('#game').classList.toggle('hd', HD);
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
    if (ph === 'show' && res && (res.type !== 'redeal' ? winners.includes(p.id) : (res.tie || []).includes(p.id))) cl.push('win');
    let cards = '';
    if (inHand(p.id) && (!folded(p.id) || revealed[p.id])) {
      if (revealed[p.id]) cards = revealed[p.id].map((c, k) => CH(c, { key: `${handKey}:${p.id}:${k}`, flip: true, flipAgo: since('rv:' + handKey + p.id), hi: !!fiveW && winners.includes(p.id) && fiveW.has(c) })).join('');
      else cards = Array.from({ length: ncards }, (_, k) => CH(null, cardOpts(p.id, k))).join('');
    }
    let st = '';
    if (!inHand(p.id)) st = p.chips <= 0 ? '칩 없음' : (ph === 'bet' ? '다음 판부터' : '');
    else if (folded(p.id)) {
      const rj = h.rj;
      st = HD ? '폴드' : (h.lost || []).includes(p.id) ? '패배' : '다이';
      if (ph === 'show' && rj && rj.ids.includes(p.id)) st = rj.yes.includes(p.id) ? '<b>재경기 참가!</b>' : rj.no.includes(p.id) ? '다이 (안 함)' : '<b>참가 고민 중…</b>';
    }
    else if (ph === 'show' && ev[p.id]) st = `<span class="hn">${esc(ev[p.id])}</span>`;
    else if (allin(p.id)) st = '<b>올인</b>';
    else if (turn) st = '<b>고민 중…</b>';
    if (ph === 'show' && res && res.pay && res.pay[p.id]) st += ` <b>+${won(res.pay[p.id])}</b>`;
    if (ph === 'show' && res && res.paid && res.paid[p.id]) st += ` <b>+${won(res.paid[p.id])}</b>`;
    if (ph === 'show' && res && res.tg) {
      if (res.tg.to === p.id) st += ` <b>땡값 +${won(res.tg.total)}</b>`;
      else if (res.tg.from[p.id]) st += ` <b class="neg">땡값 -${won(res.tg.from[p.id])}</b>`;
    }
    const la = h && ph === 'bet' && h.la && h.la[p.id];
    const bub = la ? `<div class="bubble ${/^(die|fold)$/.test(la) ? 'die' : /bbing|half|ddadang|bet|raise|allin/.test(la) ? 'raise' : ''}" style="animation-delay:-${since('la:' + handKey + rdNo + p.id + la)}ms">${ACT_LABEL[la] || ''}</div>` : '';
    const canKick = isHost && !(ph === 'bet' && inHand(p.id) && !folded(p.id));
    return `<div class="${cl.join(' ')}" style="left:${pos[i].x}%;top:${pos[i].y}%" data-seat="${esc(p.id)}">
      ${canKick ? `<button class="x" data-kick="${esc(p.id)}" title="내보내기">✕</button>` : ''}
      ${bub}
      <div class="cards">${cards}</div>
      <div class="plate"><div class="ava${p.bot ? ' bot' : ''}">${initial(p.name)}</div>
        <div class="who"><div class="nm">${esc(p.name)}</div><div class="ch">${won(p.chips)}</div></div>
        <div class="tags">${roleTags(p.id)}${s.host === p.id ? '<span class="tag host">방장</span>' : ''}${p.bot ? '<span class="tag bot">봇</span>' : ''}${p.away ? '<span class="tag">자리비움</span>' : ''}</div>
      </div>
      <div class="st">${st}</div>
    </div>`;
  }).join('') || `<div class="banner" style="position:absolute;left:50%;top:22%;transform:translateX(-50%);width:80%;text-align:center">아직 아무도 없어요.<br>[초대 링크 복사]로 친구를 부르세요.</div>`;

  // 베팅 칩 (자리마다 위치를 잡아둬야 칩이 날아갈 수 있다)
  // 홀덤은 가운데에 공용 카드가 있어서 위쪽 좌석의 베팅 칩을 좌석 쪽으로 더 붙인다
  const betSpots = others.map((p, i) => { const k = HD && pos[i].y < 30 ? .84 : .62; return { id: p.id, x: 50 + (pos[i].x - 50) * k, y: 49 + (pos[i].y - 49) * k }; });
  if (myId) betSpots.push({ id: myId, x: 50, y: 82 });
  $('#bets').innerHTML = betSpots.map(b => {
    const amt = h && ph === 'bet' && h.bet ? (h.bet[b.id] || 0) : 0;
    return `<div class="bet" data-bet="${esc(b.id)}" style="left:${b.x}%;top:${b.y}%">${amt ? stackHTML(amt, 2) + `<span>${won(amt)}</span>` : ''}</div>`;
  }).join('');

  // 가운데: 덱 · 판돈 · 안내
  let banner = '';
  if (ph === 'lobby' || !h) {
    const n = players.filter(p => p.chips > 0 && !p.away).length;
    const md = HD ? `텍사스 홀덤 · ${s.lim === 'pl' ? '팟리밋' : '노리밋'}` : s.mode === 'two' ? '두 장 받고 한 번 베팅' : '한 장씩 두 번 베팅';
    const tgt = s.tg ? ' · 땡값 있음' : '';
    banner = `${practice ? '<div style="margin-bottom:4px"><span class="seal" style="font-size:15px;animation:none">연습 칩</span></div>' : ''}<span class="big">${n >= 2 ? '시작 대기' : '사람 모으는 중'}</span>${n}명 · ${HD ? `블라인드 ${blindText(s.bb)}` : `판돈 ${won(s.ante)}`}<br>${md}${tgt}<br>${isHost ? (n >= 2 ? '위의 [게임 시작]을 누르세요' : '2명 이상 필요해요. 봇을 넣어도 돼요') : '방장이 시작하면 패가 돌아가요'}`;
  } else if (ph === 'bet') {
    const tn = byId[h.ta];
    banner = `<span class="big">${HD ? ['프리플롭', '플롭', '턴', '리버'][h.st] : h.rd === 1 ? '첫 장' : (s.mode === 'two' && h.dl === 1 ? '베팅' : '두 번째 장')}</span>${tn ? (tn.id === myId ? '내 차례예요' : esc(tn.name) + ' 차례') : ''}${h.cur ? ` · 현재 ${won(h.cur)}` : ''}`;
  } else if (ph === 'show' && res) {
    const ago = since('res:' + handKey + res.type);
    if (res.type === 'redeal') {
      if (res.tie) {
        const names = res.tie.map(id => (byId[id] || {}).name).filter(Boolean).map(esc).join(', ');
        banner = `<div class="seal" style="animation-delay:-${ago}ms">동점 재경기</div><div style="margin-top:8px">${names} 동점(${esc(ev[res.tie[0]] || '')}) — 판돈 그대로 둘이서 다시 겨뤄요</div>`.replace('둘이서', res.tie.length > 2 ? `${res.tie.length}명이서` : '둘이서');
      } else {
        const by = byId[res.by];
        const rj = h.rj, waiting = rj ? rj.ids.filter(id => !rj.yes.includes(id) && !rj.no.includes(id)).length : 0;
        banner = `<div class="seal" style="animation-delay:-${ago}ms">${esc(res.name)} 재경기</div><div style="margin-top:8px">${esc(by ? by.name : '')}의 ${esc(res.name)} — 판돈 그대로 다시 돌려요</div>${waiting ? `<div style="margin-top:4px">다이한 사람이 참가 여부를 정하는 중 (${waiting}명)</div>` : ''}`;
      }
    } else {
      const wn = winners.map(id => (byId[id] || {}).name).filter(Boolean).map(esc).join(', ');
      const wh = res.type === 'show' && winners[0] && ev[winners[0]] ? ev[winners[0]] : '';
      banner = `${wh ? `<div class="seal" style="animation-delay:-${ago}ms">${esc(wh)}</div>` : ''}<span class="big" style="margin-top:6px">${wn} 승!</span>${[
        res.type === 'fold' ? (HD ? '모두 폴드' : '모두 다이') : (res.catchBy ? `${esc(res.catchBy)}로 잡았어요` : ''),
        res.tg ? `<b style="color:var(--win)">땡값 +${won(res.tg.total)}</b>` : '',
        s.auto && s.canStart ? '곧 다음 판' : '',
      ].filter(Boolean).join(' · ')}`;
    }
  }
  const pot = h ? h.pot : 0;
  const boardHTML = HD ? `<div class="board">${[0, 1, 2, 3, 4].map(i => board[i] != null
    ? CH(board[i], Object.assign({ hi: !!fiveW && fiveW.has(board[i]), dim: !!fiveW && !fiveW.has(board[i]) }, cardOpts('board', i)))
    : '<div class="slot"></div>').join('')}</div>` : '';
  const potHTML = `<div class="pot" id="pot">${pot ? stackHTML(pot, 4) : ''}<div class="amt">${won(pot)}</div><small>${h ? `판돈 · ${h.no}판` : '판돈'}</small></div>`;
  $('#center').classList.toggle('hd', HD);
  $('#game').classList.toggle('hd', HD);
  $('#center').innerHTML = HD
    ? `<div class="hdRow">${boardHTML}${potHTML}</div><div class="banner">${banner}</div>`   // 홀덤: 공용 카드와 판돈을 한 줄에 (카드는 판돈에서 날아감)
    : `<div class="potRow">
      <div class="deck" id="deck">${cardHTML(null)}${cardHTML(null)}${cardHTML(null)}</div>
      ${potHTML}
    </div><div class="banner">${banner}</div>`;

  // 내 자리
  const mp = byId[myId];
  const meEl = $('#me');
  if (!mp) {
    meEl.classList.remove('turn');
    const full = players.length >= Sutda.MAX_PLAYERS;
    meEl.innerHTML = `<div class="info watchbox"><div class="myname">👀 관전 중</div>
      <div class="mychips">${full ? '자리가 꽉 찼어요 (최대 6명). 자리가 나면 앉을 수 있어요' : '남의 패는 판이 끝나고 공개될 때만 보여요. 채팅은 할 수 있어요'}</div></div>
      <div id="actions" class="watchacts"><button class="act raise" id="btnSit" ${full ? 'disabled' : ''}>자리에 앉기<small>${full ? '자리 없음' : (ph === 'bet' ? '다음 판부터 참가' : '바로 참가')}</small></button></div>`;
    $('#btnSit').onclick = async () => { $('#btnSit').disabled = true; const r = await api({ t: 'join' }); if (r.ok && r.seated) toast('자리에 앉았어요'); else render(); };
  } else {
    const myTurn = !!(h && ph === 'bet' && h.ta === myId);
    meEl.classList.toggle('turn', myTurn);
    const mine = (res && revealed[myId]) || (s.me && h && s.me.no === h.no ? s.me.cards : null);
    let mc = '';
    if (inHand(myId)) {
      const n = folded(myId) ? (mine ? mine.length : 0) : Math.max(ncards, mine ? mine.length : 0);
      mc = Array.from({ length: n }, (_, k) => CH(mine && mine[k] != null ? mine[k] : null, Object.assign({ lg: true, hi: !!fiveW && winners.includes(myId) && mine && fiveW.has(mine[k]) }, folded(myId) ? {} : cardOpts(myId, k)))).join('');
    }
    let hn = '';
    if (HD) { if (mine && mine.length === 2) hn = board.length >= 3 ? Holdem.handName(Holdem.best(mine.concat(board)).score) : preflopName(mine); }
    else if (mine && mine.length === 2) hn = Sutda.evalHand(mine).name;
    else if (mine && mine.length === 1) { const k = Sutda.card(mine[0]); hn = `${k.m}월${k.kind === 'gwang' ? ' 광' : ''}`; }
    if (h && ([0, 1].some(k => pendingCards.has(`${handKey}:${myId}:${k}`)) || (HD && [0, 1, 2, 3, 4].some(k => pendingCards.has(`${handKey}:board:${k}`))))) hn = ''; // 카드가 도착한 뒤에 족보 공개
    let status = '';
    if (!inHand(myId)) status = mp.chips <= 0 ? (practice ? '연습 칩이 없어요 — 위의 [연습 칩 충전]' : myReq && myReq.kind !== 'return' ? '칩 충전 승인을 기다리는 중' : '칩이 없어요 — 위의 [칩 충전]으로 요청하세요') : (ph === 'bet' ? '다음 판부터 참여해요' : '');
    else if (folded(myId)) status = HD ? '폴드했어요' : '다이했어요';
    else if (allin(myId)) status = '올인!';
    else if (myTurn) status = '<b style="color:var(--red)">내 차례</b>';
    if (ph === 'show' && res && res.pay && res.pay[myId]) status = `<b style="color:var(--red)">+${won(res.pay[myId])} 획득!</b>`;
    if (ph === 'show' && res && res.tg) {
      if (res.tg.to === myId) status += ` <b style="color:var(--red)">땡값 +${won(res.tg.total)}</b>`;
      else if (res.tg.from[myId]) status += ` <span style="color:var(--ink2)">땡값 -${won(res.tg.from[myId])}</span>`;
    }
    const rj = h && h.rj;
    const myOffer = !!(ph === 'show' && res && res.type === 'redeal' && rj && rj.ids.includes(myId) && !rj.yes.includes(myId) && !rj.no.includes(myId));
    if (ph === 'show' && rj && rj.yes.includes(myId)) status = '<b style="color:var(--red)">재경기 참가 신청!</b>';
    const lg = myTurn ? (h.lg || {}) : {};
    const need = h ? Math.max(0, h.cur - ((h.bet && h.bet[myId]) || 0)) : 0;
    const B = (k, label, cls) => {
      const ok = k in lg, cost = ok ? lg[k] : null;
      const sub = k === 'die' || k === 'fold' ? '포기' : k === 'check' ? '그냥 넘김' : ok ? won(cost) + (cost >= mp.chips && cost > 0 ? ' 올인' : '') : (k === 'call' && need ? won(need) : '');
      return `<button class="act ${cls}" data-act="${k}" ${ok ? '' : 'disabled'}>${label}<small>${sub}</small></button>`;
    };
    const showCheck = 'check' in lg || (!myTurn && need === 0);
    let hdActs = '', pop = '';
    if (HD) {
      const R = lg.raise || lg.bet, myBet = (h && h.bet && h.bet[myId]) || 0;
      const rk = lg.raise ? 'raise' : lg.bet ? 'bet' : (h && h.cur ? 'raise' : 'bet'), rl = rk === 'raise' ? '레이즈' : '벳';
      const potTo = f => R ? Math.max(R.min, Math.min(R.max, Math.round((h.cur + (h.pot + need) * f) / s.sb) * s.sb)) : 0;
      const Q = (f, label) => { const to = potTo(f); return `<button class="act raise" data-act="${rk}" data-amt="${to}" ${R ? '' : 'disabled'}>${label}<small>${R ? won(to) + (to >= myBet + mp.chips ? ' 올인' : '') : ''}</small></button>`; };
      const allinOk = 'allin' in lg;
      hdActs = `<div id="actions">
        ${B('fold', '폴드', 'die')}
        ${showCheck ? B('check', '체크', 'call') : B('call', '콜', 'call')}
        <button class="act raise" data-act="allin" ${allinOk ? '' : 'disabled'}>올인<small>${won(mp.chips)}</small></button>
        ${Q(0.5, '½팟')}
        ${Q(1, '팟')}
        <button class="act raise" data-act="raiseopen" ${R ? '' : 'disabled'}>${rl}<small>${R ? won(R.min) + '~' : '금액 선택'}</small></button>
      </div>`;
      const rkey = h ? handKey + ':' + h.st + ':' + h.cur + ':' + myBet : '';
      if (raiseUI && (!h || !myTurn || !R || raiseUI.key !== rkey)) raiseUI = null;
      if (raiseUI) {
        Object.assign(raiseUI, { min: R.min, max: R.max, k: rk, label: rl, myBet, stack: myBet + mp.chips, step: Math.max(1, s.sb), potTo });
        raiseUI.amt = Math.max(R.min, Math.min(R.max, raiseUI.amt));
        pop = raisePopHTML();
      }
    }
    meEl.innerHTML = `
      <div class="mycards${folded(myId) ? ' folded' : ''}">${mc || '<span class="muted">패 없음</span>'}</div>
      <div class="info">
        <div class="meRow"><div class="ava">${initial(mp.name)}</div>
          <div><div class="myname">${esc(mp.name)} ${roleTags(myId)}${isHost ? ' <span class="tag host">방장</span>' : ''}</div>
          <div class="mychips">${practice ? '연습 칩' : '보유'} <b>${won(mp.chips)}</b>${!practice && heldText() ? ` · <span class="held">${heldText()}</span>` : ''}${status ? ' · ' + status : ''}</div></div></div>
        <div class="myhand">${esc(hn)}</div>
        ${myTurn ? '<div class="timer"><i data-timer></i></div>' : ''}
      </div>
      ${myOffer ? `<div id="actions" class="rjbox">
        <div class="rjq">${esc(res.name)} 재경기! ${rj.cost[myId] ? `<b>${won(rj.cost[myId])}</b>을 내고` : '추가 비용 없이'} 다시 참가할까요?</div>
        <button class="act raise" data-rj="1">참가<small>${rj.cost[myId] ? won(rj.cost[myId]) + (rj.cost[myId] >= mp.chips ? ' 올인' : '') : '0'}</small></button>
        <button class="act die" data-rj="0">안 함<small>계속 다이</small></button>
        <div class="timer" style="grid-column:1/-1;max-width:none"><i data-rjtimer></i></div>
      </div>` : HD ? hdActs + pop : `<div id="actions">
        ${B('die', '다이', 'die')}
        ${showCheck ? B('check', '체크', 'call') : B('call', '콜', 'call')}
        ${B('bbing', '삥', 'raise')}
        ${B('half', '하프', 'raise')}
        ${B('ddadang', '따당', 'raise')}
        <button class="act" data-act="ranks">족보<small>보기</small></button>
      </div>`}`;
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
    if (P.no !== h.no) {
      if (HD) [h.sbId, h.bbId].forEach((id, i) => FX.flyChips(seatEl(id), betEl(id), 2, i * 120));          // 블라인드
      else h.seats.forEach((id, i) => FX.flyChips(seatEl(id), potEl, 1, i * 70));                                // 판돈 걷기
    }
    else {
      const sameRound = P.dl === h.dl && P.rd === rdNo;
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
    if (h.rj && h.rj.ids.includes(myId) && !P.rj) FX.sound.turn();
    const rk = res ? handKey + ':' + res.type : '';
    if (res && P.rk !== rk) {
      FX.sound.stamp();
      if (res.type !== 'redeal') {
        winners.forEach((w, i) => { FX.flyChips(potEl, seatEl(w), 6, 500 + i * 150); setTimeout(() => FX.burst(seatEl(w), w === myId), 650); });
        if (inHand(myId)) setTimeout(() => (winners.includes(myId) ? FX.sound.win() : FX.sound.lose()), 450);
        if (res.tg) Object.keys(res.tg.from).forEach((id, i) => FX.flyChips(seatEl(id), seatEl(res.tg.to), 3, 1300 + i * 160));
      }
    }
  }
  prevSnap = h ? { no: h.no, dl: h.dl, rd: rdNo, bet: Object.assign({}, h.bet), fo: (h.fo || []).slice(), ta: h.ta, ph, rk: res ? handKey + ':' + res.type : '', rj: !!(h.rj && h.rj.ids.includes(myId)) } : { ph };
  if (firstSeen.size > 400) firstSeen.clear();
  renderLog();
  renderTimers();
}
function raiseKey(){ const h = PS && PS.h; return h ? h.no + ':' + h.dl + ':' + h.st + ':' + h.cur + ':' + ((h.bet && h.bet[PS.you]) || 0) : ''; }
function raisePopHTML(){
  const R = raiseUI, allin = R.amt >= R.stack;
  return `<div id="raisePop">
    <div class="amt" id="rpAmt">${won(R.amt)}<small>이번 라운드 총 ${R.label} · 더 내는 칩 ${won(R.amt - R.myBet)}</small></div>
    <div class="step"><button data-rs="-" aria-label="줄이기">−</button><input type="range" id="rpSl" min="${R.min}" max="${R.max}" step="${R.step}" value="${R.amt}"><button data-rs="+" aria-label="늘리기">+</button></div>
    <div class="q"><button data-rq="min">최소</button><button data-rq="0.5">½팟</button><button data-rq="0.75">¾팟</button><button data-rq="1">팟</button><button data-rq="max">${R.max >= R.stack ? '올인' : '최대'}</button></div>
    <div class="row"><button class="btn" data-rc>취소</button><button class="btn gold" data-rgo id="rpGo">${allin ? '올인' : R.label} ${won(R.amt)}</button></div>
  </div>`;
}
function setRaise(v){
  if (!raiseUI) return;
  raiseUI.amt = Math.max(raiseUI.min, Math.min(raiseUI.max, Math.round(v)));
  const sl = $('#rpSl'); if (sl) sl.value = raiseUI.amt;
  const a = $('#rpAmt'); if (a) a.innerHTML = `${won(raiseUI.amt)}<small>이번 라운드 총 ${raiseUI.label} · 더 내는 칩 ${won(raiseUI.amt - raiseUI.myBet)}</small>`;
  const g = $('#rpGo'); if (g) g.textContent = `${raiseUI.amt >= raiseUI.stack ? '올인' : raiseUI.label} ${won(raiseUI.amt)}`;
}
document.addEventListener('input', e => {
  if (e.target.id !== 'rpSl' || !raiseUI) return;
  let v = Number(e.target.value);
  if (v > raiseUI.max - raiseUI.step) v = raiseUI.max; // 끝까지 밀면 최대
  setRaise(v);
});
function renderHostbar(){
  const hb = $('#hostbar'), s = PS;
  if (!s || s.host !== s.you) { if (!hb.classList.contains('hidden')) { hb.classList.add('hidden'); setHdrH(); } hb.dataset.sig = ''; return; }
  hb.classList.remove('hidden');
  placeHostbar();
  const redealPending = s.ph === 'show' && s.h && s.h.res && s.h.res.type === 'redeal';
  const sig = [s.ph, s.auto, s.pl.length, s.canStart, redealPending].join('|');
  if (hb.dataset.sig === sig) return; hb.dataset.sig = sig; setTimeout(setHdrH, 0);
  const betting = s.ph === 'bet';
  hb.innerHTML = `<span class="lbl">방장</span>
    <button class="btn gold" id="hbStart" ${betting || redealPending || !s.canStart ? 'disabled' : ''}>${s.ph === 'show' ? '다음 판' : '<span class="t-l">게임 </span>시작'}</button>
    <button class="btn" id="hbBot" ${s.pl.length >= Sutda.MAX_PLAYERS ? 'disabled' : ''}>봇 추가</button>
    <span class="muted" style="margin-left:4px">${ruleText(s)}</span>
    <label class="chk"><input type="checkbox" id="hbAuto" ${s.auto ? 'checked' : ''}> <span class="t-l">자동으로 다음 판</span><span class="t-s">자동</span></label>`;
  $('#hbStart').onclick = () => api({ t: 'start' });
  $('#hbBot').onclick = () => api({ t: 'bot' });
  $('#hbAuto').onchange = e => api({ t: 'auto', on: e.target.checked });

}
function renderLog(){
  if (!inGame) return;
  const sys = (PS && PS.log || []).map(l => `<div class="sys">${esc(l)}</div>`);
  const chats = chatLines.slice(-30).map(c => `<div class="chat${c.w ? ' w' : ''}"><b>${esc(c.nm)}</b> ${esc(c.x)}</div>`);
  const el = $('#log');
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.innerHTML = sys.join('') + (chats.length ? '<div class="sys" style="margin-top:6px">— 채팅 —</div>' + chats.join('') : '');
  if (atBottom) el.scrollTop = el.scrollHeight;
}
function renderTimers(){
  if (PS && PS.h && PS.h.rj && PS.ph === 'show') {
    const left = PS.h.rj.left - (Date.now() - psAt);
    const pct = Math.max(0, Math.min(100, left / (PS.h.rj.total || 12000) * 100));
    document.querySelectorAll('[data-rjtimer]').forEach(el => { el.style.width = pct + '%'; });
  }
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
    if (k === 'raiseopen') { raiseUI = { key: raiseKey(), amt: 0 }; render(); return; }
    document.querySelectorAll('#actions .act').forEach(b => { if (b.dataset.act !== 'ranks') b.disabled = true; });
    raiseUI = null;
    const body = { t: 'act', k }; if (a.dataset.amt) body.a = Number(a.dataset.amt);
    api(body).then(r => { if (!r.ok) render(); });
    return;
  }
  // 레이즈 금액 창
  if (raiseUI && e.target.closest('#raisePop')) {
    const q = e.target.closest('[data-rq]'), st = e.target.closest('[data-rs]');
    if (q) { const v = q.dataset.rq; setRaise(v === 'min' ? raiseUI.min : v === 'max' ? raiseUI.max : raiseUI.potTo(Number(v))); return; }
    if (st) { setRaise(raiseUI.amt + (st.dataset.rs === '+' ? 1 : -1) * Math.max(raiseUI.step, PS.bb || 1)); return; }
    if (e.target.closest('[data-rc]')) { raiseUI = null; render(); return; }
    if (e.target.closest('[data-rgo]')) {
      const body = { t: 'act', k: raiseUI.amt >= raiseUI.stack ? 'allin' : raiseUI.k, a: raiseUI.amt };
      raiseUI = null; document.querySelectorAll('#actions .act, #raisePop button').forEach(b => { b.disabled = true; });
      api(body).then(r => { if (!r.ok) render(); });
      return;
    }
  }
  const rjb = e.target.closest('[data-rj]');
  if (rjb && !rjb.disabled) {
    document.querySelectorAll('[data-rj]').forEach(b => { b.disabled = true; });
    api({ t: 'rejoin', yes: rjb.dataset.rj === '1' }).then(r => { if (!r.ok) render(); });
    return;
  }
  const kk = e.target.closest('[data-kick]');
  if (kk) api({ t: 'kick', target: kk.dataset.kick });
});

// ───────── 칩 충전 요청 ─────────
const REQ_AMOUNTS = [10000, 30000, 50000, 100000];
function reqWord(){ return myReq && myReq.kind === 'return' ? '반납' : '충전'; }
// 반납 대기로 따로 떼어 둔 칩
function heldText(){
  if (!myReq || myReq.kind !== 'return') return '';
  return myReq.held != null ? `반납 대기 ${won(myReq.held)}` : `반납 대기 ${won(myReq.amount)} (판 끝나면 떼어 둠)`;
}
function myChipsNow(){
  const mp = PS && !PS.practice && (PS.pl || []).find(p => p[0] === PS.you);
  return mp ? mp[2] : (user ? user.chips : 0);
}
function openChipModal(tab){
  if (!user) return toast('먼저 로그인하세요');
  if (myReq) {
    const w = reqWord();
    const heldLine = myReq.kind !== 'return' ? '' : myReq.held != null
      ? `<br>칩 <b>${won(myReq.held)}</b>을 보유 칩에서 따로 떼어 뒀어요. 취소하거나 거절되면 다시 돌아와요.`
      : `<br>지금 판이 끝나면 남은 칩에서 떼어 둬요.`;
    openModal(`<h2>칩 ${w} 요청</h2><p>칩 <b>${won(myReq.amount)}</b> ${w} 요청을 관리자가 확인하고 있어요.${heldLine}<br><span class="muted">처리되면 바로 알려드려요.</span></p>
      <div class="row"><button class="btn" data-close>닫기</button><button class="btn red" id="crCancel">요청 취소</button></div>`);
    $('#crCancel').onclick = async () => {
      const r = await api({ t: 'chipCancel' });
      if (r.ok || r.status === 404) { myReq = null; closeModal(); toast(`${w} 요청을 취소했어요`); if (!inGame) refreshMe(); renderEntry(); render(); }
    };
    return;
  }
  const ret = tab === 'return', have = myChipsNow();
  openModal(`<div class="tabs ctabs"><button class="tab ${ret ? '' : 'on'}" data-ct="charge">충전 요청</button><button class="tab ${ret ? 'on' : ''}" data-ct="return">반납 요청</button></div>
    ${ret ? `<p class="muted" style="margin-top:0">보내면 그만큼 보유 칩에서 따로 떼어 둬요. 떼어 둔 칩은 베팅에 쓸 수 없고, 관리자가 확인하면 가져가요. 취소하거나 거절되면 다시 돌아와요. 게임 중이면 그 판이 끝난 뒤 남은 칩에서 떼어 둬요.</p>
      <div class="muted" style="margin-bottom:6px">지금 가진 칩 <b style="color:var(--ink)">${won(have)}</b></div>
      <div class="row" style="gap:6px;margin-bottom:10px"><input id="crAmt" class="inp" inputmode="numeric" placeholder="반납할 칩" style="flex:1"><button class="btn" id="crAll" type="button">전부</button></div>`
    : `<p class="muted" style="margin-top:0">관리자가 승인하면 칩이 들어와요. 게임 중이면 그 판이 끝난 뒤에 들어와요.</p>
      <div class="amts">${REQ_AMOUNTS.map((a, i) => `<label class="amt"><input type="radio" name="amt" value="${a}" ${i === 0 ? 'checked' : ''}><span>${won(a)}</span></label>`).join('')}</div>`}
    <input id="crNote" class="inp" maxlength="40" placeholder="관리자에게 한마디 (선택)">
    <div class="row" style="margin-top:14px"><button class="btn" data-close>취소</button><button class="btn gold" id="crSend">요청 보내기</button></div>`);
  document.querySelectorAll('[data-ct]').forEach(b => b.onclick = () => openChipModal(b.dataset.ct));
  if (ret) {
    $('#crAll').onclick = () => { $('#crAmt').value = String(myChipsNow()); };
    $('#crAmt').addEventListener('input', e => { const v = e.target.value.replace(/[^0-9]/g, ''); e.target.value = v ? Number(v).toLocaleString() : ''; });
  }
  $('#crSend').onclick = async () => {
    let amount;
    if (ret) {
      amount = Number(($('#crAmt').value || '').replace(/,/g, ''));
      if (!amount || amount < 100) return toast('반납할 칩을 100 이상으로 넣어주세요');
      if (amount > myChipsNow()) return toast('가진 칩보다 많이 반납할 수 없어요');
    } else amount = Number(document.querySelector('input[name=amt]:checked').value);
    const kind = ret ? 'return' : 'charge';
    $('#crSend').disabled = true;
    const r = await api({ t: 'chipReq', amount, kind, note: $('#crNote').value.trim() });
    $('#crSend').disabled = false;
    if (r.ok) { myReq = r.req || { amount, kind }; closeModal(); toast(`${ret ? '반납' : '충전'} 요청을 보냈어요. 관리자가 확인하면 알려드려요`); if (!inGame) refreshMe(); renderEntry(); render(); }
  };
}
// 입장 화면에 있을 때는 대기 중인 요청이 처리됐는지 가끔 확인
setInterval(async () => {
  if (inGame || !user || !myReq) return;
  const before = user.chips, was = myReq, r = await refreshMe();
  if (r && !r.req) {
    if (was.kind === 'return') toast(user.chips > before ? `칩 반납 요청이 처리됐어요. ${won(user.chips - before)}이 돌아왔어요` : '칩 반납이 처리됐어요');
    else toast(user.chips > before ? `칩 충전이 승인됐어요! (+${won(user.chips - before)})` : '칩 충전 요청이 처리됐어요');
  }
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
  if (PS && PS.kind === 'holdem') return showHoldemRanks();
  const R = [
    ['38광땡', '3월 광 + 8월 광. 최강'], ['13·18광땡', '1월 광 + 3월 광 / 1월 광 + 8월 광'],
    ['땡', '같은 월 두 장. 장땡(10) > 9땡 > … > 1땡'],
    ['알리', '1 + 2'], ['독사', '1 + 4'], ['구삥', '1 + 9'], ['장삥', '1 + 10'], ['장사', '4 + 10'], ['세륙', '4 + 6'],
    ['끗', '두 장 합의 일의 자리. 갑오(9끗) > 8끗 > … > 1끗 > 망통(0)'],
    ['암행어사', '4월 열끗 + 7월 열끗. 13·18광땡을 잡음 (아니면 1끗)'],
    ['땡잡이', '3월 광 + 7월 열끗. 1~9땡을 잡음 (아니면 망통)'],
    ['구사', '4 + 9. 상대 최고가 알리 이하면 재경기 (아니면 3끗). 재경기 때 다이했던 사람은 남은 사람이 건 만큼 맞춰 내고 다시 참가할 수 있음'],
    ['멍텅구리구사', '4월 열끗 + 9월 열끗. 상대가 장땡 이하면 재경기'],
  ];
  const X = [
    ['한 장씩 · 2번 베팅', '한 장 받고 베팅, 한 장 더 받고 베팅 (기본)'],
    ['두 장 받고 · 1번 베팅', '두 장을 다 받고 한 번만 베팅'],
    ['동점 재경기', '패를 열었을 때 가장 높은 패가 같으면, 판돈 그대로 동점인 사람끼리만 새로 받아 다시 겨룸 (최대 3번, 그 뒤엔 나눠 가짐). 방 만들 때 나눠 갖기로 정할 수도 있음'],
    ['땡값', '장땡·광땡으로 이기면 끝까지 남은 다른 사람(다이 제외)이 1인당 따로 냄. 장땡 판돈 100%, 13·18광땡 150%, 38광땡 200%. 1~9땡은 없음. 땡잡이·암행어사에 잡히면 없음. 칩이 모자라면 있는 만큼만'],
  ];
  const A = [['삥', '첫 베팅을 판돈만큼'], ['하프', '콜하고 판 전체의 절반만큼 더'], ['따당', '앞 사람 베팅의 두 배로'], ['콜 / 체크', '맞추기 / 그냥 넘기기'], ['다이', '포기']];
  openModal(`<h2>족보</h2><table class="rank-t">${R.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
    <h2 style="margin-top:18px">베팅</h2><table class="rank-t">${A.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
    <h2 style="margin-top:18px">진행 방식 · 땡값 <span class="muted" style="font-size:13px">방 만들 때 정해요</span></h2><table class="rank-t">${X.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
    <p class="muted">올인한 사람은 자기가 건 만큼만 먹어요(사이드팟).</p>
    <div style="text-align:right"><button class="btn gold" data-close>닫기</button></div>`);
}
function showHoldemRanks(){
  const ex = (cs, hi) => `<span class="rk-ex">${cs.split(' ').map(t => { const r = '23456789TJQKA'.indexOf(t[0]), u = 'shdc'.indexOf(t[1]); return pcardHTML(r * 4 + u, {}); }).join('')}</span>`;
  const R = [
    ['로열 플러시', '같은 무늬 10·J·Q·K·A', 'Ts Js Qs Ks As'], ['스트레이트 플러시', '같은 무늬 연속 5장', '5h 6h 7h 8h 9h'],
    ['포카드', '같은 숫자 4장', '9s 9h 9d 9c Kd'], ['풀하우스', '트리플 + 원페어', 'Qs Qh Qd 4c 4s'],
    ['플러시', '같은 무늬 5장', '2d 7d 9d Jd Ad'], ['스트레이트', '연속 5장 (A-2-3-4-5도 됨)', '4c 5d 6h 7s 8c'],
    ['트리플', '같은 숫자 3장', '7s 7h 7d Kc 2s'], ['투페어', '원페어 두 개', 'Js Jd 5c 5h As'],
    ['원페어', '같은 숫자 2장', 'As Ad 9c 6h 3s'], ['하이카드', '아무것도 없으면 가장 높은 카드', 'Ah Jc 8d 5s 2c'],
  ];
  const A = [['폴드', '포기'], ['체크', '건 사람이 없을 때 그냥 넘기기'], ['콜', '앞 사람이 건 만큼 맞추기'], ['벳 / 레이즈', '처음 걸기 / 더 올리기. 최소는 빅 블라인드 또는 직전에 올린 만큼'], ['올인', '가진 칩 전부']];
  const X = [
    ['진행', '패 2장씩 받고 프리플롭 베팅 → 공용 카드 3장(플롭) → 1장(턴) → 1장(리버), 매번 베팅'],
    ['승부', '내 패 2장과 공용 카드 5장 중 가장 좋은 5장으로 겨뤄요. 같으면 나눠 가져요'],
    ['블라인드', '딜러(D) 왼쪽 두 사람이 스몰(SB)·빅(BB) 블라인드를 먼저 내요. 딜러는 판마다 한 칸씩 돌아요'],
    ['노리밋 / 팟리밋', '노리밋은 가진 칩까지, 팟리밋은 한 번에 판돈 크기까지만 올릴 수 있어요'],
    ['땡값', '포카드 이상으로 혼자 이기면 끝까지 남은 사람(폴드 제외)이 1인당 따로 내요: 이긴 사람이 건 금액 × 로티플 3배, 스티플·백티플 2배, 포카드 1배. 딴 돈과 땡값을 합쳐 내 보유 칩을 넘을 수 없고, 내가 올인했는데 더 많이 건 사람이 졌으면 없어요 (방 만들 때 켜고 끔)'],
  ];
  openModal(`<h2>홀덤 족보 <span class="muted" style="font-size:13px">위가 높아요</span></h2><table class="rank-t">${R.map(r => `<tr><td>${r[0]}</td><td>${r[1]}${ex(r[2])}</td></tr>`).join('')}</table>
    <h2 style="margin-top:18px">베팅</h2><table class="rank-t">${A.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
    <h2 style="margin-top:18px">규칙</h2><table class="rank-t">${X.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
    <p class="muted">올인한 사람은 자기가 건 만큼만 먹어요(사이드팟).</p>
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

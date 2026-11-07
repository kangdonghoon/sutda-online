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

// ───────── 신원 ─────────
let me = store.get('sutda-me');
function newIdentity(){ me = { pid: 'u' + rid(14), tok: rid(32) }; store.set('sutda-me', me); }
if (!me || !me.pid || !me.tok) newIdentity();
let myName = store.get('sutda-nick') || '';

// ───────── 상태 ─────────
let code = null, es = null, PS = null, psAt = 0, inGame = false;
let chatLines = [];

async function api(d, quiet){
  try {
    const r = await fetch('/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ pid: me.pid, tok: me.tok, room: code }, d)) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (!quiet && j.error) toast(j.error); return { ok: false, status: r.status, ...j }; }
    return { ok: true, ...j };
  } catch(e){ if (!quiet) toast('서버에 연결할 수 없어요'); return { ok: false, status: 0 }; }
}

// ───────── 입장 화면 ─────────
$('#nick').value = myName;
function needNick(){
  const v = $('#nick').value.trim().slice(0,10);
  if (!v) { $('#nick').focus(); toast('닉네임을 먼저 입력하세요'); return null; }
  myName = v; store.set('sutda-nick', v); return v;
}
async function create(solo){
  if (!needNick()) return;
  let r = await api({ t: 'create', nm: myName, solo: !!solo });
  if (!r.ok && r.status === 403) { newIdentity(); r = await api({ t: 'create', nm: myName, solo: !!solo }); }
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

function showInvite(){
  const m = /^#([a-z0-9]{4})$/i.exec(location.hash);
  const box = $('#inviteBox');
  if (!m) { box.classList.add('hidden'); return false; }
  const c = m[1].toLowerCase();
  box.innerHTML = `<h3>초대받은 방 <span class="code">${esc(c.toUpperCase())}</span></h3>
    <div class="muted" style="margin-bottom:10px">닉네임을 입력하고 입장하세요.</div>
    <button class="btn gold" id="btnInvite" style="width:100%">이 방으로 입장</button>`;
  box.classList.remove('hidden');
  $('#btnInvite').onclick = () => joinTable(c);
  $('#joinCode').value = c;
  return true;
}
function showResume(){
  const last = store.get('sutda-last');
  const box = $('#resumeBox');
  box.classList.add('hidden');
  if (!last || !last.code || Date.now() - last.t > 6 * 3600e3 || location.hash) return;
  box.innerHTML = `<h3>이어하기</h3><div class="row" style="align-items:center"><div class="muted" style="flex:2">최근 방 <span class="code">${esc(last.code.toUpperCase())}</span></div><button class="btn" id="btnRejoin">다시 입장</button></div>`;
  box.classList.remove('hidden');
  $('#btnRejoin').onclick = () => joinTable(last.code);
}

// ───────── 방 입장 / 연결 ─────────
async function joinTable(c){
  if (!needNick()) return;
  code = c.toLowerCase();
  let r = await api({ t: 'join', nm: myName });
  if (!r.ok && r.status === 403 && /인증/.test(r.error || '')) { newIdentity(); r = await api({ t: 'join', nm: myName }); }
  if (!r.ok) { code = null; return; }
  store.set('sutda-last', { code, t: Date.now() });
  try { history.replaceState(null, '', '#' + code); } catch(e){ location.hash = code; }
  inGame = true; PS = null; chatLines = [];
  $('#entry').classList.add('hidden'); $('#game').classList.remove('hidden');
  $('#hCode').textContent = code.toUpperCase();
  if (!r.seated) toast('자리가 꽉 차서 관전으로 들어왔어요');
  openStream();
  render();
}
function openStream(){
  if (es) es.close();
  es = new EventSource(`/events?room=${encodeURIComponent(code)}&pid=${encodeURIComponent(me.pid)}&tok=${encodeURIComponent(me.tok)}`);
  es.onopen = () => netState(true);
  es.addEventListener('st', e => {
    try { PS = JSON.parse(e.data); psAt = Date.now(); } catch(err){ return; }
    netState(true); render();
  });
  es.addEventListener('ch', e => { try { const d = JSON.parse(e.data); chatLines.push({ nm: d.nm, x: d.x }); if (chatLines.length > 60) chatLines.shift(); renderLog(); } catch(err){} });
  es.addEventListener('kick', () => { toast('방장이 내보냈어요'); leaveGame(true); });
  es.onerror = async () => {
    netState(false);
    if (es && es.readyState === 2) { // 서버가 거절함 → 방이 사라졌는지 확인
      const r = await api({ t: 'join', nm: myName }, true);
      if (!r.ok && r.status === 404) { toast('방이 닫혔어요'); leaveGame(true); }
      else if (r.ok && inGame) setTimeout(openStream, 1500);
    }
  };
}
function netState(c){ const el = $('#hNet'); el.textContent = c ? '연결됨' : '재연결 중…'; el.className = 'chip-s ' + (c ? 'ok' : 'bad'); }
function leaveGame(silent){
  if (!silent && code) api({ t: 'leave' }, true);
  if (es) { es.close(); es = null; }
  inGame = false; code = null; PS = null;
  try { history.replaceState(null, '', location.pathname); } catch(e){}
  $('#game').classList.add('hidden'); $('#entry').classList.remove('hidden');
  if (silent) store.del('sutda-last');
  showInvite(); showResume(); loadTables();
}
$('#btnLeave').onclick = () => confirmBox('방에서 나갈까요?', '진행 중인 판이 있으면 다이 처리돼요.', '나가기', () => leaveGame(false));
$('#btnCopy').onclick = async () => {
  const link = location.origin + location.pathname + '#' + code;
  try { await navigator.clipboard.writeText(link); toast('초대 링크를 복사했어요'); } catch(e){ toast(link); }
};
$('#btnRebuy').onclick = () => api({ t: 'rebuy' });
$('#btnRanks').onclick = showRanks;
window.addEventListener('hashchange', () => { if (!inGame) showInvite(); });

// 채팅
const EMOTES = ['ㅋㅋㅋ', '아 ㅡㅡ', '쫄?', '올인 각', '굿굿', 'ㅠㅠ'];
$('#emotes').innerHTML = EMOTES.map(e => `<button type="button" data-e="${esc(e)}">${esc(e)}</button>`).join('');
$('#emotes').addEventListener('click', e => { const b = e.target.closest('[data-e]'); if (b) api({ t: 'chat', x: b.dataset.e }, true); });
$('#chatForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#chatIn').value.trim(); if (v) { api({ t: 'chat', x: v.slice(0, 80) }, true); $('#chatIn').value = ''; } });

// ───────── 렌더 ─────────
const EMO = {1:['🦢','🌲'],2:['🐦','🌺'],3:['🌸','🌸'],4:['🐤','🌿'],5:['🌉','🌷'],6:['🦋','🌹'],7:['🐗','🍂'],8:['🌕','🌾'],9:['🍶','🌼'],10:['🦌','🍁']};
function cardHTML(c, lg, anim){
  const cls = 'hw' + (lg ? ' lg' : '') + (anim ? ' deal-in' : '');
  if (c == null) return `<div class="${cls} back"></div>`;
  const k = Sutda.card(c);
  return `<div class="${cls} face" title="${k.m}월 ${Sutda.MONTH_NAMES[k.m]}${k.kind==='gwang'?' 광':k.kind==='yeol'?' 열끗':''}">
    ${k.kind === 'gwang' ? '<span class="gw">光</span>' : ''}${k.kind === 'yeol' ? '<span class="yl">열</span>' : ''}
    <span class="m">${k.m}</span><span class="e">${EMO[k.m][k.sp ? 0 : 1]}</span><span class="t">${Sutda.MONTH_NAMES[k.m]}</span></div>`;
}
let lastCardsKey = '';
function render(){
  if (!inGame) return;
  const s = PS;
  const myId = me.pid;
  renderHostbar();
  if (!s) {
    $('#seats').innerHTML = '';
    $('#center').innerHTML = `<div class="banner"><span class="big">연결 중…</span></div>`;
    $('#me').innerHTML = ''; renderLog(); return;
  }
  const h = s.h, ph = s.ph;
  const players = (s.pl || []).map(([id, name, chips, f]) => ({ id, name, chips, bot: !!(f & 1), away: !!(f & 2) }));
  const meIdx = players.findIndex(p => p.id === myId);
  const others = meIdx >= 0 ? players.slice(meIdx + 1).concat(players.slice(0, meIdx)) : players;
  const res = h && h.res;
  const inHand = id => !!(h && h.seats.includes(id));
  const folded = id => !!(h && (h.fo || []).includes(id));
  const allin = id => !!(h && (h.ai || []).includes(id));
  const winners = res && res.winners || [];
  const revealed = res && res.cards || {};
  const ev = res && res.ev || {};
  const cardsKey = h ? h.no + ':' + h.dl + ':' + h.nc : '';
  const anim = cardsKey !== lastCardsKey;
  const isHost = s.host === myId;

  $('#seats').innerHTML = others.map(p => {
    const cl = ['seat'];
    if (h && ph === 'bet' && h.ta === p.id) cl.push('turn');
    if (folded(p.id)) cl.push('folded');
    if (p.away) cl.push('away');
    if (ph === 'show' && winners.includes(p.id)) cl.push('win');
    let cards = '';
    if (inHand(p.id) && !folded(p.id)) {
      if (revealed[p.id]) cards = revealed[p.id].map(c => cardHTML(c)).join('');
      else cards = Array.from({ length: h.nc }, () => cardHTML(null, false, anim)).join('');
    }
    let st = '';
    if (!inHand(p.id)) st = p.chips <= 0 ? '칩 없음' : (ph === 'bet' ? '다음 판부터' : '대기');
    else if (folded(p.id)) st = '다이';
    else if (ph === 'show' && ev[p.id]) st = `<span class="hn">${esc(ev[p.id])}</span>`;
    else {
      const la = h.la && h.la[p.id];
      st = (la ? `<b>${Sutda.ACT_NAMES[la] || ''}</b> ` : '') + (h.bet && h.bet[p.id] ? `베팅 ${won(h.bet[p.id])}` : '');
      if (allin(p.id)) st += ' <b>올인</b>';
      if (h.ta === p.id) st = '<b style="color:var(--gold2)">고민 중…</b> ' + st;
    }
    if (ph === 'show' && res && res.pay && res.pay[p.id]) st += ` <b style="color:var(--win)">+${won(res.pay[p.id])}</b>`;
    const canKick = isHost && !(ph === 'bet' && inHand(p.id) && !folded(p.id));
    return `<div class="${cl.join(' ')}">
      ${canKick ? `<button class="x" data-kick="${esc(p.id)}" title="내보내기">✕</button>` : ''}
      <div class="nm"><span class="n">${esc(p.name)}</span>${s.sun === p.id && h ? '<span class="tag sun">선</span>' : ''}${p.bot ? '<span class="tag bot">봇</span>' : ''}${s.host === p.id ? '<span class="tag host">방장</span>' : ''}${p.away ? '<span class="tag">자리비움</span>' : ''}</div>
      <div class="chips">${won(p.chips)}</div>
      <div class="cards">${cards}</div>
      <div class="st">${st}</div>
      ${h && ph === 'bet' && h.ta === p.id ? '<div class="timer"><i data-timer></i></div>' : ''}
    </div>`;
  }).join('') || '<div class="muted">아직 아무도 없어요. [초대 링크 복사]로 친구를 부르세요.</div>';

  let center = '';
  if (h) center += `<div class="pot"><small>판돈 · ${h.no}판</small>${won(h.pot)}</div>`;
  if (ph === 'lobby' || !h) {
    const n = players.filter(p => p.chips > 0 && !p.away).length;
    center += `<div class="banner"><span class="big">${n >= 2 ? '시작 대기' : '인원 모으는 중'}</span><span class="muted">${n}명 · 판돈 ${won(s.ante)} · ${isHost ? (n >= 2 ? '위의 [게임 시작]을 누르세요' : '2명 이상 필요해요. 봇을 넣어도 돼요') : '방장이 시작하면 패가 돌아가요'}</span></div>`;
  } else if (ph === 'bet') {
    const tn = players.find(p => p.id === h.ta);
    center += `<div class="banner"><span class="big" style="color:var(--ink);font-size:22px">${h.rd === 1 ? '첫 장' : '두 번째 장'} 베팅</span>
      <span class="muted">${tn ? (tn.id === myId ? '내 차례예요' : esc(tn.name) + ' 차례') : ''}${h.cur ? ` · 현재 베팅 ${won(h.cur)}` : ''}</span></div>`;
  } else if (ph === 'show' && res) {
    if (res.type === 'redeal') {
      const by = players.find(p => p.id === res.by);
      center += `<div class="banner"><span class="big">${esc(res.name)}! 재경기</span><span class="muted">${esc(by ? by.name : '')}의 ${esc(res.name)} — 판돈 그대로 다시 돌려요</span></div>`;
    } else {
      const wn = winners.map(id => (players.find(p => p.id === id) || {}).name).filter(Boolean).map(esc).join(', ');
      const wh = res.type === 'show' && winners[0] && ev[winners[0]] ? ev[winners[0]] : '';
      center += `<div class="banner"><span class="big">${wn} 승!</span><span class="muted">${res.type === 'fold' ? '모두 다이' : esc(wh) + (res.catchBy ? ` — ${esc(res.catchBy)}로 잡았어요` : '')}${s.auto && s.canStart ? ' · 곧 다음 판' : ''}</span></div>`;
    }
  }
  $('#center').innerHTML = center;

  const mp = players.find(p => p.id === myId);
  const meEl = $('#me');
  if (!mp) {
    meEl.classList.remove('turn');
    meEl.innerHTML = `<div class="info"><div class="myname">관전 중</div><div class="mychips">${players.length >= Sutda.MAX_PLAYERS ? '자리가 꽉 찼어요 (최대 6명).' : '자리에 앉는 중…'}</div></div>`;
  } else {
    const myTurn = !!(h && ph === 'bet' && h.ta === myId);
    meEl.classList.toggle('turn', myTurn);
    const mine = (res && revealed[myId]) || (s.me && h && s.me.no === h.no ? s.me.cards : null);
    let mc = '';
    if (inHand(myId) && !folded(myId)) {
      if (mine) mc = mine.map(c => cardHTML(c, true, anim)).join('') + (mine.length < h.nc ? cardHTML(null, true) : '');
      else mc = Array.from({ length: h.nc }, () => cardHTML(null, true)).join('');
    } else if (inHand(myId) && folded(myId) && mine) mc = `<div style="opacity:.4;display:flex;gap:10px">${mine.map(c => cardHTML(c, true)).join('')}</div>`;
    let hn = '';
    if (mine && mine.length === 2) hn = Sutda.evalHand(mine).name;
    else if (mine && mine.length === 1) { const k = Sutda.card(mine[0]); hn = `${k.m}월${k.kind === 'gwang' ? ' 광' : ''}`; }
    let status = '';
    if (!inHand(myId)) status = mp.chips <= 0 ? '칩이 없어요 — 위의 [칩 충전]' : (ph === 'bet' ? '다음 판부터 참여해요' : '');
    else if (folded(myId)) status = '다이했어요';
    else if (allin(myId)) status = '올인!';
    else if (myTurn) status = '<b style="color:var(--gold2)">내 차례</b>';
    if (ph === 'show' && res && res.pay && res.pay[myId]) status = `<b style="color:var(--win)">+${won(res.pay[myId])} 획득!</b>`;
    const lg = myTurn ? (h.lg || {}) : {};
    const need = h ? Math.max(0, h.cur - ((h.bet && h.bet[myId]) || 0)) : 0;
    const B = (k, label, cls) => {
      const ok = k in lg, cost = ok ? lg[k] : null;
      const sub = k === 'die' ? '포기' : k === 'check' ? '그냥 넘김' : ok ? won(cost) + (cost >= mp.chips && cost > 0 ? ' 올인' : '') : (k === 'call' && need ? won(need) : '');
      return `<button class="act ${cls}" data-act="${k}" ${ok ? '' : 'disabled'}>${label}<small>${sub}</small></button>`;
    };
    const showCheck = 'check' in lg || (!myTurn && need === 0);
    meEl.innerHTML = `
      <div class="mycards">${mc || '<span class="muted">패 없음</span>'}</div>
      <div class="info">
        <div class="myname">${esc(mp.name)} ${s.sun === myId && h ? '<span class="tag sun">선</span>' : ''}${isHost ? '<span class="tag host">방장</span>' : ''}</div>
        <div class="myhand">${esc(hn) || '&nbsp;'}</div>
        <div class="mychips">보유 ${won(mp.chips)}${h && h.bet && h.bet[myId] ? ` · 이번 베팅 ${won(h.bet[myId])}` : ''}${status ? ' · ' + status : ''}</div>
        ${myTurn ? '<div class="timer" style="max-width:240px"><i data-timer></i></div>' : ''}
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
  lastCardsKey = cardsKey;
  renderLog();
  renderTimers();
}
function renderHostbar(){
  const hb = $('#hostbar'), s = PS;
  if (!s || s.host !== me.pid) { hb.classList.add('hidden'); hb.dataset.sig = ''; return; }
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
if (showInvite() && myName) { const m = /^#([a-z0-9]{4})$/i.exec(location.hash); joinTable(m[1]); }
showResume(); loadTables();
})();

// 로우바둑이 규칙 엔진 (한국식: 4장 → 아침·점심·저녁 3번 교환, 베팅 4번). 서버와 브라우저가 같이 씀
// 7포커 엔진과 같은 이름의 함수를 내보내서 서버가 방 종류에 따라 바꿔 끼운다.
(function (root) {
  'use strict';
  const P7 = typeof module !== 'undefined' && module.exports ? require('./poker7.js') : root.Poker7;
  const MAX_PLAYERS = 5, MAX_RAISES = 4, DRAW_MS = 15000, TURN_MS = 30000;
  const SUITS = ['♠', '♥', '♦', '♣'];
  const DRAW_NAMES = ['아침', '점심', '저녁'];
  // 카드 번호 0~51 (홀덤·7포커와 같음): 숫자 = c >> 2 (0 = 2, 12 = A), 무늬 = c & 3
  const rankOf = c => c >> 2, suitOf = c => c & 3;
  // 바둑이는 A가 가장 낮다: 낮은 순서 0 = A, 1 = 2, … 12 = K
  const lowOf = c => (rankOf(c) === 12 ? 0 : rankOf(c) + 1);
  const LOW_KO = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const cardName = c => LOW_KO[lowOf(c)] + SUITS[suitOf(c)];

  // ───────────── 족보 ─────────────
  // 숫자도 무늬도 겹치지 않는 카드만 센다. 장수가 많을수록 좋고(메이드 4장 > 베이스 3장 > 투베이스 2장 > 1장),
  // 장수가 같으면 가장 높은 카드부터 낮은 쪽이 이긴다. 무늬로는 가르지 않는다 (완전히 같으면 나눠 가짐)
  // 점수 = 장수 × 13^4 + 높은 카드부터 (12 - 숫자)를 13진으로
  function evalSet(cs) {
    const v = cs.map(lowOf).sort((a, b) => b - a);
    let s = cs.length;
    for (let i = 0; i < 4; i++) s = s * 13 + (i < v.length ? 12 - v[i] : 0);
    return s;
  }
  const ok = cs => new Set(cs.map(rankOf)).size === cs.length && new Set(cs.map(suitOf)).size === cs.length;
  function best(cards) {
    let top = -1, set = [];
    const n = cards.length;
    for (let m = 1; m < (1 << n); m++) {
      const cs = cards.filter((_, i) => m & (1 << i));
      if (!ok(cs)) continue;
      const s = evalSet(cs);
      if (s > top) { top = s; set = cs; }
    }
    return { score: top, set };
  }
  const sizeOf = score => Math.floor(score / 28561); // 13^4
  function highs(score) { const ks = []; let v = score; for (let i = 0; i < 4; i++) { ks.unshift(12 - (v % 13)); v = Math.floor(v / 13); } return ks.slice(0, sizeOf(score)); }
  // 메이드 특수 족보: 골프 A234, 세컨드 A235, 써드 A245
  function special(score) {
    if (sizeOf(score) !== 4) return null;
    const k = highs(score).join(',');
    return k === '3,2,1,0' ? '골프' : k === '4,2,1,0' ? '세컨드' : k === '4,3,1,0' ? '써드' : null;
  }
  function handName(score) {
    if (score < 0) return '';
    const n = sizeOf(score), ks = highs(score), sp = special(score);
    if (sp) return sp;
    const top = LOW_KO[ks[0]], list = ks.map(k => LOW_KO[k]).join('·');
    if (n === 4) return `${top} 메이드 (${list})`;
    if (n === 3) return `${top} 베이스 (${list})`;
    if (n === 2) return `투베이스 (${list})`;
    return `노베이스 (${list})`;
  }
  // 땡값 배수: 골프 3배, 세컨드 2배, 써드 1배
  function ttaengMult(score) { const sp = special(score); return sp === '골프' ? 3 : sp === '세컨드' ? 2 : sp === '써드' ? 1 : 0; }

  // 섞기용 (교환할 카드가 모자라면 버린 카드를 섞어서 다시 씀) — 상태에 숫자만 남게 직접 만든 난수
  function lcg(h) { h.seed = (Math.imul(h.seed, 1664525) + 1013904223) >>> 0; return h.seed / 4294967296; }

  // ───────────── 상태 머신 ─────────────
  function createGame(opts) {
    return {
      kind: 'badugi', v: 0, ante: (opts && opts.ante) || 100, startChips: (opts && opts.startChips) || 10000,
      players: [], phase: 'lobby', hand: null, button: null, log: [], handNo: 0,
      rake: (opts && opts.rake) || null, rakeTotal: 0, ttaeng: opts && opts.ttaeng ? 1 : 0,
    };
  }
  function P(S, id) { return S.players.find(p => p.id === id); }
  function log(S, msg) { S.log.push(msg); if (S.log.length > 30) S.log.shift(); }
  const bump = S => { S.v++; };
  const won = n => n.toLocaleString();

  function addPlayer(S, id, name, bot) {
    let p = P(S, id);
    if (p) { p.name = name || p.name; p.away = false; bump(S); return p; }
    if (S.players.length >= MAX_PLAYERS) return null;
    p = { id, name: name || '플레이어', chips: S.startChips, bot: !!bot, away: false };
    S.players.push(p); log(S, `${p.name} 입장`); bump(S); return p;
  }
  function removePlayer(S, id) {
    const i = S.players.findIndex(p => p.id === id);
    if (i < 0) return;
    const h = S.hand;
    if (h && S.phase === 'bet' && h.seats.includes(id) && !h.folded[id]) return false;
    log(S, `${S.players[i].name} 퇴장`);
    S.players.splice(i, 1); bump(S); return true;
  }
  const canStart = S => S.phase !== 'bet' && S.players.filter(p => p.chips > 0 && !p.away).length >= 2;
  const live = S => S.hand.seats.filter(id => !S.hand.folded[id]);
  const actors = S => live(S).filter(id => !S.hand.allin[id]);

  function pay(S, id, amt, isAnte) {
    const h = S.hand, p = P(S, id);
    const a = Math.max(0, Math.min(amt, p.chips));
    p.chips -= a; h.contrib[id] += a; h.pot += a;
    if (!isAnte) h.bet[id] += a;
    if (p.chips === 0) h.allin[id] = true;
    return a;
  }
  function draw1(h) {
    if (!h.deck.length) { // 덱이 비면 버린 카드를 섞어서 다시 씀
      const d = h.muck; h.muck = [];
      for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(lcg(h) * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
      h.deck = d;
    }
    return h.deck.pop();
  }

  function startHand(S, rng, now) {
    if (!canStart(S)) return false;
    const part = S.players.filter(p => p.chips > 0 && !p.away).map(p => p.id);
    let bi = 0; // 자리 순서: 지난 판 첫 자리 다음 사람부터
    if (S.button != null) {
      const all = S.players.map(p => p.id), from = all.indexOf(S.button);
      bi = -1;
      for (let k = 1; k <= all.length && bi < 0; k++) { const c = all[((from < 0 ? 0 : from) + k) % all.length]; if (part.includes(c)) bi = part.indexOf(c); }
      if (bi < 0) bi = 0;
    }
    const seats = part.slice(bi).concat(part.slice(0, bi));
    S.button = seats[0];
    S.handNo++;
    const h = S.hand = {
      no: S.handNo, deal: 1, seats, cards: {}, deck: P7.shuffle(rng), muck: [], seed: Math.floor(rng() * 4294967296) >>> 0,
      stage: 'bet', drawNo: 0, pick: {}, drew: {}, folded: {}, allin: {}, bet: {}, contrib: {}, pot: 0, cur: 0, raises: 0,
      toAct: null, acted: {}, deadline: 0, result: null, lastAct: {},
      rk: S.rake ? Object.assign({}, S.rake) : null, tg: S.ttaeng || 0,
    };
    seats.forEach(id => { h.contrib[id] = 0; h.bet[id] = 0; });
    h.start = Object.fromEntries(seats.map(id => [id, P(S, id).chips])); // 땡값 상한용
    S.phase = 'bet';
    log(S, `── ${h.no}판 시작 (판돈 ${won(S.ante)}) ──`);
    for (const id of seats) pay(S, id, S.ante, true);
    for (let r = 0; r < 4; r++) for (const id of seats) (h.cards[id] = h.cards[id] || []).push(h.deck.pop());
    beginRound(S, now);
    bump(S);
    return true;
  }

  // ── 베팅 라운드 (0: 카드 받고, 1: 아침 뒤, 2: 점심 뒤, 3: 저녁 뒤). 선은 그 판 첫 자리
  function beginRound(S, now) {
    const h = S.hand;
    h.stage = 'bet'; h.cur = 0; h.raises = 0; h.acted = {}; h.lastAct = {};
    h.seats.forEach(id => { h.bet[id] = 0; });
    h.toAct = null;
    if (actors(S).length <= 1) return nextStep(S, now); // 베팅할 사람이 한 명 이하면 교환만 계속
    log(S, h.drawNo === 0 ? '첫 베팅' : `${DRAW_NAMES[h.drawNo - 1]} 베팅${h.drawNo === 3 ? ' (마지막)' : ''}`);
    advance(S, now, h.seats[h.seats.length - 1]);
  }
  function nextStep(S, now) {
    const h = S.hand;
    if (live(S).length === 1) return finishFold(S);
    if (h.drawNo >= 3) return showdown(S);
    return startDraw(S, now);
  }
  function roundDone(S) {
    const h = S.hand, as = actors(S);
    if (as.length === 0) return true;
    if (as.length === 1) {
      const id = as[0];
      const maxBet = Math.max(0, ...live(S).map(x => h.bet[x]));
      return h.bet[id] >= maxBet && (h.acted[id] || maxBet === 0);
    }
    return as.every(id => h.acted[id] && h.bet[id] === h.cur);
  }
  function advance(S, now, fromId) {
    const h = S.hand;
    if (live(S).length === 1) return finishFold(S);
    if (roundDone(S)) { h.toAct = null; return nextStep(S, now); }
    const n = h.seats.length, startIdx = h.seats.indexOf(fromId);
    for (let k = 1; k <= n; k++) {
      const id = h.seats[(startIdx + k) % n];
      if (h.folded[id] || h.allin[id]) continue;
      if (!h.acted[id] || h.bet[id] < h.cur) { h.toAct = id; h.deadline = (now || 0) + TURN_MS; return; }
    }
    h.toAct = null; return nextStep(S, now);
  }

  // ── 교환: 살아 있는 사람이 동시에 바꿀 카드를 고른다 (0~4장, 0장이면 패스)
  function startDraw(S, now) {
    const h = S.hand;
    h.stage = 'draw'; h.pick = {}; h.drew = {}; h.dix = {}; h.toAct = null; h.lastAct = {}; h.choiceAt = null;
    h.deadline = (now || 0) + DRAW_MS;
    log(S, `${DRAW_NAMES[h.drawNo]}: 바꿀 카드를 골라요`);
    bump(S);
  }
  const choicePending = S => { const h = S.hand; return h && S.phase === 'bet' && h.stage === 'draw' ? live(S).filter(id => !h.pick[id]) : []; };
  function draw(S, id, ix, now) {
    const h = S.hand;
    if (!h || S.phase !== 'bet' || h.stage !== 'draw' || h.folded[id] || !h.seats.includes(id) || h.pick[id]) return false;
    if (!Array.isArray(ix)) return false;
    const set = [...new Set(ix.map(Number))];
    if (set.some(i => !(Number.isInteger(i) && i >= 0 && i < 4))) return false;
    h.pick[id] = set.sort((a, b) => a - b);
    bump(S);
    if (!choicePending(S).length) finishDraw(S, now);
    return true;
  }
  // 바꿀 카드 고르기 (시간 초과·자리 비움·봇): 바둑이에 안 쓰이는 카드는 바꾸고, 높은 카드는 남은 교환 횟수 보고 버림
  function autoPick(cards, drawsLeft) {
    const b = best(cards), keep = new Set(b.set);
    let out = cards.map((c, i) => (keep.has(c) ? -1 : i)).filter(i => i >= 0);
    const n = b.set.length;
    const limit = n === 4 ? (drawsLeft >= 3 ? 8 : drawsLeft === 2 ? 9 : drawsLeft === 1 ? 10 : 12) : (drawsLeft >= 2 ? 8 : drawsLeft === 1 ? 9 : 12);
    if (n >= 3) { // 가장 높은 카드가 너무 높으면 그것도 바꾼다
      const hi = b.set.reduce((a, c) => (lowOf(c) > lowOf(a) ? c : a));
      if (lowOf(hi) > limit && drawsLeft > 0) out.push(cards.indexOf(hi));
    }
    return out.sort((a, b) => a - b);
  }
  function autoChoose(S, now, onlyId) {
    const h = S.hand; if (!h || h.stage !== 'draw') return false;
    const ids = onlyId ? [onlyId] : choicePending(S);
    let any = false;
    for (const id of ids) { if (h.pick[id] || h.folded[id]) continue; h.pick[id] = autoPick(h.cards[id], 3 - h.drawNo); any = true; }
    if (any) bump(S);
    if (h.stage === 'draw' && !choicePending(S).length) finishDraw(S, now);
    return any;
  }
  const botChoose = (S, id) => { const h = S.hand; if (!h || h.stage !== 'draw' || h.pick[id]) return false; return draw(S, id, autoPick(h.cards[id], 3 - h.drawNo), 0); };
  function finishDraw(S, now) {
    const h = S.hand;
    const n = h.seats.length;
    for (let k = 0; k < n; k++) { // 선부터 차례로 받는다
      const id = h.seats[k];
      if (h.folded[id]) continue;
      const ix = h.pick[id] || [];
      ix.forEach(i => { h.muck.push(h.cards[id][i]); });
      ix.forEach(i => { h.cards[id][i] = draw1(h); });
      h.drew[id] = ix.length; h.dix[id] = ix.slice();
    }
    const nm = DRAW_NAMES[h.drawNo];
    log(S, `${nm} 교환: ` + h.seats.filter(id => !h.folded[id]).map(id => `${P(S, id).name} ${h.drew[id] ? h.drew[id] + '장' : '패스'}`).join(', '));
    h.drawNo++; h.deal++;
    S.ev = { n: ((S.ev && S.ev.n) || 0) + 1, k: 'draw', dr: Object.assign({}, h.drew) };
    beginRound(S, now);
  }

  // 베팅 (섯다·7포커와 같은 한국식): 다이 · 체크/콜 · 삥 · 하프 · 따당
  function legal(S, id) {
    const h = S.hand; if (!h || S.phase !== 'bet' || h.stage !== 'bet' || h.toAct !== id) return {};
    const p = P(S, id), need = h.cur - h.bet[id];
    const out = { die: 0 };
    if (need <= 0) out.check = 0; else out.call = Math.min(need, p.chips);
    const canRaise = h.raises < MAX_RAISES && p.chips > need && actors(S).length > 1;
    if (canRaise) {
      if (h.cur === 0) out.bbing = Math.min(S.ante, p.chips);
      out.half = Math.min(need + Math.max(S.ante, Math.floor((h.pot + need) / 2)), p.chips);
      if (h.cur > 0) out.ddadang = Math.min(2 * h.cur - h.bet[id], p.chips);
    }
    return out;
  }
  const ACT_NAMES = { die: '다이', check: '체크', call: '콜', bbing: '삥', half: '하프', ddadang: '따당' };
  function act(S, id, kind, now) {
    if (kind === 'fold') kind = 'die';
    const L = legal(S, id);
    if (!(kind in L)) return false;
    const h = S.hand, p = P(S, id);
    if (kind === 'die') { h.folded[id] = true; log(S, `${p.name}: 다이`); }
    else {
      const paid = pay(S, id, L[kind]);
      if (h.bet[id] > h.cur) { h.cur = h.bet[id]; h.acted = {}; h.raises++; }
      h.acted[id] = true;
      log(S, `${p.name}: ${ACT_NAMES[kind]}${paid ? ' ' + won(paid) : ''}${h.allin[id] ? ' (올인)' : ''}`);
    }
    h.lastAct[id] = kind;
    S.ev = { n: ((S.ev && S.ev.n) || 0) + 1, id, k: kind, ai: !!h.allin[id] };
    advance(S, now, id);
    bump(S);
    return true;
  }
  function autoAct(S, now) {
    const h = S.hand; if (!h || S.phase !== 'bet') return false;
    if (h.stage === 'draw') return autoChoose(S, now);
    if (!h.toAct) return false;
    const L = legal(S, h.toAct);
    return act(S, h.toAct, 'check' in L ? 'check' : 'die', now);
  }
  // 교환 중에 나가면 그 판은 다이
  function leaveHand(S, id, now) {
    const h = S.hand;
    if (!h || S.phase !== 'bet' || !h.seats.includes(id) || h.folded[id]) return false;
    if (h.stage === 'draw') {
      h.folded[id] = true; log(S, `${P(S, id).name}: 다이`); bump(S);
      if (live(S).length === 1) { finishFold(S); return true; }
      if (!choicePending(S).length) finishDraw(S, now);
      return true;
    }
    if (h.toAct === id) return act(S, id, 'die', now);
    return false;
  }

  function collectTtaeng(S, h, w, ids, mult, payMap) {
    if (!(mult > 0)) return null;
    const myBet = h.contrib[w] || 0;
    if (h.allin[w] && ids.some(id => id !== w && (h.contrib[id] || 0) > myBet)) return null;
    const each = Math.floor(myBet * mult);
    if (each <= 0) return null;
    const start = h.start && h.start[w] != null ? h.start[w] : Infinity;
    const cap = Math.max(0, start - Math.max(0, (payMap[w] || 0) - myBet));
    const from = {}; let total = 0;
    for (const id of ids) {
      if (id === w) continue;
      const p = P(S, id); if (!p) continue;
      const a = Math.min(each, p.chips, cap - total); if (a <= 0) continue;
      p.chips -= a; from[id] = a; total += a;
    }
    if (total <= 0) return null;
    P(S, w).chips += total;
    return { to: w, each, mult, from, total };
  }
  function finishFold(S) {
    const h = S.hand, w = live(S)[0];
    const pw = P(S, w), rake = P7.rakeFor(h, true), win = h.pot - rake;
    pw.chips += win; S.rakeTotal = (S.rakeTotal || 0) + rake;
    h.result = { type: 'fold', winners: [w], pay: { [w]: win }, rake, reveal: false };
    log(S, `${pw.name} 승리 (+${won(win)}, 모두 다이)`);
    h.toAct = null; h.stage = 'bet'; S.phase = 'show';
  }
  function showdown(S) {
    const h = S.hand;
    h.toAct = null; h.stage = 'bet';
    const ids = h.seats.filter(id => !h.folded[id]);
    const score = {}, ev = {}, five = {};
    for (const id of ids) { const b = best(h.cards[id]); score[id] = b.score; ev[id] = handName(b.score); five[id] = b.set; }
    const { pay: payMap, mainWinners, rake } = P7.settle(h.contrib, ids, score, P7.rakeFor(h, false));
    Object.entries(payMap).forEach(([id, a]) => { P(S, id).chips += a; });
    S.rakeTotal = (S.rakeTotal || 0) + rake;
    h.result = { type: 'show', winners: mainWinners, pay: payMap, ev, five, rake, reveal: true };
    log(S, `${mainWinners.map(id => `${P(S, id).name}(${ev[id]})`).join(', ')} 승리`);
    Object.entries(payMap).forEach(([id, a]) => { if (!mainWinners.includes(id)) log(S, `${P(S, id).name} 사이드팟 +${won(a)}`); });
    if (h.tg > 0 && mainWinners.length === 1) {
      const w = mainWinners[0];
      const tg = collectTtaeng(S, h, w, ids, ttaengMult(score[w]), payMap);
      if (tg) { h.result.tg = tg; log(S, `땡값! ${P(S, w).name} +${won(tg.total)} (${special(score[w])}, 건 금액의 ${tg.mult}배, 각자 ${won(tg.each)})`); }
    }
    S.phase = 'show';
  }

  // 공개 상태: 남의 카드는 장수만 (전부 null). 결과 공개 때는 끝까지 남은 사람 패 전부
  function publicState(S, now) {
    const h = S.hand;
    const out = {
      kind: 'badugi', v: S.v, ph: S.phase, ante: S.ante, tg: S.ttaeng || 0, sc: S.startChips,
      pl: S.players.map(p => [p.id, p.name, p.chips, (p.bot ? 1 : 0) | (p.away ? 2 : 0)]),
      log: S.log.slice(-8), ev: S.ev || null,
    };
    if (h) {
      const vis = {};
      for (const id of h.seats) vis[id] = (h.cards[id] || []).map(() => null);
      out.h = {
        no: h.no, dl: h.deal, dn: h.drawNo, stage: h.stage, seats: h.seats, vis, sun: h.seats[0],
        chosen: Object.keys(h.pick || {}), drew: h.drew || {}, dix: h.dix || {},
        fo: Object.keys(h.folded), ai: Object.keys(h.allin).filter(k => h.allin[k]),
        bet: h.bet, pot: h.pot, cur: h.cur, ta: h.toAct, raises: h.raises, la: h.lastAct,
        left: (h.toAct || h.stage === 'draw') && S.phase === 'bet' ? Math.max(0, h.deadline - (now || 0)) : 0,
        total: h.stage === 'draw' ? DRAW_MS : TURN_MS,
      };
      if (h.result) {
        const r = Object.assign({}, h.result);
        if (r.reveal) r.cards = Object.fromEntries(live(S).map(id => [id, h.cards[id]]));
        out.h.res = r;
      }
    }
    return out;
  }
  // 내 카드 (교환 중이면 내가 고른 카드도)
  const myView = (S, id) => { const h = S.hand; return h && h.cards[id] && h.seats.includes(id) ? { no: h.no, dl: h.deal, cards: h.cards[id], pick: h.pick && h.pick[id] || null } : null; };

  // ───────────── 봇 ─────────────
  // 손패 세기 (0~1): 메이드는 높은 카드가 낮을수록, 덜 된 패는 남은 교환이 많을수록 기대치가 있음
  function strength(cards, drawsLeft) {
    const b = best(cards), n = b.set.length, hi = b.set.length ? Math.max(...b.set.map(lowOf)) : 12;
    if (n === 4) return 0.55 + (12 - hi) / 12 * 0.45;
    if (n === 3) return 0.2 + (12 - hi) / 12 * 0.2 + drawsLeft * 0.09;
    return 0.05 + drawsLeft * 0.06;
  }
  function botDecide(S, id, rng) {
    const h = S.hand, L = legal(S, id);
    const need = 'call' in L ? L.call : 0;
    const opps = live(S).length - 1;
    // 상대가 패스(안 바꿈)하면 메이드일 가능성이 높으니 조심
    const passers = live(S).filter(x => x !== id && h.drawNo > 0 && h.drew[x] === 0).length;
    const eq = strength(h.cards[id], 3 - h.drawNo) - 0.05 * (opps - 1) - 0.08 * passers + (rng() - 0.5) * 0.1;
    const ratio = need / Math.max(1, h.pot + need);
    if (eq > 0.8 && ('half' in L || 'ddadang' in L) && rng() < 0.7) return 'ddadang' in L && rng() < 0.4 ? 'ddadang' : 'half';
    if (eq > 0.55 && 'bbing' in L && rng() < 0.5) return 'bbing';
    if (need === 0) return 'check';
    if (eq > ratio + 0.1) return 'call';
    if (h.drawNo === 0 && ratio < 0.25 && eq > 0.2) return 'call';
    return 'die';
  }

  const redeal = () => false, rejoinAnswer = () => false, rejoinPending = () => [];

  const api = {
    MAX_PLAYERS, DRAW_MS, DRAW_NAMES, LOW_KO, SUITS, rankOf, suitOf, lowOf, cardName, evalSet, best, handName, sizeOf, special, ttaengMult,
    createGame, addPlayer, removePlayer, canStart, startHand, legal, act, autoAct, redeal, rejoinAnswer, rejoinPending,
    draw, choicePending, autoChoose, autoPick, botChoose, leaveHand, myView,
    publicState, botDecide, ACT_NAMES, strength,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Badugi = api;
})(typeof window !== 'undefined' ? window : globalThis);

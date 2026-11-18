// 텍사스 홀덤 규칙 엔진 (서버와 브라우저가 같이 씀)
// 섯다 엔진(core.js)과 같은 모양의 함수를 내보내서 서버가 방 종류에 따라 바꿔 끼운다.
(function (root) {
  'use strict';
  const MAX_PLAYERS = 6;
  const RANKS = '23456789TJQKA';
  const RANK_KO = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  // 카드 번호 0~51: 숫자 = c >> 2 (0 = 2, 12 = A), 무늬 = c & 3
  const rankOf = c => c >> 2, suitOf = c => c & 3;
  const cardName = c => RANK_KO[rankOf(c)] + SUITS[suitOf(c)];
  const cardCode = c => RANKS[rankOf(c)] + 'shdc'[suitOf(c)];

  // ───────────── 족보 ─────────────
  // 점수는 [족보 번호, 비교용 숫자들]을 하나의 정수로 접어서 크기만 비교하면 되게 만든다
  const CAT = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];
  const pack = (cat, ks) => { let v = cat; for (let i = 0; i < 5; i++) v = v * 13 + (ks[i] || 0); return v; };

  function eval5(cs) {
    const rs = cs.map(rankOf).sort((a, b) => b - a);
    const flush = cs.every(c => suitOf(c) === suitOf(cs[0]));
    const uniq = [...new Set(rs)];
    let straightHi = -1;
    if (uniq.length === 5) {
      if (rs[0] - rs[4] === 4) straightHi = rs[0];
      else if (rs[0] === 12 && rs[1] === 3) straightHi = 3; // A-2-3-4-5 (휠)
    }
    if (straightHi >= 0 && flush) return pack(8, [straightHi]);
    const cnt = {}; rs.forEach(r => { cnt[r] = (cnt[r] || 0) + 1; });
    const groups = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a);
    const shape = groups.map(g => cnt[g]).join('');
    if (shape === '41') return pack(7, groups);
    if (shape === '32') return pack(6, groups);
    if (flush) return pack(5, rs);
    if (straightHi >= 0) return pack(4, [straightHi]);
    if (shape === '311') return pack(3, groups);
    if (shape === '221') return pack(2, groups);
    if (shape === '2111') return pack(1, groups);
    return pack(0, rs);
  }
  // n장 중 5장을 고르는 모든 조합 (n = 5, 6, 7)
  const COMBOS = {};
  function combos(n) {
    if (COMBOS[n]) return COMBOS[n];
    const out = [], f = (st, a) => { if (a.length === 5) { out.push(a); return; } for (let i = st; i < n; i++) f(i + 1, a.concat(i)); };
    f(0, []);
    return (COMBOS[n] = out);
  }
  // 패 2장 + 공용 카드 중 가장 좋은 5장
  function best(cards) {
    if (cards.length < 5) return { score: -1, five: cards.slice() };
    let top = -1, five = null;
    for (const cmb of combos(cards.length)) {
      const f = cmb.map(i => cards[i]), sc = eval5(f);
      if (sc > top) { top = sc; five = f; }
    }
    return { score: top, five };
  }
  function handName(score) {
    if (score < 0) return '';
    let v = score; const ks = [];
    for (let i = 0; i < 5; i++) { ks.unshift(v % 13); v = Math.floor(v / 13); }
    const cat = v, R = i => RANK_KO[ks[i]];
    switch (cat) {
      case 8: return ks[0] === 12 ? '로열 플러시' : `스트레이트 플러시 (${R(0)} 하이)`;
      case 7: return `포카드 (${R(0)})`;
      case 6: return `풀하우스 (${R(0)}·${R(1)})`;
      case 5: return `플러시 (${R(0)} 하이)`;
      case 4: return `스트레이트 (${R(0)} 하이)`;
      case 3: return `트리플 (${R(0)})`;
      case 2: return `투페어 (${R(0)}·${R(1)})`;
      case 1: return `원페어 (${R(0)})`;
      default: return `하이카드 (${R(0)})`;
    }
  }
  const catOf = score => Math.floor(score / 371293); // 13^5

  function shuffle(rng) {
    const d = Array.from({ length: 52 }, (_, i) => i);
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }

  // ───────────── 정산 ─────────────
  // contrib: {id: 총 기여}, live: 폴드 안 한 id(버튼 다음부터 순서), score: {id: 점수}, rake: 뗄 총액
  // 자투리 칩은 버튼 왼쪽부터 가까운 승자에게
  function settle(contrib, live, score, rake) {
    const pay = {};
    const levels = [...new Set(Object.values(contrib).filter(v => v > 0))].sort((a, b) => a - b);
    const layers = [];
    let prev = 0;
    for (const lv of levels) {
      const contributors = Object.keys(contrib).filter(id => contrib[id] >= lv);
      layers.push({ amount: (lv - prev) * contributors.length, elig: live.filter(id => contrib[id] >= lv), refund: contributors.length === 1 });
      prev = lv;
    }
    const contested = layers.filter(l => !l.refund && l.elig.length);
    const total = contested.reduce((a, l) => a + l.amount, 0);
    let taken = 0;
    rake = Math.max(0, Math.min(Math.floor(rake || 0), total));
    if (rake > 0) {
      let big = contested[0];
      contested.forEach(l => { if (l.amount > big.amount) big = l; });
      contested.forEach(l => { const r = Math.floor(l.amount * rake / total); l.amount -= r; taken += r; });
      big.amount -= rake - taken; taken = rake;
    }
    let mainWinners = null, leftover = 0;
    const pots = [];
    for (const { amount, elig } of layers) {
      if (!elig.length) { leftover += amount; continue; }
      const top = Math.max(...elig.map(id => score[id]));
      const winners = elig.filter(id => score[id] === top);
      if (!mainWinners) mainWinners = winners;
      const share = Math.floor(amount / winners.length);
      let rem = amount - share * winners.length;
      winners.forEach(w => { pay[w] = (pay[w] || 0) + share + (rem-- > 0 ? 1 : 0); });
      if (elig.length > 1) pots.push({ amount, winners });
    }
    if (leftover && mainWinners) {
      const share = Math.floor(leftover / mainWinners.length);
      let rem = leftover - share * mainWinners.length;
      mainWinners.forEach(w => { pay[w] = (pay[w] || 0) + share + (rem-- > 0 ? 1 : 0); });
    }
    return { pay, mainWinners: mainWinners || [], rake: taken, pots };
  }
  function uncalled(contrib) {
    const v = Object.values(contrib || {}).sort((a, b) => b - a);
    return v.length > 1 && v[0] > v[1] ? v[0] - v[1] : 0;
  }
  // 수수료: 섯다와 같은 설정 {rate(%), cap, min, folds}. 플롭이 안 열린 판은 안 뗀다 (노 플롭 노 드롭)
  function rakeFor(h, isFold) {
    const r = h.rk;
    if (!r || !(r.rate > 0)) return 0;
    if (h.street === 0) return 0;
    if (isFold && !r.folds) return 0;
    const pot = h.pot - uncalled(h.contrib);
    if (pot <= 0 || pot < (r.min || 0)) return 0;
    let a = Math.floor(pot * r.rate / 100);
    if (r.cap > 0) a = Math.min(a, r.cap);
    return Math.max(0, Math.min(a, pot));
  }

  // ───────────── 상태 머신 ─────────────
  // opts.bb: 빅 블라인드 (스몰은 절반), opts.limit: 'nl' 노리밋 | 'pl' 팟리밋
  function createGame(opts) {
    const bb = (opts && opts.bb) || (opts && opts.ante) || 100;
    return {
      kind: 'holdem', v: 0, ante: bb, bb, sb: Math.max(1, Math.floor(bb / 2)),
      startChips: (opts && opts.startChips) || 10000,
      players: [], phase: 'lobby', hand: null, button: null, log: [], handNo: 0,
      rake: (opts && opts.rake) || null, rakeTotal: 0,
      limit: opts && opts.limit === 'pl' ? 'pl' : 'nl',
      ttaeng: opts && opts.ttaeng ? 1 : 0,   // 땡값 켬(1) / 끔(0)
    };
  }
  function P(S, id) { return S.players.find(p => p.id === id); }
  // 땡값 (한게임 맞포커 방식): 이긴 사람이 이 판에 건 금액 × 배수를, 끝까지 남은(다이·폴드 안 한) 패자가 1인당 낸다.
  // - 딴 돈(판돈에서 받은 것 - 자기가 건 것)과 땡값을 합쳐 판 시작 때 보유 칩을 넘을 수 없다
  // - 이긴 사람이 올인인데 그보다 많이 건 사람이 졌으면 땡값 없음
  // - 패자 칩이 모자라면 있는 만큼만
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
  // 땡값 배수 (한게임 7포커·홀덤 기준): 로티플 3배, 백티플·스티플 2배, 포카드 1배
  function ttaengMult(score) {
    const cat = catOf(score), top = Math.floor(score / 28561) % 13; // 13^4: 첫 비교 숫자
    if (cat === 8) return top === 12 ? 3 : 2;
    if (cat === 7) return 1;
    return 0;
  }

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

  function pay(S, id, amt) {
    const h = S.hand, p = P(S, id);
    const a = Math.max(0, Math.min(amt, p.chips));
    p.chips -= a; h.contrib[id] += a; h.pot += a; h.bet[id] += a;
    if (p.chips === 0) h.allin[id] = true;
    return a;
  }

  function startHand(S, rng, now) {
    if (!canStart(S)) return false;
    const part = S.players.filter(p => p.chips > 0 && !p.away).map(p => p.id);
    // 딜러 버튼: 좌석 순서로 지난 버튼 다음 사람
    let bi = 0;
    if (S.button != null) {
      const all = S.players.map(p => p.id);
      const from = all.indexOf(S.button);
      bi = -1;
      for (let k = 1; k <= all.length && bi < 0; k++) {
        const cand = all[((from < 0 ? 0 : from) + k) % all.length];
        if (part.includes(cand)) bi = part.indexOf(cand);
      }
      if (bi < 0) bi = 0;
    }
    const seats = part.slice(bi).concat(part.slice(0, bi)); // seats[0] = 버튼
    S.button = seats[0];
    S.handNo++;
    const n = seats.length;
    const h = S.hand = {
      no: S.handNo, deal: 1, seats, cards: {}, board: [], deck: shuffle(rng), street: 0,
      folded: {}, allin: {}, bet: {}, contrib: {}, pot: 0, cur: 0, minRaise: S.bb, toAct: null,
      acted: {}, noRaise: {}, deadline: 0, result: null, lastAct: {}, rk: S.rake ? Object.assign({}, S.rake) : null,
      sbId: seats[n === 2 ? 0 : 1], bbId: seats[n === 2 ? 1 : 2 % n], runout: false, tg: S.ttaeng || 0,
    };
    seats.forEach(id => { h.contrib[id] = 0; h.bet[id] = 0; });
    h.start = Object.fromEntries(seats.map(id => [id, P(S, id).chips])); // 땡값 상한용: 판 시작 때 칩
    S.phase = 'bet';
    log(S, `── ${h.no}판 시작 (블라인드 ${won(S.sb)}/${won(S.bb)}) ──`);
    const sbPaid = pay(S, h.sbId, S.sb), bbPaid = pay(S, h.bbId, S.bb);
    log(S, `${P(S, h.sbId).name}: 스몰 블라인드 ${won(sbPaid)}`);
    log(S, `${P(S, h.bbId).name}: 빅 블라인드 ${won(bbPaid)}`);
    h.cur = S.bb;
    if (S.deckHook) S.deckHook(S);
    for (let r = 0; r < 2; r++) for (const id of seats) (h.cards[id] = h.cards[id] || []).push(h.deck.pop());
    h.toAct = null;
    advance(S, now, h.bbId);
    bump(S);
    return true;
  }

  // 이번 스트리트 베팅이 끝났는지. 행동할 사람이 한 명뿐이면(나머지는 올인) 남이 건 만큼 맞췄을 때 끝
  // 블라인드는 행동이 아니라서, 프리플롭에 모두 콜만 하면 빅 블라인드가 마지막으로 선택권을 가진다
  function roundDone(S) {
    const h = S.hand, as = actors(S);
    if (as.length === 0) return true;
    if (as.length === 1) {
      const id = as[0];
      const maxOther = Math.max(0, ...live(S).filter(x => x !== id).map(x => h.bet[x]));
      return h.bet[id] >= maxOther && (h.acted[id] || h.bet[id] >= h.cur);
    }
    return as.every(id => h.acted[id] && h.bet[id] === h.cur);
  }

  function nextStreet(S) {
    const h = S.hand;
    h.street++;
    h.deck.pop(); // 버리는 카드 한 장
    const k = h.street === 1 ? 3 : 1;
    for (let i = 0; i < k; i++) h.board.push(h.deck.pop());
    h.cur = 0; h.minRaise = S.bb; h.acted = {}; h.noRaise = {}; h.lastAct = {};
    h.seats.forEach(id => { h.bet[id] = 0; });
    const names = ['', '플롭', '턴', '리버'];
    log(S, `${names[h.street]}: ${h.board.slice(h.street === 1 ? 0 : -1).map(cardName).join(' ')}`);
  }

  function advance(S, now, fromId) {
    const h = S.hand;
    if (live(S).length === 1) return finishFold(S);
    if (roundDone(S)) {
      if (h.street === 3) return showdown(S);
      // 더 베팅할 사람이 없으면 남은 카드를 다 깔고 승부
      if (actors(S).length <= 1) {
        h.runout = h.street < 3;
        while (h.street < 3) nextStreet(S);
        return showdown(S);
      }
      nextStreet(S);
      return advance(S, now, h.seats[0]);
    }
    const n = h.seats.length;
    const startIdx = h.seats.indexOf(fromId);
    for (let k = 1; k <= n; k++) {
      const id = h.seats[(startIdx + k) % n];
      if (h.folded[id] || h.allin[id]) continue;
      if (!h.acted[id] || h.bet[id] < h.cur) { h.toAct = id; h.deadline = (now || 0) + 30000; return; }
    }
    // 행동할 사람이 없음 (모두 올인 등)
    if (actors(S).length <= 1) {
      h.runout = h.street < 3;
      while (h.street < 3) nextStreet(S);
      return showdown(S);
    }
    return showdown(S);
  }

  // 낼 수 있는 행동. raise는 이번 스트리트 총 베팅액(raise to) 기준 {min, max}
  function legal(S, id) {
    const h = S.hand; if (!h || S.phase !== 'bet' || h.toAct !== id) return {};
    const p = P(S, id), need = h.cur - h.bet[id];
    const out = { fold: 0 };
    if (need <= 0) out.check = 0; else out.call = Math.min(need, p.chips);
    const others = actors(S).filter(x => x !== id);
    const stack = h.bet[id] + p.chips; // 이번 스트리트에 최대로 걸 수 있는 총액
    if (p.chips > need && others.length > 0 && !h.noRaise[id]) {
      const minTo = h.cur === 0 ? Math.min(S.bb, stack) : h.cur + h.minRaise;
      const potMax = h.cur + h.pot + Math.max(0, need); // 팟리밋 최대
      const maxTo = S.limit === 'pl' ? Math.min(potMax, stack) : stack;
      if (maxTo > h.cur) {
        out[h.cur === 0 ? 'bet' : 'raise'] = { min: Math.min(minTo, maxTo), max: maxTo };
        if (maxTo === stack) out.allin = p.chips;
      }
    }
    if (!('allin' in out) && out.call === p.chips && p.chips > 0) out.allin = p.chips; // 콜이 곧 올인
    return out;
  }

  const ACT_NAMES = { fold: '폴드', check: '체크', call: '콜', bet: '벳', raise: '레이즈', allin: '올인' };

  function act(S, id, kind, now, amount) {
    if (kind === 'die') kind = 'fold';
    const L = legal(S, id);
    if (!(kind in L)) return false;
    const h = S.hand, p = P(S, id);
    let shown = kind;
    if (kind === 'fold') { h.folded[id] = true; log(S, `${p.name}: 폴드`); }
    else if (kind === 'check') { h.acted[id] = true; log(S, `${p.name}: 체크`); }
    else if (kind === 'call') { const a = pay(S, id, L.call); h.acted[id] = true; log(S, `${p.name}: 콜 ${won(a)}${h.allin[id] ? ' (올인)' : ''}`); }
    else {
      // bet/raise/allin: 이번 스트리트 총액 to 로 맞춘다
      let to;
      if (kind === 'allin') to = h.bet[id] + p.chips;
      else { const R = L[kind]; to = Math.floor(Number(amount)); if (!Number.isFinite(to)) to = R.min; to = Math.max(R.min, Math.min(R.max, to)); }
      if (to <= h.cur) { // 올인인데 콜보다 작거나 같음
        const a = pay(S, id, to - h.bet[id]); h.acted[id] = true;
        shown = 'allin'; log(S, `${p.name}: 올인 ${won(a)}`);
      } else {
        const inc = to - h.cur, wasCur = h.cur;
        pay(S, id, to - h.bet[id]);
        h.cur = to;
        if (inc >= h.minRaise) { h.minRaise = inc; h.acted = {}; h.noRaise = {}; }
        else for (const x of Object.keys(h.acted)) if (h.acted[x]) h.noRaise[x] = true; // 덜 올린 올인은 이미 행동한 사람에게 다시 올릴 권리를 주지 않음
        h.acted[id] = true;
        if (h.allin[id]) shown = 'allin';
        else shown = wasCur === 0 ? 'bet' : 'raise';
        log(S, `${p.name}: ${ACT_NAMES[shown]} ${won(to)}${h.allin[id] && shown !== 'allin' ? ' (올인)' : ''}`);
      }
    }
    h.lastAct[id] = shown;
    S.ev = { n: ((S.ev && S.ev.n) || 0) + 1, id, k: shown, ai: !!h.allin[id] };
    advance(S, now, id);
    bump(S);
    return true;
  }

  function autoAct(S, now) {
    const h = S.hand; if (!h || S.phase !== 'bet' || !h.toAct) return false;
    const L = legal(S, h.toAct);
    return act(S, h.toAct, 'check' in L ? 'check' : 'fold', now);
  }

  function finishFold(S) {
    const h = S.hand, w = live(S)[0];
    const pw = P(S, w), rake = rakeFor(h, true), win = h.pot - rake;
    pw.chips += win; S.rakeTotal = (S.rakeTotal || 0) + rake;
    h.result = { type: 'fold', winners: [w], pay: { [w]: win }, rake, reveal: false };
    log(S, `${pw.name} 승리 (+${won(win)}, 모두 폴드)`);
    h.toAct = null; S.phase = 'show';
  }

  function showdown(S) {
    const h = S.hand;
    h.toAct = null;
    // 버튼 왼쪽부터 순서
    const order = h.seats.slice(1).concat(h.seats.slice(0, 1));
    const ids = order.filter(id => !h.folded[id]);
    const score = {}, ev = {}, five = {};
    for (const id of ids) { const b = best(h.cards[id].concat(h.board)); score[id] = b.score; ev[id] = handName(b.score); five[id] = b.five; }
    const { pay: payMap, mainWinners, rake, pots } = settle(h.contrib, ids, score, rakeFor(h, false));
    Object.entries(payMap).forEach(([id, a]) => { P(S, id).chips += a; });
    S.rakeTotal = (S.rakeTotal || 0) + rake;
    h.result = { type: 'show', winners: mainWinners, pay: payMap, ev, five, rake, reveal: true, pots };
    log(S, `${mainWinners.map(id => `${P(S, id).name}(${ev[id]})`).join(', ')} 승리`);
    Object.entries(payMap).forEach(([id, a]) => { if (!mainWinners.includes(id)) log(S, `${P(S, id).name} 사이드팟 +${won(a)}`); });
    // 땡값: 포카드 이상으로 혼자 이기면 끝까지 남은 사람이 낸다
    if (h.tg > 0 && mainWinners.length === 1) {
      const w = mainWinners[0];
      const tg = collectTtaeng(S, h, w, ids, ttaengMult(score[w]), payMap);
      if (tg) { h.result.tg = tg; log(S, `땡값! ${P(S, w).name} +${won(tg.total)} (건 금액의 ${tg.mult}배, 각자 ${won(tg.each)})`); }
    }
    S.phase = 'show';
  }

  function publicState(S, now) {
    const h = S.hand;
    const out = {
      kind: 'holdem', v: S.v, ph: S.phase, ante: S.bb, sb: S.sb, bb: S.bb, lim: S.limit, tg: S.ttaeng || 0, btn: S.button, sc: S.startChips,
      pl: S.players.map(p => [p.id, p.name, p.chips, (p.bot ? 1 : 0) | (p.away ? 2 : 0)]),
      log: S.log.slice(-8), ev: S.ev || null,
    };
    if (h) {
      out.h = {
        no: h.no, st: h.street, dl: h.deal, seats: h.seats, board: h.board, sbId: h.sbId, bbId: h.bbId,
        fo: Object.keys(h.folded), ai: Object.keys(h.allin).filter(k => h.allin[k]),
        bet: h.bet, pot: h.pot, cur: h.cur, mr: h.minRaise, ta: h.toAct,
        left: h.toAct ? Math.max(0, h.deadline - (now || 0)) : 0, la: h.lastAct, runout: h.runout,
      };
      if (h.result) {
        const r = Object.assign({}, h.result);
        if (r.reveal) r.cards = Object.fromEntries(live(S).map(id => [id, h.cards[id]]));
        out.h.res = r;
      }
    }
    return out;
  }

  // ───────────── 봇 ─────────────
  // 프리플롭: 첸 공식을 0~1로 펴서 쓰고, 플롭 이후: 남은 상대 수만큼 무작위로 돌려 본 승률
  function preflopStrength(cs) {
    const [a, b] = cs.map(rankOf).sort((x, y) => y - x);
    const pts = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 10];
    let s = pts[a];
    if (a === b) s = Math.max(5, s * 2);
    else {
      if (suitOf(cs[0]) === suitOf(cs[1])) s += 2;
      const gap = a - b - 1;
      s -= gap <= 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
      if (gap <= 1 && a < 10) s += 1;
    }
    return Math.max(0, Math.min(1, (s + 1) / 21));
  }
  function equity(S, id, rng, iters) {
    const h = S.hand, opp = live(S).length - 1;
    const known = new Set(h.cards[id].concat(h.board));
    const rest = []; for (let c = 0; c < 52; c++) if (!known.has(c)) rest.push(c);
    let win = 0;
    for (let t = 0; t < iters; t++) {
      const d = rest.slice();
      const draw = () => { const j = Math.floor(rng() * d.length); const c = d[j]; d[j] = d[d.length - 1]; d.pop(); return c; };
      const board = h.board.slice(); while (board.length < 5) board.push(draw());
      const mine = best(h.cards[id].concat(board)).score;
      let lose = false, tie = 0;
      for (let o = 0; o < opp && !lose; o++) { const s = best([draw(), draw()].concat(board)).score; if (s > mine) lose = true; else if (s === mine) tie++; }
      if (!lose) win += tie ? 1 / (tie + 1) : 1;
    }
    return win / iters;
  }
  function botDecide(S, id, rng) {
    const h = S.hand, L = legal(S, id), p = P(S, id);
    const need = 'call' in L ? L.call : 0;
    const opp = Math.max(1, live(S).length - 1);
    const R = L.raise || L.bet;
    const sizeTo = frac => R ? Math.max(R.min, Math.min(R.max, Math.round(h.cur + (h.pot + need) * frac))) : 0;
    const raiseTo = to => (to >= R.max && 'allin' in L) ? { k: 'allin' } : { k: L.raise ? 'raise' : 'bet', a: to };
    const potOdds = need / Math.max(1, h.pot + need);
    const noise = (rng() - 0.5) * 0.08;
    if (h.street === 0) {
      // 프리플롭: 손패 점수로 판단. 상대가 많을수록, 걸린 금액이 클수록 빡빡하게
      const s = preflopStrength(h.cards[id]) + noise - (opp - 1) * 0.015;
      const big = need / Math.max(1, p.chips + need); // 스택 대비 콜 금액
      if (R && s > 0.6 && rng() < 0.85) return raiseTo(sizeTo(h.cur > S.bb ? 1 : 0.8));
      if (need === 0) return R && s > 0.45 && rng() < 0.35 ? raiseTo(sizeTo(0.7)) : { k: 'check' };
      if (need <= S.bb / 2 && s > 0.28) return { k: 'call' };       // 스몰 블라인드 채우기
      if (need <= S.bb && s > 0.36) return { k: 'call' };
      if (s > 0.5 + big * 0.5 || (s > 0.42 && big < 0.08)) return { k: 'call' };
      return { k: 'fold' };
    }
    // 플롭 이후: 무작위 상대 기준 승률은 실제보다 높게 나오므로 깎아서 쓴다
    const raw = equity(S, id, rng, 120);
    const eq = Math.pow(raw, 1 + 0.12 * opp) + noise;
    if (R && eq > 0.62 && rng() < 0.75) return raiseTo(sizeTo(eq > 0.8 ? 0.9 : 0.6));
    if (need === 0) {
      if (R && eq > 0.45 && rng() < 0.45) return raiseTo(sizeTo(0.5));
      if (R && rng() < 0.06) return raiseTo(sizeTo(0.4)); // 가끔 블러프
      return { k: 'check' };
    }
    if (eq > potOdds + 0.08) return { k: 'call' };
    return { k: 'fold' };
  }

  // 섯다 엔진과 같은 이름의 빈 함수 (홀덤엔 재경기가 없음)
  const redeal = () => false, rejoinAnswer = () => false, rejoinPending = () => [];

  const api = {
    MAX_PLAYERS, RANK_KO, SUITS, rankOf, suitOf, cardName, cardCode, eval5, best, handName, catOf, CAT, shuffle, settle, rakeFor, ttaengMult,
    createGame, addPlayer, removePlayer, canStart, startHand, legal, act, autoAct, redeal, rejoinAnswer, rejoinPending,
    publicState, botDecide, ACT_NAMES, preflopStrength, equity,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Holdem = api;
})(typeof window !== 'undefined' ? window : globalThis);

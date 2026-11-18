// 7포커 규칙 엔진 (한국식: 초이스 → 4·5·6구 오픈 → 7구 히든). 서버와 브라우저가 같이 씀
// 섯다·홀덤 엔진과 같은 이름의 함수를 내보내서 서버가 방 종류에 따라 바꿔 끼운다.
(function (root) {
  'use strict';
  const MAX_PLAYERS = 6, MAX_RAISES = 4, CHOICE_MS = 15000, TURN_MS = 30000;
  const RANK_KO = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  // 카드 번호 0~51 (홀덤과 같음): 숫자 = c >> 2 (0 = 2, 12 = A), 무늬 = c & 3 (♠ ♥ ♦ ♣)
  const rankOf = c => c >> 2, suitOf = c => c & 3;
  const cardName = c => RANK_KO[rankOf(c)] + SUITS[suitOf(c)];
  // 무늬 서열 (한국식): ♠ > ◆ > ♥ > ♣
  const SUIT_POW = [3, 1, 2, 0];

  // ───────────── 족보 (한국식) ─────────────
  // 0 탑 · 1 원페어 · 2 투페어 · 3 트리플 · 4 스트레이트 · 5 백스트레이트 · 6 마운틴 · 7 플러시 · 8 풀하우스 · 9 포카드
  // 10 스트레이트 플러시 · 11 백스트레이트 플러시 · 12 로열 스트레이트 플러시
  // 점수 = 족보 → 비교 숫자들(13진) → 대표 카드 무늬. 같은 족보·같은 숫자면 무늬로 가른다
  const pack = (cat, ks, suit) => { let v = cat; for (let i = 0; i < 5; i++) v = v * 13 + (ks[i] || 0); return v * 4 + (suit || 0); };
  const bestSuit = cs => Math.max(...cs.map(c => SUIT_POW[suitOf(c)]));
  function evalCards(cs) { // 1~5장 (5장 미만이면 페어류만)
    const rs = cs.map(rankOf);
    const cnt = {}; rs.forEach(r => { cnt[r] = (cnt[r] || 0) + 1; });
    const groups = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a);
    const shape = groups.map(g => cnt[g]).join('');
    const topCards = cs.filter(c => rankOf(c) === groups[0]);
    if (cs.length === 5) {
      const flush = cs.every(c => suitOf(c) === suitOf(cs[0]));
      const sr = rs.slice().sort((a, b) => b - a);
      let st = -1; // 0 일반, 1 백스트레이트(A-5), 2 마운틴(A-K)
      let hi = -1;
      if (groups.length === 5) {
        if (sr[0] - sr[4] === 4) { hi = sr[0]; st = sr[0] === 12 ? 2 : 0; }
        else if (sr[0] === 12 && sr[1] === 3) { hi = 3; st = 1; }
      }
      const hiCard = cs.reduce((a, c) => (rankOf(c) > rankOf(a) || (rankOf(c) === rankOf(a) && SUIT_POW[suitOf(c)] > SUIT_POW[suitOf(a)])) ? c : a);
      const sp = SUIT_POW[suitOf(hiCard)];
      if (st >= 0 && flush) return pack(st === 2 ? 12 : st === 1 ? 11 : 10, [hi], sp);
      if (shape === '41') return pack(9, groups, bestSuit(topCards));
      if (shape === '32') return pack(8, groups, bestSuit(topCards));
      if (flush) return pack(7, sr, sp);
      if (st === 2) return pack(6, [12], sp);
      if (st === 1) return pack(5, [3], sp);
      if (st === 0) return pack(4, [hi], sp);
    }
    if (shape.startsWith('4')) return pack(9, groups, bestSuit(topCards));
    if (shape.startsWith('3')) return pack(3, groups, bestSuit(topCards));
    if (shape.startsWith('22')) return pack(2, groups, bestSuit(topCards));
    if (shape.startsWith('2')) return pack(1, groups, bestSuit(topCards));
    return pack(0, groups, bestSuit(topCards));
  }
  const COMBOS = {};
  function combos(n) {
    if (COMBOS[n]) return COMBOS[n];
    const out = [], f = (st, a) => { if (a.length === 5) { out.push(a); return; } for (let i = st; i < n; i++) f(i + 1, a.concat(i)); };
    f(0, []);
    return (COMBOS[n] = out);
  }
  // 가진 카드 중 가장 좋은 5장 (5장 미만이면 그 카드들로)
  function best(cards) {
    if (!cards.length) return { score: -1, five: [] };
    if (cards.length <= 5) return { score: evalCards(cards), five: cards.slice() };
    let top = -1, five = null;
    for (const cmb of combos(cards.length)) { const f = cmb.map(i => cards[i]), sc = evalCards(f); if (sc > top) { top = sc; five = f; } }
    return { score: top, five };
  }
  const catOf = score => Math.floor(score / 4 / 371293); // 13^5
  function handName(score) {
    if (score < 0) return '';
    let v = Math.floor(score / 4); const ks = [];
    for (let i = 0; i < 5; i++) { ks.unshift(v % 13); v = Math.floor(v / 13); }
    const R = i => RANK_KO[ks[i]];
    switch (v) {
      case 12: return '로열 스트레이트 플러시';
      case 11: return '백스트레이트 플러시';
      case 10: return `스트레이트 플러시 (${R(0)})`;
      case 9: return `포카드 (${R(0)})`;
      case 8: return `풀하우스 (${R(0)})`;
      case 7: return `플러시 (${R(0)} 탑)`;
      case 6: return '마운틴';
      case 5: return '백스트레이트';
      case 4: return `스트레이트 (${R(0)} 탑)`;
      case 3: return `트리플 (${R(0)})`;
      case 2: return `투페어 (${R(0)}·${R(1)})`;
      case 1: return `원페어 (${R(0)})`;
      default: return `${R(0)} 탑`;
    }
  }
  // 땡값 배수 (한게임 7포커 기준): 로티플 3배, 백티플·스티플 2배, 포카드 1배
  function ttaengMult(score) {
    const cat = catOf(score);
    if (cat === 12) return 3;
    if (cat === 11 || cat === 10) return 2;
    if (cat === 9) return 1;
    return 0;
  }

  function shuffle(rng) {
    const d = Array.from({ length: 52 }, (_, i) => i);
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }

  // ───────────── 정산 (사이드팟, 수수료) ─────────────
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
    for (const { amount, elig } of layers) {
      if (!elig.length) { leftover += amount; continue; }
      const top = Math.max(...elig.map(id => score[id]));
      const winners = elig.filter(id => score[id] === top);
      if (!mainWinners) mainWinners = winners;
      const share = Math.floor(amount / winners.length);
      let rem = amount - share * winners.length;
      winners.forEach(w => { pay[w] = (pay[w] || 0) + share + (rem-- > 0 ? 1 : 0); });
    }
    if (leftover && mainWinners) {
      const share = Math.floor(leftover / mainWinners.length);
      let rem = leftover - share * mainWinners.length;
      mainWinners.forEach(w => { pay[w] = (pay[w] || 0) + share + (rem-- > 0 ? 1 : 0); });
    }
    return { pay, mainWinners: mainWinners || [], rake: taken };
  }
  function uncalled(contrib) {
    const v = Object.values(contrib || {}).sort((a, b) => b - a);
    return v.length > 1 && v[0] > v[1] ? v[0] - v[1] : 0;
  }
  // 수수료: 섯다와 같은 설정 {rate(%), cap, min, folds}
  function rakeFor(h, isFold) {
    const r = h.rk;
    if (!r || !(r.rate > 0)) return 0;
    if (isFold && !r.folds) return 0;
    const pot = h.pot - uncalled(h.contrib);
    if (pot <= 0 || pot < (r.min || 0)) return 0;
    let a = Math.floor(pot * r.rate / 100);
    if (r.cap > 0) a = Math.min(a, r.cap);
    return Math.max(0, Math.min(a, pot));
  }

  // ───────────── 상태 머신 ─────────────
  function createGame(opts) {
    return {
      kind: 'poker7', v: 0, ante: (opts && opts.ante) || 100, startChips: (opts && opts.startChips) || 10000,
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

  function startHand(S, rng, now) {
    if (!canStart(S)) return false;
    const part = S.players.filter(p => p.chips > 0 && !p.away).map(p => p.id);
    // 자리 순서: 지난 판 첫 자리 다음 사람부터 (동점 처리·행동 순서용)
    let bi = 0;
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
      no: S.handNo, deal: 1, seats, cards: {}, up: {}, deck: shuffle(rng), stage: 'choice', choice: {},
      folded: {}, allin: {}, bet: {}, contrib: {}, pot: 0, cur: 0, raises: 0, toAct: null, acted: {},
      deadline: (now || 0) + CHOICE_MS, result: null, lastAct: {}, sun: null, round: 4,
      rk: S.rake ? Object.assign({}, S.rake) : null, tg: S.ttaeng || 0,
    };
    seats.forEach(id => { h.contrib[id] = 0; h.bet[id] = 0; });
    h.start = Object.fromEntries(seats.map(id => [id, P(S, id).chips])); // 땡값 상한용
    S.phase = 'bet';
    log(S, `── ${h.no}판 시작 (판돈 ${won(S.ante)}) ──`);
    for (const id of seats) pay(S, id, S.ante, true);
    for (let r = 0; r < 4; r++) for (const id of seats) { (h.cards[id] = h.cards[id] || []).push(h.deck.pop()); (h.up[id] = h.up[id] || []).push(false); }
    log(S, '카드 4장: 1장 버리고 1장 공개할 카드를 골라요');
    bump(S);
    return true;
  }

  // ── 초이스: 4장 중 버릴 카드(d)와 보여줄 카드(o)
  const choicePending = S => { const h = S.hand; return h && S.phase === 'bet' && h.stage === 'choice' ? live(S).filter(id => !h.choice[id]) : []; };
  function choose(S, id, d, o, now) {
    const h = S.hand;
    if (!h || S.phase !== 'bet' || h.stage !== 'choice' || h.folded[id] || !h.seats.includes(id) || h.choice[id]) return false;
    d = Math.floor(Number(d)); o = Math.floor(Number(o));
    if (!(d >= 0 && d < 4 && o >= 0 && o < 4 && d !== o)) return false;
    h.choice[id] = { d, o };
    bump(S);
    if (!choicePending(S).length) finishChoice(S, now);
    return true;
  }
  // 자동 선택 (시간 초과·자리 비움·봇): 짝이 되는 카드는 지키고, 가장 낮은 카드를 버리고 그다음 낮은 카드를 보여준다
  function autoPick(cards) {
    const cnt = {}; cards.forEach(c => { cnt[rankOf(c)] = (cnt[rankOf(c)] || 0) + 1; });
    const suitCnt = {}; cards.forEach(c => { suitCnt[suitOf(c)] = (suitCnt[suitOf(c)] || 0) + 1; });
    const value = c => (cnt[rankOf(c)] > 1 ? 100 : 0) + (suitCnt[suitOf(c)] >= 3 ? 30 : 0) + rankOf(c);
    const order = [0, 1, 2, 3].sort((a, b) => value(cards[a]) - value(cards[b]) || a - b);
    const d = order[0];
    // 보여줄 카드: 짝이 아닌 것 중 낮은 것 (짝은 숨긴다)
    const o = order.slice(1).find(i => cnt[rankOf(cards[i])] === 1) ?? order[1];
    return { d, o };
  }
  function autoChoose(S, now, onlyId) {
    const ids = onlyId ? [onlyId] : choicePending(S);
    let any = false;
    for (const id of ids) { if (S.hand.choice[id] || S.hand.folded[id]) continue; const c = autoPick(S.hand.cards[id]); S.hand.choice[id] = c; any = true; }
    if (any) bump(S);
    if (S.hand.stage === 'choice' && !choicePending(S).length) finishChoice(S, now);
    return any;
  }
  function finishChoice(S, now) {
    const h = S.hand;
    for (const id of h.seats) {
      if (h.folded[id]) continue;
      const cs = h.cards[id], { d, o } = h.choice[id] || autoPick(cs);
      const keep = [0, 1, 2, 3].filter(i => i !== d && i !== o).map(i => cs[i]);
      h.cards[id] = keep.concat(cs[o]); h.up[id] = [false, false, true];
    }
    h.stage = 'bet'; h.deal++;
    log(S, '초이스 끝');
    dealCard(S, true); // 4구 (공개)
    beginRound(S, now);
  }
  function dealCard(S, open) {
    const h = S.hand;
    for (const id of h.seats) if (!h.folded[id]) { h.cards[id].push(h.deck.pop()); h.up[id].push(!!open); }
    h.round = h.cards[live(S)[0]].length;
  }
  const visible = (h, id) => h.cards[id].filter((c, i) => h.up[id][i]);
  // 선: 공개된 카드가 가장 좋은 사람 (같으면 무늬)
  function sunOf(S) {
    const h = S.hand, as = actors(S);
    let top = null, ts = -1;
    for (const id of as) { const s = best(visible(h, id)).score; if (s > ts) { ts = s; top = id; } }
    return top;
  }
  function beginRound(S, now) {
    const h = S.hand;
    h.cur = 0; h.raises = 0; h.acted = {}; h.lastAct = {};
    h.seats.forEach(id => { h.bet[id] = 0; });
    h.toAct = null; h.sun = sunOf(S);
    if (h.sun) log(S, `${h.round}구${h.round === 7 ? ' (히든)' : ''} · 선 ${P(S, h.sun).name}`);
    const n = h.seats.length, si = h.sun ? h.seats.indexOf(h.sun) : 0;
    advance(S, now, h.seats[(si - 1 + n) % n]);
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
    if (roundDone(S)) {
      if (h.round >= 7) return showdown(S);
      if (actors(S).length <= 1) { // 더 베팅할 사람이 없으면 남은 카드를 다 주고 승부
        while (h.round < 7) dealCard(S, h.round < 6);
        h.runout = true;
        return showdown(S);
      }
      dealCard(S, h.round < 6); // 5·6구 공개, 7구 히든
      return beginRound(S, now);
    }
    const n = h.seats.length, startIdx = h.seats.indexOf(fromId);
    for (let k = 1; k <= n; k++) {
      const id = h.seats[(startIdx + k) % n];
      if (h.folded[id] || h.allin[id]) continue;
      if (!h.acted[id] || h.bet[id] < h.cur) { h.toAct = id; h.deadline = (now || 0) + TURN_MS; return; }
    }
    if (h.round < 7) { while (h.round < 7) dealCard(S, h.round < 6); h.runout = true; }
    return showdown(S);
  }

  // 베팅 (섯다와 같은 한국식): 다이 · 체크/콜 · 삥(판돈만큼) · 하프(콜 + 판돈의 절반) · 따당(앞 베팅의 두 배)
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
    if (h.stage === 'choice') return autoChoose(S, now);
    if (!h.toAct) return false;
    const L = legal(S, h.toAct);
    return act(S, h.toAct, 'check' in L ? 'check' : 'die', now);
  }
  // 초이스 중에 나가면 그 판은 다이
  function leaveHand(S, id, now) {
    const h = S.hand;
    if (!h || S.phase !== 'bet' || !h.seats.includes(id) || h.folded[id]) return false;
    if (h.stage === 'choice') {
      h.folded[id] = true; log(S, `${P(S, id).name}: 다이`); bump(S);
      if (live(S).length === 1) { finishFold(S); return true; }
      if (!choicePending(S).length) finishChoice(S, now);
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
    const pw = P(S, w), rake = rakeFor(h, true), win = h.pot - rake;
    pw.chips += win; S.rakeTotal = (S.rakeTotal || 0) + rake;
    h.result = { type: 'fold', winners: [w], pay: { [w]: win }, rake, reveal: false };
    log(S, `${pw.name} 승리 (+${won(win)}, 모두 다이)`);
    h.toAct = null; h.stage = 'bet'; S.phase = 'show';
  }
  function showdown(S) {
    const h = S.hand;
    h.toAct = null;
    const ids = h.seats.filter(id => !h.folded[id]);
    const score = {}, ev = {}, five = {};
    for (const id of ids) { const b = best(h.cards[id]); score[id] = b.score; ev[id] = handName(b.score); five[id] = b.five; }
    const { pay: payMap, mainWinners, rake } = settle(h.contrib, ids, score, rakeFor(h, false));
    Object.entries(payMap).forEach(([id, a]) => { P(S, id).chips += a; });
    S.rakeTotal = (S.rakeTotal || 0) + rake;
    h.result = { type: 'show', winners: mainWinners, pay: payMap, ev, five, rake, reveal: true };
    log(S, `${mainWinners.map(id => `${P(S, id).name}(${ev[id]})`).join(', ')} 승리`);
    Object.entries(payMap).forEach(([id, a]) => { if (!mainWinners.includes(id)) log(S, `${P(S, id).name} 사이드팟 +${won(a)}`); });
    if (h.tg > 0 && mainWinners.length === 1) {
      const w = mainWinners[0];
      const tg = collectTtaeng(S, h, w, ids, ttaengMult(score[w]), payMap);
      if (tg) { h.result.tg = tg; log(S, `땡값! ${P(S, w).name} +${won(tg.total)} (건 금액의 ${tg.mult}배, 각자 ${won(tg.each)})`); }
    }
    S.phase = 'show';
  }

  // 공개 상태: 남의 카드는 공개된 것만 (숨긴 카드는 null). 결과 공개 때는 끝까지 남은 사람 패 전부
  function publicState(S, now) {
    const h = S.hand;
    const out = {
      kind: 'poker7', v: S.v, ph: S.phase, ante: S.ante, tg: S.ttaeng || 0, sc: S.startChips,
      pl: S.players.map(p => [p.id, p.name, p.chips, (p.bot ? 1 : 0) | (p.away ? 2 : 0)]),
      log: S.log.slice(-8), ev: S.ev || null,
    };
    if (h) {
      const vis = {};
      for (const id of h.seats) vis[id] = (h.cards[id] || []).map((c, i) => (h.up[id][i] ? c : null));
      out.h = {
        no: h.no, dl: h.deal, rd: h.round, stage: h.stage, seats: h.seats, vis, sun: h.sun,
        chosen: Object.keys(h.choice || {}),
        fo: Object.keys(h.folded), ai: Object.keys(h.allin).filter(k => h.allin[k]),
        bet: h.bet, pot: h.pot, cur: h.cur, ta: h.toAct, raises: h.raises, la: h.lastAct, runout: !!h.runout,
        left: (h.toAct || h.stage === 'choice') && S.phase === 'bet' ? Math.max(0, h.deadline - (now || 0)) : 0,
        total: h.stage === 'choice' ? CHOICE_MS : TURN_MS,
      };
      if (h.result) {
        const r = Object.assign({}, h.result);
        if (r.reveal) r.cards = Object.fromEntries(live(S).map(id => [id, h.cards[id]]));
        out.h.res = r;
      }
    }
    return out;
  }
  // 내 카드 (공개 여부 포함)
  const myView = (S, id) => { const h = S.hand; return h && h.cards[id] && h.seats.includes(id) ? { no: h.no, dl: h.deal, cards: h.cards[id], up: h.up[id] } : null; };

  // ───────────── 봇 ─────────────
  // 남의 공개 카드를 빼고 나머지를 무작위로 채워 승률을 돌려 본다
  function equity(S, id, rng, iters) {
    const h = S.hand, opps = live(S).filter(x => x !== id);
    const known = new Set(h.cards[id]);
    opps.forEach(o => visible(h, o).forEach(c => known.add(c)));
    const rest = []; for (let c = 0; c < 52; c++) if (!known.has(c)) rest.push(c);
    let win = 0;
    for (let t = 0; t < iters; t++) {
      const d = rest.slice();
      const draw = () => { const j = Math.floor(rng() * d.length); const c = d[j]; d[j] = d[d.length - 1]; d.pop(); return c; };
      const mine = h.cards[id].slice(); while (mine.length < 7) mine.push(draw());
      const ms = best(mine).score;
      let lose = false;
      for (const o of opps) { const oc = h.cards[o].map((c, i) => (h.up[o][i] ? c : draw())); while (oc.length < 7) oc.push(draw()); if (best(oc).score > ms) { lose = true; break; } }
      if (!lose) win++;
    }
    return win / iters;
  }
  function botDecide(S, id, rng) {
    const h = S.hand, L = legal(S, id);
    const need = 'call' in L ? L.call : 0;
    const eq = equity(S, id, rng, 70) + (rng() - 0.5) * 0.08;
    const ratio = need / Math.max(1, h.pot + need);
    if (eq > 0.7 && ('half' in L || 'ddadang' in L) && rng() < 0.7) return 'ddadang' in L && rng() < 0.4 ? 'ddadang' : 'half';
    if (eq > 0.5 && 'bbing' in L && rng() < 0.5) return 'bbing';
    if (need === 0) return 'check';
    if (eq > ratio + 0.08) return 'call';
    if (h.round <= 4 && ratio < 0.25 && eq > 0.2) return 'call';
    return 'die';
  }
  const botChoose = (S, id) => { const h = S.hand; if (!h || h.stage !== 'choice' || h.choice[id]) return false; const c = autoPick(h.cards[id]); return choose(S, id, c.d, c.o, 0); };

  const redeal = () => false, rejoinAnswer = () => false, rejoinPending = () => [];

  const api = {
    MAX_PLAYERS, CHOICE_MS, RANK_KO, SUITS, SUIT_POW, rankOf, suitOf, cardName, evalCards, best, handName, catOf, ttaengMult, shuffle, settle, rakeFor,
    createGame, addPlayer, removePlayer, canStart, startHand, legal, act, autoAct, redeal, rejoinAnswer, rejoinPending,
    choose, choicePending, autoChoose, autoPick, botChoose, leaveHand, myView,
    publicState, botDecide, ACT_NAMES, equity,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Poker7 = api;
})(typeof window !== 'undefined' ? window : globalThis);

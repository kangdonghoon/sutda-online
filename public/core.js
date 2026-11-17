// 섯다 규칙 엔진 — 순수 로직 (브라우저/Node 공용)
(function (root) {
  'use strict';

  const MONTH_NAMES = ['', '송학', '매조', '벚꽃', '흑싸리', '난초', '모란', '홍싸리', '공산', '국화', '단풍'];
  const MAX_PLAYERS = 6;
  const MAX_RAISES = 4;       // 한 라운드 최대 레이즈 횟수
  const MAX_REDEALS = 3;

  // 카드: 0..19, 월 = (c>>1)+1, 짝수 = 특수패(1·3·8월은 광, 나머지는 열끗), 홀수 = 피
  function card(c) {
    const m = (c >> 1) + 1;
    const sp = c % 2 === 0;
    const kind = sp ? ((m === 1 || m === 3 || m === 8) ? 'gwang' : 'yeol') : 'pi';
    return { c, m, sp, kind };
  }

  // 족보 판정. rank가 클수록 강함.
  // special: amhaeng(암행어사) / ddangjabi(땡잡이) / gusa(구사) / mgusa(멍텅구리구사)
  function evalHand(cs) {
    if (!cs || cs.length < 2) {
      if (cs && cs.length === 1) { const a = card(cs[0]); return { rank: -1, name: a.m + '월', special: null }; }
      return { rank: -1, name: '', special: null };
    }
    const a = card(cs[0]), b = card(cs[1]);
    const lo = Math.min(a.m, b.m), hi = Math.max(a.m, b.m);
    const g = a.kind === 'gwang' && b.kind === 'gwang';
    const has = (m, kind) => (a.m === m && a.kind === kind) || (b.m === m && b.kind === kind);

    if (g && lo === 3 && hi === 8) return { rank: 1000, name: '38광땡', special: null };
    if (g && lo === 1 && hi === 8) return { rank: 900, name: '18광땡', special: null };
    if (g && lo === 1 && hi === 3) return { rank: 900, name: '13광땡', special: null };
    if (lo === hi) return { rank: 800 + lo, name: lo === 10 ? '장땡' : lo + '땡', special: null };
    if (lo === 4 && hi === 7 && has(4, 'yeol') && has(7, 'yeol')) return { rank: 1, name: '암행어사', special: 'amhaeng' };
    if (lo === 3 && hi === 7 && has(3, 'gwang') && has(7, 'yeol')) return { rank: 0, name: '땡잡이', special: 'ddangjabi' };
    if (lo === 4 && hi === 9) {
      if (has(4, 'yeol') && has(9, 'yeol')) return { rank: 3, name: '멍텅구리구사', special: 'mgusa' };
      return { rank: 3, name: '구사', special: 'gusa' };
    }
    if (lo === 1 && hi === 2) return { rank: 700, name: '알리', special: null };
    if (lo === 1 && hi === 4) return { rank: 690, name: '독사', special: null };
    if (lo === 1 && hi === 9) return { rank: 680, name: '구삥', special: null };
    if (lo === 1 && hi === 10) return { rank: 670, name: '장삥', special: null };
    if (lo === 4 && hi === 10) return { rank: 660, name: '장사', special: null };
    if (lo === 4 && hi === 6) return { rank: 650, name: '세륙', special: null };
    const k = (a.m + b.m) % 10;
    return { rank: k, name: k === 0 ? '망통' : k === 9 ? '갑오' : k + '끗', special: null };
  }

  // 특수패(암행어사/땡잡이)를 반영해 승자 결정. 구사 재경기는 여기서 다루지 않음.
  function pickWinners(ids, cards) {
    const ev = {}; ids.forEach(id => { ev[id] = evalHand(cards[id]); });
    const top = Math.max(...ids.map(id => ev[id].rank));
    const holders = sp => ids.filter(id => ev[id].special === sp);
    let winners, catchBy = null;
    if (top === 900 && holders('amhaeng').length) { winners = holders('amhaeng'); catchBy = '암행어사'; }
    else if (top >= 801 && top <= 809 && holders('ddangjabi').length) { winners = holders('ddangjabi'); catchBy = '땡잡이'; }
    else winners = ids.filter(id => ev[id].rank === top);
    return { winners, ev, catchBy };
  }

  // 구사/멍구사 재경기 조건
  function checkRedeal(ids, cards) {
    if (ids.length < 2) return null;
    const ev = {}; ids.forEach(id => { ev[id] = evalHand(cards[id]); });
    // 암행어사·땡잡이가 이기는 상황이면 재경기 없음
    const pw = pickWinners(ids, cards);
    if (pw.catchBy) return null;
    for (const id of ids) {
      const sp = ev[id].special;
      if (sp !== 'gusa' && sp !== 'mgusa') continue;
      const othersTop = Math.max(...ids.filter(x => x !== id).map(x => ev[x].rank));
      if (sp === 'gusa' && othersTop < 800) return { by: id, name: '구사' };
      if (sp === 'mgusa' && othersTop < 900) return { by: id, name: '멍텅구리구사' };
    }
    return null;
  }

  // 사이드팟 정산. contrib: {id: 총 기여}, live: 다이하지 않은 id(좌석순), cards, rake: 뗄 수수료 총액
  function settle(contrib, live, cards, rake) {
    const pay = {};
    const levels = [...new Set(Object.values(contrib).filter(v => v > 0))].sort((a, b) => a - b);
    const layers = [];
    let prev = 0;
    for (const lv of levels) {
      const contributors = Object.keys(contrib).filter(id => contrib[id] >= lv);
      layers.push({ amount: (lv - prev) * contributors.length, elig: live.filter(id => contrib[id] >= lv), refund: contributors.length === 1 });
      prev = lv;
    }
    // 수수료는 실제로 겨룬 팟에서만, 팟 크기에 비례해서 뗀다 (아무도 안 받은 초과 베팅은 그대로 돌려줌)
    const contested = layers.filter(l => !l.refund);
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
      const { winners } = elig.length === 1 ? { winners: elig } : pickWinners(elig, cards);
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

  // 수수료 계산. h.rk = 판 시작 때 고정한 설정 {rate(%), cap, min, folds}
  // 받아준 사람이 없는 초과 베팅 (가장 많이 건 한 사람의 차액)
  function uncalled(contrib) {
    const v = Object.values(contrib || {}).sort((a, b) => b - a);
    return v.length > 1 && v[0] > v[1] ? v[0] - v[1] : 0;
  }
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

  function shuffle(rng) {
    const d = Array.from({ length: 20 }, (_, i) => i);
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }

  // ───────────── 게임 상태 머신 (방장 브라우저에서만 실행) ─────────────
  function createGame(opts) {
    return {
      v: 0, ante: (opts && opts.ante) || 100, startChips: (opts && opts.startChips) || 10000,
      players: [], phase: 'lobby', hand: null, sun: null, log: [], handNo: 0,
      rake: (opts && opts.rake) || null, rakeTotal: 0,
    };
  }
  function P(S, id) { return S.players.find(p => p.id === id); }
  function log(S, msg) { S.log.push(msg); if (S.log.length > 30) S.log.shift(); }
  function bump(S) { S.v++; }

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
    if (h && S.phase === 'bet' && h.seats.includes(id) && !h.folded[id]) return false; // 진행 중엔 불가
    log(S, `${S.players[i].name} 퇴장`);
    S.players.splice(i, 1); bump(S); return true;
  }

  function canStart(S) {
    return S.phase !== 'bet' && S.players.filter(p => p.chips > 0 && !p.away).length >= 2;
  }

  function startHand(S, rng, now) {
    if (!canStart(S)) return false;
    const part = S.players.filter(p => p.chips > 0 && !p.away).map(p => p.id);
    // 선(직전 승자)부터 좌석 순서
    let start = part.indexOf(S.sun);
    if (start < 0) {
      // 선이 빠졌으면 좌석 순서상 다음 사람
      const allIdx = S.players.findIndex(p => p.id === S.sun);
      start = 0;
      if (allIdx >= 0) for (let k = 1; k <= S.players.length; k++) {
        const cand = S.players[(allIdx + k) % S.players.length].id;
        const j = part.indexOf(cand); if (j >= 0) { start = j; break; }
      }
    }
    const seats = part.slice(start).concat(part.slice(0, start));
    S.handNo++;
    const h = S.hand = {
      no: S.handNo, seats, cards: {}, deck: shuffle(rng), round: 1, redeals: 0,
      folded: {}, allin: {}, bet: {}, contrib: {}, pot: 0, cur: 0, toAct: null, acted: {}, raises: 0,
      deadline: 0, result: null, deal: 1, lastAct: {}, rk: S.rake ? Object.assign({}, S.rake) : null,
    };
    seats.forEach(id => { h.contrib[id] = 0; h.bet[id] = 0; });
    S.phase = 'bet';
    log(S, `── ${h.no}판 시작 (판돈 ${S.ante}) ──`);
    for (const id of seats) pay(S, id, S.ante, true);
    seats.forEach(id => { h.bet[id] = 0; });
    dealOne(S);
    beginRound(S, now);
    bump(S);
    return true;
  }

  function dealOne(S) {
    const h = S.hand;
    for (const id of h.seats) if (!h.folded[id]) { (h.cards[id] = h.cards[id] || []).push(h.deck.pop()); }
  }

  function pay(S, id, amt, isAnte) {
    const h = S.hand, p = P(S, id);
    const a = Math.max(0, Math.min(amt, p.chips));
    p.chips -= a; h.contrib[id] += a; h.pot += a;
    if (!isAnte) h.bet[id] += a;
    if (p.chips === 0) h.allin[id] = true;
    return a;
  }

  const live = S => S.hand.seats.filter(id => !S.hand.folded[id]);
  const actors = S => live(S).filter(id => !S.hand.allin[id]);

  function beginRound(S, now) {
    const h = S.hand;
    h.cur = 0; h.raises = 0; h.acted = {}; h.lastAct = {};
    h.seats.forEach(id => { h.bet[id] = 0; });
    h.toAct = null;
    advance(S, now, null);
  }

  function roundDone(S) {
    const h = S.hand, as = actors(S);
    if (as.length === 0) return true;
    if (as.length === 1) {
      const id = as[0];
      // 혼자 남은 행동자: 맞춰야 할 금액이 없으면 끝
      const maxBet = Math.max(0, ...live(S).map(x => h.bet[x]));
      return h.bet[id] >= maxBet && (h.acted[id] || maxBet === 0);
    }
    return as.every(id => h.acted[id] && h.bet[id] === h.cur);
  }

  function advance(S, now, fromId) {
    const h = S.hand;
    if (live(S).length === 1) return finishFold(S);
    if (roundDone(S)) {
      if (h.round === 1) {
        h.round = 2; dealOne(S); h.deal++;
        return beginRound(S, now);
      }
      return showdown(S);
    }
    // 다음 차례
    const n = h.seats.length;
    let startIdx = fromId == null ? -1 : h.seats.indexOf(fromId);
    for (let k = 1; k <= n; k++) {
      const id = h.seats[(startIdx + k + n) % n];
      if (h.folded[id] || h.allin[id]) continue;
      if (!h.acted[id] || h.bet[id] < h.cur) { h.toAct = id; h.deadline = (now || 0) + 30000; return; }
    }
    // 이론상 도달하지 않음
    return showdown(S);
  }

  function legal(S, id) {
    const h = S.hand; if (!h || S.phase !== 'bet' || h.toAct !== id) return {};
    const p = P(S, id), need = h.cur - h.bet[id];
    const out = { die: 0 };
    if (need <= 0) out.check = 0; else out.call = Math.min(need, p.chips);
    const canRaise = h.raises < MAX_RAISES && p.chips > need && actors(S).length > 1;
    if (canRaise) {
      if (h.cur === 0) out.bbing = Math.min(S.ante, p.chips);
      const half = need + Math.max(S.ante, Math.floor((h.pot + need) / 2));
      out.half = Math.min(half, p.chips);
      if (h.cur > 0) out.ddadang = Math.min(2 * h.cur - h.bet[id], p.chips);
    }
    return out;
  }

  const ACT_NAMES = { die: '다이', check: '체크', call: '콜', bbing: '삥', half: '하프', ddadang: '따당' };

  function act(S, id, kind, now) {
    const L = legal(S, id);
    if (!(kind in L)) return false;
    const h = S.hand, p = P(S, id);
    if (kind === 'die') { h.folded[id] = true; log(S, `${p.name}: 다이`); }
    else {
      const before = h.bet[id];
      const paid = pay(S, id, L[kind]);
      const allin = h.allin[id] ? ' (올인)' : '';
      if (h.bet[id] > h.cur) { h.cur = h.bet[id]; h.acted = {}; h.raises++; }
      h.acted[id] = true;
      log(S, `${p.name}: ${ACT_NAMES[kind]}${paid ? ' ' + paid.toLocaleString() : ''}${allin}`);
      void before;
    }
    h.lastAct[id] = kind;
    advance(S, now, id);
    bump(S);
    return true;
  }

  function autoAct(S, now) {
    const h = S.hand; if (!h || S.phase !== 'bet' || !h.toAct) return false;
    const L = legal(S, h.toAct);
    return act(S, h.toAct, 'check' in L ? 'check' : 'die', now);
  }

  function finishFold(S) {
    const h = S.hand, w = live(S)[0];
    const pw = P(S, w), rake = rakeFor(h, true), win = h.pot - rake;
    pw.chips += win; S.rakeTotal = (S.rakeTotal || 0) + rake;
    h.result = { type: 'fold', winners: [w], pay: { [w]: win }, rake, reveal: false };
    log(S, `${pw.name} 승리 (+${win.toLocaleString()}, 모두 다이)${rake ? ` · 수수료 ${rake.toLocaleString()}` : ''}`);
    h.toAct = null; S.sun = w; S.phase = 'show';
  }

  function showdown(S) {
    const h = S.hand, ids = live(S);
    h.toAct = null;
    const rd = h.redeals < MAX_REDEALS ? checkRedeal(ids, h.cards) : null;
    const ev = {}; ids.forEach(id => { ev[id] = evalHand(h.cards[id]).name; });
    if (rd) {
      h.result = { type: 'redeal', by: rd.by, name: rd.name, ev, reveal: true };
      log(S, `${P(S, rd.by).name}의 ${rd.name}! 재경기`);
      S.phase = 'show';
      return;
    }
    const { pay: payMap, mainWinners, rake } = settle(h.contrib, ids, h.cards, rakeFor(h, false));
    const pw = pickWinners(ids, h.cards);
    Object.entries(payMap).forEach(([id, a]) => { P(S, id).chips += a; });
    S.rakeTotal = (S.rakeTotal || 0) + rake;
    h.result = { type: 'show', winners: mainWinners, pay: payMap, ev, catchBy: pw.catchBy, rake, reveal: true };
    const wn = mainWinners.map(id => `${P(S, id).name}(${ev[id]})`).join(', ');
    log(S, `${wn} 승리${pw.catchBy ? ' — ' + pw.catchBy + '!' : ''}`);
    Object.entries(payMap).forEach(([id, a]) => { if (!mainWinners.includes(id)) log(S, `${P(S, id).name} 사이드팟 +${a.toLocaleString()}`); });
    if (rake) log(S, `수수료 ${rake.toLocaleString()}`);
    S.sun = mainWinners[0];
    S.phase = 'show';
  }

  function redeal(S, rng, now) {
    const h = S.hand;
    if (S.phase !== 'show' || !h || !h.result || h.result.type !== 'redeal') return false;
    h.redeals++; h.deck = shuffle(rng); h.cards = {}; h.round = 1; h.result = null; h.deal++;
    h.seats.forEach(id => { if (!h.folded[id]) h.allin[id] = P(S, id).chips === 0; });
    S.phase = 'bet';
    dealOne(S); beginRound(S, now); bump(S);
    return true;
  }

  // 공개 상태(패는 결과 공개 시에만)
  function publicState(S, now) {
    const h = S.hand;
    const out = {
      v: S.v, ph: S.phase, ante: S.ante, sun: S.sun, sc: S.startChips,
      pl: S.players.map(p => [p.id, p.name, p.chips, (p.bot ? 1 : 0) | (p.away ? 2 : 0)]),
      log: S.log.slice(-8),
    };
    if (h) {
      out.h = {
        no: h.no, rd: h.round, dl: h.deal, seats: h.seats,
        fo: Object.keys(h.folded), ai: Object.keys(h.allin).filter(k => h.allin[k]),
        bet: h.bet, pot: h.pot, cur: h.cur, ta: h.toAct, raises: h.raises,
        left: h.toAct ? Math.max(0, h.deadline - (now || 0)) : 0, la: h.lastAct,
        nc: h.cards[live(S)[0]] ? h.cards[live(S)[0]].length : 0,
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
  function strength(cs) {
    if (cs.length === 1) {
      const c = card(cs[0]);
      return c.kind === 'gwang' ? 0.62 : c.m >= 9 ? 0.55 : c.m === 4 ? 0.5 : 0.42;
    }
    const e = evalHand(cs);
    if (e.special === 'mgusa') return 0.55;
    if (e.special === 'gusa') return 0.5;
    if (e.special === 'ddangjabi') return 0.42;
    if (e.special === 'amhaeng') return 0.4;
    if (e.rank >= 900) return 1;
    if (e.rank === 810) return 0.97;
    if (e.rank > 800) return 0.84 + 0.012 * (e.rank - 800);
    if (e.rank >= 650) return 0.68 + (e.rank - 650) / 50 * 0.1;
    return 0.1 + 0.06 * e.rank;
  }

  function botDecide(S, id, rng) {
    const h = S.hand, L = legal(S, id);
    const s = strength(h.cards[id]) + (rng() - 0.5) * 0.16;
    const need = 'call' in L ? L.call : 0;
    const ratio = need / Math.max(1, h.pot + need);
    if (s > 0.82 && ('half' in L || 'ddadang' in L) && rng() < 0.75) return 'ddadang' in L && rng() < 0.4 ? 'ddadang' : 'half';
    if (s > 0.6 && 'bbing' in L && rng() < 0.5) return 'bbing';
    if (need === 0) return 'check';
    if (s > 0.55) return 'call';
    if (s > 0.35 && ratio < 0.3) return 'call';
    if (h.round === 1 && ratio < 0.2) return 'call';
    return 'die';
  }

  const api = {
    MONTH_NAMES, MAX_PLAYERS, card, evalHand, pickWinners, checkRedeal, settle, rakeFor, shuffle,
    createGame, addPlayer, removePlayer, canStart, startHand, legal, act, autoAct, redeal,
    publicState, botDecide, ACT_NAMES,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Sutda = api;
})(typeof window !== 'undefined' ? window : globalThis);

// 홀덤 엔진 테스트: node test/holdem.test.js
'use strict';
const assert = require('assert');
const H = require('../public/holdem.js');

// 'As', 'Td', '9c' 같은 표기를 카드 번호로
const C = s => { const r = '23456789TJQKA'.indexOf(s[0]), u = 'shdc'.indexOf(s[1]); assert(r >= 0 && u >= 0, s); return r * 4 + u; };
const cs = str => str.split(' ').map(C);
const sc = str => H.best(cs(str)).score;
const name = str => H.handName(sc(str));

// ── 족보 순서
const ladder = [
  'As Kd 9c 7h 3s 2d 4c',  // 하이카드
  'As Ad 9c 7h 3s 2d 5c',  // 원페어
  'As Ad 9c 9h 3s 2d 5c',  // 투페어
  'As Ad Ac 9h 3s 2d 5c',  // 트리플
  'As 2d 3c 4h 5s 9d Kc',  // 휠 스트레이트
  '6s 7d 8c 9h Ts 2d 2c',  // 스트레이트
  'As Js 9s 7s 3s 2d 4c',  // 플러시
  'As Ad Ac 9h 9s 2d 5c',  // 풀하우스
  'As Ad Ac Ah 9s 2d 5c',  // 포카드
  '5s 6s 7s 8s 9s 2d 2c',  // 스트레이트 플러시
  'Ts Js Qs Ks As 2d 2c',  // 로열
];
for (let i = 1; i < ladder.length; i++) assert(sc(ladder[i]) > sc(ladder[i - 1]), `족보 순서 ${i}: ${name(ladder[i])} > ${name(ladder[i - 1])}`);
assert.strictEqual(name('As 2d 3c 4h 5s 9d Kc'), '스트레이트 (5 하이)');
assert.strictEqual(name('Ts Js Qs Ks As 2d 2c'), '로열 플러시');
assert.strictEqual(name('As Ad 9c 9h 3s 2d 5c'), '투페어 (A·9)');
// 키커
assert(sc('As Ad Kc 7h 3s 2d 4c') > sc('As Ad Qc 7h 3s 2d 4c'), '원페어 키커');
assert.strictEqual(sc('As Ad Kc Qh 3s 2d 4c'), sc('Ah Ac Kd Qs 3c 2h 4d'), '무늬 상관없이 같은 점수');
// 투페어 셋이면 높은 두 쌍 + 키커
assert.strictEqual(name('As Ad Kc Kh 3s 3d 2c'), '투페어 (A·K)');
// 6장 / 5장도 동작
assert(H.best(cs('As Ad Kc Kh 3s 3d')).score > 0);
assert.strictEqual(H.best(cs('As Ad Kc Kh 3s')).five.length, 5);

// ── 정산: 사이드팟, 자투리, 수수료
{
  const r = H.settle({ a: 100, b: 300, c: 300 }, ['a', 'b', 'c'], { a: 9, b: 5, c: 1 }, 0);
  assert.deepStrictEqual(r.pay, { a: 300, b: 400 }, '사이드팟');
  const t = H.settle({ a: 101, b: 101, c: 101 }, ['a', 'b', 'c'], { a: 5, b: 5, c: 1 }, 0);
  assert.strictEqual(t.pay.a + t.pay.b, 303); assert.strictEqual(t.pay.a, 152, '자투리는 앞 사람');
  const u = H.settle({ a: 100, b: 500 }, ['a', 'b'], { a: 9, b: 1 }, 0);
  assert.deepStrictEqual(u.pay, { a: 200, b: 400 }, '받아주지 않은 초과분은 돌려줌');
}

// ── 시뮬레이션: 봇끼리 수천 판, 칩 보존과 멈춤 없음
function seeded(seed) { let x = seed >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function sim(limit, n, hands, seed, rake) {
  const rng = seeded(seed);
  const G = H.createGame({ bb: 100, startChips: 5000, limit, rake, ttaeng: n % 2 === 0 ? 1 : 0 });
  for (let i = 0; i < n; i++) H.addPlayer(G, 'p' + i, '봇' + i, true);
  const total0 = G.players.reduce((a, p) => a + p.chips, 0);
  let played = 0, raked = 0, showdowns = 0, runouts = 0, now = 0;
  for (let k = 0; k < hands; k++) {
    // 칩 떨어진 봇은 다시 채움 (총량 추적)
    let refill = 0;
    for (const p of G.players) if (p.chips === 0) { p.chips = 5000; refill += 5000; }
    if (!H.canStart(G)) break;
    const before = G.players.reduce((a, p) => a + p.chips, 0);
    assert(H.startHand(G, rng, now));
    let steps = 0;
    while (G.phase === 'bet') {
      const id = G.hand.toAct; assert(id, '행동할 사람이 있어야 함');
      const L = H.legal(G, id);
      assert(Object.keys(L).length > 0, '낼 수 있는 행동이 있어야 함');
      let ok;
      if (rng() < 0.15) { // 무작위 행동 (테두리 금액 포함)
        const ks = Object.keys(L), k2 = ks[Math.floor(rng() * ks.length)];
        const R = L[k2]; const a = R && R.min != null ? (rng() < 0.5 ? R.min : R.max) : undefined;
        ok = H.act(G, id, k2, now, a);
      } else { const d = H.botDecide(G, id, rng); ok = H.act(G, id, d.k, now, d.a); }
      assert(ok, '봇 행동은 항상 성공');
      if (++steps > 400) throw new Error('판이 끝나지 않음');
      const h = G.hand;
      // 불변식: 판돈 = 기여 합, 칩 음수 없음
      assert.strictEqual(h.pot, Object.values(h.contrib).reduce((a, b) => a + b, 0));
      G.players.forEach(p => assert(p.chips >= 0));
    }
    assert.strictEqual(G.phase, 'show');
    const h = G.hand;
    const after = G.players.reduce((a, p) => a + p.chips, 0);
    assert.strictEqual(after + h.result.rake, before, `칩 보존 (판 ${h.no})`);
    if (h.result.type === 'show') { showdowns++; assert.strictEqual(h.board.length, 5); }
    if (h.runout) runouts++;
    if (h.street === 0) assert.strictEqual(h.result.rake, 0, '노 플롭 노 드롭');
    raked += h.result.rake; played++;
    void refill; now += 1000;
  }
  const total = G.players.reduce((a, p) => a + p.chips, 0);
  return { played, showdowns, runouts, raked, total0, total };
}
for (const [limit, n, k] of [['nl', 2, 2000], ['nl', 6, 600], ['pl', 3, 1000], ['pl', 6, 400], ['nl', 4, 600]]) {
  const r = sim(limit, n, k, 7 + n, { rate: 5, cap: 2000, min: 500, folds: false });
  console.log(`${limit} ${n}명: ${r.played}판, 쇼다운 ${r.showdowns}, 올인 런아웃 ${r.runouts}, 수수료 ${r.raked.toLocaleString()}`);
  assert(r.played > 100);
}

// ── 팟리밋: 레이즈 최대가 팟 크기를 넘지 않음
{
  const G = H.createGame({ bb: 100, startChips: 100000, limit: 'pl' });
  ['a', 'b', 'c'].forEach(id => H.addPlayer(G, id, id));
  H.startHand(G, Math.random, 0);
  const id = G.hand.toAct, L = H.legal(G, id);
  // 블라인드 50/100, 팟 150, 콜 100 → 최대 100 + 150 + 100 = 350
  assert.strictEqual(L.raise.max, 350, '팟리밋 최대');
  assert.strictEqual(L.raise.min, 200, '최소 레이즈');
  assert(!('allin' in L));
}
// ── 헤즈업: 버튼이 스몰이고 프리플롭 먼저, 플롭부터는 빅 블라인드가 먼저
{
  const G = H.createGame({ bb: 100, startChips: 10000 });
  ['a', 'b'].forEach(id => H.addPlayer(G, id, id));
  H.startHand(G, Math.random, 0);
  const h = G.hand;
  assert.strictEqual(h.sbId, h.seats[0]); assert.strictEqual(h.toAct, h.seats[0]);
  H.act(G, h.toAct, 'call', 0);
  assert.strictEqual(h.toAct, h.bbId, '빅 블라인드 선택권');
  H.act(G, h.toAct, 'check', 0);
  assert.strictEqual(h.street, 1); assert.strictEqual(h.toAct, h.bbId, '플롭은 빅 블라인드 먼저');
}
// ── 덜 올린 올인은 이미 행동한 사람에게 다시 올릴 권리를 주지 않음
{
  const G = H.createGame({ bb: 100, startChips: 10000 });
  ['a', 'b', 'c'].forEach(id => H.addPlayer(G, id, id));
  H.startHand(G, Math.random, 0);
  const h = G.hand; const [btn, sb, bb] = h.seats;
  G.players.find(p => p.id === sb).chips = 250; // 스몰은 300까지밖에 못 올림 (이미 50 냄)
  H.act(G, btn, 'raise', 0, 200);       // 버튼 200 (레이즈 크기 100)
  H.act(G, sb, 'allin', 0);             // 스몰 300 올인 (100 더: 정상 레이즈)
  H.act(G, bb, 'call', 0);
  assert(H.legal(G, btn).raise, '정상 레이즈 뒤에는 다시 올릴 수 있음');
}
{
  const G = H.createGame({ bb: 100, startChips: 10000 });
  ['a', 'b', 'c'].forEach(id => H.addPlayer(G, id, id));
  H.startHand(G, Math.random, 0);
  const h = G.hand; const [btn, sb, bb] = h.seats;
  G.players.find(p => p.id === sb).chips = 200; // 스몰은 250까지
  H.act(G, btn, 'raise', 0, 200);
  H.act(G, sb, 'allin', 0);             // 250: 50만 더 (덜 올림)
  H.act(G, bb, 'call', 0);
  const L = H.legal(G, btn);
  assert(!L.raise && 'call' in L, '덜 올린 올인 뒤에는 콜·폴드만');
}
// ── 땡값 (한게임 방식): 로티플 3배, 백티플·스티플 2배, 포카드 1배
assert.strictEqual(H.ttaengMult(sc('Ts Js Qs Ks As 2d 3c')), 3);
assert.strictEqual(H.ttaengMult(sc('As 2s 3s 4s 5s Kd Qc')), 2, '백티플');
assert.strictEqual(H.ttaengMult(sc('5h 6h 7h 8h 9h 2d 2c')), 2, '스티플');
assert.strictEqual(H.ttaengMult(sc('9s 9h 9d 9c Kd 2c 3h')), 1, '포카드');
assert.strictEqual(H.ttaengMult(sc('Qs Qh Qd 4c 4s 2d 9h')), 0, '풀하우스는 없음');
// 판 하나를 짜서 돌려 보기: board = 공용 5장, 덱은 뒤에서부터 나가고 스트리트마다 한 장 버림
function rigged(hands, board, opts) {
  const G = H.createGame(Object.assign({ bb: 100, startChips: 10000, ttaeng: 1 }, opts || {}));
  Object.keys(hands).forEach(id => H.addPlayer(G, id, id));
  H.startHand(G, Math.random, 0);
  const h = G.hand; const b = cs(board);
  Object.keys(hands).forEach(id => { h.cards[id] = cs(hands[id]); });
  h.deck = [b[4], 0, b[3], 0, b[2], b[1], b[0], 0];
  return G;
}
{
  const G = rigged({ x: 'As Ks', y: '7h 7d' }, 'Qs Js Ts 2d 3c');
  while (G.phase === 'bet') { const L = H.legal(G, G.hand.toAct); H.act(G, G.hand.toAct, 'check' in L ? 'check' : 'call', 0); }
  const r = G.hand.result;
  assert.deepStrictEqual(r.winners, ['x']);
  assert.deepStrictEqual(r.tg, { to: 'x', each: 300, mult: 3, from: { y: 300 }, total: 300 }, '로티플 3배 (건 금액 100)');
  assert.strictEqual(G.players.find(p => p.id === 'y').chips, 10000 - 100 - 300);
}
{ // 땡값 끈 방
  const G = rigged({ x: 'As Ks', y: '7h 7d' }, 'Qs Js Ts 2d 3c', { ttaeng: 0 });
  while (G.phase === 'bet') { const L = H.legal(G, G.hand.toAct); H.act(G, G.hand.toAct, 'check' in L ? 'check' : 'call', 0); }
  assert.strictEqual(G.hand.result.tg, undefined);
}
{ // 폴드한 사람은 안 냄, 포카드 1배
  const G = rigged({ x: '9s 9h', y: '7h 7d', z: '2c 3d' }, '9d 9c Kd 4h 5s');
  while (G.phase === 'bet') { const id = G.hand.toAct, L = H.legal(G, id); H.act(G, id, id === 'z' ? 'fold' : ('check' in L ? 'check' : 'call'), 0); }
  const r = G.hand.result;
  assert.deepStrictEqual(r.winners, ['x']); assert.deepStrictEqual(Object.keys(r.tg.from), ['y']); assert.strictEqual(r.tg.mult, 1);
}
console.log('holdem ok');

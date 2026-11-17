const S = require('../public/core.js');
const assert = require('assert');
// 카드 번호: 월 m의 특수패 = (m-1)*2, 피 = (m-1)*2+1
const sp = m => (m - 1) * 2, pi = m => (m - 1) * 2 + 1;
const E = cs => S.evalHand(cs).name;

assert.equal(E([sp(3), sp(8)]), '38광땡');
assert.equal(E([sp(1), sp(8)]), '18광땡');
assert.equal(E([sp(1), sp(3)]), '13광땡');
assert.equal(E([sp(1), pi(3)]), '4끗');
assert.equal(E([sp(10), pi(10)]), '장땡');
assert.equal(E([sp(1), pi(1)]), '1땡');
assert.equal(E([pi(1), pi(2)]), '알리');
assert.equal(E([pi(1), sp(4)]), '독사');
assert.equal(E([pi(9), pi(1)]), '구삥');
assert.equal(E([pi(1), pi(10)]), '장삥');
assert.equal(E([pi(4), pi(10)]), '장사');
assert.equal(E([pi(4), pi(6)]), '세륙');
assert.equal(E([pi(5), pi(4)]), '갑오');
assert.equal(E([pi(2), pi(8)]), '망통');
assert.equal(E([sp(4), sp(7)]), '암행어사');
assert.equal(E([pi(4), sp(7)]), '1끗');
assert.equal(E([sp(3), sp(7)]), '땡잡이');
assert.equal(E([pi(3), sp(7)]), '망통');
assert.equal(E([sp(4), sp(9)]), '멍텅구리구사');
assert.equal(E([pi(4), sp(9)]), '구사');

// 암행어사가 18광땡을 잡음
let r = S.pickWinners(['a', 'b'], { a: [sp(4), sp(7)], b: [sp(1), sp(8)] });
assert.deepEqual(r.winners, ['a']); assert.equal(r.catchBy, '암행어사');
// 38광땡은 못 잡음
r = S.pickWinners(['a', 'b'], { a: [sp(4), sp(7)], b: [sp(3), sp(8)] });
assert.deepEqual(r.winners, ['b']);
// 땡잡이가 9땡을 잡음, 장땡은 못 잡음
r = S.pickWinners(['a', 'b'], { a: [sp(3), sp(7)], b: [sp(9), pi(9)] });
assert.deepEqual(r.winners, ['a']);
r = S.pickWinners(['a', 'b'], { a: [sp(3), sp(7)], b: [sp(10), pi(10)] });
assert.deepEqual(r.winners, ['b']);
// 구사: 상대가 알리 이하면 재경기, 땡이면 아님
assert.ok(S.checkRedeal(['a', 'b'], { a: [pi(4), pi(9)], b: [pi(1), pi(2)] }));
assert.equal(S.checkRedeal(['a', 'b'], { a: [pi(4), pi(9)], b: [sp(2), pi(2)] }), null);
// 멍구사: 장땡까지 재경기, 광땡이면 아님
assert.ok(S.checkRedeal(['a', 'b'], { a: [sp(4), sp(9)], b: [sp(10), pi(10)] }));
assert.equal(S.checkRedeal(['a', 'b'], { a: [sp(4), sp(9)], b: [sp(1), sp(8)] }), null);
// 무승부 분배
r = S.settle({ a: 500, b: 500 }, ['a', 'b'], { a: [pi(2), pi(3)], b: [sp(2), sp(3)] });
assert.deepEqual(r.pay, { a: 500, b: 500 });
// 사이드팟: a 올인 100, b·c 각 500. a 최강
r = S.settle({ a: 100, b: 500, c: 500 }, ['a', 'b', 'c'], { a: [sp(3), sp(8)], b: [sp(10), pi(10)], c: [pi(2), pi(3)] });
assert.deepEqual(r.pay, { a: 300, b: 800 });

// 수수료: 겨룬 판돈 1,000에서 50 → 승자 950, b의 초과 베팅 100은 그대로 돌려줌
r = S.settle({ a: 500, b: 600 }, ['a', 'b'], { a: [sp(3), sp(8)], b: [pi(2), pi(3)] }, 50);
assert.deepEqual(r.pay, { a: 950, b: 100 }); assert.equal(r.rake, 50);
assert.equal(S.rakeFor({ pot: 1100, contrib: { a: 500, b: 600 }, rk: { rate: 5, cap: 0, min: 0 } }, false), 50);
// 사이드팟에서도 칩 총합 = 판돈 - 수수료
r = S.settle({ a: 100, b: 500, c: 500 }, ['a', 'b', 'c'], { a: [sp(3), sp(8)], b: [sp(10), pi(10)], c: [pi(2), pi(3)] }, 55);
assert.equal(Object.values(r.pay).reduce((x, y) => x + y, 0), 1100 - 55);
assert.ok(r.pay.a < 300 && r.pay.b < 800);
// rakeFor: 비율·상한·최소·다이판
const H = (pot, rk) => ({ pot, rk, contrib: { a: pot / 2, b: pot / 2 } });
assert.equal(S.rakeFor(H(10000, { rate: 5, cap: 2000, min: 500 }), false), 500);
assert.equal(S.rakeFor(H(100000, { rate: 5, cap: 2000, min: 500 }), false), 2000);
assert.equal(S.rakeFor(H(400, { rate: 5, cap: 2000, min: 500 }), false), 0);
assert.equal(S.rakeFor(H(10000, { rate: 5, cap: 2000, min: 500, folds: false }), true), 0);
assert.equal(S.rakeFor(H(10000, { rate: 5, cap: 2000, min: 500, folds: true }), true), 500);
assert.equal(S.rakeFor(H(10000, null), false), 0);

// 땡값 금액 (판돈 100): 1~9땡 0, 장땡 100, 13·18광땡 150, 38광땡 200
assert.equal(S.ttaengAmount(805, 100, 1), 0);
assert.equal(S.ttaengAmount(810, 100, 1), 100);
assert.equal(S.ttaengAmount(900, 100, 1), 150);
assert.equal(S.ttaengAmount(1000, 100, 1), 200);
assert.equal(S.ttaengAmount(700, 100, 1), 0);
assert.equal(S.ttaengAmount(810, 100, 0), 0);
assert.equal(S.ttaengAmount(900, 500, 1), 750);
// 두 장 모드: 시작하자마자 두 장, 바로 마지막 라운드
{
  let sd = 3; const r2 = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const G = S.createGame({ mode: 'two', ttaeng: 1 });
  S.addPlayer(G, 'x', 'X', true); S.addPlayer(G, 'y', 'Y', true);
  S.startHand(G, r2, 0);
  assert.equal(G.hand.round, 2); assert.equal(G.hand.cards.x.length, 2); assert.equal(G.hand.cards.y.length, 2);
  assert.equal(S.publicState(G, 0).h.nc, 2);
}
// 땡값 정산: x가 장땡, y·z는 끝까지 체크 → y·z가 각자 100
{
  const G = S.createGame({ ante: 100, ttaeng: 1 });
  ['x', 'y', 'z'].forEach(id => S.addPlayer(G, id, id.toUpperCase(), true));
  S.startHand(G, () => 0.5, 0);
  const h = G.hand; h.cards = { x: [sp(10), pi(10)], y: [pi(2), pi(3)], z: [pi(1), pi(4)] };
  h.round = 2;
  // 모두 체크 → 결과
  while (G.phase === 'bet') S.act(G, h.toAct, 'check', 0);
  const r = h.result;
  assert.equal(r.type, 'show'); assert.deepEqual(r.winners, ['x']);
  assert.deepEqual(r.tg, { to: 'x', each: 100, from: { y: 100, z: 100 }, total: 200 });
  assert.equal(G.players.find(p => p.id === 'x').chips, 10000 - 100 + 300 + 200);
  assert.equal(G.players.find(p => p.id === 'y').chips, 10000 - 100 - 100);
}
// 다이한 사람은 땡값을 내지 않음: x가 38광땡, z가 다이 → y만 200
{
  const G = S.createGame({ ante: 100, ttaeng: 1 });
  ['x', 'y', 'z'].forEach(id => S.addPlayer(G, id, id.toUpperCase(), true));
  S.startHand(G, () => 0.5, 0);
  const h = G.hand; h.cards = { x: [sp(3), sp(8)], y: [pi(2), pi(3)], z: [pi(1), pi(4)] }; h.round = 2;
  while (G.phase === 'bet') S.act(G, h.toAct, h.toAct === 'z' ? 'die' : 'check', 0);
  assert.deepEqual(h.result.tg, { to: 'x', each: 200, from: { y: 200 }, total: 200 });
  assert.equal(G.players.find(p => p.id === 'z').chips, 10000 - 100);
}
// 1~9땡은 땡값 없음
{
  const G = S.createGame({ ante: 100, ttaeng: 1 });
  ['x', 'y'].forEach(id => S.addPlayer(G, id, id, true));
  S.startHand(G, () => 0.5, 0);
  const h = G.hand; h.cards = { x: [sp(9), pi(9)], y: [pi(2), pi(3)] }; h.round = 2;
  while (G.phase === 'bet') S.act(G, h.toAct, 'check', 0);
  assert.deepEqual(h.result.winners, ['x']); assert.equal(h.result.tg, undefined);
}
// 땡잡이로 잡히면 땡값 없음
{
  const G = S.createGame({ ante: 100, ttaeng: 1 });
  ['x', 'y'].forEach(id => S.addPlayer(G, id, id, true));
  S.startHand(G, () => 0.5, 0);
  const h = G.hand; h.cards = { x: [sp(9), pi(9)], y: [sp(3), sp(7)] }; h.round = 2;
  while (G.phase === 'bet') S.act(G, h.toAct, 'check', 0);
  assert.deepEqual(h.result.winners, ['y']); assert.equal(h.result.tg, undefined);
}

// ── 시뮬레이션: 무작위 게임 수천 판, 칩 보존과 무한루프 없음 확인
let seed = 7; const rng = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
let hands = 0, redeals = 0, folds = 0, shows = 0, raked = 0, ttaengs = 0;
for (let g = 0; g < 300; g++) {
  const G = S.createGame({ ante: 100, startChips: 3000, rake: g % 3 ? { rate: 5, cap: 300, min: 300, folds: g % 2 === 0 } : null, mode: g % 4 < 2 ? 'two' : 'one', ttaeng: g % 2 });
  const n = 2 + (g % 5);
  for (let i = 0; i < n; i++) S.addPlayer(G, 'p' + i, 'P' + i, true);
  const total = () => G.rakeTotal + G.players.reduce((s, p) => s + p.chips, 0) + (G.hand && G.phase === 'bet' ? G.hand.pot : 0)
    + (G.hand && G.phase === 'show' && G.hand.result.type === 'redeal' ? G.hand.pot : 0);
  const T0 = total();
  for (let k = 0; k < 60 && S.canStart(G); k++) {
    S.startHand(G, rng, 0); hands++;
    let steps = 0;
    while (true) {
      if (G.phase === 'bet') {
        const id = G.hand.toAct; assert.ok(id, 'toAct missing');
        const kind = rng() < 0.05 ? null : S.botDecide(G, id, rng);
        const ok = kind ? S.act(G, id, kind, 0) : S.autoAct(G, 0);
        assert.ok(ok, 'illegal ' + kind + ' ' + JSON.stringify(S.legal(G, id)));
      } else if (G.phase === 'show' && G.hand.result.type === 'redeal') { redeals++; S.redeal(G, rng, 0); }
      else break;
      assert.ok(++steps < 500, 'loop');
      assert.equal(total(), T0, 'chips not conserved mid-hand');
      assert.ok(JSON.stringify(S.publicState(G, 0)).length < 3500, 'state too big');
    }
    G.hand.result.type === 'fold' ? folds++ : shows++;
    raked += G.hand.result.rake || 0;
    if (G.hand.result.tg) ttaengs++;
    assert.equal(total(), T0, 'chips not conserved');
    G.players.forEach(p => assert.ok(p.chips >= 0));
  }
}
console.log('ok', { hands, redeals, folds, shows, raked, ttaengs });

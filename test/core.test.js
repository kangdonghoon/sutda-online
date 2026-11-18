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

// 땡값 배수 (한게임 방식): 38광땡 2배, 13·18광땡 1배, 장땡~1땡 0.5배, 그 밖은 없음
assert.equal(S.ttaengMult(1000), 2);
assert.equal(S.ttaengMult(900), 1);
assert.equal(S.ttaengMult(810), 0.5);
assert.equal(S.ttaengMult(801), 0.5);
assert.equal(S.ttaengMult(700), 0);
assert.equal(S.ttaengMult(9), 0);
// 두 장 모드: 시작하자마자 두 장, 바로 마지막 라운드
{
  let sd = 3; const r2 = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const G = S.createGame({ mode: 'two', ttaeng: 1 });
  S.addPlayer(G, 'x', 'X', true); S.addPlayer(G, 'y', 'Y', true);
  S.startHand(G, r2, 0);
  assert.equal(G.hand.round, 2); assert.equal(G.hand.cards.x.length, 2); assert.equal(G.hand.cards.y.length, 2);
  assert.equal(S.publicState(G, 0).h.nc, 2);
}
// 땡값 정산: x가 장땡(0.5배), 판돈 100만 걸고 모두 체크 → y·z가 각자 50
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
  assert.deepEqual(r.tg, { to: 'x', each: 50, mult: 0.5, from: { y: 50, z: 50 }, total: 100 });
  assert.equal(G.players.find(p => p.id === 'x').chips, 10000 - 100 + 300 + 100);
  assert.equal(G.players.find(p => p.id === 'y').chips, 10000 - 100 - 50);
}
// 다이한 사람은 땡값을 내지 않음: x가 38광땡(2배, 건 금액 100), z가 다이 → y만 200
{
  const G = S.createGame({ ante: 100, ttaeng: 1 });
  ['x', 'y', 'z'].forEach(id => S.addPlayer(G, id, id.toUpperCase(), true));
  S.startHand(G, () => 0.5, 0);
  const h = G.hand; h.cards = { x: [sp(3), sp(8)], y: [pi(2), pi(3)], z: [pi(1), pi(4)] }; h.round = 2;
  while (G.phase === 'bet') S.act(G, h.toAct, h.toAct === 'z' ? 'die' : 'check', 0);
  assert.deepEqual(h.result.tg, { to: 'x', each: 200, mult: 2, from: { y: 200 }, total: 200 });
  assert.equal(G.players.find(p => p.id === 'z').chips, 10000 - 100);
}
// 9땡도 0.5배, 많이 걸수록 커짐: y가 삥(+100), x 콜 → x가 건 금액 200 × 0.5 = 100
{
  const G = S.createGame({ ante: 100, ttaeng: 1 });
  ['x', 'y'].forEach(id => S.addPlayer(G, id, id, true));
  S.startHand(G, () => 0.5, 0);
  const h = G.hand; h.cards = { x: [sp(9), pi(9)], y: [pi(2), pi(3)] }; h.round = 2;
  let bet = false;
  while (G.phase === 'bet') { const L = S.legal(G, h.toAct); if (!bet && 'bbing' in L) { S.act(G, h.toAct, 'bbing', 0); bet = true; } else S.act(G, h.toAct, 'check' in L ? 'check' : 'call', 0); }
  assert.deepEqual(h.result.winners, ['x']);
  assert.deepEqual(h.result.tg, { to: 'x', each: 100, mult: 0.5, from: { y: 100 }, total: 100 });
}
// 상한: 딴 돈 + 땡값 ≤ 판 시작 때 보유 칩. x 300으로 시작, 판돈 100씩 → 딴 돈 200, 땡값은 100까지만
{
  const G = S.createGame({ ante: 100, ttaeng: 1 });
  ['x', 'y', 'z'].forEach(id => S.addPlayer(G, id, id, true));
  G.players[0].chips = 300;
  S.startHand(G, () => 0.5, 0);
  const h = G.hand; h.cards = { x: [sp(3), sp(8)], y: [pi(2), pi(3)], z: [pi(1), pi(4)] }; h.round = 2;
  while (G.phase === 'bet') S.act(G, h.toAct, 'check', 0);
  assert.equal(h.result.tg.total, 100, '상한');
  assert.equal(G.players[0].chips, 300 - 100 + 300 + 100);
}
// 올인 예외: x가 판돈만 내고 올인, y가 더 걸었다가 졌으면 땡값 없음
{
  const G = S.createGame({ ante: 100, ttaeng: 1 });
  ['x', 'y', 'z'].forEach(id => S.addPlayer(G, id, id, true));
  G.players[0].chips = 100;
  S.startHand(G, () => 0.5, 0);
  const h = G.hand; h.cards = { x: [sp(3), sp(8)], y: [pi(2), pi(3)], z: [pi(1), pi(4)] }; h.round = 2;
  assert(h.allin.x);
  let bet = false;
  while (G.phase === 'bet') { const L = S.legal(G, h.toAct); if (!bet && 'bbing' in L) { S.act(G, h.toAct, 'bbing', 0); bet = true; } else S.act(G, h.toAct, 'check' in L ? 'check' : 'call', 0); }
  assert.deepEqual(h.result.winners, ['x']); assert.equal(h.result.tg, undefined, '올인 예외');
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

// 구사 재경기 재참가: z는 첫 장에서 다이, x 구사·y 알리 → 재경기, z는 차액을 내고 참가
{
  const G = S.createGame({ ante: 100 });
  ['x', 'y', 'z'].forEach(id => S.addPlayer(G, id, id, true));
  S.startHand(G, () => 0.5, 0);
  const h = G.hand;
  S.act(G, 'x', 'bbing', 0); S.act(G, 'y', 'call', 0); S.act(G, 'z', 'die', 0);   // x·y 각 200, z 100
  h.cards = { x: [pi(4), pi(9)], y: [pi(1), pi(2)], z: h.cards.z };
  S.act(G, 'x', 'check', 0); S.act(G, 'y', 'check', 0);
  assert.equal(h.result.type, 'redeal'); assert.equal(h.result.name, '구사');
  assert.deepEqual(h.rejoin.ids, ['z']); assert.equal(h.rejoin.cost.z, 100);
  assert.deepEqual(S.rejoinPending(G), ['z']);
  assert.equal(S.rejoinAnswer(G, 'x', true), false, 'only folded players');
  assert.ok(S.rejoinAnswer(G, 'z', true)); assert.equal(S.rejoinAnswer(G, 'z', false), false, 'answer once');
  const pot = h.pot, zc = G.players[2].chips;
  S.redeal(G, () => 0.4, 0);
  assert.equal(h.pot, pot + 100); assert.equal(G.players[2].chips, zc - 100); assert.equal(h.contrib.z, 200);
  assert.ok(!h.folded.z && h.cards.z && h.cards.z.length === 1);
  assert.equal(S.publicState(G, 0).h.rj, null);
}
{
  // 대답 안 하면 불참
  const G = S.createGame({ ante: 100 });
  ['x', 'y', 'z'].forEach(id => S.addPlayer(G, id, id, true));
  S.startHand(G, () => 0.5, 0);
  const h = G.hand;
  S.act(G, 'x', 'check', 0); S.act(G, 'y', 'check', 0); S.act(G, 'z', 'die', 0);
  h.cards = { x: [pi(4), pi(9)], y: [pi(1), pi(2)], z: h.cards.z };
  S.act(G, 'x', 'check', 0); S.act(G, 'y', 'check', 0);
  assert.equal(h.rejoin.cost.z, 0);
  S.redeal(G, () => 0.4, 0);
  assert.ok(h.folded.z && !h.cards.z);
}

// 동점 재경기
const play = (G, pick) => { while (G.phase === 'bet') S.act(G, G.hand.toAct, pick ? pick(G.hand.toAct) : 'check', 0); };
{
  // x·y 동점(5끗), z는 2끗 → z 탈락, x·y 재경기, 판돈 300 그대로
  const G = S.createGame({ ante: 100 });
  ['x', 'y', 'z'].forEach(id => S.addPlayer(G, id, id, true));
  S.startHand(G, () => 0.5, 0);
  const h = G.hand; h.cards = { x: [pi(2), pi(3)], y: [pi(1), sp(4)].reverse().map(c => c) , z: [pi(1), pi(1) ^ 0] };
  h.cards = { x: [pi(2), pi(3)], y: [pi(6), pi(9)], z: [pi(5), pi(7)] }; h.round = 2;
  play(G);
  assert.equal(h.result.type, 'redeal'); assert.deepEqual(h.result.tie.sort(), ['x', 'y']);
  assert.equal(h.folded.z, true); assert.equal(h.pot, 300);
  let sd = 9; S.redeal(G, () => (sd = (sd * 16807) % 2147483647) / 2147483647, 0);
  assert.equal(G.phase, 'bet'); assert.ok(h.cards.x && h.cards.y && !h.cards.z);
  // 재경기 결과 정해지게 패 지정
  h.cards = { x: [sp(10), pi(10)], y: [pi(2), pi(3)] }; h.round = 2;
  play(G);
  assert.equal(h.result.type, 'show'); assert.deepEqual(h.result.winners, ['x']); assert.equal(h.result.pay.x, 300);
}
{
  // 나눠 갖기 옵션: 동점이면 반씩
  const G = S.createGame({ ante: 100, tie: 'split' });
  ['x', 'y'].forEach(id => S.addPlayer(G, id, id, true));
  S.startHand(G, () => 0.5, 0);
  const h = G.hand; h.cards = { x: [pi(2), pi(3)], y: [pi(6), pi(9)] }; h.round = 2;
  play(G);
  assert.equal(h.result.type, 'show'); assert.deepEqual(h.result.pay, { x: 100, y: 100 });
}
{
  // 초과 베팅 정산: x·y는 칩 200이라 콜하면서 올인(200씩), z는 250을 걸었지만 낮은 패 → z의 초과 50은 먼저 돌려받음
  const G = S.createGame({ ante: 100, mode: 'two' });
  ['x', 'y', 'z'].forEach(id => S.addPlayer(G, id, id, true));
  G.players[0].chips = 200; G.players[1].chips = 200;
  S.startHand(G, () => 0.5, 0);
  const h = G.hand; h.cards = { x: [pi(2), pi(3)], y: [pi(6), pi(9)], z: [pi(5), pi(7)] };
  assert.deepEqual(h.seats, ['x', 'y', 'z']);
  S.act(G, 'x', 'check', 0); S.act(G, 'y', 'check', 0); S.act(G, 'z', 'half', 0);
  S.act(G, 'x', 'call', 0); S.act(G, 'y', 'call', 0);
  assert.equal(h.result.type, 'redeal'); assert.deepEqual(h.result.paid, { z: 50 });
  assert.equal(h.pot, 600); assert.deepEqual(h.contrib, { x: 200, y: 200, z: 200 });
  assert.equal(G.players[2].chips, 10000 - 250 + 50);
}
{
  // 동점이 3번 이어지면 그다음엔 나눠 가짐
  const G = S.createGame({ ante: 100 });
  ['x', 'y'].forEach(id => S.addPlayer(G, id, id, true));
  S.startHand(G, () => 0.5, 0);
  const h = G.hand; let n = 0;
  for (;;) {
    h.cards = { x: [pi(2), pi(3)], y: [pi(6), pi(9)] }; h.round = 2; play(G);
    if (h.result.type !== 'redeal') break;
    n++; S.redeal(G, () => 0.3, 0);
  }
  assert.equal(n, 3); assert.deepEqual(h.result.pay, { x: 100, y: 100 });
}

// ── 시뮬레이션: 무작위 게임 수천 판, 칩 보존과 무한루프 없음 확인
let seed = 7; const rng = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
let hands = 0, redeals = 0, folds = 0, shows = 0, raked = 0, ttaengs = 0, ties = 0, rejoins = 0;
for (let g = 0; g < 300; g++) {
  const G = S.createGame({ ante: 100, startChips: 3000, rake: g % 3 ? { rate: 5, cap: 300, min: 300, folds: g % 2 === 0 } : null, mode: g % 4 < 2 ? 'two' : 'one', ttaeng: g % 2, tie: g % 5 === 0 ? 'split' : 'replay' });
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
      } else if (G.phase === 'show' && G.hand.result.type === 'redeal') {
        G.hand.result.tie ? ties++ : redeals++;
        S.rejoinPending(G).forEach(id => { if (rng() < 0.6) { S.rejoinAnswer(G, id, rng() < 0.7); rejoins++; } });
        S.redeal(G, rng, 0);
      }
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
console.log('ok', { hands, redeals, ties, rejoins, folds, shows, raked, ttaengs });

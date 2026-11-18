// 7포커 엔진 테스트: node test/poker7.test.js
'use strict';
const assert = require('assert');
const K = require('../public/poker7.js');

const C = s => { const r = '23456789TJQKA'.indexOf(s[0]), u = 'shdc'.indexOf(s[1]); assert(r >= 0 && u >= 0, s); return r * 4 + u; };
const cs = str => str.split(' ').map(C);
const sc = str => K.best(cs(str)).score;
const name = str => K.handName(sc(str));

// ── 한국식 족보 순서
const ladder = [
  'As Kd 9c 7h 3s 2d 4c',   // A 탑
  '2s 2d 9c 7h 3s Kd 5c',   // 원페어
  '2s 2d 9c 9h 3s Kd 5c',   // 투페어
  '2s 2d 2c 9h 3s Kd 5c',   // 트리플
  '6s 7d 8c 9h Ts 2d 2c',   // 스트레이트 (10 탑)
  '9s Td Jc Qh Ks 2d 2c',   // 스트레이트 (K 탑)
  'As 2d 3c 4h 5s 9d Kc',   // 백스트레이트 (K 탑 스트레이트보다 높음)
  'Ts Jd Qc Kh As 2d 4c',   // 마운틴
  '2s 7s 9s Js 3s 4d 4c',   // 플러시
  '2s 2d 2c 9h 9s Kd 5c',   // 풀하우스
  '2s 2d 2c 2h 9s Kd 5c',   // 포카드
  '5s 6s 7s 8s 9s 2d 2c',   // 스트레이트 플러시
  'As 2s 3s 4s 5s Kd Qc',   // 백스트레이트 플러시
  'Ts Js Qs Ks As 2d 2c',   // 로열
];
for (let i = 1; i < ladder.length; i++) assert(sc(ladder[i]) > sc(ladder[i - 1]), `족보 순서 ${i}: ${name(ladder[i])} > ${name(ladder[i - 1])}`);
assert.strictEqual(name('As 2d 3c 4h 5s 9d Kc'), '백스트레이트');
assert.strictEqual(name('Ts Jd Qc Kh As 2d 4c'), '마운틴');
assert.strictEqual(name('Ts Js Qs Ks As 2d 2c'), '로열 스트레이트 플러시');
assert.strictEqual(name('2s 2d 9c 9h 3s Kd 5c'), '투페어 (9·2)');
// 같은 족보·같은 숫자면 무늬로 (♠ > ◆ > ♥ > ♣)
assert(sc('Ks Kh 9c 7h 3s') > sc('Kd Kc 9d 7s 3c'), 'K 원페어: 스페이드가 이김');
assert(sc('Kd Kc 9h 7s 3c') > sc('Kh Kc 9d 7c 3d'), '다이아 > 하트');
assert(sc('As Qs 9s 7s 3s') > sc('Ad Qd 9d 7d 3d'), '플러시 무늬');
// 숫자가 먼저, 무늬는 그다음
assert(sc('Ac Ah 9c 7h 3s') > sc('Ks Kd 9d 7s 3c'));
// 공개 카드끼리 (선 정하기): 페어 > 높은 카드, 같으면 무늬
assert(K.best(cs('3c 3d')).score > K.best(cs('As Kd')).score);
assert(K.best(cs('As Kd')).score > K.best(cs('Ah Kc')).score, '공개 카드 같은 숫자면 무늬'); assert(K.best(cs('Ah Kd')).score > K.best(cs('As 2d')).score, '숫자가 먼저');
// 땡값 배수
assert.strictEqual(K.ttaengMult(sc('Ts Js Qs Ks As 2d 2c')), 3);
assert.strictEqual(K.ttaengMult(sc('As 2s 3s 4s 5s Kd Qc')), 2);
assert.strictEqual(K.ttaengMult(sc('5s 6s 7s 8s 9s 2d 2c')), 2);
assert.strictEqual(K.ttaengMult(sc('2s 2d 2c 2h 9s Kd 5c')), 1);
assert.strictEqual(K.ttaengMult(sc('2s 2d 2c 9h 9s Kd 5c')), 0);

// ── 진행: 초이스 → 4구 공개 → 5·6구 공개 → 7구 히든
{
  const G = K.createGame({ ante: 100, startChips: 10000 });
  ['a', 'b', 'c'].forEach(id => K.addPlayer(G, id, id));
  K.startHand(G, Math.random, 0);
  const h = G.hand;
  assert.strictEqual(h.stage, 'choice'); assert.strictEqual(h.pot, 300);
  ['a', 'b', 'c'].forEach(id => assert.strictEqual(h.cards[id].length, 4));
  assert(!K.act(G, 'a', 'check', 0), '초이스 중에는 베팅 불가');
  const st0 = K.publicState(G, 0);
  assert(st0.h.vis.a.every(c => c === null), '초이스 전에는 아무것도 안 보임');
  const fourth = h.cards.a[2];
  assert(K.choose(G, 'a', 0, 2, 0)); assert(!K.choose(G, 'a', 1, 2, 0), '두 번 고를 수 없음');
  assert(!K.choose(G, 'b', 1, 1, 0), '같은 카드를 버리고 보여줄 수 없음');
  K.choose(G, 'b', 3, 0, 0);
  assert.strictEqual(h.stage, 'choice');
  K.choose(G, 'c', 1, 2, 0);
  assert.strictEqual(h.stage, 'bet'); assert.strictEqual(h.round, 4);
  assert.strictEqual(h.cards.a.length, 4); assert.deepStrictEqual(h.up.a, [false, false, true, true]);
  assert.strictEqual(h.cards.a[2], fourth, '보여주기로 한 카드가 공개 자리로');
  const st = K.publicState(G, 0);
  assert.strictEqual(st.h.vis.b[0], null); assert.notStrictEqual(st.h.vis.b[2], null, '공개 카드는 보임');
  // 선은 공개 카드가 가장 좋은 사람
  const vis = id => h.cards[id].filter((c, i) => h.up[id][i]);
  const top = ['a', 'b', 'c'].reduce((x, y) => (K.best(vis(y)).score > K.best(vis(x)).score ? y : x));
  assert.strictEqual(h.sun, top); assert.strictEqual(h.toAct, top);
  while (G.phase === 'bet') { const L = K.legal(G, h.toAct); K.act(G, h.toAct, 'check' in L ? 'check' : 'call', 0); }
  assert.strictEqual(h.result.type, 'show');
  ['a', 'b', 'c'].forEach(id => { assert.strictEqual(h.cards[id].length, 7); assert.deepStrictEqual(h.up[id], [false, false, true, true, true, true, false]); });
}
// 초이스 시간 초과: 자동으로 고름
{
  const G = K.createGame({ ante: 100 });
  ['a', 'b'].forEach(id => K.addPlayer(G, id, id));
  K.startHand(G, Math.random, 0);
  K.choose(G, 'a', 0, 1, 0);
  K.autoAct(G, 20000);
  assert.strictEqual(G.hand.stage, 'bet');
}
// 짝은 숨기고 버리지 않음
{
  const p = K.autoPick(cs('7s 7d 2c Kh'));
  assert.strictEqual(p.d, 2, '가장 낮은 2를 버림'); assert.strictEqual(p.o, 3, '짝이 아닌 K를 보여줌');
}
// 초이스 중에 나가면 다이, 혼자 남으면 바로 끝
{
  const G = K.createGame({ ante: 100 });
  ['a', 'b'].forEach(id => K.addPlayer(G, id, id));
  K.startHand(G, Math.random, 0);
  K.leaveHand(G, 'b', 0);
  assert.strictEqual(G.phase, 'show'); assert.deepStrictEqual(G.hand.result.winners, ['a']);
}
// 땡값: 포카드로 이기면 끝까지 남은 사람이 건 금액만큼
{
  const G = K.createGame({ ante: 100, ttaeng: 1 });
  ['a', 'b'].forEach(id => K.addPlayer(G, id, id));
  K.startHand(G, Math.random, 0);
  const h = G.hand;
  K.choose(G, 'a', 0, 1, 0); K.choose(G, 'b', 0, 1, 0);
  h.cards.a = cs('9s 9h 9d 9c'); h.cards.b = cs('2s 3h 5d 7c'); // 4구까지 받은 상태로 바꿔치기
  h.deck = cs('Ks 4d 8h Qc Jd 6s'); // 남은 카드 (뒤에서부터 나감)
  while (G.phase === 'bet') { const L = K.legal(G, h.toAct); K.act(G, h.toAct, 'check' in L ? 'check' : 'call', 0); }
  assert.deepStrictEqual(h.result.winners, ['a']);
  assert.deepStrictEqual(h.result.tg, { to: 'a', each: 100, mult: 1, from: { b: 100 }, total: 100 });
}

// ── 시뮬레이션: 봇끼리 수천 판, 칩 보존과 멈춤 없음
function seeded(seed) { let x = seed >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function sim(n, hands, seed, rake, tg) {
  const rng = seeded(seed);
  const G = K.createGame({ ante: 100, startChips: 5000, rake, ttaeng: tg });
  for (let i = 0; i < n; i++) K.addPlayer(G, 'p' + i, '봇' + i, true);
  let played = 0, shows = 0, runouts = 0, tgs = 0, now = 0;
  for (let k = 0; k < hands; k++) {
    for (const p of G.players) if (p.chips === 0) p.chips = 5000;
    const before = G.players.reduce((a, p) => a + p.chips, 0);
    assert(K.startHand(G, rng, now));
    let steps = 0;
    while (G.phase === 'bet') {
      const h = G.hand;
      if (h.stage === 'choice') {
        for (const id of K.choicePending(G)) { if (rng() < 0.2) continue; K.botChoose(G, id); }
        if (h.stage === 'choice' && rng() < 0.3) K.autoAct(G, now);
        if (h.stage === 'choice' && rng() < 0.05) { const ids = K.choicePending(G); if (ids.length) K.leaveHand(G, ids[0], now); }
      } else {
        const id = h.toAct; assert(id, '행동할 사람');
        const L = K.legal(G, id); assert(Object.keys(L).length);
        const k2 = rng() < 0.15 ? Object.keys(L)[Math.floor(rng() * Object.keys(L).length)] : K.botDecide(G, id, rng);
        assert(K.act(G, id, k2, now), '행동 성공');
      }
      if (++steps > 500) throw new Error('판이 끝나지 않음');
      const h2 = G.hand;
      assert.strictEqual(h2.pot, Object.values(h2.contrib).reduce((a, b) => a + b, 0));
      G.players.forEach(p => assert(p.chips >= 0));
    }
    const h = G.hand, after = G.players.reduce((a, p) => a + p.chips, 0);
    assert.strictEqual(after + h.result.rake, before, `칩 보존 (판 ${h.no})`);
    if (h.result.type === 'show') { shows++; h.seats.filter(id => !h.folded[id]).forEach(id => assert.strictEqual(h.cards[id].length, 7)); }
    if (h.runout) runouts++;
    if (h.result.tg) tgs++;
    played++; now += 1000;
  }
  return { played, shows, runouts, tgs };
}
for (const [n, k] of [[2, 800], [4, 400], [6, 250]]) {
  const r = sim(n, k, 11 + n, { rate: 5, cap: 2000, min: 500, folds: n % 2 === 0 }, n % 2 === 0 ? 1 : 0);
  console.log(`7포커 ${n}명: ${r.played}판, 쇼다운 ${r.shows}, 올인 런아웃 ${r.runouts}, 땡값 ${r.tgs}`);
}
console.log('poker7 ok');

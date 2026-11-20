// 로우바둑이 엔진 테스트: node test/badugi.test.js
'use strict';
const assert = require('assert');
const K = require('../public/badugi.js');

const C = s => { const r = '23456789TJQKA'.indexOf(s[0]), u = 'shdc'.indexOf(s[1]); assert(r >= 0 && u >= 0, s); return r * 4 + u; };
const cs = str => str.split(' ').map(C);
const sc = str => K.best(cs(str)).score;
const name = str => K.handName(sc(str));

// ── 족보 순서 (낮은 것부터 → 높은 것)
const ladder = [
  'Ks Kd Kh Kc',   // 노베이스 (K)
  '2s 2d 2h 2c',   // 노베이스 (2)
  'Ks Qd Qh Qc',   // 투베이스 (K·Q)
  '3s 2s Ah Ac',   // 투베이스 (3·A)
  'Ks Qd Jh Jc',   // K 베이스
  '4s 3d 2h 2c',   // 4 베이스
  '3s 2d Ah Ac',   // 3 베이스 (A23)
  'Ks Qd Jh Tc',   // K 메이드
  '9s 8d 3h Ac',   // 9 메이드
  '6s 5d 4h 3c',   // 6 메이드
  '5s 4d 3h 2c',   // 5 메이드 (2345)
  'As 3d 4h 5c',   // A345
  'As 2d 4h 5c',   // 써드
  'As 2d 3h 5c',   // 세컨드
  'As 2d 3h 4c',   // 골프
];
for (let i = 1; i < ladder.length; i++) assert(sc(ladder[i]) > sc(ladder[i - 1]), `족보 순서 ${i}: ${name(ladder[i])} > ${name(ladder[i - 1])}`);
assert.strictEqual(name('As 2d 3h 4c'), '골프');
assert.strictEqual(name('As 2d 3h 5c'), '세컨드');
assert.strictEqual(name('As 2d 4h 5c'), '써드');
assert.strictEqual(name('9s 8d 3h Ac'), '9 메이드 (9·8·3·A)');
assert.strictEqual(name('4s 3d 2h 2c'), '4 베이스 (4·3·2)');
assert.strictEqual(name('Ks Qd Qh Qc'), '투베이스 (K·Q)');
assert.strictEqual(name('Ks Kd Kh Kc'), '노베이스 (K)');
// 같은 무늬는 하나만: 3♠ 2♠ → 하나만 씀
assert.strictEqual(K.sizeOf(sc('3s 2s Ah 5d')), 3);
assert.strictEqual(name('3s 2s Ah 5d'), '5 베이스 (5·2·A)');
// 높은 카드가 같으면 그다음 카드로
assert(sc('8s 4d 3h Ac') > sc('8s 5d 2h Ac'));
// 무늬로는 가르지 않음
assert.strictEqual(sc('As 2d 3h 4c'), sc('Ad 2s 3c 4h'));
// 땡값 배수
assert.strictEqual(K.ttaengMult(sc('As 2d 3h 4c')), 3);
assert.strictEqual(K.ttaengMult(sc('As 2d 3h 5c')), 2);
assert.strictEqual(K.ttaengMult(sc('As 2d 4h 5c')), 1);
assert.strictEqual(K.ttaengMult(sc('As 3d 4h 5c')), 0);
assert.strictEqual(K.ttaengMult(sc('As 2s 3h 4c')), 0);
// 자동 교환: 쓰는 카드는 남기고 겹치는 카드는 바꾼다
assert.deepStrictEqual(K.autoPick(cs('As 2s 3h 4c'), 3), [1]);
assert.deepStrictEqual(K.autoPick(cs('As 2d 3h 4c'), 3), []);
assert.deepStrictEqual(K.autoPick(cs('As 2d 3h Kc'), 3), [3], '메이드여도 K는 초반에 바꿈');
assert.deepStrictEqual(K.autoPick(cs('As 2d 3h Kc'), 0), [], '마지막엔 안 바꿈');

// ── 진행: 첫 베팅 → 아침 → 베팅 → 점심 → 베팅 → 저녁 → 베팅 → 승부
{
  const G = K.createGame({ ante: 100, startChips: 10000 });
  ['a', 'b', 'c'].forEach(id => K.addPlayer(G, id, id));
  K.startHand(G, Math.random, 0);
  const h = G.hand;
  assert.strictEqual(h.stage, 'bet'); assert.strictEqual(h.pot, 300); assert.strictEqual(h.toAct, 'a');
  ['a', 'b', 'c'].forEach(id => assert.strictEqual(h.cards[id].length, 4));
  const st0 = K.publicState(G, 0);
  assert(st0.h.vis.b.every(c => c === null) && st0.h.vis.b.length === 4, '남의 카드는 안 보임');
  assert(!K.draw(G, 'a', [0], 0), '베팅 중에는 교환 불가');
  ['a', 'b', 'c'].forEach(id => assert(K.act(G, id, 'check', 0)));
  assert.strictEqual(h.stage, 'draw'); assert.strictEqual(h.drawNo, 0);
  assert(!K.act(G, 'a', 'check', 0), '교환 중에는 베팅 불가');
  assert(!K.draw(G, 'a', [4], 0), '잘못된 카드 번호');
  const keepA = h.cards.a.slice();
  assert(K.draw(G, 'a', [0, 2], 0));
  assert(!K.draw(G, 'a', [1], 0), '두 번 못 고름');
  assert.deepStrictEqual(K.myView(G, 'a').pick, [0, 2]);
  assert(K.draw(G, 'b', [], 0)); // 패스
  assert.strictEqual(h.stage, 'draw');
  assert(K.draw(G, 'c', [0, 1, 2, 3], 0));
  assert.strictEqual(h.stage, 'bet'); assert.strictEqual(h.drawNo, 1);
  assert.strictEqual(h.cards.a[1], keepA[1]); assert.strictEqual(h.cards.a[3], keepA[3]);
  assert.notStrictEqual(h.cards.a[0], keepA[0]);
  assert.deepStrictEqual(K.publicState(G, 0).h.drew, { a: 2, b: 0, c: 4 });
  // 나머지 진행
  for (let r = 1; r <= 3; r++) {
    ['a', 'b', 'c'].forEach(id => assert(K.act(G, id, 'check', 0)));
    if (r < 3) { assert.strictEqual(h.stage, 'draw'); K.autoChoose(G, 0); assert.strictEqual(h.drawNo, r + 1); }
  }
  assert.strictEqual(G.phase, 'show'); assert.strictEqual(h.result.type, 'show');
  // 카드 중복 없음
  const all = ['a', 'b', 'c'].flatMap(id => h.cards[id]); assert.strictEqual(new Set(all).size, 12);
}
// ── 교환 중에 나가면 다이
{
  const G = K.createGame({ ante: 100, startChips: 10000 });
  ['a', 'b'].forEach(id => K.addPlayer(G, id, id));
  K.startHand(G, Math.random, 0);
  K.act(G, 'a', 'check', 0); K.act(G, 'b', 'check', 0);
  K.draw(G, 'b', [], 0);
  assert(K.leaveHand(G, 'a', 0));
  assert.strictEqual(G.phase, 'show'); assert.deepStrictEqual(G.hand.result.winners, ['b']);
}
// ── 땡값: 골프로 이기면 건 금액의 3배를 각자에게서
{
  const G = K.createGame({ ante: 100, startChips: 10000, ttaeng: 1 });
  ['a', 'b'].forEach(id => K.addPlayer(G, id, id));
  K.startHand(G, Math.random, 0);
  const h = G.hand;
  h.cards.a = cs('As 2d 3h 4c'); h.cards.b = cs('Ks Kd Qh Jc');
  h.deck = h.deck.filter(c => !h.cards.a.includes(c) && !h.cards.b.includes(c));
  for (let r = 0; r < 4; r++) {
    K.act(G, 'a', 'check', 0); K.act(G, 'b', 'check', 0);
    if (r < 3) { K.draw(G, 'a', [], 0); K.draw(G, 'b', [], 0); }
  }
  assert.deepStrictEqual(h.result.winners, ['a']);
  assert.strictEqual(h.result.ev.a, '골프');
  assert.deepStrictEqual(h.result.tg, { to: 'a', each: 300, mult: 3, from: { b: 300 }, total: 300 });
}
// ── 올인이면 베팅 없이 교환만 이어감
{
  const G = K.createGame({ ante: 100, startChips: 1000 });
  ['a', 'b'].forEach(id => K.addPlayer(G, id, id));
  G.players[1].chips = 200;
  K.startHand(G, Math.random, 0);
  const h = G.hand;
  K.act(G, 'a', 'half', 0); // 판돈 200의 절반 = 100
  K.act(G, 'b', 'call', 0); // b 올인
  assert(h.allin.b);
  assert.strictEqual(h.stage, 'draw');
  K.autoChoose(G, 0); assert.strictEqual(h.stage, 'draw', '베팅 없이 바로 다음 교환'); assert.strictEqual(h.drawNo, 1);
  K.autoChoose(G, 0); K.autoChoose(G, 0);
  assert.strictEqual(G.phase, 'show');
}

// ── 시뮬레이션: 봇끼리 수천 판, 칩 보존·카드 중복 없음·멈춤 없음
function seeded(seed) { let x = seed >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function sim(n, hands, seed, rake, tg) {
  const rng = seeded(seed);
  const G = K.createGame({ ante: 100, startChips: 5000, rake, ttaeng: tg });
  for (let i = 0; i < n; i++) K.addPlayer(G, 'p' + i, '봇' + i, true);
  let played = 0, shows = 0, tgs = 0, made = 0, now = 0;
  for (let k = 0; k < hands; k++) {
    for (const p of G.players) if (p.chips === 0) p.chips = 5000;
    const before = G.players.reduce((a, p) => a + p.chips, 0);
    assert(K.startHand(G, rng, now));
    let steps = 0;
    while (G.phase === 'bet') {
      const h = G.hand;
      if (h.stage === 'draw') {
        for (const id of K.choicePending(G)) { if (rng() < 0.2) continue; K.botChoose(G, id); }
        if (h.stage === 'draw' && rng() < 0.3) K.autoAct(G, now);
        if (h.stage === 'draw' && rng() < 0.04) { const ids = K.choicePending(G); if (ids.length) K.leaveHand(G, ids[0], now); }
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
      const inHand = h2.seats.flatMap(id => h2.cards[id]);
      assert.strictEqual(new Set(inHand.concat(h2.deck, h2.muck)).size, 52, '카드 52장 그대로');
      assert.strictEqual(inHand.length + h2.deck.length + h2.muck.length, 52);
    }
    const h = G.hand, after = G.players.reduce((a, p) => a + p.chips, 0);
    assert.strictEqual(after + h.result.rake, before, `칩 보존 (판 ${h.no})`);
    if (h.result.type === 'show') { shows++; h.result.winners.forEach(w => { if (K.sizeOf(K.best(h.cards[w]).score) === 4) made++; }); }
    if (h.result.tg) tgs++;
    played++; now += 1000;
  }
  return { played, shows, tgs, made };
}
for (const [n, k] of [[2, 800], [3, 500], [5, 300]]) {
  const r = sim(n, k, 21 + n, { rate: 5, cap: 2000, min: 500, folds: n % 2 === 0 }, 1);
  console.log(`바둑이 ${n}명: ${r.played}판, 쇼다운 ${r.shows} (메이드로 이김 ${r.made}), 땡값 ${r.tgs}`);
}
console.log('badugi ok');

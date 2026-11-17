// 저장소 테스트: 메모리 + (PSQL_ARGS가 있으면) 실제 Postgres
const assert = require('assert');
const { PgStore, MemStore } = require('../store.js');
async function run(store, label) {
  await store.init(); await store.init(); // 두 번 불러도 안전해야 함
  const a = await store.createUser({ username: 'donghun', nick: "동훈's", pwHash: 'h1', salt: 's1' });
  assert.equal(a.username, 'donghun'); assert.equal(a.chips, 10000); assert.equal(a.banned, false); assert.equal(a.nick, "동훈's");
  assert.equal(await store.createUser({ username: 'donghun', nick: 'x', pwHash: 'h', salt: 's' }), null, 'dup');
  const b = await store.createUser({ username: 'minsu', nick: '민수', pwHash: 'h2', salt: 's2' });
  assert.equal((await store.userByName('minsu')).id, b.id);
  assert.equal(await store.userByName('nobody'), null);
  await store.createSession('tokA', a.id, Date.now() + 60000);
  await store.createSession('tokOld', a.id, Date.now() - 1);
  assert.equal((await store.sessionUser('tokA')).id, a.id);
  assert.equal(await store.sessionUser('tokOld'), null, 'expired');
  assert.equal(await store.sessionUser('nope'), null);
  await store.recordHand(a.id, 12500, true, 2500);
  await store.recordHand(a.id, 12000, false, 0);
  let u = await store.userById(a.id);
  assert.deepEqual([u.chips, u.hands, u.wins, u.best], [12000, 2, 1, 2500]);
  await store.recordHand(b.id, 0, false, 0);
  // 충전 요청: 1인 1대기, 승인은 한 번만
  const q1 = await store.createChipRequest(b.id, 10000, "급해요 '빨리'");
  assert.equal(q1.status, 'pending'); assert.equal(q1.note, "급해요 '빨리'");
  assert.equal(await store.createChipRequest(b.id, 30000, ''), null, 'one pending per user');
  let pend = await store.pendingRequests(); assert.equal(pend.length, 1); assert.equal(pend[0].nick, '민수'); assert.equal(pend[0].userChips, 0);
  const d1 = await store.decideChipRequest(q1.id, 'approved', 10000, 'donghun'); assert.equal(d1.granted, 10000);
  assert.equal(await store.decideChipRequest(q1.id, 'approved', 10000, 'donghun'), null, 'no double approve');
  await store.grantChips(b.id, 10000, null);
  u = await store.userById(b.id); assert.deepEqual([u.chips, u.rebuys, u.bought], [10000, 1, 10000]);
  const q2 = await store.createChipRequest(b.id, 50000, ''); assert.ok(q2);
  assert.equal((await store.cancelChipRequest(b.id)).status, 'canceled');
  assert.equal(await store.cancelChipRequest(b.id), null);
  const q3 = await store.createChipRequest(b.id, 30000, ''); await store.decideChipRequest(q3.id, 'rejected', null, 'donghun');
  const rec = await store.recentRequests(10); assert.deepEqual(rec.map(r => r.status).sort(), ['approved', 'canceled', 'rejected']);
  assert.equal((await store.pendingRequests()).length, 0);
  await store.grantChips(b.id, 5000, 3000); u = await store.userById(b.id); assert.deepEqual([u.chips, u.bought], [3000, 15000]);
  await store.setChips(b.id, 10000);
  const rk = await store.ranking(10);
  assert.deepEqual(rk.map(r => [r.username, r.profit]), [['donghun', 2000], ['minsu', -15000]]);
  await store.setBanned(b.id, true); assert.equal((await store.userById(b.id)).banned, true);
  assert.equal((await store.ranking(10)).length, 1);
  await store.setChips(a.id, 777); assert.equal((await store.userById(a.id)).chips, 777);
  await store.setNick(a.id, '새닉'); assert.equal((await store.userById(a.id)).nick, '새닉');
  assert.equal((await store.listUsers('MIN')).length, 1, 'search case-insensitive');
  assert.equal((await store.listUsers()).length, 2);
  await store.deleteUserSessions(a.id); assert.equal(await store.sessionUser('tokA'), null);
  await store.purgeSessions();
  assert.equal(await store.getSetting('rake'), null);
  await store.setSetting('rake', '{"rate":5}'); await store.setSetting('rake', '{"rate":7}');
  assert.equal(await store.getSetting('rake'), '{"rate":7}');
  const now = Date.now();
  await store.logRake({ at: now - 8 * 864e5, room: 'old1', hand: 1, pot: 1000, rake: 50, winners: "옛날" });
  await store.logRake({ at: now - 2 * 864e5, room: 'abcd', hand: 3, pot: 4000, rake: 200, winners: "민수" });
  await store.logRake({ at: now, room: 'abcd', hand: 4, pot: 10000, rake: 500, winners: "동훈's, 지영" });
  const st = await store.rakeStats({ today: now - 3600e3, week: now - 7 * 864e5 });
  assert.deepEqual(st, { total: 750, n: 3, today: 500, todayN: 1, week: 700 });
  const rc = await store.recentRake(2);
  assert.deepEqual(rc.map(e => [e.hand, e.rake, e.winners]), [[4, 500, "동훈's, 지영"], [3, 200, '민수']]);
  console.log(label, 'ok');
}
(async () => {
  await run(new MemStore(), 'memory');
  if (process.env.PSQL_ARGS) await run(new PgStore('x', require('./pg-shim.js')), 'postgres');
})().catch(e => { console.error(e); process.exit(1); });

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
  await store.recordHand(b.id, 0, false, 0); await store.rebuy(b.id, 10000);
  u = await store.userById(b.id); assert.deepEqual([u.chips, u.rebuys], [10000, 1]);
  const rk = await store.ranking(10);
  assert.deepEqual(rk.map(r => [r.username, r.profit]), [['donghun', 2000], ['minsu', -10000]]);
  await store.setBanned(b.id, true); assert.equal((await store.userById(b.id)).banned, true);
  assert.equal((await store.ranking(10)).length, 1);
  await store.setChips(a.id, 777); assert.equal((await store.userById(a.id)).chips, 777);
  await store.setNick(a.id, '새닉'); assert.equal((await store.userById(a.id)).nick, '새닉');
  assert.equal((await store.listUsers('MIN')).length, 1, 'search case-insensitive');
  assert.equal((await store.listUsers()).length, 2);
  await store.deleteUserSessions(a.id); assert.equal(await store.sessionUser('tokA'), null);
  await store.purgeSessions();
  console.log(label, 'ok');
}
(async () => {
  await run(new MemStore(), 'memory');
  if (process.env.PSQL_ARGS) await run(new PgStore('x', require('./pg-shim.js')), 'postgres');
})().catch(e => { console.error(e); process.exit(1); });

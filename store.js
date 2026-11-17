// 저장소: DATABASE_URL이 있으면 Postgres(Neon), 없으면 메모리(로컬 개발용, 재시작 시 초기화)
'use strict';

const START_CHIPS = 10000;

function mapReq(r) {
  if (!r) return null;
  return {
    id: Number(r.id), userId: Number(r.user_id), amount: Number(r.amount), note: r.note || '', status: r.status,
    createdAt: Number(r.created_at), decidedAt: r.decided_at == null ? null : Number(r.decided_at), decidedBy: r.decided_by || null,
    granted: r.granted == null ? null : Number(r.granted), username: r.username, nick: r.nick,
    userChips: r.user_chips == null ? undefined : Number(r.user_chips),
  };
}
function mapUser(r) {
  if (!r) return null;
  const b = v => v === true || v === 't' || v === 'true' || v === 1;
  return {
    id: Number(r.id), username: r.username, nick: r.nick, pwHash: r.pw_hash, salt: r.salt,
    chips: Number(r.chips), hands: Number(r.hands), wins: Number(r.wins), best: Number(r.best),
    rebuys: Number(r.rebuys), bought: Number(r.bought || 0), banned: b(r.banned), createdAt: Number(r.created_at), lastSeen: Number(r.last_seen),
  };
}

// ───────── Postgres ─────────
class PgStore {
  constructor(url, pgModule) {
    const pg = pgModule || require('pg');
    this.pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30000 });
    // Neon은 쉬는 동안 연결을 끊는다. 처리 안 하면 프로세스가 죽는다.
    this.pool.on('error', e => console.error('[db] idle client error:', e.message));
    this.kind = 'postgres';
  }
  q(text, params) { return this.pool.query(text, params || []); }
  async init() {
    await this.q(`CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      username   TEXT NOT NULL UNIQUE,
      nick       TEXT NOT NULL,
      pw_hash    TEXT NOT NULL,
      salt       TEXT NOT NULL,
      chips      BIGINT NOT NULL DEFAULT ${START_CHIPS},
      hands      INTEGER NOT NULL DEFAULT 0,
      wins       INTEGER NOT NULL DEFAULT 0,
      best       BIGINT NOT NULL DEFAULT 0,
      rebuys     INTEGER NOT NULL DEFAULT 0,
      banned     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL,
      last_seen  BIGINT NOT NULL DEFAULT 0
    )`);
    await this.q(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    )`);
    await this.q(`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`);
    await this.q(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await this.q(`CREATE TABLE IF NOT EXISTS rake_log (
      id      SERIAL PRIMARY KEY,
      at      BIGINT NOT NULL,
      room    TEXT NOT NULL,
      hand    INTEGER NOT NULL,
      pot     BIGINT NOT NULL,
      rake    BIGINT NOT NULL,
      winners TEXT NOT NULL DEFAULT ''
    )`);
    await this.q(`CREATE INDEX IF NOT EXISTS rake_log_at_idx ON rake_log(at)`);
    // 충전 요청
    await this.q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bought BIGINT NOT NULL DEFAULT 0`);
    await this.q(`UPDATE users SET bought = rebuys * ${START_CHIPS} WHERE bought = 0 AND rebuys > 0`); // 예전 자동 충전분 이전
    await this.q(`CREATE TABLE IF NOT EXISTS chip_requests (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount     BIGINT NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      decided_at BIGINT,
      decided_by TEXT,
      granted    BIGINT
    )`);
    await this.q(`CREATE UNIQUE INDEX IF NOT EXISTS chip_requests_one_pending ON chip_requests(user_id) WHERE status = 'pending'`);
    await this.q(`CREATE INDEX IF NOT EXISTS chip_requests_status_idx ON chip_requests(status, id)`);
  }
  // 요청 만들기. 이미 대기 중인 요청이 있으면 null
  async createChipRequest(userId, amount, note) {
    try {
      const r = await this.q(`INSERT INTO chip_requests (user_id, amount, note, created_at) VALUES ($1, $2, $3, $4) RETURNING *`, [userId, amount, note || '', Date.now()]);
      return mapReq(r.rows[0]);
    } catch (e) { if (e.code === '23505') return null; throw e; }
  }
  async pendingRequests() {
    const r = await this.q(`SELECT c.*, u.username, u.nick, u.chips AS user_chips FROM chip_requests c JOIN users u ON u.id = c.user_id WHERE c.status = 'pending' ORDER BY c.id`);
    return r.rows.map(mapReq);
  }
  async recentRequests(limit) {
    const r = await this.q(`SELECT c.*, u.username, u.nick FROM chip_requests c JOIN users u ON u.id = c.user_id WHERE c.status <> 'pending' ORDER BY c.decided_at DESC NULLS LAST, c.id DESC LIMIT $1`, [limit]);
    return r.rows.map(mapReq);
  }
  // 대기 중인 요청만 처리됨 (두 번 승인 방지). 처리된 요청을 돌려주고, 이미 처리됐으면 null
  async decideChipRequest(id, status, granted, by) {
    const r = await this.q(`UPDATE chip_requests SET status = $2, granted = $3, decided_at = $4, decided_by = $5 WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, status, granted, Date.now(), by]);
    return mapReq(r.rows[0]);
  }
  async cancelChipRequest(userId) {
    const r = await this.q(`UPDATE chip_requests SET status = 'canceled', decided_at = $2, decided_by = 'self' WHERE user_id = $1 AND status = 'pending' RETURNING *`, [userId, Date.now()]);
    return mapReq(r.rows[0]);
  }
  // 승인된 충전: chips가 숫자면 그 값으로, null이면 기존 칩에 더함
  async grantChips(userId, amount, chips) {
    if (chips == null) await this.q(`UPDATE users SET chips = chips + $2, rebuys = rebuys + 1, bought = bought + $2 WHERE id = $1`, [userId, amount]);
    else await this.q(`UPDATE users SET chips = $3, rebuys = rebuys + 1, bought = bought + $2 WHERE id = $1`, [userId, amount, chips]);
  }
  async getSetting(key) { const r = await this.q(`SELECT value FROM settings WHERE key = $1`, [key]); return r.rows[0] ? r.rows[0].value : null; }
  async setSetting(key, value) {
    await this.q(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, value]);
  }
  async logRake(e) {
    await this.q(`INSERT INTO rake_log (at, room, hand, pot, rake, winners) VALUES ($1, $2, $3, $4, $5, $6)`, [e.at, e.room, e.hand, e.pot, e.rake, e.winners]);
  }
  // since: { today, week } 기준 시각(ms)
  async rakeStats(since) {
    const r = await this.q(`SELECT COALESCE(SUM(rake), 0) AS total, COUNT(*) AS n,
        COALESCE(SUM(CASE WHEN at >= $1 THEN rake ELSE 0 END), 0) AS today,
        COALESCE(SUM(CASE WHEN at >= $1 THEN 1 ELSE 0 END), 0) AS today_n,
        COALESCE(SUM(CASE WHEN at >= $2 THEN rake ELSE 0 END), 0) AS week
      FROM rake_log`, [since.today, since.week]);
    const x = r.rows[0];
    return { total: Number(x.total), n: Number(x.n), today: Number(x.today), todayN: Number(x.today_n), week: Number(x.week) };
  }
  async recentRake(limit) {
    const r = await this.q(`SELECT * FROM rake_log ORDER BY id DESC LIMIT $1`, [limit]);
    return r.rows.map(x => ({ at: Number(x.at), room: x.room, hand: Number(x.hand), pot: Number(x.pot), rake: Number(x.rake), winners: x.winners }));
  }
  async createUser({ username, nick, pwHash, salt }) {
    try {
      const r = await this.q(
        `INSERT INTO users (username, nick, pw_hash, salt, created_at, last_seen) VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
        [username, nick, pwHash, salt, Date.now()]);
      return mapUser(r.rows[0]);
    } catch (e) {
      if (e.code === '23505') return null; // 아이디 중복
      throw e;
    }
  }
  async userByName(username) { return mapUser((await this.q(`SELECT * FROM users WHERE username = $1`, [username])).rows[0]); }
  async userById(id) { return mapUser((await this.q(`SELECT * FROM users WHERE id = $1`, [id])).rows[0]); }
  async createSession(tokenHash, userId, expiresAt) {
    await this.q(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, [tokenHash, userId, expiresAt]);
  }
  async sessionUser(tokenHash) {
    const r = await this.q(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2`,
      [tokenHash, Date.now()]);
    return mapUser(r.rows[0]);
  }
  async deleteSession(tokenHash) { await this.q(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]); }
  async deleteUserSessions(userId) { await this.q(`DELETE FROM sessions WHERE user_id = $1`, [userId]); }
  async purgeSessions() { await this.q(`DELETE FROM sessions WHERE expires_at < $1`, [Date.now()]); }
  // 판이 끝났을 때: 칩 저장 + 전적 누적
  async recordHand(userId, chips, won, gain) {
    await this.q(
      `UPDATE users SET chips = $2, hands = hands + 1, wins = wins + $3, best = GREATEST(best, $4), last_seen = $5 WHERE id = $1`,
      [userId, chips, won ? 1 : 0, gain, Date.now()]);
  }
  async setChips(userId, chips) { await this.q(`UPDATE users SET chips = $2, last_seen = $3 WHERE id = $1`, [userId, chips, Date.now()]); }
  async setBanned(userId, banned) { await this.q(`UPDATE users SET banned = $2 WHERE id = $1`, [userId, !!banned]); }
  async setNick(userId, nick) { await this.q(`UPDATE users SET nick = $2 WHERE id = $1`, [userId, nick]); }
  async touch(userId) { await this.q(`UPDATE users SET last_seen = $2 WHERE id = $1`, [userId, Date.now()]); }
  async listUsers(search) {
    const r = search
      ? await this.q(`SELECT * FROM users WHERE username ILIKE $1 OR nick ILIKE $1 ORDER BY last_seen DESC LIMIT 200`, ['%' + search + '%'])
      : await this.q(`SELECT * FROM users ORDER BY last_seen DESC LIMIT 200`);
    return r.rows.map(mapUser);
  }
}

// ───────── 메모리 (DB 없이 로컬 실행할 때) ─────────
class MemStore {
  constructor() { this.users = new Map(); this.sessions = new Map(); this.seq = 0; this.kind = 'memory'; this.settings = new Map(); this.rakes = []; this.reqs = []; this.reqSeq = 0; }
  async init() {}
  async getSetting(k) { return this.settings.has(k) ? this.settings.get(k) : null; }
  async setSetting(k, v) { this.settings.set(k, String(v)); }
  async logRake(e) { this.rakes.push(Object.assign({}, e)); if (this.rakes.length > 5000) this.rakes.shift(); }
  async rakeStats(since) {
    const sum = f => this.rakes.filter(f).reduce((a, e) => a + e.rake, 0);
    return { total: sum(() => true), n: this.rakes.length, today: sum(e => e.at >= since.today), todayN: this.rakes.filter(e => e.at >= since.today).length, week: sum(e => e.at >= since.week) };
  }
  async recentRake(limit) { return this.rakes.slice(-limit).reverse().map(e => Object.assign({}, e)); }
  async createUser({ username, nick, pwHash, salt }) {
    if ([...this.users.values()].some(u => u.username === username)) return null;
    const now = Date.now();
    const u = { id: ++this.seq, username, nick, pwHash, salt, chips: START_CHIPS, hands: 0, wins: 0, best: 0, rebuys: 0, bought: 0, banned: false, createdAt: now, lastSeen: now };
    this.users.set(u.id, u); return { ...u };
  }
  async userByName(n) { const u = [...this.users.values()].find(x => x.username === n); return u ? { ...u } : null; }
  async userById(id) { const u = this.users.get(Number(id)); return u ? { ...u } : null; }
  async createSession(h, userId, exp) { this.sessions.set(h, { userId, exp }); }
  async sessionUser(h) { const s = this.sessions.get(h); if (!s || s.exp <= Date.now()) return null; return this.userById(s.userId); }
  async deleteSession(h) { this.sessions.delete(h); }
  async deleteUserSessions(id) { for (const [h, s] of this.sessions) if (s.userId === id) this.sessions.delete(h); }
  async purgeSessions() { const now = Date.now(); for (const [h, s] of this.sessions) if (s.exp < now) this.sessions.delete(h); }
  async recordHand(id, chips, won, gain) { const u = this.users.get(id); if (!u) return; u.chips = chips; u.hands++; if (won) u.wins++; u.best = Math.max(u.best, gain); u.lastSeen = Date.now(); }
  async setChips(id, chips) { const u = this.users.get(id); if (u) { u.chips = chips; u.lastSeen = Date.now(); } }
  async createChipRequest(userId, amount, note) {
    if (this.reqs.some(r => r.userId === userId && r.status === 'pending')) return null;
    const r = { id: ++this.reqSeq, userId, amount, note: note || '', status: 'pending', createdAt: Date.now(), decidedAt: null, decidedBy: null, granted: null };
    this.reqs.push(r); return this.withUser(r);
  }
  withUser(r, chips) { const u = this.users.get(r.userId) || {}; return Object.assign({}, r, { username: u.username, nick: u.nick }, chips ? { userChips: u.chips } : {}); }
  async pendingRequests() { return this.reqs.filter(r => r.status === 'pending').map(r => this.withUser(r, true)); }
  async recentRequests(limit) { return this.reqs.filter(r => r.status !== 'pending').sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0) || b.id - a.id).slice(0, limit).map(r => this.withUser(r)); }
  async decideChipRequest(id, status, granted, by) {
    const r = this.reqs.find(x => x.id === Number(id) && x.status === 'pending'); if (!r) return null;
    Object.assign(r, { status, granted, decidedAt: Date.now(), decidedBy: by }); return this.withUser(r);
  }
  async cancelChipRequest(userId) {
    const r = this.reqs.find(x => x.userId === userId && x.status === 'pending'); if (!r) return null;
    Object.assign(r, { status: 'canceled', decidedAt: Date.now(), decidedBy: 'self' }); return this.withUser(r);
  }
  async grantChips(id, amount, chips) { const u = this.users.get(id); if (!u) return; u.chips = chips == null ? u.chips + amount : chips; u.rebuys++; u.bought += amount; }
  async setBanned(id, b) { const u = this.users.get(id); if (u) u.banned = !!b; }
  async setNick(id, nick) { const u = this.users.get(id); if (u) u.nick = nick; }
  async touch(id) { const u = this.users.get(id); if (u) u.lastSeen = Date.now(); }
  async listUsers(search) {
    const s = (search || '').toLowerCase();
    return [...this.users.values()].filter(u => !s || u.username.includes(s) || u.nick.toLowerCase().includes(s))
      .sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 200).map(u => ({ ...u }));
  }
}

function createStore() {
  const url = process.env.DATABASE_URL;
  if (url) return new PgStore(url, process.env.PG_MODULE ? require(process.env.PG_MODULE) : undefined); // PG_MODULE: 테스트용
  console.warn('[db] DATABASE_URL이 없어 메모리 저장소를 씁니다. 서버를 끄면 계정이 사라져요.');
  return new MemStore();
}

module.exports = { createStore, PgStore, MemStore, START_CHIPS };

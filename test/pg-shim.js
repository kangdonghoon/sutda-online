// 테스트 전용: 'pg' 패키지 대신 psql CLI로 실제 Postgres에 쿼리를 보낸다.
// 사용: PSQL_ARGS="-h /tmp -p 5433 -U postgres -d sutda_test"
'use strict';
const { execFile } = require('child_process');

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false, i = 0, quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') { q = true; quoted = true; }
    else if (c === ',') { row.push(quoted || cur !== '' ? cur : null); cur = ''; quoted = false; }
    else if (c === '\n') { row.push(quoted || cur !== '' ? cur : null); rows.push(row); row = []; cur = ''; quoted = false; }
    else cur += c;
    i++;
  }
  if (cur !== '' || row.length) { row.push(quoted || cur !== '' ? cur : null); rows.push(row); }
  return rows;
}
class Pool {
  constructor() { this.args = (process.env.PSQL_ARGS || '').split(' ').filter(Boolean); this.queries = 0; }
  on() {}
  query(text, params) {
    this.queries++;
    const sql = text.replace(/\$(\d+)/g, (_, n) => lit((params || [])[Number(n) - 1]));
    return new Promise((resolve, reject) => {
      execFile('psql', [...this.args, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--csv', '-c', sql], (err, stdout, stderr) => {
        if (err) {
          const e = new Error(stderr || err.message);
          if (/duplicate key/.test(stderr)) e.code = '23505';
          return reject(e);
        }
        const rows = parseCsv(stdout);
        if (!rows.length) return resolve({ rows: [], rowCount: 0 });
        const [head, ...data] = rows;
        resolve({
          rows: data.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === 't' ? true : r[i] === 'f' ? false : r[i]]))),
          rowCount: data.length,
        });
      });
    });
  }
}
module.exports = { Pool };

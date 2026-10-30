import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function authDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../../cloudflare/migrations/0007_auth.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../cloudflare/migrations/0008_required_password_change.sql', import.meta.url), 'utf8'));
  const db = { sqlite, prepare(sql) {
    let values = [];
    return { bind(...input) { values = input; return this; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async run() { return sqlite.prepare(sql).run(...values); },
    };
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return db;
}

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { hashPassword, normalizeUsername, validUsername } from '../cloudflare/auth/password.js';
import { parseWranglerD1Results, accountExistsFromD1Results } from './lib/wrangler-json.js';

const require = createRequire(import.meta.url);
const wranglerBin = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const [action, rawUsername, ...flags] = process.argv.slice(2);
const username = normalizeUsername(rawUsername);
const roleAt = flags.indexOf('--role');
const role = roleAt >= 0 ? flags[roleAt + 1] : 'user';
const temporary = flags.includes('--temporary');
const allowed = ['create', 'reset-password', 'set-role', 'disable', 'enable', 'revoke-sessions'];
if (!allowed.includes(action) || !validUsername(username) || !['user', 'admin'].includes(role)
    || (temporary && !['create', 'reset-password'].includes(action))
    || flags.filter(flag => ['--local', '--remote'].includes(flag)).length !== 1) {
  console.error('用法：node scripts/manage-user.mjs <create|reset-password|set-role|disable|enable|revoke-sessions> <帳號> [--role user|admin] [--temporary（限 create/reset-password）] <--local|--remote>');
  process.exit(1);
}
async function passwordInput() {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    return input.replace(/\r?\n$/, '');
  }
  process.stdout.write('密碼（12～128 字元，輸入不顯示）：');
  process.stdin.setRawMode(true); process.stdin.setEncoding('utf8'); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let password = '';
    const done = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\u0003') { done(); reject(new Error('已取消')); return; }
        if (char === '\r' || char === '\n') { done(); resolve(password); return; }
        if (char === '\u007f' || char === '\b') password = password.slice(0, -1);
        else password += char;
      }
    };
    process.stdin.on('data', onData);
  });
}
let directory;
try {
  directory = await mkdtemp(join(tmpdir(), 'stock-account-'));
  const file = join(directory, 'account.sql');
  const execute = async (sql, { readRows = false } = {}) => {
    if (!readRows) await writeFile(file, sql, { mode: 0o600 });
    // --command returns SELECT rows; remote --file returns import metadata.
    // Password hashes remain in temporary SQL files, never command arguments.
    const input = readRows ? ['--command', sql] : ['--file', file];
    const result = spawnSync(process.execPath, [wranglerBin, 'd1', 'execute', 'stockapps-t86', flags.includes('--remote') ? '--remote' : '--local', ...input, '--yes', '--json'], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
    if (result.error || result.status !== 0) throw new Error('帳號設定失敗，請確認已套用資料庫 migration');
    return parseWranglerD1Results(result.stdout);
  };
  const found = await execute(`SELECT id FROM app_users WHERE username = '${username}';`, { readRows: true });
  const exists = accountExistsFromD1Results(found);
  if (action === 'create' && exists) throw new Error('帳號已存在，請使用 reset-password 或 set-role');
  if (action !== 'create' && !exists) throw new Error('找不到此帳號，未進行任何更新');
  let sql;
  if (action === 'create' || action === 'reset-password') {
    const hash = await hashPassword(await passwordInput());
    sql = action === 'create'
      ? `INSERT INTO app_users(id, username, password_hash, role, created_at, must_change_password) VALUES ('${crypto.randomUUID()}', '${username}', '${hash}', '${role}', ${Date.now()}, ${Number(temporary)});`
      : `UPDATE app_users SET password_hash = '${hash}', must_change_password = ${Number(temporary)} WHERE username = '${username}';`;
  } else if (action === 'set-role') sql = `UPDATE app_users SET role = '${role}' WHERE username = '${username}';`;
  else if (action === 'disable' || action === 'enable') sql = `UPDATE app_users SET disabled = ${action === 'disable' ? 1 : 0} WHERE username = '${username}';`;
  else sql = '';
  sql += `\nDELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM app_users WHERE username = '${username}');`;
  await execute(sql);
  console.log('帳號設定完成，既有登入已撤銷。');
  if (temporary) console.log('此為臨時密碼；登入後必須先建立新密碼，才能使用管理功能。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (directory) await rm(directory, { recursive: true, force: true }); }

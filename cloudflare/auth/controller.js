import { hashPassword, normalizeUsername, validUsername, verifyPassword, sha256, randomToken } from './password.js';
import { currentUser, sessionToken, sessionCookie, SESSION_SECONDS, sameOrigin, authReply } from './session.js';
let dummyHash;
async function readBody(request) {
  let length = 0, chunks = [];
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid login');
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 2048) { await reader.cancel(); throw new Error('Invalid login'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function readLogin(request) {
  const body = await readBody(request);
  const username = normalizeUsername(body?.username), password = body?.password;
  if (!validUsername(username) || typeof password !== 'string' || password.length < 1 || password.length > 128) throw new Error('Invalid login');
  return { username, password };
}
async function attempt(db, key, now, max) {
  const row = await db.prepare(`INSERT INTO auth_attempts(key, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN auth_attempts.expires_at <= ? THEN 1 ELSE auth_attempts.count + 1 END,
    expires_at = CASE WHEN auth_attempts.expires_at <= ? THEN excluded.expires_at ELSE auth_attempts.expires_at END
    RETURNING count`).bind(key, now + 15 * 60_000, now, now).first();
  return row.count <= max;
}
async function changePassword(request, env, time) {
  const user = await currentUser(request, env, time);
  if (!user) return authReply({ error: '請先登入' }, 401);
  if (!user.mustChangePassword) return authReply({ error: '此帳號不需更改初始密碼' }, 403);
  let input;
  try { input = await readBody(request); } catch { return authReply({ error: '請輸入有效的新密碼' }, 400); }
  if (typeof input?.password !== 'string' || input.password.length < 12 || input.password.length > 128)
    return authReply({ error: '密碼必須為 12～128 字元' }, 400);
  if (input.password !== input.confirmPassword) return authReply({ error: '兩次輸入的密碼不一致' }, 400);
  const db = env.T86_DB;
  const account = await db.prepare('SELECT password_hash FROM app_users WHERE id = ? AND disabled = 0 AND must_change_password = 1').bind(user.id).first();
  if (!account) return authReply({ error: '登入狀態已變更，請重新登入' }, 409);
  if (await verifyPassword(input.password, account.password_hash)) return authReply({ error: '新密碼不可與初始密碼相同' }, 400);
  const passwordHash = await hashPassword(input.password), token = randomToken();
  const oldTokenHash = await sha256(sessionToken(request)), tokenHash = await sha256(token);
  // Only the request that replaces the original hash may revoke sessions or issue a new one.
  // The original session must still be valid when the atomic batch commits.
  await db.batch([
    db.prepare(`UPDATE app_users SET password_hash = ?, must_change_password = 0
      WHERE id = ? AND password_hash = ? AND must_change_password = 1 AND disabled = 0
      AND EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash = ? AND user_id = app_users.id AND expires_at > ?)`)
      .bind(passwordHash, user.id, account.password_hash, oldTokenHash, time),
    db.prepare(`DELETE FROM auth_sessions WHERE user_id = ? AND EXISTS
      (SELECT 1 FROM app_users WHERE id = ? AND password_hash = ? AND must_change_password = 0 AND disabled = 0)`)
      .bind(user.id, user.id, passwordHash),
    db.prepare(`INSERT INTO auth_sessions(token_hash, user_id, expires_at)
      SELECT ?, id, ? FROM app_users WHERE id = ? AND password_hash = ? AND must_change_password = 0 AND disabled = 0`)
      .bind(tokenHash, time + SESSION_SECONDS * 1000, user.id, passwordHash),
  ]);
  const authenticated = await currentUser(new Request(request.url, { headers: { Cookie: sessionCookie(token) } }), env, time);
  if (!authenticated) return authReply({ error: '登入狀態已變更，請重新登入' }, 409);
  return authReply({ user: authenticated }, 200, { 'Set-Cookie': sessionCookie(token) });
}
export async function authController(request, env, action, { now = Date.now } = {}) {
  if (!sameOrigin(request)) return authReply({ error: '請從本站登入' }, 403);
  const method = action === 'me' ? 'GET' : 'POST';
  if (request.method !== method) return authReply({ error: 'Method not allowed' }, 405, { Allow: method });
  try {
    if (action === 'me') return authReply({ user: await currentUser(request, env, now()) });
    if (!env.T86_DB) return authReply({ error: '帳號服務暫時無法使用' }, 503);
    if (action === 'change-password') return await changePassword(request, env, now());
    if (action === 'logout') {
      const token = sessionToken(request);
      if (token) await env.T86_DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
      return authReply({ loggedOut: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
    }
    let input;
    try { input = await readLogin(request); } catch { return authReply({ error: '請輸入有效的帳號與密碼' }, 400); }
    const db = env.T86_DB, time = now();
    const ipKey = await sha256(`ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`);
    const userKey = await sha256(`user:${input.username}`);
    await db.prepare('DELETE FROM auth_attempts WHERE expires_at <= ?').bind(time).run();
    const ipAllowed = await attempt(db, ipKey, time, 30);
    if (!ipAllowed) return authReply({ error: '嘗試次數過多，請於 15 分鐘後再試' }, 429, { 'Retry-After': '900' });
    const accountAllowed = await attempt(db, userKey, time, 5);
    if (!accountAllowed) return authReply({ error: '嘗試次數過多，請於 15 分鐘後再試' }, 429, { 'Retry-After': '900' });
    const user = await db.prepare('SELECT * FROM app_users WHERE username = ?').bind(input.username).first();
    dummyHash ??= hashPassword(randomToken());
    const verified = await verifyPassword(input.password, user?.password_hash || await dummyHash);
    if (!verified || !user || user.disabled) return authReply({ error: '帳號或密碼錯誤' }, 401);
    const token = randomToken(), tokenHash = await sha256(token);
    await db.batch([
      db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(time),
      db.prepare('DELETE FROM auth_attempts WHERE expires_at <= ? OR key = ?').bind(time, userKey),
      db.prepare(`INSERT INTO auth_sessions(token_hash, user_id, expires_at)
        SELECT ?, id, ? FROM app_users WHERE id = ? AND password_hash = ? AND disabled = 0`)
        .bind(tokenHash, time + SESSION_SECONDS * 1000, user.id, user.password_hash),
    ]);
    const authenticated = await currentUser(new Request(request.url, { headers: { Cookie: sessionCookie(token) } }), env, time);
    if (!authenticated) return authReply({ error: '帳號或密碼錯誤' }, 401);
    return authReply({ user: authenticated }, 200, { 'Set-Cookie': sessionCookie(token) });
  } catch { return authReply({ error: '帳號服務暫時無法使用' }, 503); }
}

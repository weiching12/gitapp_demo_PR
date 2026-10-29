import { sha256 } from './password.js';
export const SESSION_COOKIE = '__Host-stock_session';
export const SESSION_SECONDS = 12 * 60 * 60;
export function sessionCookie(token, seconds = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
}
export function sessionToken(request) {
  const cookies = (request.headers.get('Cookie') || '').split(';').map(part => part.trim());
  const token = cookies.find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
}
export async function currentUser(request, env, now = Date.now()) {
  const token = sessionToken(request);
  if (!token) return null;
  if (!env.T86_DB) throw new Error('Account database unavailable');
  return env.T86_DB.prepare(`SELECT u.id, u.username, u.role FROM auth_sessions s
    JOIN app_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`)
    .bind(await sha256(token), now).first();
}
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return (!origin || origin === new URL(request.url).origin) && !['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site'));
}
export const authReply = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});

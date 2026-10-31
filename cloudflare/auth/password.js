const ITERATIONS = 100000; // Web Crypto PBKDF2 limit supported by Workers.
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function sha256(value) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)));
}
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('密碼必須為 12～128 字元');
  const salt = randomToken();
  return `pbkdf2-sha256$${ITERATIONS}$${salt}$${await derive(password, salt)}`;
}
export async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored).split('$');
  if (scheme !== 'pbkdf2-sha256' || iterations !== String(ITERATIONS) || !/^[a-f0-9]{64}$/.test(salt || '') || !/^[a-f0-9]{64}$/.test(hash || '')) return false;
  const actual = await derive(password, salt);
  let mismatch = 0;
  for (let i = 0; i < hash.length; i++) mismatch |= actual.charCodeAt(i) ^ hash.charCodeAt(i);
  return mismatch === 0;
}
export const normalizeUsername = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const validUsername = value => /^[a-z0-9][a-z0-9_.@-]{2,63}$/.test(value);

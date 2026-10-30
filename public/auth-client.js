export const accountDestination = user => user.mustChangePassword ? '/change-password.html' : user.role === 'admin' ? '/admin-visitors.html' : '/';

export async function authRequest(action, body) {
  let response;
  try {
    response = await fetch(`/api/v1/auth/${action}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw new Error('無法連線至登入服務，請稍後再試。'); }
  let data;
  try { data = await response.json(); } catch { /* Empty or non-JSON gateway responses need a useful message. */ }
  if (!response.ok) {
    const fallback = response.status >= 500 ? '登入服務暫時無法使用，請稍後再試。'
      : response.status === 429 ? '嘗試次數過多，請稍後再試。' : '操作未完成，請稍後再試。';
    throw new Error(typeof data?.error === 'string' && data.error.length <= 160 ? data.error : fallback);
  }
  if (!data || !Object.hasOwn(data, 'user') || (data.user !== null &&
      (typeof data.user.username !== 'string' || !['user', 'admin'].includes(data.user.role))))
    throw new Error('登入服務回應異常，請稍後再試。');
  return data;
}

export function notifyAccountChanged() {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('stock-insight-auth');
  channel.postMessage('changed'); channel.close();
}

const form = document.getElementById('login-form'), status = document.getElementById('status');
const destination = user => user.role === 'admin' ? '/admin-visitors.html' : '/';
async function existingSession() {
  try {
    const response = await fetch('/api/v1/auth/me', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(8000) });
    const { user } = response.ok ? await response.json() : {};
    if (user) location.replace(destination(user));
  } catch { /* Login remains available when the session check fails. */ }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('submit'); button.disabled = true; status.textContent = '登入中…';
  try {
    const response = await fetch('/api/v1/auth/login', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: form.username.value, password: form.password.value }),
      signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    form.password.value = '';
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '登入失敗，請稍後重試');
    const channel = new BroadcastChannel('stock-insight-auth'); channel.postMessage('changed'); channel.close();
    location.replace(destination(data.user));
  } catch (error) { status.textContent = error.message || '無法連線，請稍後重試'; }
  finally { form.password.value = ''; button.disabled = false; }
});
void existingSession();

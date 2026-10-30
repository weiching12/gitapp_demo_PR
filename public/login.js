import { accountDestination, authRequest, notifyAccountChanged } from './auth-client.js';
const form = document.getElementById('login-form'), status = document.getElementById('status');
async function existingSession() {
  try {
    const { user } = await authRequest('me');
    if (user) location.replace(accountDestination(user));
  } catch { /* Login remains available when the session check fails. */ }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('submit'); button.disabled = true; status.dataset.state = 'pending'; status.textContent = '登入中…';
  try {
    const { user } = await authRequest('login', { username: form.username.value, password: form.password.value });
    if (!user) throw new Error('登入服務回應異常，請稍後再試。');
    notifyAccountChanged();
    location.replace(accountDestination(user));
  } catch (error) { status.dataset.state = 'error'; status.textContent = error.message || '無法連線，請稍後再試。'; }
  finally { form.password.value = ''; button.disabled = false; }
});
void existingSession();

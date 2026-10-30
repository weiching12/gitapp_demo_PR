import { accountDestination, authRequest, notifyAccountChanged } from './auth-client.js';
const form = document.getElementById('change-password-form'), status = document.getElementById('status');
const password = form.elements.password, confirmation = form.elements.confirmPassword, button = document.getElementById('submit');
let ready = false;
async function checkSession() {
  try {
    const { user } = await authRequest('me');
    if (!user) { location.replace('/login.html'); return; }
    if (!user.mustChangePassword) { location.replace(accountDestination(user)); return; }
    ready = true; password.disabled = false; confirmation.disabled = false; button.disabled = false; status.textContent = '';
  } catch (error) { status.dataset.state = 'error'; status.textContent = error.message; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!ready) return;
  status.dataset.state = 'error';
  if (password.value !== confirmation.value) { status.textContent = '兩次輸入的密碼不一致，請重新確認。'; confirmation.focus(); return; }
  button.disabled = true; status.dataset.state = 'pending'; status.textContent = '正在儲存新密碼…';
  try {
    const { user } = await authRequest('change-password', { password: password.value, confirmPassword: confirmation.value });
    if (!user || user.mustChangePassword) throw new Error('新密碼未完成儲存，請稍後再試。');
    notifyAccountChanged(); location.replace(accountDestination(user));
  } catch (error) { status.dataset.state = 'error'; status.textContent = error.message; }
  finally { password.value = ''; confirmation.value = ''; button.disabled = false; }
});
void checkSession();

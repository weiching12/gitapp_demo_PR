export async function startAccountMenu(node) {
  if (!node) return;
  const render = async () => {
    try {
      const response = await fetch('/api/v1/auth/me', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) return;
      const { user } = await response.json();
      if (!node.isConnected) return;
      node.replaceChildren();
      if (!user) { const link = document.createElement('a'); link.href = '/login.html'; link.textContent = '登入'; node.append(link); return; }
      const label = document.createElement('span'); label.textContent = user.username; label.title = user.username; node.append(label);
      if (user.mustChangePassword) { const link = document.createElement('a'); link.href = '/change-password.html'; link.textContent = '設定新密碼'; node.append(link); }
      else if (user.role === 'admin') { const link = document.createElement('a'); link.href = '/admin-visitors.html'; link.textContent = '訪客統計'; node.append(link); }
      const logout = document.createElement('button'); logout.type = 'button'; logout.textContent = '登出';
      logout.onclick = async () => {
        logout.disabled = true;
        try {
          const response = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
          if (!response.ok) throw new Error();
          const channel = new BroadcastChannel('stock-insight-auth'); channel.postMessage('changed'); channel.close();
          await render();
        } catch { logout.textContent = '登出失敗，重試'; logout.disabled = false; }
      };
      node.append(logout);
    } catch { /* Public browsing remains available when account services are offline. */ }
  };
  const channel = new BroadcastChannel('stock-insight-auth');
  channel.onmessage = () => { if (node.isConnected) void render(); else channel.close(); };
  await render();
}

import { PresenceApiClient } from "./api/presence-client.js";

const STORAGE_KEY = "stock-insight-browser-id";

export function startPresence(node, { demo = false } = {}) {
  if (!node) return;
  if (demo) { node.textContent = "在線人數 · 示範模式"; return; }
  let id = crypto.randomUUID();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(stored ?? "")) id = stored;
    else localStorage.setItem(STORAGE_KEY, id);
  } catch { /* Storage-disabled browsers use a page-local random identifier. */ }
  let active = false, stopped = false;
  const client = new PresenceApiClient();
  const update = async () => {
    if (stopped || active || document.visibilityState === "hidden") return;
    active = true;
    try {
      const { online } = await client.heartbeat(id, { signal: AbortSignal.timeout(8000) });
      if (!Number.isSafeInteger(online) || online < 1) throw new Error("Invalid online count");
      if (!stopped) { node.textContent = `在線 ${online.toLocaleString("zh-TW")} 人`; node.dataset.state = "ready"; }
    } catch {
      if (!stopped) { node.textContent = "在線人數暫無法取得"; node.dataset.state = "error"; }
    } finally { active = false; }
  };
  const timer = setInterval(update, 30_000);
  const resume = () => { if (document.visibilityState === "visible") update(); };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("pageshow", resume);
  update();
  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("pageshow", resume);
  };
}

import { PresenceApiClient } from "./api/presence-client.js";

const STORAGE_KEY = "stock-insight-browser-id";

export function startPresence(node, { demo = false, client = new PresenceApiClient(), now = Date.now } = {}) {
  if (!node) return;
  if (demo) { node.textContent = "今日造訪人數 · 示範模式"; return; }
  let id = crypto.randomUUID();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(stored ?? "")) id = stored;
    else localStorage.setItem(STORAGE_KEY, id);
  } catch { /* Storage-disabled browsers use a page-local random identifier. */ }
  let stopped = false;
  let lastCheckedAt = 0, recordedDay, pending;
  const update = async (record = false, force = false) => {
    if (stopped) return;
    if (pending) return pending;
    const day = new Date(now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    record = record || recordedDay !== day;
    if (!record && !force && now() - lastCheckedAt < 60_000) return;
    pending = (async () => { try {
      const { today } = await (record
        ? client.recordVisit(id, { signal: AbortSignal.timeout(8000) })
        : client.count({ signal: AbortSignal.timeout(8000) }));
      if (!Number.isSafeInteger(today) || today < 1) throw new Error("Invalid daily visitor count");
      if (!stopped) {
        node.textContent = `今日造訪人數 ${today.toLocaleString("zh-TW")} 人`;
        node.dataset.state = "ready";
        lastCheckedAt = now();
        if (record) recordedDay = day;
      }
    } catch {
      if (!stopped) { node.textContent = "今日造訪人數暫無法取得"; node.dataset.state = "error"; }
    } finally { pending = null; } })();
    return pending;
  };
  void update(true);
  return { refresh: (force = false) => update(false, force), stop: () => { stopped = true; } };
}

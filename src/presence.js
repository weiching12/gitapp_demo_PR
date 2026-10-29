import { PresenceApiClient } from "./api/presence-client.js";

const STORAGE_KEY = "stock-insight-browser-id";

export function startPresence(node, { demo = false, client = new PresenceApiClient(), now = Date.now } = {}) {
  if (!node) return;
  node.hidden = true;
  if (demo) { node.textContent = "今日造訪人數 · 示範模式"; return; }
  let id = crypto.randomUUID();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(stored ?? "")) id = stored;
    else localStorage.setItem(STORAGE_KEY, id);
  } catch { /* Storage-disabled browsers use a page-local random identifier. */ }
  let nationality;
  try { nationality = localStorage.getItem("stock-insight-nationality") || undefined; } catch {}
  let stopped = false;
  let lastCheckedAt = 0, recordedDay, pending;
  const update = async (record = false, force = false) => {
    if (stopped) return;
    if (pending) return pending;
    const day = new Date(now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    record = record || recordedDay !== day;
    if (!record && !force && now() - lastCheckedAt < 60_000) return;
    if (!record) return;
    pending = (async () => { try {
      await client.recordVisit(id, { nationality, signal: AbortSignal.timeout(8000) });
      if (!stopped) { lastCheckedAt = now(); recordedDay = day; }
    } catch {
      if (!stopped) { node.textContent = ""; node.dataset.state = "error"; }
    } finally { pending = null; } })();
    return pending;
  };
  const form = globalThis.document?.getElementById("visitor-nationality-form");
  if (form && nationality) form.elements.nationality.value = nationality;
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    const status = form.querySelector('[role="status"]');
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const submitted = String(new FormData(form).get("nationality") || "").trim();
      await client.recordVisit(id, { nationality: submitted, signal: AbortSignal.timeout(8000) });
      nationality = submitted || undefined;
      try {
        if (nationality) localStorage.setItem("stock-insight-nationality", nationality);
        else localStorage.removeItem("stock-insight-nationality");
      } catch {}
      status.textContent = "國籍已送出";
    } catch { status.textContent = "送出失敗，請稍後再試"; }
    finally { button.disabled = false; }
  });
  void update(true);
  return { refresh: (force = false) => update(false, force), stop: () => { stopped = true; } };
}

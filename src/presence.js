import { PresenceApiClient } from "./api/presence-client.js";

const STORAGE_KEY = "stock-insight-browser-id";
const pageStates = new WeakMap();
const nonDocumentPage = {};

function currentPageState() {
  const document = globalThis.document ?? nonDocumentPage;
  let page = pageStates.get(document);
  if (page) return page;
  let id = crypto.randomUUID();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(stored ?? "")) id = stored;
    else localStorage.setItem(STORAGE_KEY, id);
  } catch { /* Storage-disabled browsers use a document-local identifier. */ }
  page = { id, visit: null };
  pageStates.set(document, page);
  return page;
}

function currentVisit(page, now) {
  const day = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (page.visit?.day !== day) page.visit = { day, visitId: crypto.randomUUID(), recorded: false, pending: null };
  return page.visit;
}

export function startPresence(node, { demo = false, client = new PresenceApiClient(), now = Date.now } = {}) {
  if (!node) return;
  node.hidden = true;
  if (demo) { node.textContent = "今日造訪次數 · 示範模式"; return; }
  const page = currentPageState();
  let stopped = false;
  const update = async () => {
    if (stopped) return null;
    const visit = currentVisit(page, now());
    if (visit.recorded) return visit;
    if (visit.pending) return visit.pending;
    visit.pending = Promise.resolve().then(async () => { try {
      await client.recordVisit(page.id, { visitId: visit.visitId, signal: AbortSignal.timeout(8000) });
      // A shell may have been rebuilt while this shared document request ran.
      visit.recorded = true;
      if (!stopped) delete node.dataset.state;
      return visit;
    } catch {
      if (!stopped) { node.textContent = ""; node.dataset.state = "error"; }
      return null;
    } finally { visit.pending = null; } });
    return visit.pending;
  };
  const handle = { refresh: update, stop: () => {
    stopped = true;
    if (page.active === handle) {
      page.active = null;
      globalThis.window?.removeEventListener("pageshow", page.onPageShow);
    }
  } };
  page.onPageShow ??= event => {
    if (!event.persisted || !page.active) return;
    // Returning through BFCache is a new entry, while ordinary visibility
    // changes and the initial pageshow must not duplicate the page-load visit.
    page.visit = null;
    void page.active.refresh();
  };
  page.active = handle;
  globalThis.window?.addEventListener("pageshow", page.onPageShow);
  void update();
  return handle;
}

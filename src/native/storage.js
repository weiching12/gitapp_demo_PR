export const NATIVE_STORAGE_KEY = "stock-insight-native-v1";
export const NATIVE_PUSH_KEY = "stock-insight-native-push-v1";
const KEYS = ["stock-insight-v1", "stock-insight-research-v2", "stock-insight-current-page", NATIVE_PUSH_KEY];

// Hydrate before the UI reads preferences. Serialize writes so an older snapshot cannot win.
export async function createNativeStorage({ preferences, fallback, onError = console.warn }) {
  const { value } = await preferences.get({ key: NATIVE_STORAGE_KEY });
  let values;
  if (value !== null) {
    const saved = JSON.parse(value);
    if (saved?.version !== 1 || !saved.values || Array.isArray(saved.values) || typeof saved.values !== "object")
      throw new Error("原生設定格式無法讀取，保留原資料");
    values = new Map(KEYS.filter((key) => typeof saved.values[key] === "string").map((key) => [key, saved.values[key]]));
  } else {
    values = new Map();
    for (const key of KEYS) {
      let prior;
      try { prior = fallback?.getItem(key); } catch { /* WebView storage is optional during migration. */ }
      if (typeof prior === "string") values.set(key, prior);
    }
    if (values.size) await preferences.set({ key: NATIVE_STORAGE_KEY,
      value: JSON.stringify({ version: 1, values: Object.fromEntries(values) }) });
  }
  let dirty = false, pending;
  const flush = () => {
    if (pending) return pending;
    if (!dirty) return Promise.resolve();
    pending = (async () => {
      while (dirty) {
        dirty = false;
        try { await preferences.set({ key: NATIVE_STORAGE_KEY,
          value: JSON.stringify({ version: 1, values: Object.fromEntries(values) }) }); }
        catch (error) { dirty = true; throw error; }
      }
    })().finally(() => { pending = null; });
    return pending;
  };
  const change = () => { dirty = true; void flush().catch(onError); };
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (!KEYS.includes(key)) throw new Error("Unsupported native preference key");
      value = String(value);
      if (values.get(key) !== value) { values.set(key, value); change(); }
    },
    removeItem(key) { if (values.delete(key)) change(); },
    flush,
  };
}

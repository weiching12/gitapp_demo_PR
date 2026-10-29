import { MarketApiClient } from "../api/market-client.js";
import { startAppLifecycle } from "./lifecycle.js";

export async function createNativeRuntime({ app, platform, getDataVersion, onDataUpdate,
  onPause, onBack, onHistoryBack, beforeResume, onError = console.warn, client = new MarketApiClient(), now = Date.now }) {
  let lifecycle, pending, lastCheckedAt = null;
  const checkForUpdates = (force = false, isActive = () => lifecycle?.isActive() ?? true) => {
    if (!isActive() || !getDataVersion()) return Promise.resolve(false);
    if (pending) return pending;
    if (!force && lastCheckedAt !== null && now() - lastCheckedAt < 60_000) return Promise.resolve(false);
    pending = (async () => {
      const { data } = await client.market({ cache: "no-store" });
      if (!isActive()) return false;
      if (typeof data?.generation !== "string" || !data.generation) throw new Error("無法確認最新行情版本");
      lastCheckedAt = now();
      const updated = data.generation !== getDataVersion();
      if (updated) await onDataUpdate(data);
      return updated;
    })().finally(() => { pending = null; });
    return pending;
  };
  lifecycle = await startAppLifecycle({ app, platform, onPause, onBack, onHistoryBack, onError,
    onResume: async ({ isActive }) => {
      const [updated] = await Promise.all([checkForUpdates(true, isActive), beforeResume?.()]);
      return updated;
    } });
  return { checkForUpdates, stop: lifecycle.stop };
}

import { MarketApiClient } from "./api/market-client.js";

export function startPwa({ onConnection, getDataVersion, onDataUpdate } = {}) {
  const marketClient = new MarketApiClient();
  const reportConnection = () => onConnection?.(navigator.onLine);
  window.addEventListener("online", reportConnection);
  window.addEventListener("offline", reportConnection);
  reportConnection();

  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return async () => false;

  const controlledAtStart = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlledAtStart || refreshing) return;
    refreshing = true;
    location.reload();
  });

  const registrationPromise = navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  registrationPromise.catch((error) => console.warn("PWA registration failed", error));
  let lastCheckedAt = 0;
  let pendingCheck;
  const check = async () => {
    if (!navigator.onLine) throw new Error("目前沒有網路連線");
    const registration = await registrationPromise;
    await registration.update();
    if (registration.installing) {
      await new Promise((resolve) => {
        const worker = registration.installing;
        if (["installed", "activated", "redundant"].includes(worker.state)) return resolve();
        worker.addEventListener("statechange", () => {
          if (["installed", "activated", "redundant"].includes(worker.state)) resolve();
        });
      });
    }
    if (registration.waiting && navigator.serviceWorker.controller) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      return true;
    }
    const currentVersion = getDataVersion?.();
    if (!currentVersion) return false;
    const { data: latest } = await marketClient.market({ cache: "no-store" });
    if (latest?.generation && latest.generation !== currentVersion) {
      onDataUpdate?.(latest);
      return true;
    }
    return false;
  };
  return (force = false) => {
    if (pendingCheck) return pendingCheck;
    if (!force && Date.now() - lastCheckedAt < 60_000) return Promise.resolve(false);
    pendingCheck = check().then((updated) => {
      lastCheckedAt = Date.now();
      return updated;
    }).finally(() => { pendingCheck = null; });
    return pendingCheck;
  };
}

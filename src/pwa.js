import { MarketApiClient } from "./api/market-client.js";

export function startPwa({ onConnection, getDataVersion, onUpdateRequired } = {}) {
  const marketClient = new MarketApiClient();
  const reportConnection = () => onConnection?.(navigator.onLine);
  window.addEventListener("online", reportConnection);
  window.addEventListener("offline", reportConnection);
  reportConnection();

  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return async () => false;

  let previousController = navigator.serviceWorker.controller, activating = false;
  let offeredWorker, offeredResult;
  const activate = (worker) => new Promise((resolve, reject) => {
    if (navigator.serviceWorker.controller === worker) return resolve();
    activating = true;
    const finish = (error) => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      worker.removeEventListener("statechange", failed);
      activating = false;
      if (error) reject(error); else resolve();
    };
    const changed = () => { if (navigator.serviceWorker.controller === worker) finish(); };
    const failed = () => { if (worker.state === "redundant") finish(new Error("新版本啟用失敗，請重新更新")); };
    const timer = setTimeout(() => finish(new Error("更新逾時，請確認連線後重試")), 15_000);
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    worker.addEventListener("statechange", failed);
    try { worker.postMessage({ type: "SKIP_WAITING" }); } catch (error) { finish(error); }
  });
  const offerWorker = (worker) => {
    if (!worker || !navigator.serviceWorker.controller) return Promise.resolve(false);
    if (offeredWorker === worker) return offeredResult;
    offeredWorker = worker;
    offeredResult = Promise.resolve(onUpdateRequired({ kind: "app", activate: () => activate(worker) }));
    return offeredResult;
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const hadController = Boolean(previousController);
    previousController = navigator.serviceWorker.controller;
    if (hadController && !activating)
      void onUpdateRequired({ kind: "app" }).catch((error) => console.warn("PWA update failed", error));
  });
  const watched = new WeakSet();
  const watch = (worker) => {
    if (!worker || watched.has(worker)) return;
    watched.add(worker);
    const changed = () => {
      if (worker.state === "installed")
        void offerWorker(worker).catch((error) => console.warn("PWA update failed", error));
    };
    worker.addEventListener("statechange", changed);
    changed();
  };
  const registrationPromise = navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => {
    registration.addEventListener("updatefound", () => watch(registration.installing));
    watch(registration.installing);
    return registration;
  });
  registrationPromise.catch((error) => console.warn("PWA registration failed", error));
  let lastCheckedAt = 0;
  let pendingCheck;
  const check = async () => {
    if (!navigator.onLine) throw new Error("目前沒有網路連線");
    const registration = await registrationPromise;
    await registration.update();
    const worker = registration.installing;
    if (worker && !["installed", "activated", "redundant"].includes(worker.state)) {
      await new Promise((resolve, reject) => {
        const finish = (error) => {
          clearTimeout(timer); worker.removeEventListener("statechange", changed);
          if (error) reject(error); else resolve();
        };
        const changed = () => {
          if (["installed", "activated"].includes(worker.state)) finish();
          else if (worker.state === "redundant") finish(new Error("新版下載失敗，請稍後重試"));
        };
        const timer = setTimeout(() => finish(new Error("版本檢查逾時，請稍後重試")), 12_000);
        worker.addEventListener("statechange", changed); changed();
      });
    }
    const waiting = registration.waiting || (worker?.state === "installed" ? worker : null);
    if (waiting && navigator.serviceWorker.controller) {
      await offerWorker(waiting);
      return true;
    }
    const currentVersion = getDataVersion?.();
    if (!currentVersion) return false;
    const { data: latest } = await marketClient.market({ cache: "no-store" });
    if (latest?.generation && latest.generation !== currentVersion) {
      await onUpdateRequired({ kind: "data", generation: latest.generation });
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

export function startPwa({ onConnection, onUpdate, getDataVersion, onDataUpdate } = {}) {
  const reportConnection = () => onConnection?.(navigator.onLine);
  window.addEventListener("online", reportConnection);
  window.addEventListener("offline", reportConnection);
  reportConnection();

  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => {
    let lastUpdateCheck = 0;
    let checkingData = false;
    const checkForUpdate = async () => {
      if (!navigator.onLine || document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastUpdateCheck < 60_000) return;
      lastUpdateCheck = now;
      registration.update().catch((error) => console.warn("PWA update check failed", error));
      const currentVersion = getDataVersion?.();
      if (!currentVersion || checkingData) return;
      checkingData = true;
      try {
        const response = await fetch("/api/market", { cache: "no-store" });
        if (!response.ok) return;
        const latest = await response.json();
        if (latest?.generation && latest.generation !== currentVersion) onDataUpdate?.(latest);
      } catch (error) {
        console.warn("Market data update check failed", error);
      } finally {
        checkingData = false;
      }
    };
    const notify = () => {
      if (registration.waiting && navigator.serviceWorker.controller) onUpdate?.(() => {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      });
    };
    notify();
    registration.addEventListener("updatefound", () => {
      registration.installing?.addEventListener("statechange", notify);
    });
    document.addEventListener("visibilitychange", checkForUpdate);
    window.addEventListener("pageshow", checkForUpdate);
    window.addEventListener("focus", checkForUpdate);
    window.setInterval(checkForUpdate, 5 * 60_000);
    checkForUpdate();
  }).catch((error) => console.warn("PWA registration failed", error));

  const controlledAtStart = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlledAtStart || refreshing) return;
    refreshing = true;
    location.reload();
  });
}

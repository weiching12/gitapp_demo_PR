export function startPwa({ onConnection, onUpdate } = {}) {
  const reportConnection = () => onConnection?.(navigator.onLine);
  window.addEventListener("online", reportConnection);
  window.addEventListener("offline", reportConnection);
  reportConnection();

  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => {
    let lastUpdateCheck = 0;
    const checkForUpdate = () => {
      if (!navigator.onLine || document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastUpdateCheck < 60_000) return;
      lastUpdateCheck = now;
      registration.update().catch((error) => console.warn("PWA update check failed", error));
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
    window.setInterval(checkForUpdate, 15 * 60_000);
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

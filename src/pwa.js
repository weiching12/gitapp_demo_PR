export function startPwa({ onConnection, onUpdate } = {}) {
  const reportConnection = () => onConnection?.(navigator.onLine);
  window.addEventListener("online", reportConnection);
  window.addEventListener("offline", reportConnection);
  reportConnection();

  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => {
    const notify = () => {
      if (registration.waiting && navigator.serviceWorker.controller) onUpdate?.(() => {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      });
    };
    notify();
    registration.addEventListener("updatefound", () => {
      registration.installing?.addEventListener("statechange", notify);
    });
  }).catch((error) => console.warn("PWA registration failed", error));

  const controlledAtStart = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlledAtStart || refreshing) return;
    refreshing = true;
    location.reload();
  });
}

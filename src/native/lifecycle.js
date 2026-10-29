// Native plugin injection keeps lifecycle behavior testable without a device.
export async function startAppLifecycle({ app, platform, onResume, onPause = () => {},
  onBack = () => false, onHistoryBack = () => {}, onError = console.warn }) {
  const listeners = [];
  let active = true, observedState = false, stopped = false, resuming, backing;
  const isActive = () => active && !stopped;
  const resume = () => {
    if (resuming || !isActive()) return resuming;
    resuming = Promise.resolve().then(() => isActive() && onResume({ isActive }))
      .catch(onError).finally(() => { resuming = null; });
    return resuming;
  };
  const stop = async () => {
    stopped = true;
    await Promise.allSettled(listeners.map((listener) => listener.remove()));
  };
  try {
    listeners.push(await app.addListener("appStateChange", ({ isActive: next }) => {
      if (stopped || typeof next !== "boolean") return;
      observedState = true;
      if (next === active) return;
      active = next;
      if (active) return resume();
      return Promise.resolve().then(onPause).catch(onError);
    }));
    if (platform === "android") listeners.push(await app.addListener("backButton", (event) => {
      if (stopped || backing) return backing;
      backing = Promise.resolve().then(async () => {
        if (stopped || await onBack()) return;
        if (event.canGoBack) await onHistoryBack();
        else await app.minimizeApp();
      }).catch(onError).finally(() => { backing = null; });
      return backing;
    }));
    const initial = await app.getState();
    if (!observedState) active = initial.isActive;
    return { isActive, stop };
  } catch (error) { await stop(); throw error; }
}

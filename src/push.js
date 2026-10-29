import { PushApiClient } from "./api/push-client.js";

const decodeKey = (value) => {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

export function startPushNotifications(button, {
  client = new PushApiClient(),
  onMessage,
  onStatus,
  runtime = {
    navigator: globalThis.navigator,
    window: globalThis.window,
    document: globalThis.document,
    Notification: globalThis.Notification,
  },
} = {}) {
  const { navigator, window, document, Notification } = runtime;
  const supported = Boolean(navigator && window && Notification && "serviceWorker" in navigator && "PushManager" in window);
  if (!supported || !button) { if (button) button.hidden = true; onStatus?.({ supported: false, subscribed: false }); return; }
  let version = 0;
  let subscriptionError = null;
  const render = (subscribed) => {
    if (subscribed) subscriptionError = null;
    button.hidden = false;
    button.classList.toggle("push-enabled", subscribed);
    button.setAttribute("aria-pressed", String(subscribed));
    button.setAttribute("aria-label", subscribed ? "關閉每日資料更新通知" : "開啟每日資料更新通知");
    button.querySelector("span").textContent = subscribed ? "關閉更新通知" : "開啟更新通知";
    onStatus?.({ supported: true, subscribed, permission: Notification.permission,
      ...(subscriptionError && { error: subscriptionError }) });
  };
  const refresh = () => {
    if (button.disabled) return Promise.resolve();
    const currentVersion = ++version;
    return navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => { if (currentVersion === version && !button.disabled) render(Boolean(subscription)); })
      .catch(() => { if (currentVersion === version && !button.disabled) { button.hidden = true; onStatus?.({ supported: false, subscribed: false }); } });
  };
  const refreshWhenVisible = () => { if (!document || document.visibilityState === "visible") refresh(); };
  refresh();
  document?.addEventListener?.("visibilitychange", refreshWhenVisible);
  window.addEventListener?.("pageshow", refresh);
  button.addEventListener("click", async () => {
    version++;
    subscriptionError = null;
    button.disabled = true;
    try {
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current) {
        if (!await current.unsubscribe()) throw new Error("Browser push unsubscribe failed");
        render(false);
        try { await client.unsubscribe(current.endpoint); }
        catch (error) {
          console.warn("Push server cleanup failed", error);
          onMessage?.("已關閉此裝置通知；伺服器紀錄將在下次推播時清理");
          return;
        }
        onMessage?.("已關閉每日更新通知"); return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { onMessage?.("需要允許通知才能接收每日更新提醒"); return; }
      const { data: config } = await client.config();
      if (!config.enabled || !config.publicKey) throw new Error("Push notifications are unavailable");
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.publicKey) });
      try { await client.subscribe(subscription.toJSON()); } catch (error) { await subscription.unsubscribe(); throw error; }
      render(true); onMessage?.("每日資料更新完成後會通知你");
    } catch (error) {
      subscriptionError = error?.name === "AbortError"
        ? "瀏覽器無法建立推播訂閱；請使用一般瀏覽視窗或已安裝的 App 重試"
        : "推播訂閱未完成，請稍後重試";
      console.warn("Push subscription failed", error); onMessage?.("目前無法設定更新通知，請稍後再試");
    } finally { button.disabled = false; refresh(); }
  });
  return {
    refresh,
    destroy() {
      document?.removeEventListener?.("visibilitychange", refreshWhenVisible);
      window.removeEventListener?.("pageshow", refresh);
    },
  };
}

import { PushApiClient } from "./api/push-client.js";

const decodeKey = (value) => {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

export function startPushNotifications(button, { client = new PushApiClient(), onMessage } = {}) {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported || !button) { if (button) button.hidden = true; return; }
  const render = (subscribed) => {
    button.classList.toggle("push-enabled", subscribed);
    button.setAttribute("aria-pressed", String(subscribed));
    button.setAttribute("aria-label", subscribed ? "關閉每日資料更新通知" : "開啟每日資料更新通知");
    button.querySelector("span").textContent = subscribed ? "關閉更新通知" : "開啟更新通知";
  };
  navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()).then((subscription) => render(Boolean(subscription)))
    .catch(() => { button.hidden = true; });
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current) {
        await client.unsubscribe(current.endpoint); await current.unsubscribe(); render(false);
        onMessage?.("已關閉每日更新通知"); return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { onMessage?.("需要允許通知才能接收每日更新提醒"); return; }
      const config = await client.config();
      if (!config.enabled || !config.publicKey) throw new Error("Push notifications are unavailable");
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.publicKey) });
      try { await client.subscribe(subscription.toJSON()); } catch (error) { await subscription.unsubscribe(); throw error; }
      render(true); onMessage?.("每日資料更新完成後會通知你");
    } catch (error) {
      console.warn("Push subscription failed", error); onMessage?.("目前無法設定更新通知，請稍後再試");
    } finally { button.disabled = false; }
  });
}

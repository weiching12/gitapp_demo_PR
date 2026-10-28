import { NATIVE_PUSH_KEY } from "./storage.js";
import { NativePushClient } from "./push-client.js";

export async function startNativePush({ push, storage, client = new NativePushClient(),
  onStatus = () => {}, onMessage = () => {}, onOpen = () => {}, registrationTimeout = 20_000 }) {
  let saved;
  try { saved = JSON.parse(storage.getItem(NATIVE_PUSH_KEY)); } catch {}
  const state = { enabled: saved?.enabled === true, token: saved?.token ?? null,
    cleanup: saved?.cleanup ?? null, environment: saved?.environment ?? "sandbox",
    secret: /^[a-f0-9]{64}$/.test(saved?.secret ?? "") ? saved.secret
      : [...crypto.getRandomValues(new Uint8Array(32))].map((n) => n.toString(16).padStart(2, "0")).join("") };
  const listeners = [];
  let config, stopped = false, operation, registration, refreshing, registrationQueue = Promise.resolve();
  const persist = async () => { storage.setItem(NATIVE_PUSH_KEY, JSON.stringify(state)); await storage.flush?.(); };
  const report = (message, busy = false) => {
    if (!stopped) onStatus({ enabled: Boolean(config?.enabled || state.enabled),
      subscribed: Boolean(state.enabled && state.token), busy, message });
  };
  const cleanup = async () => {
    if (!state.cleanup) return;
    await client.unsubscribe({ token: state.cleanup.token, environment: state.cleanup.environment, secret: state.secret });
    state.cleanup = null; await persist();
  };
  const register = () => {
    if (registration) return registration.promise;
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    const timer = setTimeout(() => reject(new Error("通知註冊逾時，請稍後重試")), registrationTimeout);
    registration = { promise, resolve, reject };
    promise.finally(() => { clearTimeout(timer); registration = null; }).catch(() => {});
    Promise.resolve().then(() => push.register()).catch(reject);
    return promise;
  };
  const handleRegistration = async ({ value: token }) => {
    if (stopped || !state.enabled || !config?.enabled) return;
    try {
      if (!/^[a-f0-9]{32,512}$/i.test(token ?? "") || token.length % 2) throw new Error("無法取得有效通知代碼");
      const old = state.token && { token: state.token, environment: state.environment };
      await client.subscribe({ token, environment: config.environment, secret: state.secret });
      if (stopped || !state.enabled) {
        await client.unsubscribe({ token, environment: config.environment, secret: state.secret });
        return;
      }
      state.token = token; state.environment = config.environment;
      if (old && (old.token !== token || old.environment !== state.environment)) state.cleanup = old;
      await persist();
      await cleanup();
      report("已開啟通知，資料更新完成後會提醒你");
      registration?.resolve(true);
    } catch (error) { registration?.reject(error); report("通知註冊未完成，請稍後重試"); }
  };
  const registered = (event) => {
    const task = registrationQueue.then(() => handleRegistration(event));
    registrationQueue = task.catch(() => {});
    return task;
  };
  const refresh = () => {
    if (operation) return operation;
    if (refreshing || stopped) return refreshing ?? Promise.resolve();
    refreshing = (async () => {
      await cleanup().catch(() => {});
      const response = await client.config(); config = response.data;
      if (!config.enabled) { report("原生通知尚未開放"); return; }
      const permission = await push.checkPermissions();
      if (state.enabled && permission.receive !== "granted") {
        state.enabled = false;
        if (state.token) state.cleanup = { token: state.token, environment: state.environment };
        state.token = null; await persist(); await cleanup();
      }
      if (state.enabled && permission.receive === "granted") await register();
      else report(permission.receive === "denied" ? "通知權限已關閉，可至 iPhone 設定調整" : "尚未開啟通知");
    })().catch(() => report("通知狀態暫時無法確認，返回 App 後會重試"))
      .finally(() => { refreshing = null; });
    return refreshing;
  };
  const toggle = () => {
    if (operation) return operation;
    operation = (async () => {
      await refreshing;
      report("正在設定通知…", true);
      try {
        if (state.enabled && state.token) {
          await push.unregister();
          state.enabled = false;
          if (state.token) state.cleanup = { token: state.token, environment: state.environment };
          state.token = null; await persist();
          await cleanup().catch(() => onMessage("已關閉此裝置通知，伺服器紀錄稍後重試清理"));
          report("已關閉更新通知"); return;
        }
        const response = await client.config(); config = response.data;
        if (!config.enabled) { report("原生通知尚未開放"); return; }
        let permission = await push.checkPermissions();
        if (["prompt", "prompt-with-rationale"].includes(permission.receive)) permission = await push.requestPermissions();
        if (permission.receive !== "granted") throw new Error("請在 iPhone 設定允許通知後重試");
        state.enabled = true; await persist();
        await register();
      } catch (error) {
        if (!state.token) { state.enabled = false; await persist(); }
        report("通知設定未完成，請稍後重試"); throw error;
      }
    })().finally(() => { operation = null; });
    return operation;
  };
  try {
    listeners.push(await push.addListener("registration", registered));
    listeners.push(await push.addListener("registrationError", () => registration?.reject(new Error("無法註冊原生通知，請稍後重試"))));
    listeners.push(await push.addListener("pushNotificationReceived", () => onMessage("株研資料已更新")));
    listeners.push(await push.addListener("pushNotificationActionPerformed", () => onOpen()));
    report("正在讀取通知設定…", true);
    void refresh();
    return { refresh, toggle, async stop() {
      stopped = true;
      registration?.reject(new Error("通知工作已停止"));
      await Promise.allSettled(listeners.map((listener) => listener.remove()));
    } };
  } catch (error) {
    stopped = true;
    await Promise.allSettled(listeners.map((listener) => listener.remove()));
    throw error;
  }
}

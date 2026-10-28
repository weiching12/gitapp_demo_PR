import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Preferences } from "@capacitor/preferences";
import { PushNotifications } from "@capacitor/push-notifications";
import { createNativeRuntime } from "./runtime.js";
import { createNativeStorage } from "./storage.js";
import { startNativePush } from "./push.js";

export async function prepareNativeStorage(options) {
  if (!Capacitor.isNativePlatform()) return options.fallback;
  return createNativeStorage({ ...options, preferences: Preferences });
}

export async function enableNativePush(options) {
  if (!Capacitor.isNativePlatform()) return;
  return startNativePush({ ...options, push: PushNotifications });
}

export async function startNativeApp(options) {
  if (!Capacitor.isNativePlatform()) return { checkForUpdates: async () => false, stop: async () => {} };
  return createNativeRuntime({ ...options, app: App, platform: Capacitor.getPlatform() });
}

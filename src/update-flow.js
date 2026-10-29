const KEY = "stock-insight-update-progress";

export function createUpdateFlow({ storage, beforeReload = async () => {}, reload,
  onState = () => {}, now = Date.now }) {
  const read = () => {
    try {
      const saved = JSON.parse(storage?.getItem(KEY) ?? "null");
      return saved?.showProgress === true && Number.isFinite(saved.startedAt) && now() - saved.startedAt < 86_400_000;
    } catch { return false; }
  };
  const clear = () => { try { storage?.removeItem(KEY); } catch {} };
  let startup = true, resuming = read(), pending, applying;
  const isBlocking = () => Boolean(resuming || pending || applying);
  if (resuming) onState({ phase: "updating" });

  const apply = () => {
    if (applying) return applying;
    if (!pending && !resuming) return Promise.resolve(false);
    const update = pending;
    const showProgress = !startup || resuming;
    if (showProgress) onState({ phase: "updating" });
    applying = Promise.resolve().then(async () => {
      await beforeReload();
      await update?.activate?.();
      try { storage?.setItem(KEY, JSON.stringify({ showProgress, startedAt: now() })); } catch {}
      reload();
      return true;
    }).catch((error) => {
      clear(); resuming = false; startup = false;
      onState({ phase: "error", message: error.message || "更新失敗，請稍後重試" });
      throw error;
    }).finally(() => { applying = null; });
    return applying;
  };

  return {
    isBlocking, apply,
    offer(update) {
      if (applying) return applying;
      if (pending?.kind === "app" && update.kind !== "app") return Promise.resolve(true);
      pending = update;
      if (startup) return apply();
      onState({ phase: "available" });
      return Promise.resolve(true);
    },
    finishStartup({ fresh = true } = {}) {
      if (applying) return;
      startup = false;
      if (resuming && !fresh) {
        pending = { kind: "data" };
        onState({ phase: "error", message: "尚未取得最新資料，請確認連線後重新更新" });
        return;
      }
      if (resuming) { resuming = false; pending = null; clear(); onState({ phase: "idle" }); }
      else if (!pending) clear();
    },
    failStartup() {
      startup = false;
      if (!resuming) return;
      pending = { kind: "data" };
      onState({ phase: "error", message: "更新尚未完成，請確認連線後重新更新" });
    },
    async reloadCurrent() {
      if (isBlocking()) return false;
      await beforeReload(); reload(); return true;
    },
  };
}

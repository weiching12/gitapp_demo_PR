export function createUpdateDialog({ onUpdate, isBlocking }) {
  let dialog;
  return ({ phase, message }) => {
    if (phase === "idle") { dialog?.close(); return; }
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "required-update-dialog";
      dialog.setAttribute("aria-labelledby", "required-update-heading");
      dialog.setAttribute("aria-describedby", "required-update-message");
      dialog.setAttribute("data-mandatory-update", "true");
      dialog.innerHTML = '<div class="update-dialog-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.7-1L20 9M4 15l2.2 3A7 7 0 0 0 17.9 17"/></svg></div><h2 id="required-update-heading"></h2><p id="required-update-message" role="status" aria-live="polite"></p><button type="button" class="primary-button" id="apply-app-update">更新</button>';
      dialog.addEventListener("cancel", (event) => event.preventDefault());
      dialog.addEventListener("close", () => {
        if (isBlocking()) queueMicrotask(() => { if (!dialog.open && isBlocking()) dialog.showModal(); });
      });
      dialog.querySelector("button").addEventListener("click", (event) => {
        event.stopPropagation();
        void onUpdate().catch(() => {});
      });
      document.body.append(dialog);
    }
    const busy = phase === "updating";
    dialog.setAttribute("aria-busy", String(busy));
    dialog.dataset.phase = phase;
    dialog.querySelector("h2").textContent = busy ? "正在更新" : phase === "error" ? "更新尚未完成" : "有新版本可更新";
    dialog.querySelector("p").textContent = message || (busy ? "請稍候，完成後將自動回到原畫面。" : "請更新至最新版本，完成後將自動回到原畫面。");
    const button = dialog.querySelector("button");
    button.disabled = busy;
    button.textContent = busy ? "更新中…" : phase === "error" ? "重新更新" : "更新";
    if (!dialog.open) dialog.showModal();
  };
}

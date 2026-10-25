export function bindInputMode(onChange) {
  const update = (mode) => { onChange(mode === "touch"); document.documentElement.dataset.inputMode = mode; };
  document.addEventListener("pointerdown", (event) => update(event.pointerType === "touch" ? "touch" : "pointer"), { capture: true, passive: true });
  document.addEventListener("touchstart", () => update("touch"), { capture: true, passive: true });
  document.addEventListener("keydown", () => update("keyboard"), true);
}

export function bindPullToRefresh(pullRefresh) {
  let gesture = null;
  const reset = () => {
    gesture = null;
    pullRefresh.classList.remove("is-pulling", "is-ready", "is-refreshing");
    pullRefresh.style.removeProperty("--pull-distance");
    pullRefresh.lastChild.textContent = "下拉重新整理";
  };
  document.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    const blocked = event.touches.length !== 1 || window.scrollY > 0 || document.querySelector("dialog[open]") || event.target.closest("button, a, input, select, .table-scroll");
    if (blocked || !touch || !matchMedia("(max-width: 700px)").matches) return;
    gesture = { x: touch.clientX, y: touch.clientY, distance: 0 };
  }, { passive: true });
  document.addEventListener("touchmove", (event) => {
    if (!gesture || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const vertical = touch.clientY - gesture.y;
    const horizontal = Math.abs(touch.clientX - gesture.x);
    if (vertical <= 0 || vertical <= horizontal) return;
    event.preventDefault();
    gesture.distance = Math.min(104, vertical * 0.55);
    pullRefresh.style.setProperty("--pull-distance", `${gesture.distance}px`);
    pullRefresh.classList.add("is-pulling");
    const ready = gesture.distance >= 68;
    pullRefresh.classList.toggle("is-ready", ready);
    pullRefresh.lastChild.textContent = ready ? "放開即可更新" : "下拉重新整理";
  }, { passive: false });
  document.addEventListener("touchend", () => {
    if (!gesture) return;
    if (gesture.distance < 68) { reset(); return; }
    pullRefresh.classList.remove("is-pulling", "is-ready");
    pullRefresh.classList.add("is-refreshing");
    pullRefresh.lastChild.textContent = "正在更新資料";
    gesture = null;
    const refreshEvent = new CustomEvent("stockapps:refresh", { cancelable: true });
    if (window.dispatchEvent(refreshEvent)) window.location.reload();
    else reset();
  }, { passive: true });
  document.addEventListener("touchcancel", reset, { passive: true });
}

export function bindMobileDragDismiss(dialog, handle) {
  let drag = null;
  let suppressClickUntil = 0;
  const reset = () => { drag = null; dialog.classList.remove("is-dragging"); dialog.style.removeProperty("--mobile-drag-y"); };
  handle.addEventListener("pointerdown", (event) => {
    if (!dialog.open || !matchMedia("(max-width: 520px)").matches || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    dialog.classList.add("is-dragging");
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (event.pointerId !== drag?.id) return;
    const distance = event.clientY - drag.y;
    const horizontal = Math.abs(event.clientX - drag.x);
    dialog.style.setProperty("--mobile-drag-y", `${distance > horizontal ? Math.max(0, distance) : 0}px`);
  });
  handle.addEventListener("pointerup", (event) => {
    if (event.pointerId !== drag?.id) return;
    const distance = event.clientY - drag.y;
    const horizontal = Math.abs(event.clientX - drag.x);
    if (Math.hypot(distance, horizontal) > 8) suppressClickUntil = performance.now() + 350;
    reset();
    if (distance >= 90 && distance > horizontal) dialog.close();
  });
  handle.addEventListener("pointercancel", reset);
  handle.addEventListener("click", () => { if (dialog.open && performance.now() >= suppressClickUntil) dialog.close(); });
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener("close", () => { reset(); suppressClickUntil = 0; });
}

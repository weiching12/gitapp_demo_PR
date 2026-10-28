import { bindMobileDragDismiss } from "./gestures.js";

export function createDialogController() {
  const open = (dialog, { focus = true, mobileTarget, desktopTarget } = {}) => {
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    const selector = matchMedia("(max-width: 520px)").matches ? mobileTarget : desktopTarget;
    const focusTarget = selector ? dialog.querySelector(selector) : null;
    if (focus) focusTarget?.focus({ preventScroll: true });
    else if (dialog.contains(document.activeElement)) document.activeElement.blur();
  };

  const bindBackdropDismiss = () => {
    document.querySelectorAll("dialog:not([data-mandatory-update])").forEach((dialog) => dialog.addEventListener("click", (event) => {
      if (event.target !== event.currentTarget) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
        dialog.close();
    }));
  };

  const bindMobileDismiss = (dialog, handleSelector) => {
    bindMobileDragDismiss(dialog, dialog.querySelector(handleSelector));
  };

  return { open, bindBackdropDismiss, bindMobileDismiss };
}

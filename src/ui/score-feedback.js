export function createScoreHaptics({ impact, vibrate = pattern => navigator.vibrate?.(pattern) } = {}) {
  return kind => {
    try {
      if (impact) {
        if (kind !== "cancel") void Promise.resolve(impact(kind === "finish" ? "MEDIUM" : "LIGHT")).catch(() => {});
      } else vibrate(kind === "cancel" ? 0 : kind === "finish" ? 18 : 8);
    } catch { /* Unsupported or disabled haptics must not interrupt the score. */ }
  };
}

export function createScoreAnimator({ pulse = () => {}, canPulse = () => false,
  requestFrame = callback => requestAnimationFrame(callback), cancelFrame = id => cancelAnimationFrame(id),
  hidden = () => document.hidden, reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches } = {}) {
  let session = null, frameId;
  const key = dialog => `${dialog.dataset.request}:${dialog.dataset.entrySymbol}`;
  const scoreValue = dialog => dialog.querySelector(".entry-summary-head strong[data-score-target]");
  const stop = () => {
    if (frameId !== undefined) cancelFrame(frameId);
    if (session && !session.finished) {
      const value = scoreValue(session.dialog);
      if (value && key(session.dialog) === session.key) value.textContent = `${Number(value.dataset.scoreTarget).toFixed(2)} / 100`;
      if (session.haptic) pulse("cancel");
    }
    frameId = undefined;
    session = null;
  };
  const animate = dialog => {
    const value = scoreValue(dialog), target = Number(value?.dataset.scoreTarget);
    if (session?.dialog === dialog && session.key === key(dialog)) {
      if (session.finished && value) value.textContent = `${target.toFixed(2)} / 100`;
      return;
    }
    stop();
    if (!value || !dialog.open || !Number.isFinite(target) || target <= 0 || reducedMotion() || hidden()) return;
    session = { dialog, key: key(dialog), target, startedAt: null, lastPulse: 0, lastNumber: 0, haptic: canPulse(), finished: false };
    value.textContent = "0.00 / 100";
    const frame = now => {
      frameId = undefined;
      const current = session;
      if (!current) return;
      const value = scoreValue(dialog);
      if (!dialog.open || !value?.isConnected || key(dialog) !== current.key || hidden() || reducedMotion()) { stop(); return; }
      current.startedAt ??= now;
      const elapsed = now - current.startedAt, progress = Math.min(elapsed / 750, 1);
      const score = current.target * (1 - (1 - progress) ** 3);
      value.textContent = `${score.toFixed(2)} / 100`;
      if (progress < 1) {
        if (current.haptic && canPulse() && elapsed - current.lastPulse >= 120 && Math.floor(score) !== current.lastNumber) {
          pulse("tick");
          current.lastPulse = elapsed;
          current.lastNumber = Math.floor(score);
        }
        frameId = requestFrame(frame);
      } else {
        current.finished = true;
        if (current.haptic && canPulse()) pulse("finish");
      }
    };
    frameId = requestFrame(frame);
  };
  return { animate, stop };
}

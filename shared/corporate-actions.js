// Compare closes across verified TWSE ex-rights/dividend sessions on a
// reference-price-adjusted basis. This is a price-series adjustment, not a
// cash-dividend total-return calculation.
export function comparableCloseReturn(window, eventsByDate = new Map()) {
  if (!Array.isArray(window) || window.length < 2 ||
      !window.every((bar) => Number.isFinite(bar?.close) && bar.close > 0)) return null;
  let firstCloseOnCurrentBasis = window[0].close;
  for (let index = 1; index < window.length; index++) {
    const event = eventsByDate.get(window[index].date);
    if (!event) continue;
    if (!["息", "權", "權息"].includes(event.kind) ||
        !(event.beforeClose > 0) || !(event.reference > 0)) return null;
    const precedingClose = window[index - 1].close;
    const tolerance = Math.max(0.01, precedingClose * 0.0001);
    if (Math.abs(precedingClose - event.beforeClose) > tolerance) return null;
    firstCloseOnCurrentBasis *= event.reference / event.beforeClose;
  }
  return Number.isFinite(firstCloseOnCurrentBasis) && firstCloseOnCurrentBasis > 0
    ? window.at(-1).close / firstCloseOnCurrentBasis - 1 : null;
}

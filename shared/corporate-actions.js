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

/** Put earlier OHLC on the latest session's official ex-dividend reference basis.
 * A missing or inconsistent official reference leaves the series unusable.
 * Volume and institutional shares are deliberately left unchanged.
 */
export function referenceAdjustedDividendHistory(history, eventsByDate) {
  if (!Array.isArray(history) || !history.length || !(eventsByDate instanceof Map)) return null;
  const bars = history.map((bar) => ({ ...bar }));
  for (let index = 1; index < bars.length; index++) {
    const event = eventsByDate.get(bars[index].date);
    if (!event) continue;
    const previousClose = history[index - 1].close;
    const tolerance = Math.max(0.01, previousClose * 0.0001);
    if (event.kind !== "息" || !(event.beforeClose > 0) || !(event.reference > 0) ||
        !(event.reference < event.beforeClose) ||
        !Number.isFinite(previousClose) ||
        Math.abs(previousClose - event.beforeClose) > tolerance) return null;
    const factor = event.reference / event.beforeClose;
    for (let earlier = 0; earlier < index; earlier++) {
      for (const field of ["open", "high", "low", "close"]) {
        if (!(bars[earlier][field] > 0)) return null;
        bars[earlier][field] *= factor;
      }
    }
  }
  return bars;
}

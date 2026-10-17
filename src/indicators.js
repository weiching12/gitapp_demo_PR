/** All prices use TWD and all volumes use shares. Input must be oldest first. */
export const DEFAULT_SETTINGS = Object.freeze({
  period: 9,
  kSmooth: 3,
  dSmooth: 3,
});

export function analyzeHistory(history, settings = DEFAULT_SETTINGS) {
  const { period, kSmooth, dSmooth } = settings;
  if (![period, kSmooth, dSmooth].every((n) => Number.isInteger(n) && n > 0)) {
    throw new RangeError("指標週期必須是正整數");
  }
  let k = 50;
  let d = 50;
  return history.map((bar, index) => {
    const ma = (days) =>
      index + 1 < days
        ? null
        : history
            .slice(index + 1 - days, index + 1)
            .reduce((sum, row) => sum + row.close, 0) / days;
    let rsv = null;
    let currentK = null;
    let currentD = null;
    if (index + 1 >= period) {
      const window = history.slice(index + 1 - period, index + 1);
      const high = Math.max(...window.map((row) => row.high));
      const low = Math.min(...window.map((row) => row.low));
      // A flat window has no relative price position; use a neutral RSV of 50.
      rsv = high === low ? 50 : ((bar.close - low) / (high - low)) * 100;
      k = (k * (kSmooth - 1)) / kSmooth + rsv / kSmooth;
      d = (d * (dSmooth - 1)) / dSmooth + k / dSmooth;
      currentK = k;
      currentD = d;
    }
    const previousClose = history[index - 1]?.close ?? null;
    const ma60 = ma(60);
    return {
      ...bar,
      ma5: ma(5),
      ma20: ma(20),
      ma60,
      rsv,
      k: currentK,
      d: currentD,
      change: previousClose === null ? null : bar.close - previousClose,
      changePercent:
        previousClose === null || previousClose === 0
          ? null
          : (bar.close / previousClose - 1) * 100,
      deviation:
        ma60 === null || ma60 === 0 ? null : (bar.close / ma60 - 1) * 100,
      institutionalNet:
        bar.institutions?.reduce((sum, row) => sum + row.buy - row.sell, 0) ??
        null,
    };
  });
}

export function getSnapshot(stock, asOf, settings) {
  const history = analyzeHistory(
    stock.history.filter((bar) => bar.date <= asOf),
    settings,
  );
  return { ...stock, history, latest: history.at(-1) ?? null };
}

export function filterStocks(
  stocks,
  { query = "", sector = "all", view = "all", favorites = [] } = {},
) {
  const text = query.trim().toLocaleLowerCase();
  return stocks.filter((stock) => {
    if (!stock.latest) return false;
    if (
      text &&
      !`${stock.symbol} ${stock.name}`.toLocaleLowerCase().includes(text)
    )
      return false;
    if (sector !== "all" && stock.sector !== sector) return false;
    if (view === "favorites" && !favorites.includes(stock.symbol)) return false;
    if (view === "above" && !(stock.latest.deviation > 0)) return false;
    if (
      view === "oversold" &&
      !(stock.latest.k !== null && stock.latest.k < 20)
    )
      return false;
    return true;
  });
}

/** Escape every cell and neutralize spreadsheet formula prefixes. */
export function toCsv(rows) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let cell = String(value ?? "");
            if (/^[=+@\-\t\r]/.test(cell) && !/^-?\d+(\.\d+)?$/.test(cell))
              cell = "'" + cell;
            return '"' + cell.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}

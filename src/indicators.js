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
      institutionalNet: getInstitutionalNet(bar.institutions),
    };
  });
}

export function getInstitutionalNet(institutions) {
  const values = ["外資", "投信", "自營商"].map((name) => {
    const rows = institutions?.filter((item) => item.name === name) ?? [];
    const item = rows[0];
    return rows.length === 1 && [item.buy, item.sell].every((n) => Number.isFinite(n) && n >= 0)
      ? item.buy - item.sell : null;
  });
  return values.every(Number.isFinite) ? values.reduce((sum, n) => sum + n, 0) : null;
}

export function getSnapshot(stock, asOf, settings) {
  const history = analyzeHistory(
    stock.history.filter((bar) => bar.date <= asOf),
    settings,
  );
  return {
    ...stock,
    history,
    latest: history.at(-1) ?? null,
    signal: getTechnicalSignal(history),
    institutionalSummary: getInstitutionalSummary(history),
  };
}

/** Totals stay in shares; rolling windows include the selected session. */
export function getInstitutionalSummary(history) {
  const names = ["外資", "投信", "自營商"];
  const series = Object.fromEntries(names.map((name) => [name, []]));
  const totals = [];
  for (const bar of history) {
    const daily = names.map((name) => {
      const entries = Array.isArray(bar.institutions)
        ? bar.institutions.filter((item) => item?.name === name)
        : [];
      const item = entries[0];
      const net = entries.length === 1 &&
        [item.buy, item.sell].every((n) => Number.isFinite(n) && n >= 0)
        ? item.buy - item.sell : null;
      series[name].push(net);
      return net;
    });
    totals.push(daily.every(Number.isFinite)
      ? daily.reduce((sum, value) => sum + value, 0) : null);
  }

  const summarize = (values) => {
    const rolling = (days) => {
      const window = values.slice(-days);
      return window.length === days && window.every(Number.isFinite)
        ? window.reduce((sum, value) => sum + value, 0) : null;
    };
    const latest = values.at(-1);
    let streak = { direction: "unknown", days: null, atLeast: false };
    if (Number.isFinite(latest)) {
      if (latest === 0) streak = { direction: "neutral", days: 0, atLeast: false };
      else {
        const sign = Math.sign(latest);
        let days = 0;
        while (days < values.length && Number.isFinite(values[values.length - 1 - days]) &&
          Math.sign(values[values.length - 1 - days]) === sign) days++;
        streak = {
          direction: sign > 0 ? "buy" : "sell",
          days,
          // The series start or a missing session may hide an earlier streak.
          atLeast: days === values.length || !Number.isFinite(values[values.length - 1 - days]),
        };
      }
    }
    return { net5: rolling(5), net20: rolling(20), streak };
  };
  const total = summarize(totals);
  return {
    total: { net5: total.net5, net20: total.net20 },
    institutions: Object.fromEntries(names.map((name) => [name, summarize(series[name])])),
  };
}

/** Evaluate only the last two completed sessions in the selected snapshot. */
export function getTechnicalSignal(history) {
  const current = history.at(-1);
  const previous = history.at(-2);
  const signal = (code, tone, label, reason) => ({ code, tone, label, reason });
  const validKd = (row) =>
    row && [row.k, row.d].every((n) => Number.isFinite(n) && n >= 0 && n <= 100);
  if (!validKd(current) || !validKd(previous))
    return signal("insufficient", "neutral", "資料不足", "需連續兩個交易日的有效 K、D 值");

  const crossesUp =
    previous.k <= previous.d && current.k > current.d && current.k > previous.k;
  const crossesDown =
    previous.k >= previous.d && current.k < current.d && current.k < previous.k;
  const lowZone = (row) => row.k < 20 && row.d < 20;
  const highZone = (row) => row.k > 80 && row.d > 80;
  const trendConfirmed =
    Number.isFinite(current.close) &&
    current.close > 0 &&
    Number.isFinite(current.ma20) &&
    current.ma20 > 0 &&
    Number.isFinite(previous.ma20) &&
    previous.ma20 > 0 &&
    current.close >= current.ma20 &&
    current.ma20 >= previous.ma20;

  if (crossesUp && (lowZone(previous) || lowZone(current)))
    return trendConfirmed
      ? signal("buy-watch", "positive", "留意買點", "低檔黃金交叉；收盤站上走平或上彎 MA20")
      : signal("rebound-watch", "caution", "反彈觀察", "低檔黃金交叉；MA20 趨勢尚未確認");
  if (crossesDown && (highZone(previous) || highZone(current)))
    return signal("sell-watch", "negative", "留意賣點", "高檔死亡交叉；留意動能轉弱");
  if (crossesDown)
    return signal("weakening", "negative", "動能轉弱", "K 下穿 D；等待止跌與趨勢確認");
  if (crossesUp)
    return signal("strengthening", "positive", "動能轉強", "K 上穿 D；尚非低檔買點條件");
  if (current.k < 20)
    return signal("oversold-watch", "caution", "低檔觀察", "K 低於 20；當日未出現低檔黃金交叉");
  if (current.k > 80)
    return signal("overbought-watch", "caution", "高檔觀察", "K 高於 80；高檔可能持續鈍化");
  if (current.k > current.d && trendConfirmed)
    return signal("bullish-watch", "positive", "偏多觀察", "K 高於 D；收盤站上走平或上彎 MA20");
  if (current.k < current.d)
    return signal("bearish-watch", "negative", "偏弱觀察", "K 低於 D；暫待動能改善");
  return signal("neutral", "neutral", "中性觀望", "KD 與趨勢尚未形成明確條件");
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

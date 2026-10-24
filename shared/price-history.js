export function dailyCloseSeries(history, tradingDates, asOf, days = 30) {
  const index = tradingDates?.indexOf(asOf) ?? -1;
  if (index < 0) return [];
  const closes = new Map((history ?? []).filter((bar) => bar.date <= asOf)
    .map((bar) => [bar.date, Number.isFinite(bar.close) && bar.close > 0 ? bar.close : null]));
  return tradingDates.slice(Math.max(0, index - days + 1), index + 1)
    .map((date) => ({ date, close: closes.get(date) ?? null }));
}

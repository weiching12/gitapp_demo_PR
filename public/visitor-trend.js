export function trendSeries(start, end, daily, period = 'day') {
  const counts = new Map(daily.map(row => [row.day, row.visitors]));
  const points = [];
  const first = period === 'month' ? start.slice(0, 7) + '-01' : start;
  const last = period === 'month' ? end.slice(0, 7) + '-01' : end;
  for (let date = new Date(first); date <= new Date(last);) {
    const day = date.toISOString().slice(0, period === 'month' ? 7 : 10);
    points.push({ day, value: counts.get(day) ?? null });
    if (period === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
    else date.setUTCDate(date.getUTCDate() + 1);
  }
  return points;
}

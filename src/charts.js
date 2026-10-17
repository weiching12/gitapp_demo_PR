const COLORS = {
  up: "#c6514e",
  down: "#228773",
  ma5: "#bc934d",
  ma20: "#6d88ad",
  ma60: "#8367a2",
  k: "#b68c46",
  d: "#637fba",
};
const price = (value) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const pathFor = (rows, accessor, x, y) => {
  let started = false;
  return rows
    .map((row, i) => {
      const value = accessor(row);
      if (value === null || !Number.isFinite(value)) {
        started = false;
        return "";
      }
      const point = `${started ? "L" : "M"}${x(i).toFixed(2)},${y(value).toFixed(2)}`;
      started = true;
      return point;
    })
    .join(" ");
};

export function renderChart(history, count, compact = false) {
  const rows = history.slice(-count);
  if (!rows.length) return '<p class="empty">尚無足夠的歷史資料</p>';
  const width = compact ? 450 : 900,
    left = 12,
    right = 72,
    plotWidth = width - left - right;
  const top = 22,
    bottom = 242,
    volumeTop = 264,
    volumeBottom = 306;
  const kdTop = 353,
    kdBottom = 445;
  const x = (i) => left + ((i + 0.5) * plotWidth) / rows.length;
  const values = rows
    .flatMap((row) => [row.high, row.low, row.ma5, row.ma20, row.ma60])
    .filter((n) => n !== null);
  const min = Math.min(...values),
    max = Math.max(...values);
  const padding = (max - min || max * 0.01 || 1) * 0.09;
  const lower = min - padding,
    upper = max + padding;
  const y = (value) =>
    bottom - ((value - lower) / (upper - lower)) * (bottom - top);
  const yKd = (value) => kdBottom - (value / 100) * (kdBottom - kdTop);
  const maxVolume = Math.max(...rows.map((row) => row.volume), 1);
  const candleWidth = Math.max(
    1.4,
    Math.min(10, (plotWidth / rows.length) * 0.58),
  );
  let svg = `<svg class="market-chart" viewBox="0 0 ${width} 478" role="img" aria-label="${rows[0].date} 至 ${rows.at(-1).date} 的示範日K線、均線、成交量及KD走勢">`;
  for (let i = 0; i <= 4; i++) {
    const value = lower + ((upper - lower) * i) / 4;
    svg += `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" class="chart-grid"/><text x="${width - right + 12}" y="${y(value) + 4}" class="chart-label">${price(value)}</text>`;
  }
  svg += `<text x="${left}" y="${volumeTop - 6}" class="chart-label">成交量</text><text x="${width - right + 12}" y="${volumeTop + 8}" class="chart-label">${(maxVolume / 1000).toFixed(0)} 張</text>`;
  rows.forEach((row, i) => {
    const color = row.close >= row.open ? COLORS.up : COLORS.down;
    const height = Math.max(1.5, Math.abs(y(row.close) - y(row.open)));
    const volumeHeight = (row.volume / maxVolume) * (volumeBottom - volumeTop);
    svg += `<g><title>${row.date} 開 ${price(row.open)} 高 ${price(row.high)} 低 ${price(row.low)} 收 ${price(row.close)}，成交 ${(row.volume / 1000).toFixed(0)} 張</title><line x1="${x(i)}" y1="${y(row.high)}" x2="${x(i)}" y2="${y(row.low)}" stroke="${color}"/><rect x="${x(i) - candleWidth / 2}" y="${Math.min(y(row.open), y(row.close))}" width="${candleWidth}" height="${height}" rx="0.6" fill="${color}"/><rect x="${x(i) - candleWidth / 2}" y="${volumeBottom - volumeHeight}" width="${candleWidth}" height="${volumeHeight}" rx="0.6" fill="${color}" opacity=".3"/></g>`;
  });
  for (const key of ["ma5", "ma20", "ma60"]) {
    svg += `<path d="${pathFor(rows, (row) => row[key], x, y)}" fill="none" stroke="${COLORS[key]}" stroke-width="1.7" stroke-linejoin="round"/>`;
  }
  svg += `<line x1="${left}" y1="329" x2="${width - 12}" y2="329" class="chart-grid"/><text x="${left}" y="347" class="chart-label">KD 隨機指標</text><rect x="${left}" y="${yKd(80)}" width="${plotWidth}" height="${yKd(20) - yKd(80)}" fill="#f6f7f4"/>`;
  for (const value of [20, 50, 80]) {
    svg += `<line x1="${left}" y1="${yKd(value)}" x2="${width - right}" y2="${yKd(value)}" class="chart-grid" stroke-dasharray="4 5"/><text x="${width - right + 12}" y="${yKd(value) + 4}" class="chart-label">${value}</text>`;
  }
  for (const key of ["k", "d"])
    svg += `<path d="${pathFor(rows, (row) => row[key], x, yKd)}" fill="none" stroke="${COLORS[key]}" stroke-width="2"/>`;
  for (let i = 0; i < 5; i++) {
    const index = Math.round(((rows.length - 1) * i) / 4);
    svg += `<text x="${x(index)}" y="470" text-anchor="${i === 0 ? "start" : "middle"}" class="chart-label">${rows[index].date.slice(5).replace("-", "/")}</text>`;
  }
  return svg + "</svg>";
}

export function sparkline(history) {
  const data = history.slice(-24);
  const prices = data.map((row) => row.close);
  const min = Math.min(...prices),
    max = Math.max(...prices);
  const x = (i) => 2 + (i / Math.max(data.length - 1, 1)) * 82;
  const y = (value) => 28 - ((value - min) / (max - min || 1)) * 24;
  const color = prices.at(-1) >= prices[0] ? COLORS.up : COLORS.down;
  return `<svg class="sparkline" viewBox="0 0 88 32" aria-hidden="true"><path d="${pathFor(data, (row) => row.close, x, y)}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

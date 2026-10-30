import { reviewInitialScore, reviewPriceStatus } from "../../shared/research-review.js";

const fmt = (value) => Number.isFinite(value) ? value.toFixed(2) : "—";
const signed = (value) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%` : "—";
const stateText = {
  pending: "尚未滿指定交易日", "missing-price": "觀察日資料不足",
  "missing-baseline": "缺少可靠基準", "outside-coverage": "歷史資料未涵蓋",
  incompatible: "價格基準不一致", unavailable: "資料尚未取得",
  "action-unverified": "公司行動待查核",
  "action-affected": "受公司行動影響，暫不提供可比價格變化",
};
const scoreChange = (period, snapshot) => {
  if (!snapshot?.valid || !Number.isFinite(snapshot.finalScore)) return "該日無評分";
  const initial = reviewInitialScore(period, snapshot);
  if (initial.initial?.asOf > snapshot.asOf) return "尚未到評分基準日";
  if (initial.status === "incompatible") return "設定不同，無法比較";
  if (initial.status === "same-snapshot") return "0.00 分";
  if (initial.status !== "comparable") return "缺少可比評分基準";
  return `${initial.finalDelta > 0 ? "+" : ""}${fmt(initial.finalDelta)} 分`;
};
const pointReadout = (point) => `${point.date}${point.milestone ? ` · 第 ${point.milestone} 個交易日` : ""} · 收盤 ${fmt(point.close)}（${point.priceChange}） · 評分 ${fmt(point.score)} 分（${point.scoreChange}）`;
const escapeText = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const shortDate = (date) => date.slice(5).replace("-", "/");
const readoutMarkup = (point) => `<span class="research-readout-metric"><span>收盤價</span><strong>${fmt(point.close)}</strong><small>（${escapeText(point.priceChange)}）</small></span><span class="research-readout-metric"><span>評分</span><strong>${fmt(point.score)} 分</strong><small>（${escapeText(point.scoreChange)}）</small></span>${point.milestone ? `<small>第 ${point.milestone} 個交易日</small>` : ""}`;

export function researchPriceChart(period, row, esc, range = 60) {
  const review = row?.review;
  const baseline = period?.baseline ?? period?.firstValidPriceBaseline;
  if (!review || !baseline) return '<p class="research-muted">缺少可靠價格基準或價格資料，無法繪製追蹤價格走勢。</p>';
  const base = review.dates.indexOf(baseline.asOf);
  if (base < 0) return '<p class="research-muted">基準日期已超出可查詢的歷史範圍，無法繪製連續走勢。</p>';
  const dates = review.dates.slice(Math.max(base, review.dates.length - range));
  const byDate = new Map(review.bars.map((bar) => [bar.date, bar.close]));
  const snapshots = [...(row.history ?? []), row.latest].filter(Boolean);
  const initial = period.addedSnapshot?.valid ? period.addedSnapshot : period.firstValidSnapshot;
  if (initial && !snapshots.some(snapshot => snapshot.asOf === initial.asOf)) snapshots.push(initial);
  const scores = new Map(snapshots.map((snap) => [snap.asOf, snap]));
  const points = dates.map((date) => {
    const recorded = scores.get(date);
    const snapshot = recorded?.valid && Number.isFinite(recorded.finalScore) ? recorded : null;
    const price = reviewPriceStatus(baseline, date, review);
    const day = review.dates.indexOf(date) - base;
    return { date, close: byDate.get(date) ?? null, score: snapshot?.finalScore ?? null,
      priceChange: price.status === "comparable" ? signed(price.change) : stateText[price.status] ?? "資料不足",
      scoreChange: scoreChange(period, snapshot), milestone: [5, 10, 20].includes(day) ? day : null };
  });
  const values = points.map((point) => point.close).filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return '<p class="research-muted">此區間沒有有效收盤價資料。</p>';
  const lo = Math.min(...values), hi = Math.max(...values), pad = Math.max((hi - lo) * .1, hi * .01);
  const x = (index) => 12 + index * 296 / Math.max(1, points.length - 1);
  const priceY = (value) => 108 - (value - lo + pad) / (hi - lo + pad * 2) * 90;
  const scoreY = (value) => 108 - Math.max(0, Math.min(100, value)) * .9;
  const segments = (key, y) => {
    const result = []; let current = [];
    for (const [index, point] of points.entries()) {
      if (!Number.isFinite(point[key]) || (key === "close" && point.close <= 0)) {
        if (current.length > 1) result.push(current);
        current = [];
      } else current.push(`${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`);
    }
    if (current.length > 1) result.push(current);
    return result.map((segment) => `<polyline points="${segment.join(" ")}" class="${key === "close" ? "price" : key}-line" fill="none"/>`).join("");
  };
  const milestoneDates = points.filter((point) => point.milestone).map((point) => point.date);
  const eventDates = new Set((row.timeline ?? []).map((event) => event.toDate));
  const markers = points.map((point, index) => !Number.isFinite(point.close) || point.close <= 0 ? "" :
    `<circle cx="${x(index).toFixed(1)}" cy="${priceY(point.close).toFixed(1)}" r="${milestoneDates.includes(point.date) || eventDates.has(point.date) ? 3 : 1.5}" class="price-marker${eventDates.has(point.date) ? " event" : ""}"><title>${esc(point.date)} 收盤 ${fmt(point.close)}${eventDates.has(point.date) ? " · 研究事件" : ""}</title></circle>`).join("");
  const scoreMarkers = points.map((point, index) => Number.isFinite(point.score)
    ? `<circle cx="${x(index).toFixed(1)}" cy="${scoreY(point.score).toFixed(1)}" r="2.5" class="score-marker"><title>${esc(point.date)} 評分 ${fmt(point.score)}</title></circle>` : "").join("");
  const last = points.at(-1);
  return `<div class="research-price-chart" data-range="${range}" data-review-symbol="${esc(period.symbol)}"><div class="research-chart-heading"><details class="research-chart-info"><summary aria-label="追蹤價格與評分說明"><span aria-hidden="true">ⓘ</span></summary><p>價格顯示變化率，評分顯示變化點數；點選日期查看。資料不足時不比較，價格變化不代表實際投資報酬。</p></details><h5>追蹤價格與評分</h5></div><div class="research-chart-controls"><span class="research-series-key"><i class="price-key"></i>收盤價</span><span class="research-series-key"><i class="score-key"></i>株研評分</span><span></span>${[20, 60, 120].map((days) => `<button type="button" data-review-range="${days}" aria-pressed="${range === days}">${days} 日</button>`).join("")}</div>
    <p class="research-chart-readout" aria-live="polite">${readoutMarkup(last)}</p>
    <div class="research-chart-axis"><span>價格 ${fmt(hi)}<br>${fmt(lo)}</span><span>評分 100<br>0</span></div><div class="research-chart-plot" role="slider" tabindex="0" aria-label="追蹤價格與評分；點選或水平拖曳查看交易日" aria-valuemin="1" aria-valuemax="${points.length}" aria-valuenow="${points.length}" aria-valuetext="${esc(pointReadout(last))}" data-points="${esc(JSON.stringify(points))}"><svg viewBox="0 0 320 124" preserveAspectRatio="none" aria-hidden="true"><path d="M12 18H308M12 63H308M12 108H308" class="grid"/>${segments("close", priceY)}${segments("score", scoreY)}${markers}${scoreMarkers}<line class="cursor" x1="${x(points.length - 1)}" x2="${x(points.length - 1)}" y1="18" y2="108"/><g class="research-selected-date" transform="translate(${Math.max(21, Math.min(299, x(points.length - 1)))},0)"><rect x="-20" y="1" width="40" height="14" rx="4"/><text x="0" y="11" text-anchor="middle">${esc(shortDate(last.date))}</text></g></svg></div><div class="research-chart-dates"><span>${esc(shortDate(points[0].date))}</span><span>${esc(shortDate(points.at(-1).date))}</span></div><p class="research-muted">${esc(baseline.asOf)} 為${period.baseline ? "加入時" : "首次有效"}價格基準 · 收盤價未還原，未計入股息 · 公司行動版本 ${esc(review.corporateActions?.revisionId ?? "待查核")}</p></div>`;
}

export function selectResearchPricePoint(plot, index) {
  const points = JSON.parse(plot.dataset.points);
  const selected = Math.max(0, Math.min(points.length - 1, index));
  const point = points[selected];
  plot.setAttribute("aria-valuenow", String(selected + 1));
  plot.querySelector(".cursor")?.setAttribute("x1", String(12 + selected * 296 / Math.max(1, points.length - 1)));
  plot.querySelector(".cursor")?.setAttribute("x2", String(12 + selected * 296 / Math.max(1, points.length - 1)));
  plot.setAttribute("aria-valuetext", pointReadout(point));
  const date = plot.querySelector(".research-selected-date");
  date?.setAttribute("transform", `translate(${Math.max(21, Math.min(299, 12 + selected * 296 / Math.max(1, points.length - 1)))},0)`);
  if (date) date.querySelector("text").textContent = shortDate(point.date);
  plot.closest(".research-price-chart").querySelector(".research-chart-readout").innerHTML = readoutMarkup(point);
  return point;
}

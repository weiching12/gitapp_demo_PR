import { reviewInitialScore, reviewMilestones } from "../../shared/research-review.js";

const fmt = (value) => Number.isFinite(value) ? value.toFixed(2) : "—";
const signed = (value) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%` : "—";
const stateText = {
  pending: "尚未滿指定交易日", "missing-price": "觀察日資料不足",
  "missing-baseline": "缺少可靠基準", "outside-coverage": "歷史資料未涵蓋",
  incompatible: "價格基準不一致", unavailable: "資料尚未取得",
  "action-unverified": "公司行動待查核",
  "action-affected": "受公司行動影響，暫不提供可比價格變化",
};
const resultText = (result) => result?.status === "comparable" ? signed(result.change) : stateText[result?.status] ?? "資料不足";

export function researchReviewSummary(period, row, esc) {
  if (!row?.review) return '<p class="research-muted">開啟後載入價格回顧；僅保存在目前裝置的追蹤資料不會公開。</p>';
  const result = reviewMilestones(period, row.review);
  const baseline = result.baseline;
  const initial = reviewInitialScore(period, row.latest);
  const initialText = initial.status === "comparable" || initial.status === "same-snapshot"
    ? `加入時／首次有效快照 ${esc(initial.initial.asOf)} → ${esc(row.latest.asOf)}：分數變化 ${initial.finalDelta > 0 ? "+" : ""}${fmt(initial.finalDelta)} 分`
    : initial.status === "incompatible" ? "設定不同，無法直接比較評分" : "缺少加入時可比評分快照";
  const latestEvent = (row?.timeline ?? row?.events ?? []).filter((event) => event.type !== "base-score-change").at(-1);
  const latestReason = latestEvent?.type === "final-score-change" ? latestEvent.reason?.replace(/^最終分數/, "分數") : latestEvent?.reason;
  return `<div class="research-review-summary"><p>${baseline ? `${result.baselineType === "join" ? "加入時基準" : "自首次有效價格起"} ${esc(baseline.asOf)} · ${fmt(baseline.close)} · ${esc(baseline.source)}` : "加入時沒有可靠價格基準"}</p>
    <dl>${[5, 10, 20].map((day) => `<div><dt>第 ${day} 個交易日</dt><dd>${result.milestones[day].status === "pending" ? `尚未滿 ${day} 個交易日` : `${result.milestones[day].date ? `${esc(result.milestones[day].date)} · ` : ""}${resultText(result.milestones[day])}`}</dd></div>`).join("")}
    <div><dt>截至 ${esc(result.latestDate ?? "最新交易日")}</dt><dd>${resultText(result.latest)}</dd></div></dl><p>${initialText}</p><p>最近研究事件：${latestEvent ? `${esc(latestEvent.toDate)} · ${esc(latestReason)}` : "尚無可確認事件"}</p>
    <small>價格變化採未還原收盤價，未計入股息；有公司行動或待查核區間不顯示可比變化。${row.review.source === "demo" ? "本機示範價格及平日曆，非真實市場資料。" : ""}</small></div>`;
}

export function researchPriceChart(period, row, esc, range = 60) {
  const review = row?.review;
  const baseline = period?.baseline ?? period?.firstValidPriceBaseline;
  if (!review || !baseline) return '<p class="research-muted">缺少可靠價格基準或價格資料，無法繪製追蹤價格走勢。</p>';
  const base = review.dates.indexOf(baseline.asOf);
  if (base < 0) return '<p class="research-muted">基準日期已超出可查詢的歷史範圍，無法繪製連續走勢。</p>';
  const dates = review.dates.slice(Math.max(base, review.dates.length - range));
  const byDate = new Map(review.bars.map((bar) => [bar.date, bar.close]));
  const scores = new Map((row.history ?? []).filter((snap) => snap.valid && Number.isFinite(snap.finalScore))
    .map((snap) => [snap.asOf, snap.finalScore]));
  const points = dates.map((date) => ({ date, close: byDate.get(date) ?? null, score: scores.get(date) ?? null }));
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
    return result.map((segment) => `<polyline points="${segment.join(" ")}" class="${key}-line"/>`).join("");
  };
  const milestoneDates = [5, 10, 20].map((day) => review.dates[base + day]).filter(Boolean);
  const eventDates = new Set((row.timeline ?? []).map((event) => event.toDate));
  const markers = points.map((point, index) => !Number.isFinite(point.close) || point.close <= 0 ? "" :
    `<circle cx="${x(index).toFixed(1)}" cy="${priceY(point.close).toFixed(1)}" r="${milestoneDates.includes(point.date) || eventDates.has(point.date) ? 3 : 1.5}" class="price-marker${eventDates.has(point.date) ? " event" : ""}"><title>${esc(point.date)} 收盤 ${fmt(point.close)}${eventDates.has(point.date) ? " · 研究事件" : ""}</title></circle>`).join("");
  const scoreMarkers = points.map((point, index) => Number.isFinite(point.score)
    ? `<circle cx="${x(index).toFixed(1)}" cy="${scoreY(point.score).toFixed(1)}" r="2.5" class="score-marker"><title>${esc(point.date)} 評分 ${fmt(point.score)}</title></circle>` : "").join("");
  const last = points.at(-1);
  return `<div class="research-price-chart" data-range="${range}" data-review-symbol="${esc(period.symbol)}"><div class="research-chart-heading"><details class="research-chart-info"><summary aria-label="追蹤價格與評分說明"><span aria-hidden="true">ⓘ</span></summary><p>同時顯示收藏後各交易日的實際收盤價與株研評分。評分使用原始分數，不換算為基準 100；兩條線各用自己的刻度。缺少評分的日期不補零，價格也不代表實際投資報酬。</p></details><h5>追蹤價格與評分</h5></div><div class="research-chart-controls"><span class="research-series-key"><i class="price-key"></i>收盤價</span><span class="research-series-key"><i class="score-key"></i>株研評分</span><span></span>${[20, 60, 120].map((days) => `<button type="button" data-review-range="${days}" aria-pressed="${range === days}">${days} 日</button>`).join("")}</div>
    <p class="research-chart-readout" aria-live="polite">${esc(last.date)} · 收盤 ${fmt(last.close)} · 評分 ${fmt(last.score)} 分</p>
    <div class="research-chart-axis"><span>價格 ${fmt(hi)}<br>${fmt(lo)}</span><span>評分 100<br>0</span></div><div class="research-chart-plot" role="slider" tabindex="0" aria-label="追蹤價格與評分；點選或水平拖曳查看交易日" aria-valuemin="1" aria-valuemax="${points.length}" aria-valuenow="${points.length}" data-points="${esc(JSON.stringify(points))}"><svg viewBox="0 0 320 124" preserveAspectRatio="none" aria-hidden="true"><path d="M12 18H308M12 63H308M12 108H308" class="grid"/>${segments("close", priceY)}${segments("score", scoreY)}${markers}${scoreMarkers}<line class="cursor" x1="${x(points.length - 1)}" x2="${x(points.length - 1)}" y1="18" y2="108"/></svg></div><div class="research-chart-dates"><span>${esc(points[0].date)}</span><span>${esc(points.at(-1).date)}</span></div><p class="research-muted">${esc(baseline.asOf)} 為${period.baseline ? "加入時" : "首次有效"}價格基準 · 收盤價未還原，未計入股息 · 公司行動版本 ${esc(review.corporateActions?.revisionId ?? "待查核")}</p></div>`;
}

export function selectResearchPricePoint(plot, index) {
  const points = JSON.parse(plot.dataset.points);
  const selected = Math.max(0, Math.min(points.length - 1, index));
  const point = points[selected];
  plot.setAttribute("aria-valuenow", String(selected + 1));
  plot.querySelector(".cursor")?.setAttribute("x1", String(12 + selected * 296 / Math.max(1, points.length - 1)));
  plot.querySelector(".cursor")?.setAttribute("x2", String(12 + selected * 296 / Math.max(1, points.length - 1)));
  plot.closest(".research-price-chart").querySelector(".research-chart-readout").textContent =
    `${point.date} · 收盤 ${fmt(point.close)} · 評分 ${fmt(point.score)} 分`;
}

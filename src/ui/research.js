import { activeResearchPeriod } from "./research-store.js";
import { reviewInitialScore } from "../../shared/research-review.js";
import { researchPriceChart, researchReviewSummary } from "./research-review.js";

const fmt = (value) => Number.isFinite(value) ? value.toFixed(2) : "—";
const delta = (value) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${fmt(value)}` : "—";
const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "neutral";
const dateTime = (value) => value ? new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "原始加入時間未知";
const important = (row) => (row?.comparison?.events ?? []).length > 0;
const categoryLabels = { trend: "趨勢", momentum: "KD", priceVolume: "量價", institutional: "法人", entryRisk: "進場風險" };

export function researchCardTrend(period, row) {
  const latest = row?.latest;
  const result = reviewInitialScore(period, latest);
  const initial = result.initial;
  if (!initial) return { status: "missing-initial", label: "收藏後變化", points: (row?.history ?? []).filter((item) => item.asOf <= latest?.asOf),
    reason: "收藏基準未知，僅顯示近期走勢" };
  const label = period?.addedSnapshot?.valid ? "自收藏後" : "自首次有效評分起";
  if (!latest?.valid) return { status: "missing-latest", label, points: [] };
  if (!["comparable", "same-snapshot"].includes(result.status))
    return { status: result.status, label, points: [], reason: result.status === "incompatible" ? "設定不同，暫不比較" : "資料不足，暫不比較" };
  const history = (row.history ?? []).filter((item) => item.asOf > initial.asOf && item.asOf <= latest.asOf);
  const firstHistoryDate = row.history?.[0]?.asOf;
  const points = [initial];
  if (firstHistoryDate > initial.asOf || !history.length && initial.asOf < latest.asOf)
    points.push({ asOf: "gap", valid: false });
  points.push(...history);
  if (!points.some((item) => item.asOf === latest.asOf)) points.push(latest);
  const conditionChange = Object.entries(categoryLabels).find(([key]) =>
    initial.conditions?.[key]?.status !== latest.conditions?.[key]?.status &&
    [initial.conditions?.[key]?.status, latest.conditions?.[key]?.status].every((status) => ["PASS", "FAIL"].includes(status)));
  let reason;
  if (result.status === "same-snapshot" || initial.asOf === latest.asOf) reason = "等待後續交易日評分";
  else if (conditionChange) reason = `${conditionChange[1]}條件${latest.conditions[conditionChange[0]].status === "PASS" ? "改善" : "失效"}`;
  else if (Boolean(initial.cap?.enabled) !== Boolean(latest.cap?.enabled)) reason = latest.cap?.enabled ? "分數上限啟用" : "分數上限解除";
  else {
    const category = Object.entries(categoryLabels).map(([key, name]) => ({ name,
      change: Number.isFinite(latest.categories?.[key]?.creditedContribution) && Number.isFinite(initial.categories?.[key]?.creditedContribution)
        ? latest.categories[key].creditedContribution - initial.categories[key].creditedContribution : null }))
      .filter((item) => Number.isFinite(item.change)).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
    reason = category && Math.abs(category.change) >= .005 ? `${category.name}貢獻${category.change > 0 ? "提高" : "下降"}` : "分數持平";
  }
  return { status: result.status, label, initial, latest, delta: result.finalDelta, points, reason };
}

function researchCardSparkline(trend, esc) {
  if (!trend.points.length) return `<span class="research-spark-empty">${esc(trend.reason ?? trend.label)}</span>`;
  const values = trend.points.filter((item) => item.valid && Number.isFinite(item.finalScore)).map((item) => item.finalScore);
  if (!values.length) return `<span class="research-spark-empty">${esc(trend.reason ?? "缺少可用評分")}</span>`;
  const low = Math.max(0, Math.min(...values) - 2), high = Math.min(100, Math.max(...values) + 2);
  const range = Math.max(10, high - low), center = (high + low) / 2;
  const y = (value) => (18 - (value - center) * 28 / range).toFixed(1);
  const segments = []; let current = [], previous = null;
  trend.points.forEach((item, index) => {
    const compatible = previous && ["modelVersion", "strategy", "configId", "priceBasis", "source"]
      .every((key) => previous[key] === item[key]);
    if (!item.valid || !Number.isFinite(item.finalScore) || previous && !compatible) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    if (item.valid && Number.isFinite(item.finalScore)) current.push(`${4 + index * 92 / Math.max(1, trend.points.length - 1)},${y(item.finalScore)}`);
    previous = item.valid ? item : null;
  });
  if (current.length > 1) segments.push(current);
  const latestPoint = trend.points.findLast((item) => item.valid && Number.isFinite(item.finalScore));
  const endIndex = trend.points.lastIndexOf(latestPoint);
  const startPoint = trend.points.find((item) => item.valid && Number.isFinite(item.finalScore));
  const startIndex = trend.points.indexOf(startPoint);
  return `<svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"><path d="M4 18H96" class="research-spark-guide"/>${segments.map((segment) => `<polyline points="${segment.join(" ")}"/>`).join("")}<circle class="research-spark-start" cx="${4 + startIndex * 92 / Math.max(1, trend.points.length - 1)}" cy="${y(startPoint.finalScore)}" r="2.2"/><circle cx="${4 + endIndex * 92 / Math.max(1, trend.points.length - 1)}" cy="${y(latestPoint.finalScore)}" r="2.4"/></svg>`;
}

function scoreChart(history) {
  const points = [...history].sort((a, b) => a.asOf.localeCompare(b.asOf));
  if (points.length < 2) return '<p class="research-muted">已保存的交易日快照不足，尚無法繪製歷史圖。</p>';
  const line = (key, color) => {
    let segments = [], current = [];
    points.forEach((item, index) => {
      if (!item.valid || !Number.isFinite(item[key]) ||
          (index && (["modelVersion", "configId", "priceBasis"].some((field) => item[field] !== points[index - 1][field]) || item.source !== points[index - 1].source))) {
        if (current.length > 1) segments.push(current);
        current = [];
      }
      if (item.valid && Number.isFinite(item[key])) current.push(`${8 + index * 284 / (points.length - 1)},${106 - item[key] * .9}`);
    });
    if (current.length > 1) segments.push(current);
    return segments.map((segment) => `<polyline points="${segment.join(" ")}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`).join("");
  };
  const last = points.at(-1);
  const markers = points.map((point, index) => point.cap?.enabled && point.valid
    ? `<circle cx="${8 + index * 284 / (points.length - 1)}" cy="${106 - point.finalScore * .9}" r="3" fill="#e19971"><title>${point.asOf} · 上限 ${point.cap.value}</title></circle>` : "").join("");
  return `<div class="research-chart"><p class="research-score-readout" aria-live="polite">${last.asOf} · 基礎 ${fmt(last.baseScore)} · 最終 ${fmt(last.finalScore)}${last.cap?.enabled ? ` · 上限 ${fmt(last.cap.value)}` : ""}${last.source === "historical-recalculation" ? " · 歷史重算" : ""}</p><div class="research-score-plot" role="slider" tabindex="0" aria-label="基礎分數與最終分數歷史；點選或水平拖曳查看" aria-valuemin="1" aria-valuemax="${points.length}" aria-valuenow="${points.length}" data-points="${encodeURIComponent(JSON.stringify(points.map((point) => ({ date: point.asOf, baseScore: point.baseScore ?? null, finalScore: point.finalScore ?? null, cap: point.cap ?? null, source: point.source ?? null }))))}"><svg viewBox="0 0 300 116" preserveAspectRatio="none" aria-hidden="true"><path d="M8 16H292M8 61H292M8 106H292" stroke="currentColor" opacity=".15"/>${line("baseScore", "#6a9cff")}${line("finalScore", "#e19971")}${markers}<line class="cursor" x1="292" x2="292" y1="16" y2="106"/></svg></div><div><span>${points[0].asOf}</span><span>藍：基礎　橘：最終 · 圓點：上限</span><span>${points.at(-1).asOf}</span></div></div>`;
}

export function selectResearchScorePoint(plot, index) {
  const points = JSON.parse(decodeURIComponent(plot.dataset.points));
  const selected = Math.max(0, Math.min(points.length - 1, index));
  const point = points[selected];
  plot.setAttribute("aria-valuenow", String(selected + 1));
  const x = String(8 + selected * 284 / Math.max(1, points.length - 1));
  plot.querySelector(".cursor")?.setAttribute("x1", x);
  plot.querySelector(".cursor")?.setAttribute("x2", x);
  plot.closest(".research-chart").querySelector(".research-score-readout").textContent =
    `${point.date} · 基礎 ${fmt(point.baseScore)} · 最終 ${fmt(point.finalScore)}${point.cap?.enabled ? ` · 上限 ${fmt(point.cap.value)}` : ""}${point.source === "historical-recalculation" ? " · 歷史重算" : ""}`;
}

export function renderResearchCenter({ favorites, stocks, rows, store, date, sort, filter, esc }) {
  const bySymbol = new Map(stocks.map((stock) => [stock.symbol, stock]));
  const values = favorites.map((symbol) => ({ symbol, stock: bySymbol.get(symbol), row: rows.get(symbol),
    trend: researchCardTrend(activeResearchPeriod(store, symbol), rows.get(symbol)) }));
  const comparable = values.filter(({ trend }) => trend.status === "comparable" && trend.initial.asOf !== trend.latest.asOf);
  const increased = comparable.filter(({ trend }) => trend.delta > 0).length;
  const changed = new Set(values.filter(({ row }) => important(row)).map(({ symbol }) => symbol)).size;
  const filtered = values.filter(({ row }) => filter === "all" || filter === "important" && important(row) ||
    filter === "improved" && row?.comparison?.conditionsImproved || filter === "lost" && row?.comparison?.conditionsLost);
  filtered.sort((a, b) => {
    const av = sort === "change" ? a.trend.status === "comparable" && a.trend.initial.asOf !== a.trend.latest.asOf ? a.trend.delta : null : a.row?.latest?.valid ? a.row.latest.finalScore : null;
    const bv = sort === "change" ? b.trend.status === "comparable" && b.trend.initial.asOf !== b.trend.latest.asOf ? b.trend.delta : null : b.row?.latest?.valid ? b.row.latest.finalScore : null;
    return av === null && bv === null ? a.symbol.localeCompare(b.symbol) : av === null ? 1 : bv === null ? -1 : bv - av || a.symbol.localeCompare(b.symbol);
  });
  const cards = filtered.map(({ symbol, stock, row, trend }) => {
    const snap = row?.latest;
    const label = stock?.name ?? symbol;
    const condition = snap?.valid ? `${snap.passedCount}/${snap.totalConditions} 必要條件通過` : "必要資料不足";
    const comparableTrend = trend.status === "comparable" && trend.initial.asOf !== trend.latest.asOf;
    const changeValue = comparableTrend ? delta(trend.delta) : "—";
    const baseline = trend.initial ? `${trend.initial.asOf} ${fmt(trend.initial.finalScore)} 分` : "尚無收藏基準";
    const changeDetail = `${trend.label}：${baseline} → ${snap?.asOf ?? "—"} ${fmt(snap?.finalScore)} 分；${trend.reason ?? ""}`;
    const chartLabel = `${trend.initial ? `${trend.label}分數走勢；${baseline}` : "近期已保存評分走勢；收藏時分數未知"}，最新 ${snap?.asOf ?? "—"} ${fmt(snap?.finalScore)} 分${trend.points.some((point) => point.asOf === "gap") ? "；中間資料未保存，線段中斷" : ""}`;
    const chartStart = trend.initial ?? trend.points.find((point) => point.valid && Number.isFinite(point.finalScore));
    return `<article class="research-card" data-research-symbol="${esc(symbol)}"><button type="button" class="research-card-main" data-entry-score="${esc(symbol)}"><span class="research-stock"><span class="research-stock-head"><span class="research-code">${esc(symbol)}</span><strong>${esc(label)}</strong></span>${row?.source === "historical-recalculation" ? "<small>模擬重算</small>" : ""}</span><span class="research-score"><small>最終分數</small><strong>${fmt(snap?.finalScore)}</strong></span><span class="research-delta ${tone(comparableTrend ? trend.delta : null)}" title="${esc(changeDetail)}" aria-label="${esc(changeDetail)}"><small>${esc(trend.label)}</small><strong>${changeValue}</strong></span><span class="research-sparkline" role="img" aria-label="${esc(chartLabel)}"><small>${chartStart ? esc(chartStart.asOf.slice(5).replace("-", "/")) : "—"}</small>${researchCardSparkline(trend, esc)}<small>${esc(snap?.asOf?.slice(5).replace("-", "/") ?? "最新")}</small></span><span class="research-card-foot"><span class="research-condition ${snap?.valid ? "" : "insufficient"}">${esc(condition)}${snap?.cap?.enabled ? ` · 上限 ${fmt(snap.cap.value)}` : ""}</span><span class="research-summary">${esc(row?.loading ? "讀取研究快照中" : trend.reason ?? "缺少當日評分快照")}</span></span></button></article>`;
  }).join("");
  return { stats: `<div><strong>${favorites.length}</strong><span>追蹤股票</span></div><div><strong>${increased}<small> / ${comparable.length}</small></strong><span>收藏後提高／可比較</span></div><div><strong>${changed}<small> / ${favorites.length}</small></strong><span>重要異動／追蹤</span></div>`,
    cards: cards || `<p class="research-muted">${favorites.length ? "此篩選目前沒有股票。" : "尚無追蹤股票。"}</p>` };
}

function researchDetailMarkupV2({ symbol, row, store, esc }) {
  if (!store) return "";
  const period = activeResearchPeriod(store, symbol);
  if (!period) return "";
  const snap = row?.latest;
  const comparison = row?.comparison;
  const events = row?.timeline ?? row?.events ?? [];
  const categoryNames = { trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現",
    institutional: "法人籌碼", entryRisk: "進場位置與風險" };
  const categoryMarkup = snap?.valid ? `<details class="research-breakdown"><summary>構面變化與快照版本</summary><dl class="research-facts">${Object.entries(categoryNames).map(([key, name]) =>
    `<div><dt>${name}</dt><dd>${fmt(snap.categories?.[key]?.score)} 分 · 加權計入 ${fmt(snap.categories?.[key]?.creditedContribution)}${Number.isFinite(comparison?.categoryDeltas?.[key]) ? ` · 變化 ${delta(comparison.categoryDeltas[key])}` : ""}</dd></div>`).join("")}
    <div><dt>上限</dt><dd>${snap.cap?.enabled ? `${fmt(snap.cap.value)} 分 · ${esc(snap.cap.reason ?? "")}` : "未啟用"}</dd></div><div><dt>模型／設定</dt><dd>${esc(snap.modelVersion ?? "—")} · ${esc(snap.configId ?? "—")}</dd></div><div><dt>價格基準／版本</dt><dd>${esc(snap.priceBasis ?? "—")} · ${esc(snap.revisionId ?? "—")}</dd></div><div><dt>資料取得時間</dt><dd>${esc(dateTime(snap.capturedAt))}</dd></div></dl></details>` : "";
  return `<section class="entry-evidence research-detail"><h3>研究追蹤</h3><dl class="research-facts research-tracking-facts"><div><dt>加入時間</dt><dd>${esc(dateTime(period.addedAt))}</dd></div><div><dt>開始追蹤</dt><dd>${esc(dateTime(period.startedAt))}</dd></div><div><dt>加入時快照</dt><dd>${period.addedSnapshot ? `${esc(period.addedSnapshot.asOf)} · ${period.addedSnapshot.valid ? `${fmt(period.addedSnapshot.finalScore)} 分` : esc(period.addedSnapshot.missingData?.join("、") || "資料不足")}` : "原始加入時快照未知"}</dd></div><div><dt>首次有效快照</dt><dd>${period.firstValidSnapshot ? `${esc(period.firstValidSnapshot.asOf)} · ${fmt(period.firstValidSnapshot.finalScore)} 分` : "尚未取得"}</dd></div><div><dt>最新保存快照</dt><dd>${snap ? `${esc(snap.asOf)} · ${snap.valid ? `${fmt(snap.finalScore)} 分` : esc(snap.missingData?.join("、") || "資料不足")}` : "尚無保存快照"}</dd></div><div><dt>與前一交易日</dt><dd>${esc(comparison?.summary ?? "缺少前期資料")}</dd></div></dl>${scoreChart(row?.history ?? [])}${categoryMarkup}<h4>研究事件時間軸</h4>${events.length ? `<ol class="research-events">${events.map((event) => `<li><time>${esc(event.fromDate)} → ${esc(event.toDate)}</time><span>${esc(event.reason)}</span></li>`).join("")}</ol>` : '<p class="research-muted">尚無可判定的研究異動。</p>'}<p class="research-muted">明顯變化提示門檻為 10 分，未經策略回測驗證；歷史覆蓋以已保存快照為準。</p></section>`;
}

export function researchDetailMarkup({ symbol, row, store, esc }) {
  const base = researchDetailMarkupV2({ symbol, row, store, esc });
  const period = activeResearchPeriod(store, symbol);
  if (!base || !period) return base;
  const latest = row?.latest;
  const initial = reviewInitialScore(period, latest);
  const initialSnapshot = initial.initial;
  const names = { trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現", institutional: "法人籌碼", entryRisk: "進場位置與風險" };
  const comparable = ["comparable", "same-snapshot"].includes(initial.status);
  const pair = (label, before, after, suffix = "") => `<div><dt>${label}</dt><dd>${esc(String(before ?? "—"))} → ${esc(String(after ?? "—"))}${suffix}</dd></div>`;
  const compare = `<details class="research-breakdown" open><summary>加入時與目前研究差異</summary><p class="research-muted">${initialSnapshot ? `${period.addedSnapshot?.valid ? "加入時" : "首次有效"} ${esc(initialSnapshot.asOf)} → ${esc(latest?.asOf ?? "—")}` : "缺少加入時或首次有效評分快照"}${!comparable && initial.status === "incompatible" ? " · 設定不同，無法直接比較" : ""}</p><dl class="research-facts">${pair("基礎分數", fmt(initialSnapshot?.baseScore), fmt(latest?.baseScore), comparable ? ` · 變化 ${delta(initial.baseDelta)}` : "")}${pair("最終分數", fmt(initialSnapshot?.finalScore), fmt(latest?.finalScore), comparable ? ` · 變化 ${delta(initial.finalDelta)}` : "")}${Object.entries(names).map(([key, name]) => pair(name, fmt(initialSnapshot?.categories?.[key]?.score), fmt(latest?.categories?.[key]?.score))).join("")}${pair("必要條件", initialSnapshot ? `${initialSnapshot.passedCount}/${initialSnapshot.totalConditions}` : null, latest ? `${latest.passedCount}/${latest.totalConditions}` : null)}${Object.entries(names).map(([key, name]) => pair(`${name}條件`, initialSnapshot?.conditions?.[key]?.status, latest?.conditions?.[key]?.status)).join("")}${pair("分數上限", initialSnapshot?.cap?.enabled ? `${fmt(initialSnapshot.cap.value)}：${initialSnapshot.cap.reason ?? ""}` : "未啟用", latest?.cap?.enabled ? `${fmt(latest.cap.value)}：${latest.cap.reason ?? ""}` : "未啟用")}${pair("資料完整性", initialSnapshot?.valid ? "完整" : (initialSnapshot?.missingData?.join("、") ?? "未知"), latest?.valid ? "完整" : (latest?.missingData?.join("、") ?? "未知"))}${pair("模型／設定", initialSnapshot ? `${initialSnapshot.modelVersion} · ${initialSnapshot.configId}` : null, latest ? `${latest.modelVersion} · ${latest.configId}` : null)}</dl></details>`;
  const review = `<section class="research-review-detail"><h4>追蹤價格表現</h4>${researchReviewSummary(period, row, esc)}${researchPriceChart(period, row, esc)}</section>${compare}`;
  return base.replace(/<\/section>$/, `${review}</section>`);
}

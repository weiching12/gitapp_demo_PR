import { activeResearchPeriod } from "./research-store.js";
import { reviewInitialScore } from "../../shared/research-review.js";
import { researchPriceChart } from "./research-review.js";

const fmt = (value) => Number.isFinite(value) ? value.toFixed(2) : "—";
const delta = (value) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${fmt(value)}` : "—";
const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "neutral";
const dateTime = (value) => value ? new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "原始加入時間未知";
const visibleEvents = (row) => (row?.timeline ?? row?.events ?? [])
  .filter((event) => event.type !== "base-score-change")
  .map((event) => event.type === "final-score-change"
    ? { ...event, reason: event.reason?.replace(/^最終分數/, "分數") }
    : event);
const important = (row) => (row?.comparison?.events ?? []).some((event) => event.type !== "base-score-change");
const categoryLabels = { trend: "趨勢", momentum: "KD", priceVolume: "量價", institutional: "法人", entryRisk: "進場風險" };

export function researchCardTrend(period, row) {
  const latest = row?.latest;
  const result = reviewInitialScore(period, latest);
  const initial = result.initial;
  if (!initial) return { status: "missing-initial", label: "收藏後變化", reason: "收藏基準未知，無法比較" };
  const label = period?.addedSnapshot?.valid ? "自收藏後" : "自首次有效評分起";
  if (!latest?.valid) return { status: "missing-latest", label };
  if (!["comparable", "same-snapshot"].includes(result.status))
    return { status: result.status, label, reason: result.status === "incompatible" ? "設定不同，暫不比較" : "資料不足，暫不比較" };
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
  return { status: result.status, label, initial, latest, delta: result.finalDelta, reason };
}

function scoreChart(history) {
  const points = [...history].filter((item) => item.valid && Number.isFinite(item.finalScore))
    .sort((a, b) => a.asOf.localeCompare(b.asOf));
  const heading = '<div class="research-chart-heading"><details class="research-chart-info"><summary aria-label="個股歷史評分說明"><span aria-hidden="true">ⓘ</span></summary><p>顯示這檔股票各交易日可取得的株研評分，觀察研究條件符合程度如何變化。可能包含收藏前的評分；沒有可用分數的日期不列入圖表。</p></details><h4>個股歷史評分</h4></div>';
  if (!points.length) return `<div class="research-chart">${heading}<p class="research-muted">目前沒有可繪製的有效評分。</p></div>`;
  const line = (key, color) => {
    let segments = [], current = [];
    points.forEach((item, index) => {
      if (!item.valid || !Number.isFinite(item[key]) ||
          (index && (["modelVersion", "configId", "priceBasis"].some((field) => item[field] !== points[index - 1][field]) || item.source !== points[index - 1].source))) {
        if (current.length > 1) segments.push(current);
        current = [];
      }
      if (item.valid && Number.isFinite(item[key])) current.push(`${8 + index * 284 / Math.max(1, points.length - 1)},${106 - item[key] * .9}`);
    });
    if (current.length > 1) segments.push(current);
    return segments.map((segment) => `<polyline points="${segment.join(" ")}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`).join("");
  };
  const last = points.at(-1);
  const markers = points.map((point, index) => point.cap?.enabled && point.valid
    ? `<circle cx="${8 + index * 284 / Math.max(1, points.length - 1)}" cy="${106 - point.finalScore * .9}" r="3" fill="#e19971"><title>${point.asOf} · 上限 ${point.cap.value}</title></circle>` : "").join("");
  const singleMarker = points.length === 1 ? `<circle cx="8" cy="${106 - last.finalScore * .9}" r="3" fill="#6a9cff"><title>${last.asOf} · ${fmt(last.finalScore)} 分</title></circle>` : "";
  return `<div class="research-chart">${heading}<p class="research-score-readout" aria-live="polite">${last.asOf} · ${fmt(last.finalScore)} 分${last.cap?.enabled ? ` · 上限 ${fmt(last.cap.value)}` : ""}${last.source === "historical-recalculation" ? " · 歷史重算" : ""}</p>${points.length === 1 ? '<p class="research-muted">目前只有一筆有效評分，尚無跨日變化。</p>' : ""}<div class="research-score-plot" role="slider" tabindex="0" aria-label="分數歷史；點選或水平拖曳查看" aria-valuemin="1" aria-valuemax="${points.length}" aria-valuenow="${points.length}" data-points="${encodeURIComponent(JSON.stringify(points.map((point) => ({ date: point.asOf, finalScore: point.finalScore ?? null, cap: point.cap ?? null, source: point.source ?? null }))))}"><svg viewBox="0 0 300 116" preserveAspectRatio="none" aria-hidden="true"><path d="M8 16H292M8 61H292M8 106H292" stroke="currentColor" opacity=".15"/>${line("finalScore", "#6a9cff")}${markers}${singleMarker}<line class="cursor" x1="${points.length === 1 ? 8 : 292}" x2="${points.length === 1 ? 8 : 292}" y1="16" y2="106"/></svg></div><div><span>${points[0].asOf}</span><span>${points.length > 1 ? "圓點：分數上限" : "僅一筆有效評分"}</span><span>${points.at(-1).asOf}</span></div></div>`;
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
    `${point.date} · ${fmt(point.finalScore)} 分${point.cap?.enabled ? ` · 上限 ${fmt(point.cap.value)}` : ""}${point.source === "historical-recalculation" ? " · 歷史重算" : ""}`;
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
  const entries = filtered.map(({ symbol, stock, row, trend }) => {
    const snap = row?.latest;
    const label = stock?.name ?? symbol;
    const condition = snap?.valid ? `${snap.passedCount}/${snap.totalConditions} 必要條件通過` : "必要資料不足";
    const comparableTrend = trend.status === "comparable" && trend.initial.asOf !== trend.latest.asOf;
    const changeValue = comparableTrend ? delta(trend.delta) : "—";
    const baseline = trend.initial ? `${trend.initial.asOf} ${fmt(trend.initial.finalScore)} 分` : "尚無收藏基準";
    const changeDetail = `${trend.label}：${baseline} → ${snap?.asOf ?? "—"} ${fmt(snap?.finalScore)} 分；${trend.reason ?? ""}`;
    const dateLabel = comparableTrend ? `${trend.label} · ${trend.initial.asOf.slice(5).replace("-", "/")} → ${snap.asOf.slice(5).replace("-", "/")}` : trend.label;
    const reason = row?.loading ? "讀取研究快照中" : trend.reason ?? "缺少當日評分快照";
    const conditionText = `${condition}${snap?.cap?.enabled ? ` · 上限 ${fmt(snap.cap.value)}` : ""}`;
    return `<tr class="research-card" data-research-symbol="${esc(symbol)}" data-entry-score="${esc(symbol)}"><th scope="row"><button type="button" class="research-card-main" data-entry-score="${esc(symbol)}" aria-label="查看 ${esc(symbol)} ${esc(label)} 株研評分"><span class="research-stock"><span class="research-stock-head"><span class="research-code">${esc(symbol)}</span><strong>${esc(label)}</strong></span>${row?.source === "historical-recalculation" ? "<small>模擬重算</small>" : ""}</span></button></th><td class="research-score"><strong>${fmt(snap?.finalScore)}</strong></td><td class="research-delta ${tone(comparableTrend ? trend.delta : null)}" title="${esc(changeDetail)}"><strong>${changeValue}</strong><small>${esc(dateLabel)}</small></td><td class="research-condition ${snap?.valid ? "" : "insufficient"}">${esc(conditionText)}</td><td class="research-summary">${esc(reason)}</td></tr><tr class="research-mobile-detail" aria-hidden="true"><td colspan="5"><span>${esc(conditionText)}</span><span>${esc(reason)}</span></td></tr>`;
  }).join("");
  return { stats: `<div><strong>${favorites.length}</strong><span>追蹤股票</span></div><div><strong>${increased}<small> / ${comparable.length}</small></strong><span>收藏後提高／可比較</span></div><div><strong>${changed}<small> / ${favorites.length}</small></strong><span>重要異動／追蹤</span></div>`,
    cards: entries ? `<table class="research-table"><thead><tr><th scope="col">股票</th><th scope="col">分數</th><th scope="col">分數變化</th><th scope="col">必要條件</th><th scope="col">最新異動</th></tr></thead><tbody>${entries}</tbody></table>`
      : `<p class="research-muted">${favorites.length ? "此篩選目前沒有股票。" : "尚無追蹤股票。"}</p>` };
}

function researchDetailMarkupV2({ symbol, row, store, esc }) {
  if (!store) return "";
  const period = activeResearchPeriod(store, symbol);
  if (!period) return "";
  const snap = row?.latest;
  const comparison = row?.comparison;
  const events = visibleEvents(row);
  const categoryNames = { trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現",
    institutional: "法人籌碼", entryRisk: "進場位置與風險" };
  const categoryMarkup = snap?.valid ? `<details class="research-breakdown"><summary>構面變化與快照版本</summary><dl class="research-facts">${Object.entries(categoryNames).map(([key, name]) =>
    `<div><dt>${name}</dt><dd>${fmt(snap.categories?.[key]?.score)} 分 · 加權計入 ${fmt(snap.categories?.[key]?.creditedContribution)}${Number.isFinite(comparison?.categoryDeltas?.[key]) ? ` · 變化 ${delta(comparison.categoryDeltas[key])}` : ""}</dd></div>`).join("")}
    <div><dt>上限</dt><dd>${snap.cap?.enabled ? `${fmt(snap.cap.value)} 分 · ${esc(snap.cap.reason ?? "")}` : "未啟用"}</dd></div><div><dt>模型／設定</dt><dd>${esc(snap.modelVersion ?? "—")} · ${esc(snap.configId ?? "—")}</dd></div><div><dt>價格基準／版本</dt><dd>${esc(snap.priceBasis ?? "—")} · ${esc(snap.revisionId ?? "—")}</dd></div><div><dt>資料取得時間</dt><dd>${esc(dateTime(snap.capturedAt))}</dd></div></dl></details>` : "";
  const trackingScore = period.addedSnapshot?.valid && Number.isFinite(period.addedSnapshot.finalScore)
    ? `${esc(period.addedSnapshot.asOf)} · ${fmt(period.addedSnapshot.finalScore)} 分`
    : period.addedSnapshot ? "追蹤時資料不足" : "追蹤時評分未保存";
  return `<section class="entry-evidence research-detail"><h3>研究追蹤</h3><dl class="research-facts research-tracking-facts"><div><dt>追蹤時間</dt><dd>${period.startedAt ? esc(dateTime(period.startedAt)) : "追蹤時間未知"}</dd></div><div><dt>追蹤時評分</dt><dd>${trackingScore}</dd></div></dl>${scoreChart(row?.history ?? [])}${categoryMarkup}<h4>研究事件時間軸</h4>${events.length ? `<ol class="research-events">${events.map((event) => `<li><time>${esc(event.fromDate)} → ${esc(event.toDate)}</time><span>${esc(event.reason)}</span></li>`).join("")}</ol>` : '<p class="research-muted">尚無可判定的研究異動。</p>'}<p class="research-muted">明顯變化提示門檻為 10 分，未經策略回測驗證；歷史覆蓋以已保存快照為準。</p></section>`;
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
  const compare = `<details class="research-breakdown" open><summary>加入時與目前研究差異</summary><p class="research-muted">${initialSnapshot ? `${period.addedSnapshot?.valid ? "加入時" : "首次有效"} ${esc(initialSnapshot.asOf)} → ${esc(latest?.asOf ?? "—")}` : "缺少加入時或首次有效評分快照"}${!comparable && initial.status === "incompatible" ? " · 設定不同，無法直接比較" : ""}</p><dl class="research-facts">${pair("分數", fmt(initialSnapshot?.finalScore), fmt(latest?.finalScore), comparable ? ` · 變化 ${delta(initial.finalDelta)}` : "")}${Object.entries(names).map(([key, name]) => pair(name, fmt(initialSnapshot?.categories?.[key]?.score), fmt(latest?.categories?.[key]?.score))).join("")}${pair("必要條件", initialSnapshot ? `${initialSnapshot.passedCount}/${initialSnapshot.totalConditions}` : null, latest ? `${latest.passedCount}/${latest.totalConditions}` : null)}${Object.entries(names).map(([key, name]) => pair(`${name}條件`, initialSnapshot?.conditions?.[key]?.status, latest?.conditions?.[key]?.status)).join("")}${pair("分數上限", initialSnapshot?.cap?.enabled ? `${fmt(initialSnapshot.cap.value)}：${initialSnapshot.cap.reason ?? ""}` : "未啟用", latest?.cap?.enabled ? `${fmt(latest.cap.value)}：${latest.cap.reason ?? ""}` : "未啟用")}${pair("資料完整性", initialSnapshot?.valid ? "完整" : (initialSnapshot?.missingData?.join("、") ?? "未知"), latest?.valid ? "完整" : (latest?.missingData?.join("、") ?? "未知"))}${pair("模型／設定", initialSnapshot ? `${initialSnapshot.modelVersion} · ${initialSnapshot.configId}` : null, latest ? `${latest.modelVersion} · ${latest.configId}` : null)}</dl></details>`;
  const review = `<section class="research-review-detail">${researchPriceChart(period, row, esc)}</section>${compare}`;
  return base.replace(/<\/section>$/, `${review}</section>`);
}

import { activeResearchPeriod } from "./research-store.js";
import { reviewInitialScore } from "../../shared/research-review.js";
import { researchPriceChart, researchReviewSummary } from "./research-review.js";

const fmt = (value) => Number.isFinite(value) ? value.toFixed(2) : "—";
const delta = (value) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${fmt(value)}` : "—";
const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "neutral";
const dateTime = (value) => value ? new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "原始加入時間未知";
const important = (row) => (row?.comparison?.events ?? []).length > 0;

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

export function renderResearchCenter({ favorites, stocks, rows, date, sort, filter, esc }) {
  const bySymbol = new Map(stocks.map((stock) => [stock.symbol, stock]));
  const values = favorites.map((symbol) => ({ symbol, stock: bySymbol.get(symbol), row: rows.get(symbol) }));
  const comparable = values.filter(({ row }) => row?.comparison?.status === "comparable");
  const increased = comparable.filter(({ row }) => row.comparison.finalDelta > 0).length;
  const changed = new Set(values.filter(({ row }) => important(row)).map(({ symbol }) => symbol)).size;
  const filtered = values.filter(({ row }) => filter === "all" || filter === "important" && important(row) ||
    filter === "improved" && row?.comparison?.conditionsImproved || filter === "lost" && row?.comparison?.conditionsLost);
  filtered.sort((a, b) => {
    const av = sort === "change" ? a.row?.comparison?.status === "comparable" ? a.row.comparison.finalDelta : null : a.row?.latest?.valid ? a.row.latest.finalScore : null;
    const bv = sort === "change" ? b.row?.comparison?.status === "comparable" ? b.row.comparison.finalDelta : null : b.row?.latest?.valid ? b.row.latest.finalScore : null;
    return av === null && bv === null ? a.symbol.localeCompare(b.symbol) : av === null ? 1 : bv === null ? -1 : bv - av || a.symbol.localeCompare(b.symbol);
  });
  const cards = filtered.map(({ symbol, stock, row }) => {
    const snap = row?.latest, comparison = row?.comparison;
    const label = stock?.name ?? symbol;
    const condition = snap?.valid ? `${snap.passedCount}/${snap.totalConditions} 必要條件通過` : "必要資料不足";
    const summary = comparison?.summary ?? (row?.loading ? "讀取研究快照中" : "缺少當日評分快照");
    const prior = row?.previous;
    const changeDate = comparison?.status === "comparable" ? `較 ${esc(prior.asOf.slice(5).replace("-", "/"))}` : "前日比較";
    const changeValue = comparison?.status === "comparable" ? delta(comparison.finalDelta) : "—";
    const changeSource = row?.source === "historical-recalculation" ? "本機示範資料歷史重算" : "已保存評分快照";
    const changeDetail = comparison?.status === "comparable" ? `${prior.asOf} ${fmt(prior.finalScore)} 分 → ${snap.asOf} ${fmt(snap.finalScore)} 分；${changeSource}` : comparison?.summary ?? "缺少前期資料";
    return `<article class="research-card" data-research-symbol="${esc(symbol)}"><button type="button" class="research-card-main" data-entry-score="${esc(symbol)}"><span class="research-stock"><span class="research-stock-head"><span class="research-code">${esc(symbol)}</span><strong>${esc(label)}</strong></span>${row?.source === "historical-recalculation" ? "<small>模擬重算</small>" : ""}</span><span class="research-score"><small>最終分數</small><strong>${fmt(snap?.finalScore)}</strong></span><span class="research-delta ${tone(comparison?.finalDelta)}" title="${esc(changeDetail)}" aria-label="${esc(changeDetail)}"><small>${changeDate}</small><strong>${changeValue}</strong></span><span class="research-condition">${esc(condition)}${snap?.cap?.enabled ? ` · 上限 ${fmt(snap.cap.value)}` : ""}</span><span class="research-summary">${esc(summary)}</span></button></article>`;
  }).join("");
  return { stats: `<div><strong>${favorites.length}</strong><span>追蹤股票</span></div><div><strong>${increased}/${comparable.length}</strong><span>最終分數提高／可比較</span></div><div><strong>${changed}/${favorites.length}</strong><span>重要異動股票／追蹤</span></div>`,
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
  return `<section class="entry-evidence research-detail"><h3>研究追蹤</h3><dl class="research-facts"><div><dt>加入時間</dt><dd>${esc(dateTime(period.addedAt))}</dd></div><div><dt>開始追蹤</dt><dd>${esc(dateTime(period.startedAt))}</dd></div><div><dt>加入時快照</dt><dd>${period.addedSnapshot ? `${esc(period.addedSnapshot.asOf)} · ${period.addedSnapshot.valid ? `${fmt(period.addedSnapshot.finalScore)} 分` : esc(period.addedSnapshot.missingData?.join("、") || "資料不足")}` : "原始加入時快照未知"}</dd></div><div><dt>首次有效快照</dt><dd>${period.firstValidSnapshot ? `${esc(period.firstValidSnapshot.asOf)} · ${fmt(period.firstValidSnapshot.finalScore)} 分` : "尚未取得"}</dd></div><div><dt>最新保存快照</dt><dd>${snap ? `${esc(snap.asOf)} · ${snap.valid ? `${fmt(snap.finalScore)} 分` : esc(snap.missingData?.join("、") || "資料不足")}` : "尚無保存快照"}</dd></div><div><dt>與前一交易日</dt><dd>${esc(comparison?.summary ?? "缺少前期資料")}</dd></div></dl>${scoreChart(row?.history ?? [])}${categoryMarkup}<h4>研究事件時間軸</h4>${events.length ? `<ol class="research-events">${events.map((event) => `<li><time>${esc(event.fromDate)} → ${esc(event.toDate)}</time><span>${esc(event.reason)}</span></li>`).join("")}</ol>` : '<p class="research-muted">尚無可判定的研究異動。</p>'}<p class="research-muted">明顯變化提示門檻為 10 分，未經策略回測驗證；歷史覆蓋以已保存快照為準。</p></section>`;
}

const trackingReasons = ["", "等待必要條件全部成立", "觀察趨勢延續", "觀察 KD 動能改善", "觀察法人方向", "觀察價格回到策略參考區間", "自訂理由"];

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
  const reason = period.reason ?? "";
  const relevantKey = reason.includes("KD") ? "momentum" : reason.includes("法人") ? "institutional" : null;
  const reasonStatus = reason === "等待必要條件全部成立"
    ? (row?.history ?? []).some((item) => item?.valid && item.passedCount === item.totalConditions)
      ? latest?.passedCount === latest?.totalConditions ? "已觀測到全部成立" : "歷史曾觀測到成立；目前未全部成立"
      : "尚未觀測到全部成立"
    : relevantKey ? `目前條件：${latest?.conditions?.[relevantKey]?.status ?? "資料不足"}`
      : reason ? "僅呈現研究證據，不自動判定完成" : "尚未填寫";
  const notes = `<details class="research-breakdown"><summary>追蹤理由與回顧備註（僅存在目前裝置）</summary><p>${esc(reasonStatus)}</p><form id="research-note-form" data-research-symbol="${esc(symbol)}"><label>追蹤理由 <select name="reason">${trackingReasons.map((item) => `<option value="${esc(item)}"${item === reason ? " selected" : ""}>${esc(item || "尚未填寫")}</option>`).join("")}</select></label><label>回顧備註 <textarea name="note" maxlength="1000">${esc(period.note ?? "")}</textarea></label><button type="submit">儲存研究紀錄</button></form></details>`;
  const review = `<section class="research-review-detail"><h4>追蹤價格表現</h4>${researchReviewSummary(period, row, esc)}${researchPriceChart(period, row, esc)}</section>${compare}${notes}`;
  return base.replace(/<\/section>$/, `${review}</section>`);
}

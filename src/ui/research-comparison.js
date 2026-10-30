import { reviewInitialScore } from "../../shared/research-review.js";

const categories = { trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現",
  institutional: "法人籌碼", entryRisk: "進場位置與風險" };
const fmt = value => Number.isFinite(value) ? value.toFixed(2) : "—";
const signed = value => `${value > 0 ? "+" : ""}${fmt(value)}`;
const status = value => ({ PASS: "通過", FAIL: "未通過", UNKNOWN: "資料不足" })[value] ?? "資料不足";
const tone = value => value > 0 ? "up" : value < 0 ? "down" : "neutral";

export function researchComparisonContent(period, row, date, esc) {
  // Resolve only the selected session. A later score must never fill a missing day.
  const target = row?.latest?.asOf === date ? row.latest
    : (row?.history ?? []).findLast(snapshot => snapshot.asOf === date)
      ?? (period?.addedSnapshot?.asOf === date ? period.addedSnapshot
        : period?.firstValidSnapshot?.asOf === date ? period.firstValidSnapshot : null);
  const comparison = reviewInitialScore(period, target);
  const initial = comparison.initial;
  const baselineLabel = period?.addedSnapshot?.valid ? "加入時" : "首次有效";
  const comparable = Boolean(initial && target && initial.asOf <= date &&
    ["comparable", "same-snapshot"].includes(comparison.status));
  const notice = !initial ? "缺少加入時或首次有效評分快照，無法比較。"
    : initial.asOf > date ? "所選日早於評分基準日，無法比較。"
      : !target ? "所選日沒有評分快照，無法比較。"
        : comparison.status === "incompatible" ? "模型、設定或價格基準不同，無法直接比較。"
          : comparison.status === "revision" ? "同日快照版本不同，無法視為跨日變化。"
            : !comparable ? "所選日資料不足，無法比較。" : "";
  const pair = (label, before, after, suffix = "") => `<div><dt>${label}</dt><dd>${esc(String(before ?? "—"))} → ${esc(String(after ?? "—"))}${suffix}</dd></div>`;
  const cap = snap => snap ? snap.cap?.enabled ? `${fmt(snap.cap.value)}：${snap.cap.reason ?? ""}` : "未啟用" : "—";
  const score = (snap, key) => snap?.valid ? snap.categories?.[key]?.score : null;
  const bar = (value, kind) => `<div class="research-comparison-bar"><span class="research-comparison-track"><i class="${kind}" style="width:${Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0}%"></i></span><span>${fmt(value)}</span></div>`;
  const chart = `<div class="research-comparison-chart" role="group" aria-label="各條件分數比較，滿分 100 分"><div class="research-comparison-legend"><span><i class="baseline"></i>${esc(baselineLabel)} ${esc(initial?.asOf?.slice(5).replace("-", "/") ?? "—")}</span><span><i class="selected"></i>所選日 ${esc(date?.slice(5).replace("-", "/") ?? "—")}</span></div>${Object.entries(categories).map(([key, label]) => {
    const before = score(initial, key), after = score(target, key);
    const change = comparable && Number.isFinite(before) && Number.isFinite(after) ? after - before : null;
    return `<div class="research-comparison-category" data-category="${key}"><div class="research-comparison-category-heading"><strong>${label}</strong>${Number.isFinite(change) ? `<span class="${tone(change)}">${signed(change)} 分</span>` : ""}</div><div role="img" aria-label="${label}，${esc(baselineLabel)} ${fmt(before)} 分，所選日 ${fmt(after)} 分">${bar(before, "baseline")}${bar(after, "selected")}</div><p class="research-comparison-state">${esc(baselineLabel)} ${status(initial?.conditions?.[key]?.status)} → 所選日 ${status(target?.conditions?.[key]?.status)}</p></div>`;
  }).join("")}</div>`;
  return `<p class="research-muted research-comparison-dates" aria-live="polite">${esc(baselineLabel)} ${esc(initial?.asOf ?? "—")} → 所選日 ${esc(date ?? "—")}</p>${notice ? `<p class="research-muted research-comparison-notice">${notice}</p>` : ""}<dl class="research-facts research-comparison-summary">${pair("分數", fmt(initial?.valid ? initial.finalScore : null), fmt(target?.valid ? target.finalScore : null), comparable ? ` · 變化 ${signed(comparison.finalDelta)}` : "")}${pair("必要條件", initial ? `${initial.passedCount}/${initial.totalConditions}` : null, target ? `${target.passedCount}/${target.totalConditions}` : null)}</dl>${chart}<dl class="research-facts">${pair("分數上限", cap(initial), cap(target))}${pair("資料完整性", initial?.valid ? "完整" : "資料不足", target ? target.valid ? "完整" : target.missingData?.join("、") || "資料不足" : "無當日快照")}${pair("模型／設定", initial ? `${initial.modelVersion} · ${initial.configId}` : null, target ? `${target.modelVersion} · ${target.configId}` : null)}</dl>`;
}

export function researchComparisonMarkup(period, row, esc) {
  const date = row?.review?.dates?.at(-1) ?? row?.latest?.asOf;
  return `<section class="research-initial-comparison" data-selected-date="${esc(date ?? "")}" aria-label="加入時與所選日研究差異"><h5>加入時與所選日研究差異</h5><div class="research-comparison-content">${researchComparisonContent(period, row, date, esc)}</div></section>`;
}

export function updateResearchComparison(panel, period, row, date, esc) {
  if (!panel || panel.dataset.selectedDate === date) return;
  panel.querySelector(".research-comparison-content").innerHTML = researchComparisonContent(period, row, date, esc);
  panel.dataset.selectedDate = date;
}

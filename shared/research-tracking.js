import { ENTRY_STRATEGY, ENTRY_WEIGHTS } from "./entry-score.js";

export const RESEARCH_CHANGE_THRESHOLD = 10;
const CORE_NAMES = { trend: "趨勢", momentum: "KD", priceVolume: "量價",
  institutional: "法人", entryRisk: "進場位置與風險" };
const CORE_KEYS = Object.keys(ENTRY_WEIGHTS);

export function researchConfigId(settings = {}, weights = ENTRY_WEIGHTS) {
  const kd = [settings.period ?? 9, settings.kSmooth ?? 3, settings.dSmooth ?? 3].join("-");
  return `${ENTRY_STRATEGY}:kd-${kd}:weights-${CORE_KEYS.map((key) => weights[key]).join("-")}`;
}

export function researchSnapshot(score, { symbol, market, asOf, capturedAt, generation,
  settings, source = "saved", revisionId = generation } = {}) {
  if (!symbol || !asOf) throw new Error("Research snapshot requires symbol and trading date");
  const configId = researchConfigId(settings, score?.weights);
  const valid = Number.isFinite(score?.baseScore) && Number.isFinite(score?.finalScore);
  const categories = Object.fromEntries(CORE_KEYS.map((key) => [key, {
    score: score?.rawCategories?.[key]?.score ?? score?.categories?.[key]?.score ?? null,
    contribution: score?.rawCategories?.[key]?.contribution ?? score?.categories?.[key]?.contribution ?? null,
    creditedContribution: score?.rawCategories?.[key]?.creditedContribution ?? score?.categories?.[key]?.creditedContribution ?? null,
    weight: score?.weights?.[key] ?? ENTRY_WEIGHTS[key],
  }]));
  const conditions = Object.fromEntries(CORE_KEYS.map((key) => [key, {
    status: score?.coreConditions?.[key]?.status ?? "UNKNOWN",
    reason: score?.coreConditions?.[key]?.reason ?? "資料不足",
  }]));
  const id = [symbol, asOf, score?.modelVersion ?? "unknown", configId,
    revisionId ?? "local", source].join("|");
  return { id, symbol, market: market ?? null, asOf, capturedAt: capturedAt ?? null,
    revisionId: revisionId ?? null, source, modelVersion: score?.modelVersion ?? null,
    strategy: score?.strategy ?? ENTRY_STRATEGY, configId, settings: { ...settings },
    weights: { ...(score?.weights ?? ENTRY_WEIGHTS) }, priceBasis: score?.priceBasis ?? "unadjusted",
    close: score?.metrics?.close ?? null, valid,
    baseScore: valid ? score?.rawBaseScore ?? score.baseScore : null,
    finalScore: valid ? score?.rawFinalScore ?? score.finalScore : null,
    categories, conditions, passedCount: score?.passedCount ?? 0,
    totalConditions: score?.totalConditions ?? CORE_KEYS.length,
    cap: score?.cap ?? { enabled: false, value: null, reason: null },
    missingData: [...(score?.missingData ?? [])],
  };
}

export function compareResearchSnapshots(current, previous, expectedPreviousDate) {
  if (!current) return { status: "missing-current", events: [], summary: "缺少當日保存的評分快照" };
  if (!previous || previous.asOf !== expectedPreviousDate)
    return { status: "missing-previous", events: [],
      summary: expectedPreviousDate ? `缺少 ${expectedPreviousDate} 保存的評分快照` : "尚無前期保存的評分快照" };
  if (current.asOf === previous.asOf)
    return { status: "revision", events: [], summary: "資料修訂", dates: [previous.asOf, current.asOf] };
  if (["modelVersion", "strategy", "configId", "priceBasis"].some((key) => current[key] !== previous[key]))
    return { status: "incompatible", events: [], summary: "設定不同，無法直接比較" };
  const events = [];
  const add = (type, reason) => events.push({ key: `${current.symbol}|${previous.asOf}|${current.asOf}|${current.configId}|${type}|${reason}`,
    type, reason, symbol: current.symbol, fromDate: previous.asOf, toDate: current.asOf,
    fromSnapshotId: previous.id, toSnapshotId: current.id,
    modelVersion: current.modelVersion, configId: current.configId });
  if (!previous.valid || !current.valid) {
    if (!previous.valid && current.valid) add("became-scorable", "資料由不足轉為可評分");
    else if (previous.valid && !current.valid) add("became-incomplete", "資料由完整轉為不足");
    return { status: "insufficient", events, summary: events[0]?.reason ?? "資料不足，無法比較",
      dates: [previous.asOf, current.asOf] };
  }
  const baseDelta = current.baseScore - previous.baseScore;
  const finalDelta = current.finalScore - previous.finalScore;
  const categoryDeltas = Object.fromEntries(CORE_KEYS.map((key) => [key,
    Number.isFinite(current.categories[key].score) && Number.isFinite(previous.categories[key].score)
      ? current.categories[key].score - previous.categories[key].score : null]));
  const wasAll = previous.passedCount === previous.totalConditions;
  const isAll = current.passedCount === current.totalConditions;
  if (!wasAll && isAll) add("all-conditions-passed", "必要條件全部成立");
  if (wasAll && !isAll) add("all-conditions-lost", "必要條件不再全部成立");
  for (const key of CORE_KEYS) {
    const before = previous.conditions[key].status, after = current.conditions[key].status;
    if (before !== after && before !== "UNKNOWN" && after !== "UNKNOWN")
      add(`${key}-${after.toLowerCase()}`, `${CORE_NAMES[key]}必要條件${after === "PASS" ? "改善" : "失效"}`);
  }
  if (Boolean(previous.cap?.enabled) !== Boolean(current.cap?.enabled))
    add(current.cap?.enabled ? "cap-enabled" : "cap-released",
      current.cap?.enabled ? `啟用 ${current.cap.value} 分上限：${current.cap.reason}` : "分數上限解除");
  if (Math.abs(finalDelta) >= RESEARCH_CHANGE_THRESHOLD)
    add("final-score-change", `分數${finalDelta > 0 ? "提高" : "下降"} ${Math.abs(finalDelta).toFixed(2)} 分`);
  const summary = [finalDelta ? `分數${finalDelta > 0 ? "提高" : "下降"} ${Math.abs(finalDelta).toFixed(2)} 分` : "分數持平",
    ...events.filter(({ type }) => type.startsWith("trend-") || type.startsWith("momentum-") ||
      type.startsWith("institutional-") || type.startsWith("cap-")).map(({ reason }) => reason)].join("；");
  return { status: "comparable", baseDelta, finalDelta, categoryDeltas, events, summary,
    dates: [previous.asOf, current.asOf], capChanged: Boolean(previous.cap?.enabled) !== Boolean(current.cap?.enabled),
    conditionsImproved: CORE_KEYS.some((key) => previous.conditions[key].status === "FAIL" && current.conditions[key].status === "PASS"),
    conditionsLost: CORE_KEYS.some((key) => previous.conditions[key].status === "PASS" && current.conditions[key].status === "FAIL") };
}

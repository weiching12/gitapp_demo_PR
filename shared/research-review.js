import { compareResearchSnapshots } from "./research-tracking.js";

export const REVIEW_HISTORY_LIMIT = 120;
export const REVIEW_MILESTONES = [5, 10, 20];
const positive = (value) => Number.isFinite(value) && value > 0;

export function priceBaseline(bar, { asOf, capturedAt, source, priceBasis = "unadjusted", revisionId = null } = {}) {
  if (!asOf || !positive(bar?.close)) return null;
  return { asOf, close: bar.close, capturedAt: capturedAt ?? null,
    source: source ?? "unknown", priceBasis, revisionId };
}

export function reviewPriceStatus(baseline, targetDate, review) {
  if (!baseline || !positive(baseline.close)) return { status: "missing-baseline", change: null, index: null };
  if (!review || baseline.priceBasis !== review.priceBasis)
    return { status: review ? "incompatible" : "unavailable", change: null, index: null };
  const dates = review.dates ?? [];
  const baseIndex = dates.indexOf(baseline.asOf), targetIndex = dates.indexOf(targetDate);
  if (baseIndex < 0 || targetIndex < 0 || targetIndex < baseIndex)
    return { status: "outside-coverage", change: null, index: null };
  const prices = new Map((review.bars ?? []).map((bar) => [bar.date, bar.close]));
  const target = prices.get(targetDate);
  if (!positive(target)) return { status: "missing-price", change: null, index: null };
  const covered = new Set(review.corporateActions?.coveredDates ?? []);
  const events = review.corporateActions?.events ?? [];
  const interval = dates.slice(baseIndex + 1, targetIndex + 1);
  if (interval.some((day) => !covered.has(day)))
    return { status: "action-unverified", change: null, index: null };
  if (events.some((event) => interval.includes(event.date)))
    return { status: "action-affected", change: null, index: null };
  return { status: "comparable", change: target / baseline.close - 1,
    index: target / baseline.close * 100, close: target, date: targetDate };
}

export function reviewMilestones(period, review) {
  const baseline = period?.baseline ?? period?.firstValidPriceBaseline ?? null;
  const dates = review?.dates ?? [];
  const baseIndex = dates.indexOf(baseline?.asOf);
  const milestones = Object.fromEntries(REVIEW_MILESTONES.map((day) => {
    if (!baseline) return [day, { status: "missing-baseline", date: null }];
    if (!review || baseIndex < 0) return [day, { status: "outside-coverage", date: null }];
    const date = dates[baseIndex + day];
    if (!date) return [day, { status: "pending", date: null }];
    return [day, { ...reviewPriceStatus(baseline, date, review), date }];
  }));
  const latestDate = dates.at(-1) ?? null;
  return { baseline, baselineType: period?.baseline ? "join" : period?.firstValidPriceBaseline ? "first-valid" : "missing",
    milestones, latest: latestDate ? reviewPriceStatus(baseline, latestDate, review) : { status: "unavailable", change: null },
    latestDate };
}

export function reviewInitialScore(period, latest) {
  const initial = period?.addedSnapshot?.valid ? period.addedSnapshot : period?.firstValidSnapshot?.valid ? period.firstValidSnapshot : null;
  if (!initial || !latest) return { status: "missing-initial", initial };
  if (initial.asOf === latest.asOf && initial.id === latest.id)
    return { status: "same-snapshot", initial, baseDelta: 0, finalDelta: 0 };
  const comparison = compareResearchSnapshots(latest, initial, initial.asOf);
  return { ...comparison, initial };
}

export function reviewTrackingTimeline(period, row) {
  const start = period?.addedSnapshot?.asOf ?? period?.baseline?.asOf ??
    period?.firstValidSnapshot?.asOf ?? period?.firstValidPriceBaseline?.asOf;
  if (!start) return { start: null, comparisons: [] };
  const snapshots = new Map((row?.history ?? []).filter(snapshot => snapshot?.asOf).map(snapshot => [snapshot.asOf, snapshot]));
  if (period.addedSnapshot?.id && !snapshots.get(start)?.id) snapshots.set(start, period.addedSnapshot);
  if (row?.latest?.asOf) snapshots.set(row.latest.asOf, row.latest);
  const end = row?.latest?.asOf ?? [...snapshots.keys()].sort().at(-1);
  const dates = [...new Set([...(row?.review?.dates ?? []), ...snapshots.keys()])]
    .filter(date => date >= start && date <= end).sort();
  const comparisons = dates.slice(1).map((date, index) => {
    const previousDate = dates[index], current = snapshots.get(date), previous = snapshots.get(previousDate);
    return { fromDate: previousDate, toDate: date,
      ...compareResearchSnapshots(current?.id ? current : null, previous?.id ? previous : null, previousDate) };
  });
  return { start, comparisons };
}

export function reviewEventTimeline(history = [], dates = []) {
  const result = [];
  let previous = null;
  let gap = false;
  for (const snapshot of history) {
    if (!snapshot?.id || !snapshot.valid) { gap = true; continue; }
    if (previous) {
      const adjacent = dates.indexOf(snapshot.asOf) === dates.indexOf(previous.asOf) + 1;
      const comparison = compareResearchSnapshots(snapshot, previous, previous.asOf);
      if (adjacent && !gap) result.push(...comparison.events);
      else if (comparison.status === "comparable" && (previous.passedCount !== snapshot.passedCount ||
        Boolean(previous.cap?.enabled) !== Boolean(snapshot.cap?.enabled)))
        result.push({ key: `${snapshot.id}|observed-after-gap`, type: "observed-after-gap",
          fromDate: previous.asOf, toDate: snapshot.asOf,
          reason: `於此日觀測到必要條件${snapshot.passedCount === snapshot.totalConditions ? "成立" : "未全部成立"}${snapshot.cap?.enabled ? `、${snapshot.cap.value} 分上限啟用` : ""}，前期資料不足` });
    }
    previous = snapshot;
    gap = false;
  }
  return result;
}

import { getInstitutionalNet, getPriceVolumeSignal } from "./indicators.js";
import { isEtf } from "./market-codec.js";
import { comparableCloseReturn } from "./corporate-actions.js";

export const SENTIMENT_VERSION = "tw-market-sentiment-v6";
export const SENTIMENT_WEIGHTS = Object.freeze({ breadth: 25, trend: 20, momentum: 20, institutions: 25, volume: 10 });
export const INSTITUTION_NEUTRAL_RATIO = 0.05;
export const MIN_COMPONENT_COVERAGE = 0.8;
export const MIN_EFFECTIVE_WEIGHT = 0.8;
export const MIN_EXPANDED_SAMPLE = 5;
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const sum = (values) => values.reduce((total, value) => total + value, 0);
const directionScore = (value) => value > 0 ? 1 : value < 0 ? 0 : 0.5;
const validClose = (bar) => Number.isFinite(bar?.close) && bar.close > 0;
const validVolume = (bar) => Number.isFinite(bar?.volume) && bar.volume >= 0;
const ordinaryListed = (stock, date) => !isEtf(stock) &&
  (!stock.assetType || stock.assetType === "stock") &&
  (!stock.market || stock.market === "上市") && (!stock.listedOn || stock.listedOn <= date);

export function sentimentBand(score) {
  if (!Number.isFinite(score)) return { key: "unknown", label: "資料更新中" };
  if (score <= 20) return { key: "extreme-fear", label: "極度恐懼" };
  if (score <= 40) return { key: "fear", label: "恐懼" };
  if (score < 60) return { key: "neutral", label: "中性" };
  if (score < 80) return { key: "greed", label: "貪婪" };
  return { key: "extreme-greed", label: "極度貪婪" };
}

function completeWindow(byDate, dates, start, end, predicate) {
  if (start < 0) return null;
  const window = dates.slice(start, end + 1).map((date) => byDate.get(date));
  return window.length === end - start + 1 && window.every(predicate) ? window : null;
}

function verifiedUnadjustedReturn(actions, symbol, date, window) {
  if (!actions?.verifiedWindows?.has(date)) return null;
  return comparableCloseReturn(window, actions.eventsBySymbol.get(symbol));
}

function componentsForDate(stocks, dates, index, actions) {
  const date = dates[index];
  const eligible = stocks.filter((stock) => ordinaryListed(stock, date));
  const cohort = (start) => start >= 0
    ? eligible.filter((stock) => !stock.listedOn || stock.listedOn <= dates[start]) : [];
  const cohorts = { breadth: eligible, trend: cohort(index - 59), momentum: cohort(index - 20),
    institutions: cohort(index - 4), volume: cohort(index - 20) };
  const scores = Object.fromEntries(Object.keys(SENTIMENT_WEIGHTS).map((key) => [key, []]));
  const expanded = [];
  for (const stock of eligible) {
    const byDate = new Map(stock.history.map((bar) => [bar.date, bar]));
    const bar = byDate.get(date);
    if (validClose(bar) && index > 0 && validClose(byDate.get(dates[index - 1])) &&
        Number.isFinite(bar.changePercent))
      scores.breadth.push(directionScore(bar.changePercent));
    if (cohorts.trend.includes(stock)) {
      const window = completeWindow(byDate, dates, index - 59, index, validClose);
      // MA60 comes from analyzeHistory; checking the calendar prevents bridging a missing session.
      if (window && Number.isFinite(bar.ma60) && bar.ma60 > 0)
        scores.trend.push(directionScore(bar.close - bar.ma60));
    }
    if (cohorts.momentum.includes(stock)) {
      const window = completeWindow(byDate, dates, index - 20, index, validClose);
      const comparableReturn = !window ? null
        : stock.priceBasis === "adjusted" && window.every((row) => row.priceBasis !== "unadjusted")
          ? bar.close / window[0].close - 1
          : verifiedUnadjustedReturn(actions, stock.symbol, date, window);
      if (Number.isFinite(comparableReturn)) scores.momentum.push(directionScore(comparableReturn));
    }
    if (cohorts.institutions.includes(stock)) {
      const window = completeWindow(byDate, dates, index - 4, index,
        (row) => validVolume(row) && Number.isFinite(getInstitutionalNet(row.institutions)));
      if (window) {
        const volume = sum(window.map((row) => row.volume));
        if (volume > 0) scores.institutions.push(clamp(50 + 50 *
          (sum(window.map((row) => getInstitutionalNet(row.institutions))) / volume) /
          INSTITUTION_NEUTRAL_RATIO));
      }
    }
    if (cohorts.volume.includes(stock)) {
      const signal = getPriceVolumeSignal(stock.history, dates, date, bar?.changePercent);
      if (Number.isFinite(signal.rvol20)) {
        scores.volume.push(signal.rvol20);
        if (signal.rvol20 >= 1.2) expanded.push(directionScore(bar.changePercent));
      }
    }
  }
  const samples = {}, components = {}, notes = {};
  for (const key of Object.keys(SENTIMENT_WEIGHTS)) {
    const expected = cohorts[key].length, valid = scores[key].length;
    const ratio = expected ? valid / expected : 0;
    samples[key] = { valid, expected, ratio };
    components[key] = expected && ratio >= MIN_COMPONENT_COVERAGE
      ? key === "volume" ? expanded.length
        ? sum(expanded) / expanded.length * 100 : 50
        : sum(scores[key]) / valid * (key === "institutions" ? 1 : 100)
      : null;
  }
  components.coverage = scores.breadth.length;
  if (Number.isFinite(components.volume)) {
    if (!expanded.length) notes.volume = "無明顯放量訊號";
    else if (expanded.length < MIN_EXPANDED_SAMPLE) notes.volume = "樣本偏少";
  }
  return { components, samples, notes, expandedCount: expanded.length };
}

function combine(components) {
  const entries = Object.entries(SENTIMENT_WEIGHTS).filter(([key]) => Number.isFinite(components[key]));
  const weight = sum(entries.map(([, value]) => value));
  return { effectiveWeight: weight / 100,
    score: weight >= MIN_EFFECTIVE_WEIGHT * 100
      ? Math.round(sum(entries.map(([key, value]) => components[key] * value)) / weight) : null };
}

export function calculateMarketSentiment(stocks, asOf, days = 20, tradingDates = null, actions = null) {
  const calendar = (tradingDates ?? stocks[0]?.tradingDates ??
    [...new Set(stocks.flatMap((stock) => stock.history.map((bar) => bar.date)))])
    .filter((date) => date <= asOf).sort();
  const dates = [...new Set(calendar)];
  const verifiedWindows = actions?.coveredDates && actions?.eventsBySymbol
    ? new Set(dates.filter((date, index) => index >= 20 &&
      dates.slice(index - 19, index + 1).every((day) => actions.coveredDates.has(day)))) : null;
  const comparableActions = verifiedWindows ? { ...actions, verifiedWindows } : null;
  const series = dates.slice(-days).map((date) => {
    const { components, samples, notes, expandedCount } = componentsForDate(stocks, dates, dates.indexOf(date), comparableActions);
    const { score, effectiveWeight } = combine(components);
    return { date, score, components, samples, notes, expandedCount, effectiveWeight,
      band: sentimentBand(score) };
  });
  const latest = series.at(-1);
  let valid = [...series].reverse().find((entry) => entry.score !== null);
  // The last publishable day can predate the visible 20-point chart.
  for (let index = dates.length - days - 1; !valid && index >= 0; index--) {
    const { components, samples, notes, expandedCount } = componentsForDate(stocks, dates, index, comparableActions);
    const { score, effectiveWeight } = combine(components);
    if (score !== null) valid = { date: dates[index], score, components, samples,
      notes, expandedCount, effectiveWeight, band: sentimentBand(score) };
  }
  const current = latest && latest.score !== null ? latest : valid ?? latest ??
    { date: asOf, score: null, components: {}, band: sentimentBand(null) };
  return { ...current, status: latest?.date === asOf && latest.score !== null ? "current" : "insufficient",
    requestedDate: asOf, latestEffectiveWeight: latest?.effectiveWeight ?? 0,
    latestSamples: latest?.samples ?? {}, series, version: SENTIMENT_VERSION };
}

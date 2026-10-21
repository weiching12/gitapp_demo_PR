import { getInstitutionalNet } from "./indicators.js";
import { isEtf } from "./market-codec.js";

export const SENTIMENT_VERSION = "tw-market-sentiment-v1";
export const SENTIMENT_WEIGHTS = Object.freeze({ breadth: 25, trend: 20, momentum: 20, institutions: 25, volume: 10 });
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const shareScore = (values, predicate) => values.length ? values.filter(predicate).length / values.length * 100 : null;

export function sentimentBand(score) {
  if (!Number.isFinite(score)) return { key: "unknown", label: "資料更新中" };
  if (score <= 20) return { key: "extreme-fear", label: "極度恐懼" };
  if (score <= 40) return { key: "fear", label: "恐懼" };
  if (score < 60) return { key: "neutral", label: "中性" };
  if (score < 80) return { key: "greed", label: "貪婪" };
  return { key: "extreme-greed", label: "極度貪婪" };
}

function componentsForDate(stocks, date) {
  const rows = stocks.filter((stock) => !isEtf(stock)).map((stock) => {
    const index = stock.history.findIndex((bar) => bar.date === date);
    if (index < 0) return null;
    const bar = stock.history[index], prior20 = stock.history[index - 20];
    const previousVolumes = stock.history.slice(Math.max(0, index - 20), index).map((item) => item.volume).filter((number) => Number.isFinite(number) && number > 0);
    const averageVolume = previousVolumes.length === 20 ? previousVolumes.reduce((sum, number) => sum + number, 0) / 20 : null;
    const institutionalNet = getInstitutionalNet(bar.institutions);
    return { bar, return20: prior20?.close > 0 ? (bar.close / prior20.close - 1) * 100 : null,
      institutionMoney: institutionalNet === null || !(bar.close > 0) ? null : institutionalNet * bar.close,
      volumeRatio: averageVolume && bar.volume > 0 ? bar.volume / averageVolume : null };
  }).filter(Boolean);
  const change = rows.map(({ bar }) => bar.changePercent).filter(Number.isFinite);
  const trend = rows.map(({ bar }) => bar.deviation).filter(Number.isFinite);
  const momentum = rows.map(({ return20 }) => return20).filter(Number.isFinite);
  const institutions = rows.map(({ institutionMoney }) => institutionMoney).filter(Number.isFinite);
  const volumes = rows.map(({ volumeRatio }) => volumeRatio).filter(Number.isFinite);
  return { breadth: shareScore(change, (number) => number > 0), trend: shareScore(trend, (number) => number > 0),
    momentum: shareScore(momentum, (number) => number > 0), institutions: shareScore(institutions, (number) => number > 0),
    volume: volumes.length ? clamp(50 + (volumes.reduce((sum, number) => sum + number, 0) / volumes.length - 1) * 50) : null,
    coverage: rows.length };
}

function combine(components) {
  const entries = Object.entries(SENTIMENT_WEIGHTS).filter(([key]) => Number.isFinite(components[key]));
  if (!entries.length) return null;
  const weight = entries.reduce((sum, [, value]) => sum + value, 0);
  return Math.round(entries.reduce((sum, [key, value]) => sum + components[key] * value, 0) / weight);
}

export function calculateMarketSentiment(stocks, asOf, days = 20) {
  const dates = [...new Set(stocks.flatMap((stock) => stock.history.map((bar) => bar.date)))].filter((date) => date <= asOf).sort().slice(-days);
  const series = dates.map((date) => { const components = componentsForDate(stocks, date); const score = combine(components); return { date, score, components, band: sentimentBand(score) }; });
  const current = series.at(-1) ?? { date: asOf, score: null, components: {}, band: sentimentBand(null) };
  return { ...current, series, version: SENTIMENT_VERSION };
}

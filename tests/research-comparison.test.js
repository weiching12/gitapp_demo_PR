import test from 'node:test';
import assert from 'node:assert/strict';
import { researchComparisonContent } from '../src/ui/research-comparison.js';
import { researchPriceChart } from '../src/ui/research-review.js';

const keys = ['trend', 'momentum', 'priceVolume', 'institutional', 'entryRisk'];
const snapshot = (asOf, score, overrides = {}) => ({ id: asOf, asOf, symbol: '2031', valid: true,
  modelVersion: 'v1', strategy: 'swing', configId: 'a', priceBasis: 'unadjusted',
  finalScore: score, baseScore: score, passedCount: 5, totalConditions: 5,
  categories: Object.fromEntries(keys.map(key => [key, { score }])),
  conditions: Object.fromEntries(keys.map(key => [key, { status: 'PASS' }])), cap: {}, ...overrides });
const initial = snapshot('2026-10-22', 89.25);
const middle = snapshot('2026-10-27', 82.25);
const latest = snapshot('2026-10-30', 20.5);
const period = { addedSnapshot: initial };
const row = { latest, history: [middle, latest] };
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

test('selected-session comparison keeps the saved join baseline and renders all five paired score bars', () => {
  const html = researchComparisonContent(period, row, middle.asOf, esc);
  assert.match(html, /加入時 2026-10-22 → 所選日 2026-10-27/);
  assert.match(html, /89\.25 → 82\.25 · 變化 -7\.00/);
  assert.doesNotMatch(html, /20\.50/);
  assert.equal((html.match(/data-category=/g) || []).length, 5);
  assert.equal((html.match(/class="research-comparison-bar"/g) || []).length, 10);
  const current = researchComparisonContent(period, row, latest.asOf, esc);
  assert.match(current, /89\.25 → 20\.50 · 變化 -68\.75/);
});

test('join day uses its original snapshot even outside the loaded history', () => {
  assert.match(researchComparisonContent(period, row, initial.asOf, esc), /89\.25 → 89\.25 · 變化 0\.00/);
});

test('failed conditions display zero, recalculate gated deltas, and keep missing data distinct from failure', () => {
  const before = snapshot('2026-10-22', 89.25), after = snapshot('2026-10-30', 36.25);
  before.categories.trend.score = 92;
  after.categories.trend.score = 52;
  after.conditions.trend.status = 'FAIL';
  const render = () => researchComparisonContent({ addedSnapshot: before }, { latest: after }, after.asOf, esc);
  const category = html => html.split('data-category="trend"')[1].split('data-category="momentum"')[0];
  const failed = category(render());
  assert.match(failed, /-23\.00 分/);
  assert.match(failed, /<strong>0\.00<\/strong>/);
  assert.match(failed, /data-state="fail"/);
  assert.match(failed, /class="selected" style="width:0%"/);
  assert.doesNotMatch(failed, /52\.00|research-comparison-state/);
  assert.equal(after.categories.trend.score, 52); // The saved raw score stays unchanged.
  before.conditions.trend.status = 'FAIL';
  assert.match(category(render()), /0\.00 分/);
  after.conditions.trend.status = 'PASS';
  assert.match(category(render()), /\+13\.00 分/);
  after.conditions.trend.status = 'UNKNOWN';
  const unknown = category(render());
  assert.match(unknown, /<strong>—<\/strong>/);
  assert.match(unknown, /資料不足/);
  assert.doesNotMatch(unknown, /neutral">0\.00 分/);
});

test('weighted contributions reconcile to the total and use stored credited values when available', () => {
  const before = snapshot('2026-10-27', 90.65), after = snapshot('2026-10-30', 36.25);
  const weights = [25, 15, 15, 20, 25];
  const beforeScores = [92, 100, 100, 63.25, 100], afterScores = [52, 20, 15, 85, 68];
  for (let i = 0; i < keys.length; i++) {
    before.categories[keys[i]] = { score: beforeScores[i], weight: weights[i] };
    after.categories[keys[i]] = { score: afterScores[i], weight: weights[i] };
  }
  after.conditions.trend.status = after.conditions.momentum.status = 'FAIL';
  const html = researchComparisonContent({ addedSnapshot: before }, { latest: after }, after.asOf, esc);
  assert.match(html, /<dt>加權總分<\/dt>/);
  assert.match(html, /各條件加權貢獻/);
  const contributions = [...html.matchAll(/data-contribution="([^"]*)"/g)].map(match => Number(match[1]));
  assert.equal(contributions.length, 10);
  const sum = parity => contributions.filter((_, index) => index % 2 === parity).reduce((a, b) => a + b, 0);
  assert.equal(sum(0).toFixed(2), '90.65');
  assert.equal(sum(1).toFixed(2), '36.25');
  assert.equal((sum(1) - sum(0)).toFixed(2), '-54.40');
  assert.deepEqual(contributions.slice(0, 4), [23, 0, 15, 0]);
  before.categories.trend.creditedContribution = 22.75;
  assert.match(researchComparisonContent({ addedSnapshot: before }, { latest: after }, after.asOf, esc), /data-contribution="22\.75"/);
});

test('a missing or invalid selected session never borrows the latest score or invents a change', () => {
  const missing = researchComparisonContent(period, row, '2026-10-28', esc);
  assert.match(missing, /所選日沒有評分快照/);
  assert.doesNotMatch(missing, /20\.50| · 變化/);
  const invalid = researchComparisonContent(period, { ...row, history: [snapshot('2026-10-28', null, { valid: false })] }, '2026-10-28', esc);
  assert.match(invalid, /所選日資料不足/);
  assert.doesNotMatch(invalid, / · 變化/);
});

test('incompatible models and dates before the baseline do not calculate deltas', () => {
  const incompatible = researchComparisonContent(period, { latest: { ...latest, configId: 'b' } }, latest.asOf, esc);
  assert.match(incompatible, /無法直接比較/);
  assert.doesNotMatch(incompatible, / · 變化|class="(?:up|down|neutral)">[+-]?\d+\.\d+ 分/);
  const earlier = snapshot('2026-10-21', 90);
  const before = researchComparisonContent(period, { history: [earlier] }, earlier.asOf, esc);
  assert.match(before, /早於評分基準日/);
  assert.doesNotMatch(before, / · 變化/);
});

test('legacy periods label the first valid baseline and missing baselines stay explicit', () => {
  assert.match(researchComparisonContent({ firstValidSnapshot: initial }, row, middle.asOf, esc), /首次有效 2026-10-22/);
  assert.match(researchComparisonContent({}, row, middle.asOf, esc), /缺少加入時或首次有效評分快照/);
});

test('an invalid latest revision cannot leave an older valid same-day score on the price chart', () => {
  const chartPeriod = { ...period, baseline: { asOf: initial.asOf, close: 100, priceBasis: 'unadjusted' } };
  const chartRow = { ...row, latest: { ...latest, valid: false, finalScore: null },
    review: { dates: [initial.asOf, latest.asOf], bars: [{ date: initial.asOf, close: 100 }, { date: latest.asOf, close: 101 }], priceBasis: 'unadjusted' } };
  const html = researchPriceChart(chartPeriod, chartRow, esc);
  assert.match(html, /該日無評分/);
  assert.doesNotMatch(html, /20\.50/);
  assert.match(researchComparisonContent(chartPeriod, chartRow, latest.asOf, esc), /所選日資料不足/);
});

test('chart starts on the actual Taipei join date and keeps the saved price baseline for changes', () => {
  const dates = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
  const chartPeriod = { addedAt: '2026-10-26T18:00:00Z', addedSnapshot: snapshot('2026-10-27', 90.65),
    baseline: { asOf: '2026-10-27', close: 104, priceBasis: 'unadjusted' } };
  const chartRow = { latest, history: [initial, middle, latest], review: { dates,
    bars: dates.map((date, index) => ({ date, close: 100 + index })), priceBasis: 'unadjusted',
    corporateActions: { coveredDates: dates, events: [] } } };
  const points = range => JSON.parse(researchPriceChart(chartPeriod, chartRow, esc, range)
    .match(/data-points="([^"]*)"/)[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  const full = points(120);
  assert.deepEqual(full.map(point => point.date), dates.slice(4));
  assert.equal(full.some(point => point.date === '2026-10-22'), false);
  assert.equal(full.find(point => point.date === '2026-10-27').priceChange, '0.00%');
  assert.equal(full.at(-1).priceChange, '+2.88%');
  assert.deepEqual(points(3).map(point => point.date), dates.slice(-3));
  assert.equal(points(3).at(-1).priceChange, '+2.88%');
  // An older baseline outside available history does not hide the known prices or invent a comparable change.
  const outside = researchPriceChart({ ...chartPeriod, baseline: { ...chartPeriod.baseline, asOf: '2026-09-01' } }, chartRow, esc, 120);
  assert.match(outside, /research-chart-plot/);
  assert.match(outside, /歷史資料未涵蓋/);
  assert.match(outside, /以加入收藏日期為起始/);
  assert.doesNotMatch(outside, /公司行動版本|為加入時價格基準/);
  const staleBaseline = { ...chartPeriod, baseline: { asOf: '2026-10-22', close: 101, priceBasis: 'unadjusted' } };
  const stalePoints = JSON.parse(researchPriceChart(staleBaseline, chartRow, esc, 120)
    .match(/data-points="([^"]*)"/)[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  assert.equal(stalePoints[0].date, '2026-10-27');
  assert.equal(stalePoints[0].priceChange, '+2.97%');
  const weekend = researchPriceChart({ ...chartPeriod, addedAt: '2026-10-24T04:00:00Z' }, chartRow, esc, 120);
  const weekendPoints = JSON.parse(weekend.match(/data-points="([^"]*)"/)[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  assert.equal(weekendPoints[0].date, '2026-10-26');
  const pending = researchPriceChart({ ...chartPeriod, addedAt: '2026-10-31T04:00:00Z' }, chartRow, esc);
  assert.doesNotMatch(pending, /research-chart-plot/);
  assert.match(pending, /收藏後尚無/);
});

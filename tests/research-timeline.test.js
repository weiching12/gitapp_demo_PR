import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewTrackingTimeline } from '../shared/research-review.js';
const keys = ['trend', 'momentum', 'priceVolume', 'institutional', 'entryRisk'];
const dates = ['2026-10-21', '2026-10-22', '2026-10-27', '2026-10-28'];
const snapshot = (asOf, finalScore, overrides = {}) => ({ id: `2031:${asOf}`, symbol: '2031', asOf, valid: true,
  modelVersion: 'v1', strategy: 'swing', configId: 'kd-9-3-3', priceBasis: 'unadjusted', baseScore: finalScore, finalScore,
  categories: Object.fromEntries(keys.map(key => [key, { score: finalScore }])),
  conditions: Object.fromEntries(keys.map(key => [key, { status: 'PASS' }])), passedCount: 5, totalConditions: 5, cap: {}, ...overrides });
const history = dates.map((date, index) => snapshot(date, [90, 89.25, 82.25, 65.75][index]));
const period = { addedSnapshot: history[1] };

test('tracking shows every adjacent pair after joining, including changes smaller than ten points', () => {
  const result = reviewTrackingTimeline(period, { history, latest: history.at(-1), review: { dates } });
  assert.deepEqual(result.comparisons.map(item => [item.fromDate, item.toDate, item.finalDelta]), [
    ['2026-10-22', '2026-10-27', -7], ['2026-10-27', '2026-10-28', -16.5],
  ]);
  assert.equal(result.comparisons[0].events.length, 0);
});

test('missing snapshots remain missing and never become a comparison across the gap', () => {
  const result = reviewTrackingTimeline(period, { history: [history[1], { asOf: dates[2], valid: false }, history[3]],
    latest: history[3], review: { dates } });
  assert.deepEqual(result.comparisons.map(item => [item.fromDate, item.toDate, item.status]), [
    ['2026-10-22', '2026-10-27', 'missing-current'], ['2026-10-27', '2026-10-28', 'missing-previous'],
  ]);
});

test('setting changes are identified and unknown join baselines do not invent a timeline', () => {
  const latest = { ...history[3], configId: 'different-settings' };
  const result = reviewTrackingTimeline(period, { history, latest });
  assert.equal(result.comparisons.at(-1).status, 'incompatible');
  assert.equal(result.comparisons.at(-1).finalDelta, undefined);
  assert.deepEqual(reviewTrackingTimeline({}, { history }).comparisons, []);
});

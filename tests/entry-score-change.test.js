import test from "node:test";
import assert from "node:assert/strict";
import { entryScoreDayChange } from "../shared/entry-score.js";
import { entryScoreChangePresentation } from "../src/ui/market.js";
import { compareResearchSnapshots } from "../shared/research-tracking.js";
import { researchDetailMarkup } from "../src/ui/research.js";

const number = (value, digits) => value.toFixed(digits);
const current = { asOf: "2026-10-27", finalScore: 82.25, missingData: [] };
const previous = { asOf: "2026-10-22", finalScore: 89.25, missingData: [] };
const presentation = (entryScore, prior = previous, date = previous.asOf) =>
  entryScoreChangePresentation({ entryScore,
    entryScoreChange: entryScoreDayChange(entryScore, prior, date) }, number);

test("2031 market comparison remains available when saved research snapshots are missing", () => {
  const savedComparison = compareResearchSnapshots({ asOf: previous.asOf }, null, "2026-10-21");
  assert.equal(savedComparison.status, "missing-previous");
  assert.match(savedComparison.summary, /2026-10-21.*保存的評分快照/);
  assert.deepEqual(presentation(current), { label: "較前期 -7.00",
    title: "2026-10-27 與 2026-10-22 的株研評分差額" });
  assert.equal(presentation(previous, { finalScore: 87.75 }, "2026-10-21").label, "較前期 +1.50");
  const markup = researchDetailMarkup({ symbol: "2031", row: { comparison: savedComparison },
    store: { periods: [{ symbol: "2031", removedAt: null }] }, esc: String });
  assert.match(markup, /缺少 2026-10-21 保存的評分快照/);
});

test("unavailable comparisons identify the date and actual missing inputs", () => {
  const unavailable = { ...current, finalScore: null, missingData: ["RVOL20 資料不足"] };
  assert.deepEqual(presentation(unavailable), { label: "當日資料不足",
    title: "2026-10-27 無法評分：RVOL20 資料不足" });
  assert.deepEqual(presentation(current, { ...previous, finalScore: null,
    missingData: ["近五日法人資料不完整"] }), { label: "前期資料不足",
    title: "2026-10-22 無法評分：近五日法人資料不完整" });
  assert.equal(presentation(current, null, null).label, "尚無前期資料");
  assert.equal(presentation({ ...current, finalScore: 0 }, { finalScore: 0 }).label, "較前期 0.00");
  assert.equal(entryScoreChangePresentation({ entryScore: current,
    entryScoreChange: { previousDate: "2026-10-22", delta: null } }, number).label, "前期無法比較");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDatabase } from "./helpers/t86-db.js";
import { CorporateActionRepository } from "../cloudflare/corporate-actions/repository.js";
import { combineCorporateActions, exRightsUrl, parValueUrl, parseExRightsReport,
  parseParValueReport, parseReductionReport, reductionUrl } from "../cloudflare/corporate-actions/source.js";
import { syncDailyCorporateActions } from "../cloudflare/corporate-actions/sync.js";
import { comparableCloseReturn } from "../shared/corporate-actions.js";

const date = "2026-10-22";
const report = { stat: "OK", fields: ["資料日期", "股票代號", "股票名稱",
  "除權息前收盤價", "除權息參考價", "權值+息值", "權/息"],
data: [["115年10月22日", "2330", "台積電", "100.00", "95.00", "5", "息"],
  ["115年10月22日", "00984D", "ETF", "10", "9", "1", "息"]] };
const reduction = { stat: "OK", fields: ["恢復買賣日期", "股票代號", "名稱",
  "停止買賣前收盤價格", "恢復買賣參考價"],
data: [["115/10/22", "2330", "台積電", "100.00", "150.00"]] };
const parValue = { ...reduction, data: [["115/10/22", "2601", "益航", "20.00", "100.00"]] };
const sourceResponse = async (url) => Response.json(url.includes("TWTAUU")
  ? { ...reduction, data: [] } : url.includes("TWTB8U") ? { ...parValue, data: [] } : report);

function fixture() {
  const db = testDatabase();
  db.sqlite.exec(readFileSync(new URL("../cloudflare/migrations/0004_corporate_actions.sql", import.meta.url), "utf8"));
  return { db, repository: new CorporateActionRepository(db) };
}

test("TWSE event report validates the source and keeps ordinary numeric symbols", () => {
  assert.match(exRightsUrl(date, date), /startDate=20261022&endDate=20261022$/);
  assert.deepEqual(parseExRightsReport(report, date, date),
    [{ date, symbol: "2330", kind: "息", beforeClose: 100, reference: 95 }]);
  assert.throws(() => parseExRightsReport({ ...report, stat: "NO DATA" }, date, date));
  assert.deepEqual(parseExRightsReport({ stat: "很抱歉，沒有符合條件的資料!" }, date, date), []);
  assert.throws(() => parseExRightsReport({ ...report, data: [...report.data, report.data[0]] }, date, date));
  assert.throws(() => parseExRightsReport(report, "2026-10-21", "2026-10-21"));
});

test("reduction and par-value reports flag unsupported price changes", () => {
  assert.match(reductionUrl(date, date), /TWTAUU\?/);
  assert.match(parValueUrl(date, date), /TWTB8U\?/);
  assert.deepEqual(parseReductionReport(reduction, date, date),
    [{ date, symbol: "2330", kind: "減資", beforeClose: 100, reference: 150 }]);
  assert.deepEqual(parseParValueReport(parValue, date, date),
    [{ date, symbol: "2601", kind: "面額變更", beforeClose: 20, reference: 100 }]);
  const combined = combineCorporateActions(parseExRightsReport(report, date, date),
    parseReductionReport(reduction, date, date));
  assert.equal(combined.find((event) => event.symbol === "2330").kind, "減資");
  assert.throws(() => parseReductionReport({ ...reduction, fields: [] }, date, date));
  assert.throws(() => parseParValueReport(parValue, "2026-10-21", "2026-10-21"));
});

test("D1 stores sparse events and verified event-free trading dates atomically", async () => {
  const { db, repository } = fixture();
  assert.equal(await repository.revision(), "unavailable");
  await repository.save(["2026-10-21", date], parseExRightsReport(report, date, date), "2026-10-22T11:00:00Z");
  const window = await repository.window(["2026-10-21", date]);
  assert.deepEqual([...window.coveredDates], ["2026-10-21", date]);
  assert.deepEqual([...window.eventsBySymbol.get("2330").keys()], [date]);
  assert.deepEqual(window.eventsBySymbol.get("2330").get(date),
    { kind: "息", beforeClose: 100, reference: 95 });
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM corporate_action_events").get().n, 1);
  assert.equal(await repository.revision(), "2026-10-22T11:00:00Z");
});

test("daily sync makes one normal request and at most one retry", async () => {
  const { db } = fixture();
  const env = { CORPORATE_ACTIONS_ENABLED: "1", T86_DB: db,
    MARKET_DATA: { get: async () => ({ asOf: date }) } };
  const state = { phase: "done", date };
  let calls = 0;
  const fail = async () => { calls++; return Response.json({ stat: "NO DATA" }); };
  assert.equal((await syncDailyCorporateActions(env, state, new Date("2026-10-22T12:20:00Z"), fail)).status, "before-evening-refresh");
  assert.equal((await syncDailyCorporateActions(env, state, new Date("2026-10-22T12:40:00Z"), fail)).status, "delayed");
  assert.equal((await syncDailyCorporateActions(env, state, new Date("2026-10-22T13:00:00Z"), fail)).status, "already-checked");
  assert.equal((await syncDailyCorporateActions(env, state, new Date("2026-10-22T13:15:00Z"), fail)).status, "delayed");
  assert.equal((await syncDailyCorporateActions(env, state, new Date("2026-10-22T13:50:00Z"), fail)).status, "already-checked");
  assert.equal(calls, 2);
  assert.equal(db.sqlite.prepare("SELECT Attempts FROM corporate_action_coverage WHERE Date=?").get(date).Attempts, 2);
});

test("three successful source reports are saved only after an empty-report recheck", async () => {
  const { db, repository } = fixture();
  const env = { CORPORATE_ACTIONS_ENABLED: "1", T86_DB: db,
    MARKET_DATA: { get: async () => ({ asOf: date }) } };
  let calls = 0;
  const fetcher = async (url) => { calls++; return sourceResponse(url); };
  const state = { phase: "done", date };
  assert.equal((await syncDailyCorporateActions(env, state, new Date("2026-10-22T12:40:00Z"), fetcher)).status, "empty-pending");
  assert.equal((await syncDailyCorporateActions(env, state, new Date("2026-10-22T13:15:00Z"), fetcher)).status, "complete");
  assert.equal((await syncDailyCorporateActions(env, state, new Date("2026-10-22T13:50:00Z"), fetcher)).status, "already-checked");
  assert.equal(calls, 6);
  assert.equal((await repository.window([date])).eventsBySymbol.get("2330").has(date), true);
});

test("verified reference prices adjust one or multiple events without inventing total return", () => {
  const rows = [
    { date: "2026-10-20", close: 100 },
    { date: "2026-10-21", close: 96 },
    { date, close: 47.5 },
  ];
  assert.equal(comparableCloseReturn(rows, new Map([["2026-10-21", {
    kind: "息", beforeClose: 100, reference: 95,
  }], [date, { kind: "權", beforeClose: 96, reference: 48 }]])), 0);
  assert.equal(comparableCloseReturn(rows.slice(0, 2), new Map([["2026-10-21", {
    kind: "息", beforeClose: 100, reference: 95,
  }]])), 96 / 95 - 1);
  assert.equal(comparableCloseReturn(rows.slice(0, 2), new Map([["2026-10-21", {
    kind: "息", beforeClose: 99, reference: 94,
  }]])), null);
  assert.equal(comparableCloseReturn(rows.slice(0, 2), new Map([["2026-10-21", {
    kind: "unsupported", beforeClose: 100, reference: 95,
  }]])), null);
  assert.equal(comparableCloseReturn(rows.slice(0, 2), new Map([["2026-10-21", {
    kind: "減資", beforeClose: 100, reference: 150,
  }]])), null);
});

test("an empty daily report needs a second confirmation before marking coverage complete", async () => {
  const { db, repository } = fixture();
  const env = { CORPORATE_ACTIONS_ENABLED: "1", T86_DB: db,
    MARKET_DATA: { get: async () => ({ asOf: date }) } };
  const state = { phase: "done", date };
  let calls = 0;
  const empty = async () => { calls++; return Response.json({ stat: "很抱歉，沒有符合條件的資料!" }); };
  assert.equal((await syncDailyCorporateActions(env, state, new Date("2026-10-22T12:40:00Z"), empty)).status, "empty-pending");
  assert.equal((await repository.window([date])).coveredDates.has(date), false);
  assert.equal((await syncDailyCorporateActions(env, state, new Date("2026-10-22T13:15:00Z"), empty)).status, "complete");
  assert.equal((await repository.window([date])).coveredDates.has(date), true);
  assert.equal(calls, 6);
});

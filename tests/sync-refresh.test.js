import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { syncMarket } from "../cloudflare/sync.js";
import { MANIFEST_KEY, SHARD_COUNT, SYNC_KEY, shardKey } from "../cloudflare/twse.js";
import { testStore } from "./helpers/t86-db.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/twse-20261016.json", import.meta.url)));

function setup() {
  const { db, store } = testStore(1000);
  const data = new Map(), calls = [];
  const companies = Array.from({ length: 1000 }, (_, i) => ({ 公司代號: String(1000 + i),
    公司簡稱: `公司${i}`, 產業別: "24", 上市日期: "20000101" }));
  let corrected = false;
  const kv = { get: async (k, t) => t === "json" ? JSON.parse(data.get(k) ?? "null") : data.get(k) ?? null,
    put: async (k, v) => data.set(k, v), delete: async (k) => data.delete(k) };
  const fetcher = async (input) => {
    const url = new URL(input);
    const date = url.searchParams.get("date");
    calls.push([url.pathname, date]);
    if (url.hostname.startsWith("openapi")) return Response.json(companies);
    if (url.pathname.includes("MI_INDEX")) {
      const body = structuredClone(fixture.prices);
      body.date = date;
      const row = body.tables[0].data.find((r) => r[0] === "2330");
      body.tables[0].data = companies.map((c) => [c.公司代號, ...row.slice(1)]);
      if (corrected) {
        const col = body.tables[0].fields.indexOf("成交股數");
        body.tables[0].data[0][col] = "1234567";
      }
      return Response.json(body);
    }
    const body = structuredClone(fixture.flows);
    body.date = date;
    body.data = companies.map((c) => [c.公司代號, ...body.data[0].slice(1)]);
    // Only the historical report changes; today's institution Hash stays equal.
    if (corrected && date === "20261014") for (const col of [2, 4, 18])
      body.data[0][col] = String(Number(body.data[0][col].replaceAll(",", "")) + 100);
    return Response.json(body);
  };
  const run = async (date, hour, minutes = 85) => {
    for (let minute = 0; minute < minutes; minute++) await syncMarket({ MARKET_DATA: kv }, {
      t86Store: store, fetcher,
      now: new Date(Date.parse(`${date}T${hour}:30:00Z`) + minute * 60000),
    });
    assert.equal(JSON.parse(data.get(SYNC_KEY)).phase, "done");
    return JSON.parse(data.get(MANIFEST_KEY));
  };
  const history = (manifest) => JSON.parse(data.get(shardKey(manifest.generation, 1000 % SHARD_COUNT)))
    .stocks.find((s) => s.symbol === "1000").history;
  return { db, store, calls, data, run, history, correct: () => { corrected = true; } };
}

test("20:30 publishes corrected volume even when today's T86 is unchanged", async () => {
  const f = setup();
  try {
    const early = await f.run("2026-10-19", "10");
    const priorVolume = f.history(early).at(-1)[5];
    f.correct();
    const late = await f.run("2026-10-19", "12");
    assert.equal(late.t86Hash, early.t86Hash);
    assert.equal(late.t86VersionId, early.t86VersionId);
    assert.notEqual(late.generation, early.generation);
    assert.notEqual(priorVolume, 1234567);
    assert.equal(f.history(late).at(-1)[5], 1234567);
    assert.equal(f.calls.filter(([p]) => p.includes("T86")).length, 2);
    assert.equal(f.calls.filter(([p]) => p.includes("MI_INDEX")).length, 2);
    assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM t86_versions WHERE TradeDate='2026-10-19'").get().n, 1);
  } finally { f.db.sqlite.close(); }
});

test("Friday rechecks both preceding sessions despite unchanged current T86", async () => {
  const f = setup();
  try {
    await f.run("2026-10-14", "10");
    await f.run("2026-10-15", "10");
    const early = await f.run("2026-10-16", "10");
    const before = f.history(early).find((r) => r[0] === "2026-10-14")[6];
    f.calls.length = 0;
    f.correct();
    const late = await f.run("2026-10-16", "12");
    assert.equal(late.t86Hash, early.t86Hash);
    assert.equal(f.history(late).find((r) => r[0] === "2026-10-14")[6], before + 100);
    assert.deepEqual(f.calls.filter(([p]) => p.includes("MI_INDEX")).map(([, d]) => d),
      ["20261014", "20261015", "20261016"]);
    assert.deepEqual(f.calls.filter(([p]) => p.includes("T86")).map(([, d]) => d),
      ["20261016", "20261014", "20261015"]);
  } finally { f.db.sqlite.close(); }
});

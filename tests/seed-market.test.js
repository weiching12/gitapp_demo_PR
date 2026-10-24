import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { testStore } from "./helpers/t86-db.js";
import { seedMarket } from "../scripts/seed-market.js";

test("bulk historical ingestion spaces requests, skips explicit holidays and resumes offline without upstream", async () => {
  await mkdir(".wrangler", { recursive: true });
  const testRoot = resolve(".wrangler");
  const directory = await mkdtemp(join(testRoot, "seed-test-"));
  const fixture = JSON.parse(await readFile(new URL("./fixtures/twse-20261016.json", import.meta.url), "utf8"));
  const companies = Array.from({ length: 1000 }, (_, i) => ({ 公司代號: String(1000 + i), 公司簡稱: `公司${i}`, 產業別: "24", 上市日期: "20000101" }));
  let clock = Date.now(), calls = [];
  const fetcher = async (input) => {
    const url = new URL(input);
    calls.push({ time: clock, url: url.href });
    if (url.hostname.startsWith("openapi")) return Response.json(companies);
    const date = url.searchParams.get("date");
    if (date === "20261015") return Response.json({ stat: "很抱歉，沒有符合條件的資料!" });
    const isPrice = url.pathname.includes("MI_INDEX");
    const body = structuredClone(isPrice ? fixture.prices : fixture.flows);
    body.date = date;
    if (isPrice) {
      const table = body.tables[0];
      const template = table.data.find((row) => row[0] === "2330");
      table.data = companies.map((c) => [c.公司代號, ...template.slice(1)]);
    } else {
      const template = body.data.find((row) => row[0] === "2330");
      body.data = companies.map((c) => [c.公司代號, ...template.slice(1)]);
    }
    return Response.json(body);
  };
  try {
    const options = { includeEtfs: false, t86Store: testStore().store, directory, end: "2026-10-18", sessions: 2, output: join(directory, "seed.json"), fetcher,
      now: () => clock, wait: async (ms) => { clock += ms; }, log: () => {} };
    const result = await seedMarket(options);
    assert.deepEqual(result.manifest.dates, ["2026-10-14", "2026-10-16"]);
    assert.equal(calls.length, 6); // company + 2 prices + 2 flows + explicit holiday
    assert.ok(calls.slice(1).every((call, index) => call.time - calls[index].time >= 10000));
    assert.ok(calls.every((call) => !/2026101[78]/.test(call.url)));
    assert.equal(result.entries.length, 129);
    const originalCount = calls.length;
    const replay = await seedMarket({ ...options, offline: true });
    assert.equal(calls.length, originalCount);
    assert.deepEqual(replay.entries, result.entries);
    await assert.rejects(seedMarket({ ...options, interval: 999 }), />= 10000/);
  } finally {
    assert.ok(resolve(directory).startsWith(`${testRoot}${sep}`), "Cleanup must remain inside the test workspace");
    await rm(directory, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../cloudflare/worker.js";
import { createManifest, marketDay, mergeShard, normalizeCatalog, normalizeFlows, normalizePrices, MANIFEST_KEY, shardKey, shardOf } from "../cloudflare/twse.js";

const spec = JSON.parse(readFileSync(new URL("../public/openapi.json", import.meta.url)));
// Contract smoke checker for the schema keywords used here, not a general OAS validator.
function check(schema, value) {
  if (schema.$ref) return check(spec.components.schemas[schema.$ref.split("/").at(-1)], value);
  for (const part of schema.allOf ?? []) check(part, value);
  if (schema.anyOf) {
    assert.ok(schema.anyOf.some((part) => { try { check(part, value); return true; } catch { return false; } }));
    return;
  }
  if ("const" in schema) assert.deepEqual(value, schema.const);
  if (schema.enum) assert.ok(schema.enum.includes(value));
  if (schema.type === "null") assert.equal(value, null);
  if (schema.type === "object") {
    assert.ok(value && typeof value === "object" && !Array.isArray(value));
    for (const key of schema.required ?? []) assert.ok(key in value, `Missing ${key}`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in value) check(child, value[key]);
  }
  if (schema.type === "array") {
    assert.ok(Array.isArray(value));
    if (schema.minItems) assert.ok(value.length >= schema.minItems);
    if (schema.maxItems) assert.ok(value.length <= schema.maxItems);
    for (const item of value) check(schema.items ?? {}, item);
  }
  if (schema.type === "string") { assert.equal(typeof value, "string"); if (schema.pattern) assert.match(value, new RegExp(schema.pattern)); }
  if (["number", "integer"].includes(schema.type)) {
    assert.ok(Number.isFinite(value)); if (schema.type === "integer") assert.ok(Number.isInteger(value));
    if (schema.minimum !== undefined) assert.ok(value >= schema.minimum);
    if (schema.maximum !== undefined) assert.ok(value <= schema.maximum);
  }
}

test("documented market, stock, history and analysis responses match the published contract", async () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/twse-20261016.json", import.meta.url)));
  const catalog = normalizeCatalog(fixture.companies), date = "2026-10-16";
  const day = marketDay(catalog, normalizePrices(fixture.prices, date), normalizeFlows(fixture.flows, date));
  const manifest = createManifest(catalog, [date], "contract", "2026-10-16T12:00:00Z", day.coverage);
  const data = new Map([[MANIFEST_KEY, manifest]]);
  for (let index = 0; index < 128; index++) data.set(shardKey("contract", index), { ...mergeShard(catalog, index, null, [day]), generation: "contract", index });
  const env = { MARKET_DATA: { get: async (key) => structuredClone(data.get(key) ?? null) } };
  for (const [path, definition] of Object.entries(spec.paths)) {
    if (path.endsWith("presence") || path.includes("/push/")) continue;
    const concrete = path.replace("{symbol}", "2330").replace("{generation}", "contract")
      .replace("{index}", String(shardOf("2330"))).replace("{name}", encodeURIComponent(catalog[0].sector)) +
      (path === "/api/v1/favorites/summary" ? "?symbols=2330" : "");
    const response = await worker.fetch(new Request(`https://example.test${concrete}`), env);
    assert.equal(response.status, 200, concrete);
    check(definition.get.responses[200].content["application/json"].schema, await response.json());
    const head = await worker.fetch(new Request(`https://example.test${concrete}`, { method: "HEAD" }), env);
    assert.equal(head.status, 200); assert.equal(await head.text(), "");
  }
  const invalid = await worker.fetch(new Request("https://example.test/api/v1/stocks?limit=201"), env);
  assert.equal(invalid.status, 400); check(spec.components.schemas.Error, await invalid.json());
});

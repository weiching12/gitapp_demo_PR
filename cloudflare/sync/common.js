import { SYNC_KEY, MANIFEST_KEY } from "../storage/market-keys.js";
export const STAGE_TTL = 86400;
export const put = (kv, key, value) => kv.put(key, JSON.stringify(value),
  key === SYNC_KEY || key === MANIFEST_KEY || key.includes(":shard:") ? {} : { expirationTtl: STAGE_TTL });
export async function fingerprint(value) {
  const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(value))));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
export const SHARDS_PER_TICK = 32;


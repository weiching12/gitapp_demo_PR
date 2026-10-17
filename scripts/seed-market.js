import { mkdir, writeFile } from "node:fs/promises";
import { STOCK_CATALOG } from "../src/catalog.js";
import { fetchStock, MANIFEST_KEY, stockKey, stockMetadata } from "../cloudflare/finmind.js";

// Run on this computer once before deployment. The file contains public market
// data only; credentials are never included. Upload with `wrangler kv bulk put`.
const entries = [];
const manifest = { schemaVersion: 1, stocks: {} };
for (const stock of STOCK_CATALOG) {
  const snapshot = await fetchStock(stock, null, { token: process.env.FINMIND_TOKEN });
  entries.push({ key: stockKey(stock.symbol), value: JSON.stringify(snapshot) });
  manifest.stocks[stock.symbol] = stockMetadata(snapshot);
  console.log(`${stock.symbol}: ${snapshot.stock.history.length} sessions, as of ${snapshot.asOf}`);
}
entries.push({ key: MANIFEST_KEY, value: JSON.stringify(manifest) });
await mkdir(".wrangler", { recursive: true });
await writeFile(".wrangler/market-seed.json", JSON.stringify(entries));
console.log("Saved .wrangler/market-seed.json. No cloud resources were changed.");

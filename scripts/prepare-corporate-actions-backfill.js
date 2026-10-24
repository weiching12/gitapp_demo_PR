import { writeFile } from "node:fs/promises";
import { combineCorporateActions, exRightsUrl, parValueUrl, parseExRightsReport,
  parseParValueReport, parseReductionReport, reductionUrl } from "../cloudflare/corporate-actions/source.js";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
const marketUrl = args.marketUrl ?? "https://stock-insight-tw.stock-insight-tw.workers.dev/api/v1/market";
const marketResponse = await fetch(marketUrl);
if (!marketResponse.ok) throw new Error(`Market manifest HTTP ${marketResponse.status}`);
const market = await marketResponse.json();
const calendar = market.dates ?? market.data?.dates;
if (!Array.isArray(calendar) || calendar.length < 40 || calendar.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date)))
  throw new Error("Market manifest does not contain 40 verified trading dates");
if (Boolean(args.start) !== Boolean(args.end))
  throw new Error("Specify both --start and --end for a bounded backfill");
let dates;
if (args.start) {
  const startIndex = calendar.indexOf(args.start), endIndex = calendar.indexOf(args.end);
  if (startIndex < 0 || endIndex < startIndex)
    throw new Error("Backfill dates must be ordered market trading dates");
  dates = calendar.slice(startIndex, endIndex + 1);
} else dates = calendar.slice(-40);
const start = dates[0], end = dates.at(-1);
const parsed = [];
for (const [url, parse] of [[exRightsUrl, parseExRightsReport],
  [reductionUrl, parseReductionReport], [parValueUrl, parseParValueReport]]) {
  const response = await fetch(url(start, end));
  if (!response.ok) throw new Error(`TWSE corporate-action HTTP ${response.status}`);
  parsed.push(parse(await response.json(), start, end));
}
const events = combineCorporateActions(...parsed);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const now = new Date().toISOString();
const statements = ["-- Review this SQL before applying migration 0004 and importing into D1."];
for (let offset = 0; offset < events.length; offset += 100) {
  const rows = events.slice(offset, offset + 100).map((event) =>
    `(${quote(event.date)},${quote(event.symbol)},${quote(event.kind)},${event.beforeClose},${event.reference})`);
  statements.push(`INSERT INTO corporate_action_events(Date,Symbol,Kind,BeforeClose,ReferencePrice)
    VALUES ${rows.join(",")}
    ON CONFLICT(Date,Symbol) DO UPDATE SET Kind=excluded.Kind,
    BeforeClose=excluded.BeforeClose,ReferencePrice=excluded.ReferencePrice;`);
}
statements.push(`INSERT INTO corporate_action_coverage(Date,Status,Attempts,VerifiedAt)
  VALUES ${dates.map((date) => `(${quote(date)},'complete',0,${quote(now)})`).join(",")}
  ON CONFLICT(Date) DO UPDATE SET Status='complete',VerifiedAt=excluded.VerifiedAt;`);
statements.push(`INSERT INTO corporate_action_meta(Key,Value) VALUES('revision',${quote(now)})
  ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value;`);
const report = { start, end, tradingDays: dates.length, events: events.length,
  bySource: { exRights: parsed[0].length, reduction: parsed[1].length, parValue: parsed[2].length },
  statements: statements.length - 1, latestMarketDate: market.asOf ?? market.data?.asOf };
if (args.output) {
  await writeFile(args.output, `${statements.join("\n\n")}\n`, { flag: "wx" });
  report.output = args.output;
}
console.log(JSON.stringify(report));

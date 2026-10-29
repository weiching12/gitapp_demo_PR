import { CorporateActionRepository } from "./repository.js";
import { combineCorporateActions, exRightsUrl, parValueUrl, parseExRightsReport,
  parseParValueReport, parseReductionReport, reductionUrl } from "./source.js";
import { MANIFEST_KEY } from "../storage/market-keys.js";

export async function syncDailyCorporateActions(env, state, now, fetcher = fetch) {
  if (env.CORPORATE_ACTIONS_ENABLED !== "1" || state?.phase !== "done") return { status: "skipped" };
  // The 20:30 Taipei refresh allows the TWSE daily report to settle first.
  if (now.toISOString().slice(11, 16) < "12:30") return { status: "before-evening-refresh" };
  const manifest = await env.MARKET_DATA.get(MANIFEST_KEY, "json");
  if (!manifest || manifest.asOf !== state.date) return { status: "no-current-market-day" };
  const repository = new CorporateActionRepository(env.T86_DB);
  const attempt = await repository.claim(state.date, now);
  if (!attempt) return { status: "already-checked" };
  try {
    const sources = [
      [exRightsUrl, parseExRightsReport],
      [reductionUrl, parseReductionReport],
      [parValueUrl, parseParValueReport],
    ];
    const reports = [], parsed = [];
    for (const [url, parse] of sources) {
      const response = await fetcher(url(state.date, state.date), {
        headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`TWSE corporate-action HTTP ${response.status}`);
      const report = await response.json();
      reports.push(report);
      parsed.push(parse(report, state.date, state.date));
    }
    const events = combineCorporateActions(...parsed);
    // Empty reports can precede a late official publication. Confirm once more.
    if (attempt === 1 && reports.some((report) => !report.data?.length))
      return { status: "empty-pending" };
    await repository.save([state.date], events, now.toISOString());
    return { status: "complete", events: events.length };
  } catch (error) {
    console.error(JSON.stringify({ event: "corporate-actions-delayed", date: state.date, message: error.message }));
    return { status: "delayed" };
  }
}

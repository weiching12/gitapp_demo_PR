# REST API v1

## Architecture

`worker.js` is the platform entry point: static assets, API dispatch and Cron.
`api/router.js` owns paths, methods, input validation and HTTP response policy.
`services/market-service.js` owns market/stock composition and resource errors.
`repositories/market-repository.js` owns KV keys and reads. Services accept a repository
so storage can change without rewriting HTTP handlers. `api/http.js` owns JSON,
HEAD handling, cache headers and error envelopes.

The existing sync orchestrator and T86 validation/store remain separate from public
queries. No public mutation endpoint starts ingestion, deletes data or changes settings.
Future research signals and backtests should use their own services and repositories,
with versioned API routes added only when those capabilities exist.

## Resources

| Method | Path | Response |
| --- | --- | --- |
| GET / HEAD | `/api/v1/market` | Published market manifest; chunk links point to v1 |
| GET / HEAD | `/api/v1/market/snapshots/{generation}/shards/{index}` | Immutable published shard |
| GET / HEAD | `/api/v1/stocks` | Paginated security metadata, including ETFs |
| GET / HEAD | `/api/v1/stocks/{symbol}` | Stock metadata and available history, existing snapshot format |
| GET / HEAD | `/api/v1/stocks/{symbol}/history` | `{data: [...], meta: {symbol, asOf, updatedAt, tradingDates}}` |
| GET / POST | `/api/v1/presence` | Online count / browser heartbeat; same-origin protection retained |

The stocks collection supports `offset` (default 0), `limit` (default 100, 1–200),
`type=stock|etf`, exact `sector`, and case-insensitive `q` matching code/name.
It reads only the manifest and returns `{data, meta: {asOf, updatedAt, total, offset, limit}}`.
No filter fetches upstream data. History contains available sessions, not fabricated bars.

Examples: `/api/v1/stocks?type=etf&limit=20`, `/api/v1/stocks/2330/history`.

## Compatibility and errors

Existing `/api/market`, `/api/market/{generation}/{index}`, `/api/stocks/{symbol}`,
and `/api/presence` remain available. The frontend continues using these paths;
there is no storage migration or change to scheduled KV publication.

v1 errors use `{error: {code, message}}`; legacy errors retain `{error: message}`.
Codes include `INVALID_QUERY` (400), `NOT_FOUND` / `STOCK_NOT_FOUND` (404),
`METHOD_NOT_ALLOWED` (405), `DATA_UNAVAILABLE` (503), and `PRESENCE_ERROR`.
405 responses include `Allow`. HEAD returns the same status and policy as GET,
without a response body. Missing/unavailable snapshot keys retain legacy 503 behavior.
Errors and presence responses use `no-store`; mutable market resources cache for
60 seconds; immutable snapshot shards cache for 24 hours.

This first version keeps existing snapshot response formats where useful, rather
than forcing every endpoint into one envelope. API version v1 and stored
`schemaVersion: 2` describe different contracts.

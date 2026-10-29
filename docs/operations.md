# API contracts and sync telemetry

The OpenAPI 3.1 contract is available at `/openapi.json` and maintained in
`public/openapi.json`. It describes v1 resources, pagination/filter bounds, analysis
settings, HEAD behavior, heartbeat requirements and error envelopes. Existing API
schema 2 is independent of the HTTP API version. Contract tests exercise actual
router responses against the schema keywords used by this specification.

Each active sync phase emits `market-sync-metrics` to Cloudflare Workers Logs:
date/slot, phase, duration, failures, result, last-tick KV operations and cumulative
round KV operations. Attempts and failed operations are both counted. These are
application observations, not a replacement for Cloudflare billing analytics;
dashboard, CLI and other writers are outside this meter.

The latest aggregate is persisted privately in the coordinator's `metrics` key.
No public diagnostics endpoint exposes internal state, and telemetry never writes
market KV. Idle ticks do not save duplicate metrics. A telemetry storage failure is
logged as `sync-metrics-failed` but cannot undo a completed data checkpoint. Existing
`twse-sync-delayed` and API-read failure logs remain available for diagnosis.

Operational acceptance: confirm a subsequent evening round publishes/finishes,
review `market-sync-metrics` totals and `twse-sync-delayed` errors, and compare the
published generation in KV with the D1 manifest. Deployment itself does not fetch
today's TWSE report or claim a successful future Cron run.

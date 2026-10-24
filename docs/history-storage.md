# Authoritative history in D1

Migration 0003 stores complete, lossless compact histories (including ETFs and null
institution data) in immutable generation/shard rows. A manifest becomes available
only after all 128 shards exist. This minimizes D1 row writes compared with an
initial import of roughly 100,000 daily rows plus indexes; it is a versioned history
repository, not a normalized per-symbol SQL warehouse.

`bootstrapHistory(repository, baseUrl)` copies the published legacy manifest and
shards, validates the complete dataset, verifies D1 roundtrips, rechecks the source
generation, then commits the D1 manifest. It never writes KV. Operator credentials
are supplied by an external D1 adapter, not stored in the repository.

Enable `MARKET_HISTORY_ENABLED=1` only after migration/import validation. Subsequent
snapshots merge normalized new market days with D1 history, save D1 first, then
write public KV. Missing D1 history fails closed; it does not fall back to possibly
incomplete KV. D1 completeness is checked before public manifest publication.
After publication D1 retains the current and previous generation; each generation
contains up to 260 sessions. This bounds storage rather than archiving every full
snapshot forever. Existing T86 audit data is independent and unchanged.

Prices remain explicitly `unadjusted`. No historical bars, dividends, splits or
adjustment factors are invented. Future adjusted-price analytics need a separate
corporate-actions source/model; raw OHLC must stay available.

Verification includes SQLite tests for completeness, immutability and exact null
preservation, and the full coordinated daily pipeline rebuilding a next-day snapshot
after its prior KV shards have been removed from the isolated fixture.

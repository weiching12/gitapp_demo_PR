# Frontend composition

`main.js` owns application startup, data loading, scheduling renders and event
coordination. Views receive explicit models/formatters/callbacks instead of fetching
data or creating independent copies of business rules.

HTTP access is isolated in `src/api`: `HttpClient` normalizes transport and API
errors, while `MarketApiClient` and `PresenceApiClient` own the versioned resource
paths. Providers, PWA refresh checks and presence lifecycle code depend on these
clients; view modules never call `fetch` directly.

- `ui/state.js`: fresh page/filter/settings state per application.
- `ui/preferences.js`: existing storage schema, defaults, migration and failure handling.
- `ui/shell.js`: shared shell markup and accessible navigation.
- `ui/navigation.js`: page visibility, headings, active navigation and date controls.
- `ui/market.js`: sorting/filtering, row reuse and batched market table rendering.
- `ui/watchlist.js`: favorite price cards and their render cache.
- `ui/sectors.js`: sector ranking and constituent dialog rendering; ETFs stay excluded.
- `about.js`: purpose, current capabilities and future goals.

Carousel interaction, dialog lifecycle and event delegation remain in the composition
root. These callbacks cross views; moving them should be a separate, tested change.
Indicator calculations live in `shared/indicators.js`; `src/indicators.js` is a
compatibility re-export. Server analysis uses the same rules, version `technical-v1`,
and explicitly reports unadjusted prices. No new strategy or backtest claim is added.

Browser selectors target sidebar navigation explicitly because About content has
its own navigation buttons. Tests should select the main content panel rather than
assuming only one market-related section exists.

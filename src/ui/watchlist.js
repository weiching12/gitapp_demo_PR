export function renderWatchlistView(context) {
  const { state, snapshots, pendingSymbols, loading, loadFailed, watchState, carouselIndex, esc, icon, number, signed, percent, direction, stockMoney, institutionalMoney, institutionalAmount, pendingField, renderInstitutionOverview, renderOverviewVisibility, renderCarouselPagination, scrollToCarouselCard, updateCarouselControls } = context;
  const previousCards = [...document.querySelectorAll("#watchlist-grid .watch-card")];
  const previousIndex = carouselIndex("price", previousCards);
  const previousSymbol = previousCards[previousIndex]?.dataset.watchSymbol;
  const favorites = state.favorites
    .map((symbol) => snapshots.find((stock) => stock.symbol === symbol))
    .filter((stock) => stock?.latest || (stock && pendingSymbols.has(stock.symbol)));
  document.querySelector("#favorite-count").textContent = state.favorites.length;
  document.querySelector("#watchlist-empty").hidden = favorites.length > 0 || ((loading || loadFailed) && state.favorites.length > 0);
  if (watchState.previousWatchLoading === loading && watchState.previousFavorites?.length === favorites.length && watchState.previousFavorites.every((stock, index) => stock === favorites[index])) return;
  watchState.previousWatchLoading = loading;
  watchState.previousFavorites = favorites;
  if (state.institutionSymbol && !favorites.some((stock) => stock.symbol === state.institutionSymbol))
    document.querySelector("#institution-dialog").close();
  document.querySelector("#watchlist-grid").innerHTML = favorites.map((stock) => {
    const { latest: bar, signal } = stock;
    if (!bar) return `<article class="watch-card pending-card" data-watch-symbol="${stock.symbol}" aria-busy="${loading}"><header class="watch-card-heading"><div><span class="watch-symbol">${stock.symbol}</span><h3>${esc(stock.name)}</h3></div></header><div class="metrics">${["收盤價", "成交量", "KD 值", "股價與季線"].map((label) => `<div class="metric-card"><div class="metric-label">${label}</div><div class="metric-value">${pendingField()}</div></div>`).join("")}</div></article>`;
    const kStatus = bar.k === null ? "資料不足" : bar.k > 80 ? "高檔區間" : bar.k < 20 ? "低檔區間" : "中性區間";
    return `<article class="watch-card" data-watch-symbol="${stock.symbol}" aria-labelledby="watch-title-${stock.symbol}" tabindex="-1">
      <header class="watch-card-heading"><div><span class="watch-symbol">${stock.symbol} <span>${esc(stock.market)} · ${esc(stock.sector)}</span></span><h3 id="watch-title-${stock.symbol}">${esc(stock.name)}</h3></div><button class="icon-button favorite-button is-favorite" data-favorite="${stock.symbol}" aria-label="移除${esc(stock.name)}自選" aria-pressed="true">${icon("star")}</button></header>
      <div class="metrics" aria-label="${esc(stock.name)}關鍵指標">
        <div class="metric-card"><div class="metric-label">收盤價 <span>TWD</span></div><div class="metric-value"><span class="metric-number">${number(bar.close, 2)}</span><span class="change-chip ${direction(bar.changePercent)}">${percent(bar.changePercent)}</span></div><div class="metric-description">較前日 <span class="${direction(bar.change)}">${signed(bar.change)}</span></div></div>
         <div class="metric-card"><div class="metric-label">成交量 <span>當日</span></div><div class="metric-value"><span class="metric-number">${number(bar.volume / 1000)}</span><small>張</small></div><div class="metric-description"><span class="metric-institution-money">法人淨額 <strong class="institution-money ${direction(stockMoney(stock, "total", "day"))}">${institutionalMoney(stockMoney(stock, "total", "day"))}</strong></span><small class="institution-lots">${institutionalAmount(bar.institutionalNet)}</small></div></div>
        <div class="metric-card"><div class="metric-label">KD 值 <span>(${state.settings.period}, ${state.settings.kSmooth}, ${state.settings.dSmooth})</span></div><div class="metric-value"><span class="metric-number">${number(bar.k, 2)}</span><span class="indicator-tag">${kStatus}</span></div><div class="metric-description"><span class="metric-detail">D 值 ${number(bar.d, 2)}</span><span class="metric-detail">RSV ${number(bar.rsv, 2)}</span></div></div>
        <div class="metric-card quarter-card"><div class="metric-label">股價與季線 <span>MA60</span></div><div class="metric-value ${direction(bar.deviation)}"><span class="metric-number">${percent(bar.deviation)}</span></div><div class="metric-description"><span>${bar.deviation === null ? "資料不足" : bar.deviation > 0 ? "季線之上" : bar.deviation < 0 ? "季線之下" : "季線持平"}</span><span class="metric-detail">季線 ${number(bar.ma60, 2)}</span></div></div>
      </div>
      <div class="watch-signal"><span class="signal-badge ${signal.tone}" data-signal="${signal.code}">${esc(signal.label)}</span><span class="signal-reason">${esc(signal.reason)}</span></div>

    </article>`;
  }).join("");
  renderInstitutionOverview(favorites);
  renderOverviewVisibility();
  renderCarouselPagination("price", favorites);
  if (favorites.length) {
    const match = favorites.findIndex((stock) => stock.symbol === previousSymbol);
    const nextIndex = match >= 0 ? match : Math.min(previousIndex, favorites.length - 1);
    scrollToCarouselCard("price", nextIndex, "instant");
  }
  updateCarouselControls("price");
}


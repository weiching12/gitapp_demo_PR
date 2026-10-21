import { filterStocks, getDominantInstitution } from "../../shared/indicators.js";
export function renderMarketView(context) {
  const { state, snapshots, pendingSymbols, stockMoney, tableState, TABLE_BATCH_SIZE, tableRowCache, loading, loadFailed, dataset, isDemo, esc, icon, number, percent, direction, institutionalMoney, institutionalAmount, loadingIcon, pendingField, updateSegmentedControl } = context;
  const visibleStocks = filterStocks(snapshots, state);
  if (["all", "favorites"].includes(state.view)) {
    const query = state.query.trim().toLocaleLowerCase();
    visibleStocks.push(...snapshots.filter((stock) => pendingSymbols.has(stock.symbol) &&
      (state.sector === "all" || stock.sector === state.sector) &&
      (state.view !== "favorites" || state.favorites.includes(stock.symbol)) &&
      (!query || `${stock.symbol} ${stock.name}`.toLocaleLowerCase().includes(query))));
  }
  if (state.sort)
    visibleStocks.sort((a, b) => {
      if (!a.latest) return b.latest ? 1 : 0;
      if (!b.latest) return -1;
      const av = state.sort === "institutionalNet" ? stockMoney(a, "total", "day") : a.latest[state.sort];
      const bv = state.sort === "institutionalNet" ? stockMoney(b, "total", "day") : b.latest[state.sort];
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return (av - bv) * state.sortDirection;
    });
  else visibleStocks.sort((a, b) => {
    const favoriteDifference = Number(state.favorites.includes(b.symbol)) - Number(state.favorites.includes(a.symbol));
    if (favoriteDifference) return favoriteDifference;
    const av = a.latest?.changePercent, bv = b.latest?.changePercent;
    if (av === null || av === undefined) return bv === null || bv === undefined ? a.symbol.localeCompare(b.symbol) : 1;
    if (bv === null || bv === undefined) return -1;
    return bv - av || a.symbol.localeCompare(b.symbol);
  });
  const nextViewKey = [state.date, state.view, state.sector, state.query, state.sort, state.sortDirection].join("|");
  if (nextViewKey !== tableState.viewKey) {
    tableState.viewKey = nextViewKey;
    tableState.visibleLimit = TABLE_BATCH_SIZE;
  }
  const renderedStocks = visibleStocks.slice(0, tableState.visibleLimit);
  const body = document.querySelector("#stock-rows");
  const rows = new Map([...body.children].map((row) => [row.dataset.symbol, row]));
  const visible = new Set(renderedStocks.map((stock) => stock.symbol));
  for (const [symbol, row] of rows) if (!visible.has(symbol)) row.remove();
  let cursor = body.firstElementChild;
  renderedStocks.forEach((stock) => {
    const favorite = state.favorites.includes(stock.symbol);
    let row = rows.get(stock.symbol);
    const cached = row && tableRowCache.get(row);
    if (!stock.latest) {
      if (!cached || cached.stock !== stock || cached.favorite !== favorite || cached.loading !== loading) {
        row ??= document.createElement("tr");
        row.dataset.symbol = stock.symbol;
        row.innerHTML = `<td><button class="icon-button favorite-button ${favorite ? "is-favorite" : ""}" data-favorite="${stock.symbol}" aria-label="${favorite ? "移除" : "加入"}${esc(stock.name)}自選" aria-pressed="${favorite}">${icon("star")}</button></td><th scope="row"><div class="stock-name"><strong>${stock.symbol}</strong><span>${esc(stock.name)}</span></div></th><td>${pendingField()}</td><td class="net-cell-mobile">${pendingField()}</td>${Array.from({ length: 4 }, () => `<td>${pendingField()}</td>`).join("")}<td class="net-cell-desktop">${pendingField()}</td>`;
        tableRowCache.set(row, { stock, favorite, loading });
      }
    } else if (!cached || cached.stock !== stock || cached.favorite !== favorite) {
      const { latest: bar, signal } = stock;
      const leader = getDominantInstitution(bar.institutions);
      const leaderLabel = bar.institutionalNet === null ? "" : !leader ? "合計持平"
        : `${leader.names.join("、")}${leader.direction === "buy" ? "買超" : "賣超"}最多`;
      const netAmount = stockMoney(stock, "total", "day");
      const netCell = `<span class="institution-net">${institutionalMoney(netAmount)}</span><small class="institution-lots">${institutionalAmount(bar.institutionalNet)}</small><small class="institution-leader">${leaderLabel}</small>`;
      const html = `<tr data-symbol="${stock.symbol}"><td><button class="icon-button favorite-button ${favorite ? "is-favorite" : ""}" data-favorite="${stock.symbol}" aria-label="${favorite ? "移除" : "加入"}${esc(stock.name)}自選" aria-pressed="${favorite}">${icon("star")}</button></td><th scope="row"><div class="stock-name"><strong>${stock.symbol}</strong><span>${esc(stock.name)}<span class="sector-inline">${esc(stock.sector)}</span></span></div></th><td class="price-cell"><span class="stock-price-line"><span class="stock-close">${number(bar.close, 2)}</span><span class="mobile-change change-chip ${direction(bar.changePercent)}">${percent(bar.changePercent)}</span></span><small class="stock-volume">量 ${number(bar.volume / 1000)} 張</small></td><td class="net-cell-mobile ${direction(bar.institutionalNet)}">${netCell}</td><td class="change-cell"><span class="change-chip ${direction(bar.changePercent)}">${percent(bar.changePercent)}</span></td><td><span class="k-cell">${number(bar.k, 2)}${bar.k !== null ? `<i style="--k:${Math.max(0, Math.min(100, bar.k))}%"></i>` : ""}</span><small class="kd-detail">D ${number(bar.d, 2)}</small></td><td class="signal-cell"><span class="signal-badge ${signal.tone}" data-signal="${signal.code}">${esc(signal.label)}</span><small class="signal-reason">${esc(signal.reason)}</small></td><td><span class="position-tag ${direction(bar.deviation)}">${bar.deviation === null ? "資料不足" : bar.deviation > 0 ? "季線之上" : bar.deviation < 0 ? "季線之下" : "季線持平"}</span><small class="deviation ${direction(bar.deviation)}">${percent(bar.deviation)}</small></td><td class="net-cell-desktop ${direction(bar.institutionalNet)}">${netCell}</td></tr>`;
      const holder = document.createElement("tbody");
      holder.innerHTML = html;
      if (row) row.replaceChildren(...holder.firstElementChild.childNodes);
      else row = holder.firstElementChild;
      tableRowCache.set(row, { stock, favorite });
    }
    row.setAttribute("aria-busy", String(!stock.latest && loading));
    if (row === cursor) cursor = cursor.nextElementSibling;
    else body.insertBefore(row, cursor);
  });
  if (loading && !dataset.stocks.length) body.innerHTML = `<tr class="initial-field-row" aria-busy="true"><td></td><th scope="row">股票資料</th>${Array.from({ length: 6 }, () => `<td>${loadingIcon()}</td>`).join("")}</tr>`;
  document.querySelector("#table-empty").hidden = visibleStocks.length !== 0 || loading || loadFailed;
  document.querySelector("#favorite-count").textContent =
    state.favorites.length;
  const trigger = document.querySelector("#table-load-trigger");
  trigger.hidden = renderedStocks.length >= visibleStocks.length;
  // A tall viewport may still contain the trigger after one batch. Recheck its
  // position after layout instead of waiting for it to leave and re-enter view.
  if (tableState.observer) {
    tableState.observer.unobserve(trigger);
    if (!trigger.hidden) tableState.observer.observe(trigger);
  }
  document.querySelector("#table-summary").textContent =
    `顯示 ${renderedStocks.length} / ${visibleStocks.length} 檔${isDemo ? "示範" : "觀察"}標的 · ${state.date}`;
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active);
  });
  updateSegmentedControl(document.querySelector(".filter-tabs"));
  document
    .querySelectorAll("[data-sort-heading]")
    .forEach((heading) =>
      heading.setAttribute(
        "aria-sort",
        heading.dataset.sortHeading === state.sort
          ? state.sortDirection === 1
            ? "ascending"
            : "descending"
          : "none",
      ),
    );
}


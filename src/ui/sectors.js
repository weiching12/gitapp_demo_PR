import { isEtf } from "../market-codec.js";
import { getSectorInstitutionSummary, getSectorInstitutionEstimate, getDirectionalLeader, getInstitutionVolumeRatio, getStockInstitutionValue as stockInstitutionValue } from "../../shared/indicators.js";
export function renderSectorOverviewView(context) {
  const { state, dataset, loading, loadFailed, latestSnapshots, loadingIcon, stockMoney, updateSegmentedControl, renderSectorDialog, direction, esc, percent, institutionalFigures } = context;
  if (loading || loadFailed) {
    document.querySelector("#sector-grid").innerHTML = loading
      ? `<div class="sector-loading-fields" aria-label="產業統計載入中">${["產業排名", "當日平均漲跌", "法人淨買賣超金額"].map((label) => `<div><span>${label}</span>${loadingIcon()}</div>`).join("")}</div>` : "";
    return;
  }
  const groups = new Map();
  for (const stock of latestSnapshots) {
    if (isEtf(stock)) continue;
    if (!groups.has(stock.sector)) groups.set(stock.sector, []);
    groups.get(stock.sector).push(stock);
  }
  const days = state.sectorWindow === "day" ? 1 : Number(state.sectorWindow);
  const stockReturn = (stock) => {
    if (days === 1) return stock.latest.changePercent;
    const previousDate = dataset.dates.at(-(days + 1));
    const previous = stock.history.find((bar) => bar.date === previousDate);
    return previous && Number.isFinite(previous.close) && previous.close !== 0
      ? ((stock.latest.close - previous.close) / previous.close) * 100 : null;
  };
  const sectors = [...groups].map(([name, stocks]) => {
    const priced = stocks.filter((stock) => stock.latest);
    const returns = priced.map(stockReturn).filter(Number.isFinite);
    const summary = getSectorInstitutionSummary(stocks, state.sectorWindow, dataset.dates);
    return {
      name,
      stocks,
      summary,
      estimate: getSectorInstitutionEstimate(stocks, state.sectorWindow, dataset.dates),
      total: summary.total,
      change: priced.length && returns.length === priced.length
        ? returns.reduce((total, value) => total + value, 0) / returns.length : null,
    };
  });
  sectors.sort((a, b) => {
    if (state.sectorSort === "name-asc") return a.name.localeCompare(b.name, "zh-Hant");
    if (a.estimate.amount === null) return b.estimate.amount === null ? 0 : 1;
    if (b.estimate.amount === null) return -1;
    return (a.estimate.amount - b.estimate.amount) * (state.sectorSort === "net-asc" ? 1 : -1);
  });
  document.querySelectorAll("[data-sector-window]").forEach((button) =>
    button.setAttribute("aria-pressed", button.dataset.sectorWindow === state.sectorWindow));
  document.querySelectorAll("[data-sector-sort]").forEach((button) =>
    button.setAttribute("aria-pressed", button.dataset.sectorSort === state.sectorSort));
  document.querySelectorAll(".sector-toolbar .segmented-control").forEach(updateSegmentedControl);
  document.querySelector("#sector-change-label").textContent = days === 1
    ? "當日平均漲跌" : `${days} 日平均漲跌`;
  const maxAmount = Math.max(1, ...sectors.map((sector) => Math.abs(sector.estimate.amount ?? 0)));
  let rank = 0;
  document.querySelector("#sector-grid").innerHTML = sectors.map((sector) => {
    const candidates = sector.stocks.map((stock) => ({
      stock,
      value: stockMoney(stock, "total", state.sectorWindow, dataset.info.asOf),
    }));
    const { stock: leader, value: leaderValue } = getDirectionalLeader(candidates, sector.estimate.amount);
    const periodLabel = days === 1 ? "" : `${days} 日 `;
    const leaderChange = leader ? stockReturn(leader) : null;
    const leaderText = leaderValue === null ? "" : `TOP1·${leader.name}`;
    const ranked = Number.isFinite(sector.estimate.amount);
    const bar = ranked ? `<i class="${direction(sector.estimate.amount)}" style="--sector-bar:${Math.max(4, Math.round((Math.abs(sector.estimate.amount) / maxAmount) * 100))}%"></i>` : "";
    return `<article class="sector-card" data-sector-name="${esc(sector.name)}" data-sector-details="${esc(sector.name)}" role="button" tabindex="0" aria-haspopup="dialog" aria-controls="sector-dialog" aria-label="查看${esc(sector.name)}產業個股與法人買賣超"><div class="sector-main"><span class="sector-rank">${ranked ? ++rank : ""}</span><span class="sector-marker ${direction(sector.estimate.amount)}"></span><div class="sector-identity"><h3>${esc(sector.name)}</h3><p>${periodLabel}<span>${esc(leaderText)}</span> <span class="${direction(leaderChange)}">${leader ? percent(leaderChange) : ""}</span></p><small class="sector-breadth" data-sector-breadth title="所選區間淨買賣超金額為正的家數／金額資料完整的有效家數">${sector.estimate.available ? `買超 ${sector.estimate.buying}／${sector.estimate.available} 檔` : ""}</small></div><strong class="sector-change ${direction(sector.change)}">${percent(sector.change)}</strong><div class="sector-total">${institutionalFigures(sector.estimate.amount, sector.total, 'data-sector-amount', 'data-sector-lots')}${bar}</div></div></article>`;
  }).join("");
  if (document.querySelector("#sector-dialog")?.open) renderSectorDialog(state.sectorName);
}

export function renderSectorDialogView(name, context) {
  const { state, dataset, latestSnapshots, stockMoney, isDemo, esc, number, direction, percent, institutionSparkline, institutionalFigures } = context;
  const stocks = latestSnapshots.filter((stock) => !isEtf(stock) && stock.sector === name);
  if (!stocks.length) return;
  const periods = [["day", "當日"], ["5", "5 日"], ["20", "20 日"]];
  const tradingDates = dataset.dates.filter((date) => date <= dataset.info.asOf);
  const members = stocks.map((stock) => ({
    stock,
    net: stockMoney(stock, "total", "day", dataset.info.asOf),
  })).sort((a, b) => {
    if (a.net === null) return b.net === null ? a.stock.name.localeCompare(b.stock.name, "zh-Hant") : 1;
    if (b.net === null) return -1;
    return b.net - a.net || a.stock.name.localeCompare(b.stock.name, "zh-Hant");
  });

  document.querySelector("#sector-dialog-heading").textContent = name;
  document.querySelector("#sector-dialog-meta").textContent = `${isDemo ? "最新完整交易日" : "最新報表交易日"} ${dataset.info.asOf}`;
  document.querySelector("#sector-dialog-content").innerHTML = `
    <section class="sector-detail-summary" aria-labelledby="sector-summary-heading">
      <div class="sector-detail-heading"><div><h3 id="sector-summary-heading">法人淨買賣超金額</h3><p>當日與近 5／20 個交易日累計；金額：億，張數為輔</p></div></div>
      <div class="sector-summary-grid">${periods.map(([key, label]) => {
        const summary = getSectorInstitutionSummary(stocks, key, dataset.dates);
        const total = summary.total;
        const amount = getSectorInstitutionEstimate(stocks, key, dataset.dates).amount;
        return `<article class="sector-summary-period" data-sector-period="${key}" aria-label="${label}法人買賣超"><header><h4>${label}</h4><div class="sector-summary-values">${institutionalFigures(amount, total, 'data-sector-money="total"', 'data-sector-summary="total"')}</div></header><dl>${["外資", "投信", "自營商"].map((institution) => {
          const value = summary[institution];
          const money = getSectorInstitutionEstimate(stocks, key, dataset.dates, institution).amount;
          return `<div><dt>${institution}</dt><dd>${institutionalFigures(money, value, `data-sector-money="${institution}"`, `data-sector-summary="${institution}"`)}</dd></div>`;
        }).join("")}</dl></article>`;
      }).join("")}</div>
    </section>
    <section class="sector-stock-section" aria-labelledby="sector-stock-heading">
      <div class="sector-detail-heading"><div><h3 id="sector-stock-heading">產業個股</h3><p>依當日淨買賣超金額排序；金額：億，張數為輔</p><p class="sector-chart-note">5 日柱圖：每日淨額，左舊右新、各股獨立比例尺。法人占量＝當日淨買賣超股數／成交股數。</p></div></div>
      <div class="sector-stock-scroll" tabindex="0" role="region" aria-label="${esc(name)}個股股價與法人買賣超">
        <table class="sector-stock-table"><caption class="sr-only">${esc(name)}各股最新收盤價、日漲跌幅及當日、5 日、20 日法人淨買賣超金額（億）與張數（張）</caption><colgroup><col class="sector-stock-name-column"><col class="sector-stock-price-column">${periods.map(() => '<col class="sector-stock-net-column">').join("")}</colgroup><thead><tr><th scope="col">股票</th><th scope="col">收盤價／日漲跌</th>${periods.map(([, label]) => `<th scope="col">${label}金額／張數</th>`).join("")}</tr></thead><tbody>${members.map(({ stock }) => `<tr data-sector-stock="${stock.symbol}"><th scope="row"><span class="sector-stock-name"><strong>${esc(stock.name)}</strong><small>${stock.symbol}</small></span></th><td class="sector-stock-price"><span class="sector-stock-close">${number(stock.latest?.close, 2)}</span><small class="sector-stock-change ${direction(stock.latest?.changePercent)}">${percent(stock.latest?.changePercent)}</small></td>${periods.map(([key, label]) => {
          const value = stockInstitutionValue(stock, "total", key);
          const ratio = key === "day" ? getInstitutionVolumeRatio(stock.latest) : null;
          const extra = key === "day"
            ? `<small class="institution-volume-ratio" data-institution-ratio title="當日三大法人淨買賣超股數 ÷ 當日成交股數 × 100%">${ratio === null ? "" : `法人占量 <span class="${direction(ratio)}">${percent(ratio)}</span>`}</small>`
            : key === "5" ? institutionSparkline(stock, tradingDates) : "";
          return `<td class="sector-stock-net" data-sector-net="${key}"><span class="sector-stock-period-label" aria-hidden="true">${label}</span>${institutionalFigures(stockMoney(stock, "total", key, dataset.info.asOf), value)}${extra}</td>`;
        }).join("")}</tr>`).join("")}</tbody></table>
      </div>
    </section>`;
}


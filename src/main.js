import "./styles.css";
import { demoProvider } from "./data.js";
import {
  DEFAULT_SETTINGS,
  getSnapshot,
  filterStocks,
  toCsv,
} from "./indicators.js";
import { renderChart, sparkline } from "./charts.js";

const icons = {
  chart: '<path d="M4 19V9m8 10V4m8 15v-7"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.5l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',
  arrow: '<path d="m7 17 10-10M7 7h10v10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  book: '<path d="M12 5v15M3 4c4-1 6-1 9 1 3-2 5-2 9-1v15c-4-1-6-1-9 1-3-2-5-2-9-1Z"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.chart}</svg>`;
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const number = (value, digits = 0) =>
  value === null || value === undefined
    ? "—"
    : value.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
const signed = (value, digits = 2) =>
  value === null || value === undefined
    ? "—"
    : `${value > 0 ? "+" : ""}${number(value, digits)}`;
const direction = (value) =>
  value > 0 ? "up" : value < 0 ? "down" : "neutral";
const percent = (value) =>
  value === null || value === undefined ? "—" : `${signed(value)}%`;
const state = {
  symbol: "2330",
  date: "",
  range: 66,
  view: "all",
  sector: "all",
  query: "",
  sort: null,
  sortDirection: -1,
  favorites: [],
  settings: { ...DEFAULT_SETTINGS },
};
let dataset, snapshots, visibleStocks;
let toastTimer;

function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem("stock-insight-v1"));
    if (saved && Array.isArray(saved.favorites))
      state.favorites = saved.favorites.filter(
        (item) => typeof item === "string",
      );
    else state.favorites = ["2330", "2317", "0050"];
    if (
      saved?.settings &&
      ["period", "kSmooth", "dSmooth"].every(
        (key) =>
          Number.isInteger(saved.settings[key]) &&
          saved.settings[key] >= 1 &&
          saved.settings[key] <= (key === "period" ? 60 : 20),
      )
    )
      state.settings = saved.settings;
  } catch {
    state.favorites = ["2330", "2317", "0050"];
  }
}

function savePreferences() {
  try {
    localStorage.setItem(
      "stock-insight-v1",
      JSON.stringify({ favorites: state.favorites, settings: state.settings }),
    );
  } catch {
    toast("瀏覽器無法保存設定，本次操作仍可使用。");
  }
}

function toast(message) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("visible"), 3000);
}

function shell() {
  document.querySelector("#app").innerHTML = `
    <aside class="sidebar">
      <a class="brand" href="#main" aria-label="株研首頁"><span class="brand-mark">${icon("chart")}</span><span>株研<span class="brand-en">STOCK INSIGHT</span></span></a>
      <div class="nav-caption">WORKSPACE <span>研究工作台</span></div>
      <nav aria-label="主要導覽">
        <button class="nav-item active" data-nav="all" aria-label="市場總覽">${icon("grid")}<span>市場總覽</span><span class="nav-dot"></span></button>
        <button class="nav-item" data-nav="favorites" aria-label="我的自選">${icon("star")}<span>我的自選</span><span id="favorite-count" class="count-pill"></span></button>
        <button class="nav-item" data-dialog="methodology" aria-label="指標小百科">${icon("book")}<span>指標小百科</span>${icon("chevron", "nav-chevron")}</button>
      </nav>
      <div class="sidebar-note"><span class="note-line"></span><p>看懂數據，<br>找到自己的節奏。</p><span>YOUR EDGE, YOUR PACE.</span></div>
      <div class="sidebar-bottom"><button class="nav-item" data-dialog="settings" aria-label="指標設定">${icon("settings")}<span>指標設定</span></button><div class="workspace-status"><span class="status-dot"></span>前端示範版 <span>v0.1</span></div></div>
    </aside>
    <div class="workspace">
      <header class="topbar"><div class="breadcrumb">研究工作台 ${icon("chevron")} <span>台股市場</span></div><div class="topbar-actions"><span class="demo-badge"><span></span>示範資料</span><button class="text-button" data-dialog="source">${icon("info")}<span>資料說明</span></button></div></header>
      <main id="main" tabindex="-1">
        <section class="page-heading"><div><div class="eyebrow">TAIWAN STOCK EXPLORER</div><h1>台股研究室<span class="heading-dot">.</span></h1><p>從價格到籌碼，讓每一次觀察更有依據。</p></div><div class="date-control"><label for="trade-date">${icon("calendar")} 資料交易日</label><select id="trade-date" aria-describedby="date-hint">${dataset.dates
          .slice(-30)
          .reverse()
          .map(
            (date) =>
              `<option value="${date}">${date.replaceAll("-", " / ")}</option>`,
          )
          .join(
            "",
          )}</select><span id="date-hint">預設顯示前一交易日的模擬資料</span></div></section>
        <div class="demo-notice">${icon("info")}<span>目前為前端展示，行情與法人數據皆為模擬資料。</span><button data-dialog="source">了解資料來源 ${icon("chevron")}</button></div>
        <section class="selection-heading" aria-label="目前分析標的"><div class="selected-title" id="selected-title"></div><div class="market-label"><span class="status-dot"></span>台灣證券市場 <span class="muted">/ TWD</span></div></section>
        <section class="metrics" id="metrics" aria-label="標的關鍵指標"></section>
        <div class="analysis-grid"><section class="panel chart-panel" aria-labelledby="chart-heading"><div class="panel-heading"><div><h2 id="chart-heading">價格與技術走勢</h2><span class="panel-subtitle">日 K 線 · 成交量 · KD 指標</span></div><div class="segmented" role="group" aria-label="圖表期間"><button data-range="22">1 個月</button><button data-range="66" class="active">3 個月</button><button data-range="132">6 個月</button></div></div><div class="chart-legend" id="chart-legend"></div><div id="price-chart"></div><div class="chart-foot"><span>紅漲綠跌 · 均線以收盤價計算</span><span id="chart-period"></span></div></section>
        <section class="panel flow-panel" aria-labelledby="flow-heading"><div class="panel-heading"><div><h2 id="flow-heading">三大法人動向</h2><span class="panel-subtitle" id="flow-date"></span></div><span class="unit-label">單位：張</span></div><div id="institutional-flow"></div></section></div>
        <section class="panel stocks-panel" aria-labelledby="stocks-heading"><div class="panel-heading table-heading"><div><h2 id="stocks-heading">市場觀察清單 <span id="stock-count"></span></h2><span class="panel-subtitle">比較價量、技術指標與法人籌碼</span></div><button class="outline-button" id="export-csv">${icon("download")} 匯出 CSV</button></div>
          <div class="table-toolbar"><div class="filter-tabs" role="group" aria-label="清單篩選"><button data-view="all" class="active">全部標的</button><button data-view="favorites">我的自選</button><button data-view="above">站上季線</button><button data-view="oversold">K 值低於 20</button></div><div class="search-controls"><label class="search-box">${icon("search")}<input id="stock-search" type="search" placeholder="搜尋代碼或名稱" aria-label="搜尋股票代碼或名稱" autocomplete="off"/><kbd>/</kbd></label><select id="sector-filter" aria-label="產業篩選"><option value="all">全部產業</option>${[...new Set(dataset.stocks.map((stock) => stock.sector))].map((sector) => `<option>${esc(sector)}</option>`).join("")}</select></div></div>
          <div class="signal-note">${icon("info")}<span>依資料日 KD 交叉與 MA20 趨勢判讀；模擬資料技術提示，需搭配風險控管。</span><button class="text-button" data-dialog="signals">判讀規則 ${icon("chevron")}</button></div>
          <div class="table-scroll" tabindex="0" role="region" aria-label="股票觀察清單，可左右捲動"><table><caption class="sr-only">模擬股票行情、KD 技術建議與三大法人買賣超，點選股票名稱可查看分析。</caption><thead><tr><th scope="col"><span class="sr-only">自選</span></th><th scope="col">股票名稱 / 代碼</th>${[
            ["close", "收盤價"],
            ["changePercent", "漲跌幅"],
            ["volume", "成交量（張）"],
            ["k", "K 值"],
            ["deviation", "與季線位置"],
            ["institutionalNet", "法人買賣超（張）"],
          ]
            .map(
              ([key, label]) =>
                `<th scope="col" data-sort-heading="${key}" aria-sort="none"><button data-sort="${key}">${label} <span aria-hidden="true">↕</span></button></th>${key === "k" ? '<th scope="col" class="signal-heading">KD 技術建議</th>' : ""}`,
            )
            .join(
              "",
            )}<th scope="col">近月走勢</th></tr></thead><tbody id="stock-rows"></tbody></table></div><div id="table-empty" class="empty-state" hidden>${icon("search")}<h3>沒有符合條件的股票</h3><p>試試其他關鍵字，或清除篩選條件。</p><button class="outline-button" id="reset-filters">清除篩選</button></div><div class="table-footer"><span id="table-summary"></span><span>點選股票名稱，查看完整分析 ${icon("arrow")}</span></div>
        </section>
        <footer class="page-footer"><span class="footer-brand">株研 <span>STOCK INSIGHT</span></span><span>示範資料僅供功能展示，不作為投資依據。</span><button data-dialog="methodology">計算方法 ${icon("arrow")}</button></footer>
      </main>
    </div>
    <dialog id="info-dialog" aria-labelledby="dialog-heading"><div class="dialog-top"><span class="eyebrow">STOCK INSIGHT / GUIDE</span><button class="icon-button" id="close-dialog" aria-label="關閉視窗">${icon("close")}</button></div><div id="dialog-content"></div></dialog>
    <div id="toast" role="status" class="toast"></div>`;
}

function refreshData() {
  snapshots = dataset.stocks.map((stock) =>
    getSnapshot(stock, state.date, state.settings),
  );
  renderSelected();
  renderTable();
}

function renderSelected() {
  const stock = snapshots.find((item) => item.symbol === state.symbol);
  const bar = stock.latest;
  const favorite = state.favorites.includes(stock.symbol);
  document.querySelector("#selected-title").innerHTML =
    `<span class="stock-code">${stock.symbol}</span><h2>${esc(stock.name)}</h2><span class="tag">${esc(stock.sector)}</span><button class="icon-button favorite-button ${favorite ? "is-favorite" : ""}" data-favorite="${stock.symbol}" aria-label="${favorite ? "移除" : "加入"}${esc(stock.name)}自選" aria-pressed="${favorite}">${icon("star")}</button>`;
  const kStatus =
    bar.k === null
      ? "資料不足"
      : bar.k > 80
        ? "高檔區間"
        : bar.k < 20
          ? "低檔區間"
          : "中性區間";
  document.querySelector("#metrics").innerHTML = `
    <article class="metric-card"><div class="metric-label">收盤價 <span>TWD</span></div><div class="metric-value"><span class="metric-number">${number(bar.close, 2)}</span><span class="change-chip ${direction(bar.changePercent)}">${percent(bar.changePercent)}</span></div><div class="metric-description"><span class="${direction(bar.change)}">${bar.change >= 0 ? "↗" : "↘"} ${signed(bar.change)}</span> <span>較前一交易日</span></div></article>
    <article class="metric-card"><div class="metric-label">當日成交量 ${icon("chart")}</div><div class="metric-value"><span class="metric-number">${number(bar.volume / 1000)}</span><small>張</small></div><div class="metric-description">三大法人淨額 <span class="${direction(bar.institutionalNet)}">${signed(bar.institutionalNet / 1000, 0)} 張</span></div></article>
    <article class="metric-card"><div class="metric-label">K 值 <span>KD (${state.settings.period}, ${state.settings.kSmooth}, ${state.settings.dSmooth})</span></div><div class="metric-value"><span class="metric-number">${number(bar.k, 2)}</span><span class="indicator-tag">${kStatus}</span></div><div class="metric-description"><span class="metric-detail">D 值 <span class="dark-text">${number(bar.d, 2)}</span></span><span class="metric-separator">·</span><span class="metric-detail">RSV <span class="dark-text">${number(bar.rsv, 2)}</span></span></div></article>
    <article class="metric-card quarter-card"><div class="metric-label">股價與季線 <span>MA60</span></div><div class="metric-value ${direction(bar.deviation)}"><span class="metric-number">${percent(bar.deviation)}</span><span class="position-arrow" aria-hidden="true">${bar.deviation > 0 ? "↗" : bar.deviation < 0 ? "↘" : "→"}</span></div><div class="metric-description"><span>${bar.deviation === null ? "資料不足" : bar.deviation > 0 ? "站上季線" : bar.deviation < 0 ? "位於季線下方" : "位於季線"} </span><span class="metric-separator">·</span> <span>季線 ${number(bar.ma60, 2)}</span></div></article>`;
  document.querySelector("#chart-legend").innerHTML = [
    ["ma5", "MA5"],
    ["ma20", "MA20"],
    ["ma60", "MA60"],
    ["k", "K"],
    ["d", "D"],
  ]
    .map(
      ([key, label]) =>
        `<span><i class="legend-dot ${key}"></i>${label} <b>${number(bar[key], 2)}</b></span>`,
    )
    .join("");
  document.querySelector("#price-chart").innerHTML = renderChart(
    stock.history,
    state.range,
    window.matchMedia("(max-width: 520px)").matches,
  );
  const visible = stock.history.slice(-state.range);
  document.querySelector("#chart-period").textContent =
    `${visible[0].date} — ${bar.date}`;
  document.querySelector("#flow-date").textContent =
    `${bar.date.replaceAll("-", ".")} · 當日買賣超`;
  const buy = bar.institutions.reduce((sum, item) => sum + item.buy, 0);
  const sell = bar.institutions.reduce((sum, item) => sum + item.sell, 0);
  const max = Math.max(
    ...bar.institutions.flatMap((item) => [item.buy, item.sell]),
    1,
  );
  document.querySelector("#institutional-flow").innerHTML =
    `<div class="flow-total"><span>三大法人合計買賣超</span><strong class="${direction(buy - sell)}">${signed((buy - sell) / 1000, 0)}<small> 張</small></strong><div><span>買進 ${number(buy / 1000)} 張</span><span>賣出 ${number(sell / 1000)} 張</span></div></div><div class="flow-key"><span><i class="buy-key"></i>買進</span><span><i class="sell-key"></i>賣出</span></div>${bar.institutions.map((item) => `<div class="institution"><div class="institution-heading"><h3>${item.name}</h3><span class="${direction(item.buy - item.sell)}">${signed((item.buy - item.sell) / 1000, 0)} <small>張</small></span></div><div class="flow-bar-row"><span class="flow-bar buy" style="width:${(item.buy / max) * 100}%"></span><span>${number(item.buy / 1000)}</span></div><div class="flow-bar-row"><span class="flow-bar sell" style="width:${(item.sell / max) * 100}%"></span><span>${number(item.sell / 1000)}</span></div></div>`).join("")}<div class="flow-note">${icon("info")} 買賣超 = 買進 − 賣出；1 張 = 1,000 股</div>`;
  document.querySelectorAll("[data-range]").forEach((button) => {
    const active = Number(button.dataset.range) === state.range;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active);
  });
}

function renderTable() {
  visibleStocks = filterStocks(snapshots, state);
  if (state.sort)
    visibleStocks.sort((a, b) => {
      const av = a.latest[state.sort],
        bv = b.latest[state.sort];
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return (av - bv) * state.sortDirection;
    });
  document.querySelector("#stock-rows").innerHTML = visibleStocks
    .map((stock) => {
      const { latest: bar, signal } = stock;
      const favorite = state.favorites.includes(stock.symbol);
      const selected = state.symbol === stock.symbol;
      return `<tr class="${selected ? "selected-row" : ""}" data-symbol="${stock.symbol}"><td><button class="icon-button favorite-button ${favorite ? "is-favorite" : ""}" data-favorite="${stock.symbol}" aria-label="${favorite ? "移除" : "加入"}${esc(stock.name)}自選" aria-pressed="${favorite}">${icon("star")}</button></td><th scope="row"><button class="stock-name" data-select="${stock.symbol}" aria-pressed="${selected}"><strong>${esc(stock.name)}</strong><span>${stock.symbol}<span class="sector-inline">${esc(stock.sector)}</span></span></button></th><td class="price-cell">${number(bar.close, 2)}</td><td><span class="change-chip ${direction(bar.changePercent)}">${percent(bar.changePercent)}</span></td><td>${number(bar.volume / 1000)}</td><td><span class="k-cell">${number(bar.k, 2)}${bar.k !== null ? `<i style="--k:${Math.max(0, Math.min(100, bar.k))}%"></i>` : ""}</span><small class="kd-detail">D ${number(bar.d, 2)}</small></td><td class="signal-cell"><span class="signal-badge ${signal.tone}" data-signal="${signal.code}">${esc(signal.label)}</span><small class="signal-reason">${esc(signal.reason)}</small></td><td><span class="position-tag ${direction(bar.deviation)}">${bar.deviation === null ? "資料不足" : bar.deviation > 0 ? "季線之上" : bar.deviation < 0 ? "季線之下" : "季線持平"}</span><small class="deviation ${direction(bar.deviation)}">${percent(bar.deviation)}</small></td><td class="${direction(bar.institutionalNet)}">${signed(bar.institutionalNet / 1000, 0)}</td><td>${sparkline(stock.history)}</td></tr>`;
    })
    .join("");
  document.querySelector("#table-empty").hidden = visibleStocks.length !== 0;
  document.querySelector("#export-csv").disabled = visibleStocks.length === 0;
  document.querySelector("#stock-count").textContent =
    `${visibleStocks.length} 檔`;
  document.querySelector("#favorite-count").textContent =
    state.favorites.length;
  document.querySelector("#table-summary").textContent =
    `顯示 ${visibleStocks.length} / ${snapshots.length} 檔示範標的 · ${state.date}`;
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active);
  });
  document.querySelectorAll("[data-nav]").forEach((button) => {
    const active =
      button.dataset.nav === "favorites"
        ? state.view === "favorites"
        : state.view !== "favorites";
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
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

function technicalSignalGuide() {
  return `<p class="dialog-intro">使用目前 KD (${state.settings.period}, ${state.settings.kSmooth}, ${state.settings.dSmooth}) 設定，僅比較資料日與前一交易日。買賣提示只標示當日新交叉，每日重新判讀。</p>
    <dl class="signal-rules">
      <div><dt>留意買點</dt><dd>低檔黃金交叉，且收盤價 ≥ MA20、MA20 ≥ 前日 MA20。</dd></div>
      <div><dt>反彈觀察</dt><dd>低檔黃金交叉，但 MA20 趨勢條件未齊備，包含均線資料不足。</dd></div>
      <div><dt>留意賣點</dt><dd>高檔死亡交叉，留意動能反轉與部位風險。</dd></div>
      <div><dt>動能轉強／轉弱</dt><dd>其他區間的黃金／死亡交叉，仍需搭配價量觀察。</dd></div>
      <div><dt>低檔／高檔觀察</dt><dd>當日沒有上述交叉，K &lt; 20 為低檔，K &gt; 80 為高檔；留意持續鈍化。</dd></div>
      <div><dt>偏多／偏弱／中性</dt><dd>其餘情況：K &gt; D 且 MA20 趨勢確認為偏多；K &lt; D 為偏弱；其餘中性。</dd></div>
    </dl>
    <p class="helper-text">黃金交叉：前日 K ≤ D、當日 K &gt; D 且 K 上升；死亡交叉反之。低／高檔交叉要求當日或前日 K、D 同時低於 20／高於 80。依上列順序判讀；K 恰為 20 或 80 不屬極端區間。缺少連續兩日有效 KD 時顯示「資料不足」。</p>
    <p class="helper-text">這是本網站訂定、尚未回測的觀察規則；目前使用模擬行情，沒有預測報酬或交易保證。概念參考：<a class="signal-source" href="https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/slow-stochastic" target="_blank" rel="noopener noreferrer">Fidelity 隨機指標說明 ↗</a>；本網站沿用原有遞迴 KD 算法，MA20 確認為額外條件。</p>`;
}

function openDialog(type) {
  const content = document.querySelector("#dialog-content");
  if (type === "settings") {
    content.innerHTML = `<h2 id="dialog-heading">讓指標符合你的觀察習慣</h2><p class="dialog-intro">調整後，圖表與觀察清單會一起重新計算。設定會保存在這個瀏覽器。</p><form id="settings-form"><div class="form-field"><label for="period">RSV 回溯週期</label><div><input id="period" name="period" type="number" min="1" max="60" value="${state.settings.period}" required/><span>個交易日</span></div></div><div class="form-field"><label for="kSmooth">K 平滑係數</label><input id="kSmooth" name="kSmooth" type="number" min="1" max="20" value="${state.settings.kSmooth}" required/></div><div class="form-field"><label for="dSmooth">D 平滑係數</label><input id="dSmooth" name="dSmooth" type="number" min="1" max="20" value="${state.settings.dSmooth}" required/></div><p class="helper-text">預設 KD (9, 3, 3)。季線固定為 60 個交易日的收盤價平均。</p><div class="dialog-buttons"><button class="outline-button" type="button" id="default-settings">恢復預設</button><button class="primary-button" type="submit">${icon("check")} 儲存並重新計算</button></div></form>`;
  } else if (type === "signals") {
    content.innerHTML = `<h2 id="dialog-heading">KD 技術建議怎麼看？</h2>${technicalSignalGuide()}`;
  } else if (type === "source") {
    content.innerHTML = `<h2 id="dialog-heading">資料透明，觀察才有依據。</h2><p class="dialog-intro">這是可操作的前端示範版，目前沒有連接交易所或即時行情服務。</p><div class="source-banner">${icon("info")} ${esc(dataset.info.note)}</div><dl class="source-details"><div><dt>市場與標的</dt><dd>12 檔台灣上市股票與 ETF 範例</dd></div><div><dt>示範資料截止日</dt><dd>${dataset.info.asOf}（固定資料，不會自動更新）</dd></div><div><dt>買賣量定義</dt><dd>外資、投信、自營商買進與賣出股數；畫面換算成張</dd></div><div><dt>指標計算方式</dt><dd>由模擬 OHLC 歷史資料在瀏覽器計算，並非硬填指標數值</dd></div><div><dt>下一階段</dt><dd>確認正式行情與三大法人資料來源，接上 API，再設定 Cloudflare 部署。</dd></div></dl><p class="helper-text">正式資料需涵蓋交易日曆、除權息還原與法人分類定義。此版資料未經還原，不能用於實際交易。</p>`;
  } else {
    content.innerHTML = `<h2 id="dialog-heading">讀懂價格背後的訊號</h2><p class="dialog-intro">指標提供觀察角度。搭配價量與籌碼，建立更完整的判斷。</p><article class="guide-item"><span>01</span><div><h3>季線 MA60</h3><p>最近 60 個交易日收盤價的簡單移動平均，包含選定資料日。股價高於季線時，位置顯示為正值。</p><code>乖離率 = (收盤價 ÷ MA60 − 1) × 100%</code></div></article><article class="guide-item"><span>02</span><div><h3>KD 隨機指標</h3><p>預設以 9 日最高、最低與當日收盤價計算 RSV，再以平滑係數 3 遞推 K、D。K、D 初始值為 50；不足 9 日不顯示。最高與最低相同時 RSV 採 50。</p><code>RSV = (收盤 − 最低) ÷ (最高 − 最低) × 100<br>K = 前日 K × 2/3 + RSV × 1/3<br>D = 前日 D × 2/3 + 當日 K × 1/3</code><p>K &gt; 80 為高檔區，K &lt; 20 為低檔區，不能單獨視為買賣訊號。你可以在指標設定調整參數。</p></div></article><article class="guide-item"><span>03</span><div><h3>三大法人買賣超</h3><p>外資、投信及自營商的買進股數減去賣出股數。正值為買超，負值為賣超。1 張 = 1,000 股；法人買賣量與全市場成交量的統計範圍不同。</p></div></article><article class="guide-item"><span>04</span><div><h3>前一交易日</h3><p>第一版預設資料日為 ${dataset.info.asOf}。日期選單可回看 30 個模擬交易日，所有指標僅使用選定日及之前的資料。</p></div></article><article class="guide-item"><span>05</span><div><h3>KD 技術建議</h3>${technicalSignalGuide()}</div></article>`;
  }
  document.querySelector("#info-dialog").showModal();
}

function resetFilters() {
  state.query = "";
  state.sector = "all";
  state.view = "all";
  state.sort = null;
  document.querySelector("#stock-search").value = "";
  document.querySelector("#sector-filter").value = "all";
  renderTable();
}

function exportCsv() {
  const headers = [
    "資料模式",
    "交易日",
    "代碼",
    "名稱",
    "收盤價_TWD",
    "漲跌幅_%",
    "成交量_張",
    "K",
    "D",
    "MA60",
    "季線乖離_%",
    "外資買進_張",
    "外資賣出_張",
    "外資買賣超_張",
    "投信買進_張",
    "投信賣出_張",
    "投信買賣超_張",
    "自營商買進_張",
    "自營商賣出_張",
    "自營商買賣超_張",
    "法人合計買賣超_張",
    "RSV週期",
    "K平滑係數",
    "D平滑係數",
    "KD技術建議",
    "技術判讀原因",
    "MA20",
  ];
  const fixed = (value) => (value === null ? "" : value.toFixed(4));
  const rows = visibleStocks.map((stock) => {
    const bar = stock.latest;
    return [
      "模擬資料",
      bar.date,
      stock.symbol,
      stock.name,
      bar.close,
      fixed(bar.changePercent),
      bar.volume / 1000,
      fixed(bar.k),
      fixed(bar.d),
      fixed(bar.ma60),
      fixed(bar.deviation),
      ...bar.institutions.flatMap((item) => [
        item.buy / 1000,
        item.sell / 1000,
        (item.buy - item.sell) / 1000,
      ]),
      bar.institutionalNet / 1000,
      state.settings.period,
      state.settings.kSmooth,
      state.settings.dSmooth,
      stock.signal.label,
      stock.signal.reason,
      fixed(bar.ma20),
    ];
  });
  const url = URL.createObjectURL(
    new Blob([toCsv([headers, ...rows])], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `stock-insight-demo-${state.date}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`已匯出 ${visibleStocks.length} 檔股票的示範資料`);
}

function bindEvents() {
  window.matchMedia("(max-width: 520px)").addEventListener("change", () => {
    renderSelected();
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.dialog) openDialog(button.dataset.dialog);
    if (button.id === "close-dialog")
      document.querySelector("#info-dialog").close();
    if (button.dataset.select) {
      state.symbol = button.dataset.select;
      renderSelected();
      renderTable();
      // Keep keyboard focus on the selected stock after updating table markup.
      document
        .querySelector(`[data-select="${state.symbol}"]`)
        ?.focus({ preventScroll: true });
      toast(
        `已切換至 ${snapshots.find((stock) => stock.symbol === state.symbol).name}`,
      );
    }
    if (button.dataset.favorite) {
      const symbol = button.dataset.favorite;
      const wasFavorite = state.favorites.includes(symbol);
      const wasInTitle = Boolean(button.closest("#selected-title"));
      state.favorites = wasFavorite
        ? state.favorites.filter((item) => item !== symbol)
        : [...state.favorites, symbol];
      savePreferences();
      renderSelected();
      renderTable();
      const scope = wasInTitle ? "#selected-title" : "#stock-rows";
      document
        .querySelector(`${scope} [data-favorite="${symbol}"]`)
        ?.focus({ preventScroll: true });
      toast(
        wasFavorite ? `已將 ${symbol} 移出自選` : `已將 ${symbol} 加入自選`,
      );
    }
    if (button.dataset.range) {
      state.range = Number(button.dataset.range);
      renderSelected();
    }
    if (button.dataset.view || button.dataset.nav) {
      state.view = button.dataset.view ?? button.dataset.nav;
      renderTable();
      if (button.dataset.nav)
        document
          .querySelector("#stocks-heading")
          .scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (button.dataset.sort) {
      state.sortDirection =
        state.sort === button.dataset.sort ? -state.sortDirection : -1;
      state.sort = button.dataset.sort;
      renderTable();
    }
    if (button.id === "reset-filters") resetFilters();
    if (button.id === "export-csv") exportCsv();
    if (button.id === "default-settings") {
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS))
        document.querySelector(`#${key}`).value = value;
    }
  });
  document.querySelector("#stock-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderTable();
  });
  document
    .querySelector("#sector-filter")
    .addEventListener("change", (event) => {
      state.sector = event.target.value;
      renderTable();
    });
  document.querySelector("#trade-date").addEventListener("change", (event) => {
    state.date = event.target.value;
    refreshData();
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "/" &&
      !document.querySelector("dialog[open]") &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
    ) {
      event.preventDefault();
      document.querySelector("#stock-search").focus();
    }
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "settings-form") return;
    event.preventDefault();
    const form = new FormData(event.target);
    state.settings = Object.fromEntries(
      ["period", "kSmooth", "dSmooth"].map((key) => [
        key,
        Number(form.get(key)),
      ]),
    );
    savePreferences();
    refreshData();
    document.querySelector("#info-dialog").close();
    toast("指標已重新計算，設定已儲存");
  });
  document.querySelector("#info-dialog").addEventListener("click", (event) => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      event.currentTarget.close();
  });
}

async function init() {
  dataset = await demoProvider.load();
  state.date = dataset.info.asOf;
  readPreferences();
  state.favorites = [...new Set(state.favorites)].filter((symbol) =>
    dataset.stocks.some((stock) => stock.symbol === symbol),
  );
  shell();
  refreshData();
  bindEvents();
}

init().catch((error) => {
  console.error("Unable to initialize stock dashboard", error);
  document.querySelector("#app").innerHTML =
    '<main class="load-error"><h1>暫時無法載入資料</h1><p>請重新整理頁面再試一次。</p></main>';
});

import "./styles.css";
import "./typography.css";
import { loadDataset } from "./provider.js";
import {
  DEFAULT_SETTINGS,
  getSnapshot,
  filterStocks,
  getDominantInstitution,
  getDirectionalLeader,
  getInstitutionNet,
} from "./indicators.js";

const icons = {
  chart: '<path d="M4 19V9m8 10V4m8 15v-7"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.5l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
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
const institutionalAmount = (value, withUnit = true) => value === null
  ? "資料不足"
  : `${signed(value / 1000, Number.isInteger(value / 1000) ? 0 : 2)}${withUnit ? " 張" : ""}`;
const institutionalStreak = ({ direction, days, atLeast }) => {
  if (direction === "unknown") return "資料不足";
  if (direction === "neutral") return "當日持平";
  return `${atLeast ? "至少" : ""}連${direction === "buy" ? "買" : "賣"}${days}日`;
};
const institutionalHistory = (stats) =>
  `<div class="watch-history">${[5, 20].map((days) =>
    `<span class="watch-cumulative" data-window="${days}"><span>近 ${days} 日累計</span><b class="${direction(stats[`net${days}`])}">${institutionalAmount(stats[`net${days}`])}</b></span>`,
  ).join("")}</div>`;
const state = {
  date: "",
  page: "market",
  view: "all",
  sector: "all",
  query: "",
  sort: null,
  sortDirection: -1,
  favorites: [],
  overview: "price",
  institutionWindow: "day",
  sectorWindow: "day",
  sectorSort: "name-asc",
  institutionSymbol: null,
  sectorName: null,
  settings: { ...DEFAULT_SETTINGS },
};
let dataset, snapshots, latestSnapshots;
let toastTimer;
let isDemo;

function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem("stock-insight-v1"));
    if (saved && Array.isArray(saved.favorites))
      state.favorites = saved.favorites.filter(
        (item) => typeof item === "string",
      );
    else state.favorites = ["2330", "2317", "0050", "3026", "6488"];
    if (saved && saved.catalogVersion !== 2)
      state.favorites = [...new Set([...state.favorites, "3026", "6488"])];
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
    state.favorites = ["2330", "2317", "0050", "3026", "6488"];
  }
}

function savePreferences() {
  try {
    localStorage.setItem(
      "stock-insight-v1",
      JSON.stringify({ favorites: state.favorites, settings: state.settings, catalogVersion: 2 }),
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
        <button class="nav-item active" data-page="market" aria-label="市場觀察清單">${icon("grid")}<span class="nav-label">市場觀察清單</span><span class="nav-label-mobile" aria-hidden="true">市場</span><span class="nav-dot"></span></button>
        <button class="nav-item" data-page="favorites" aria-label="自選總覽">${icon("star")}<span class="nav-label">自選總覽</span><span class="nav-label-mobile" aria-hidden="true">自選</span><span id="favorite-count" class="count-pill"></span></button>
        <button class="nav-item" data-page="sectors" aria-label="法人買株">${icon("chart")}<span class="nav-label">法人買株</span><span class="nav-label-mobile" aria-hidden="true">法人</span><span class="nav-dot"></span></button>
        <button class="nav-item" data-dialog="methodology" aria-label="指標小百科">${icon("book")}<span>指標說明</span>${icon("chevron", "nav-chevron")}</button>
        <button class="nav-item" data-dialog="source" aria-label="資料說明">${icon("info")}<span>資料說明</span>${icon("chevron", "nav-chevron")}</button>
      </nav>
      <div class="sidebar-note"><span class="note-line"></span><p>看懂數據，<br>找到自己的節奏。</p><span>YOUR EDGE, YOUR PACE.</span></div>
      <div class="sidebar-bottom"><button class="nav-item" data-dialog="settings" aria-label="指標設定">${icon("settings")}<span>指標設定</span></button><div class="workspace-status"><span class="status-dot"></span>${isDemo ? "前端示範版" : "每日收盤資料"} <span>v0.2</span></div></div>
    </aside>
    <div class="workspace">
      <header class="topbar"><div class="breadcrumb">研究工作台 ${icon("chevron")} <span id="breadcrumb-current">市場觀察清單</span></div><div class="topbar-actions"><span class="demo-badge"><span></span>${esc(dataset.info.label)}</span></div></header>
      <main id="main" tabindex="-1">
        <section class="page-heading"><div><div class="eyebrow" id="page-eyebrow">TAIWAN STOCK EXPLORER</div><h1 id="page-title">市場觀察清單<span class="heading-dot">.</span></h1><p id="page-description">比較全部標的的價量、技術指標與法人籌碼。</p></div><div class="date-control"><label for="trade-date">${icon("calendar")} 資料交易日</label><select id="trade-date" aria-describedby="date-hint">${dataset.dates
          .slice(-30)
          .reverse()
          .map(
            (date) =>
              `<option value="${date}">${date.replaceAll("-", " / ")}</option>`,
          )
          .join(
            "",
          )}</select><span id="date-hint">${isDemo ? "預設顯示前一交易日的模擬資料" : "最近一個價量與法人資料均完整的交易日"}</span></div></section>
        <section id="watchlist" data-page-panel="favorites" aria-label="自選股票" hidden>
          <div class="overview-controls"><div class="overview-tabs" role="tablist" aria-label="自選總覽視角"><button id="watchlist-price-tab" role="tab" data-overview="price" aria-label="價量總覽" aria-controls="watchlist-grid" aria-selected="true" tabindex="0">${icon("grid")}<span class="overview-label-full">價量總覽</span><span class="overview-label-short">價量</span></button><button id="watchlist-institutions-tab" role="tab" data-overview="institutions" aria-label="法人總覽" aria-controls="institution-overview" aria-selected="false" tabindex="-1">${icon("chart")}<span class="overview-label-full">法人總覽</span><span class="overview-label-short">法人</span></button></div><div class="institution-window" role="group" aria-label="法人累計區間" hidden><button data-institution-window="day" aria-pressed="true">當日</button><button data-institution-window="5" aria-pressed="false">近 5 日</button><button data-institution-window="20" aria-pressed="false">近 20 日</button></div></div>
          <div id="watchlist-carousel-controls" class="watchlist-carousel-controls" data-carousel="price" aria-label="自選卡片導覽"><span id="watchlist-carousel-status" role="status"></span><div class="watchlist-carousel-actions"><select id="watchlist-carousel-jump" data-carousel-jump aria-label="快速選擇自選股票" hidden></select><button class="icon-button" data-carousel-step="-1" aria-label="上一檔自選股票">${icon("chevron")}</button><button class="icon-button" data-carousel-step="1" aria-label="下一檔自選股票">${icon("chevron")}</button></div></div>
          <div id="watchlist-grid" class="watchlist-grid" role="tabpanel" aria-labelledby="watchlist-price-tab"></div>
          <section id="institution-overview" class="institution-overview" role="tabpanel" aria-labelledby="watchlist-institutions-tab" hidden><div id="institution-carousel-controls" class="watchlist-carousel-controls" data-carousel="institutions" aria-label="法人卡片導覽"><span role="status"></span><div class="watchlist-carousel-actions"><select data-carousel-jump aria-label="快速選擇法人比較股票" hidden></select><button class="icon-button" data-carousel-step="-1" aria-label="上一檔法人比較股票">${icon("chevron")}</button><button class="icon-button" data-carousel-step="1" aria-label="下一檔法人比較股票">${icon("chevron")}</button></div></div><div id="institution-overview-rows" class="institution-overview-rows"></div><p class="institution-overview-note">單位：張。連買／連賣天數截至資料日，與累計區間分開計算。</p></section>
          <div id="watchlist-empty" class="watchlist-empty" hidden>${icon("star")}<h3>建立你的自選清單</h3><p>到市場觀察清單點選星號，股票就會顯示在這裡。</p><button class="outline-button" data-manage-favorites>前往選擇股票</button></div>
        </section>
        <section class="panel stocks-panel" data-page-panel="market" aria-label="市場觀察股票表格">
          <div class="table-toolbar"><div class="filter-tabs" role="group" aria-label="清單篩選"><button data-view="all" class="active">全部標的</button><button data-view="favorites">我的自選</button><button data-view="above">站上季線</button><button data-view="oversold">K 值低於 20</button></div><div class="search-controls"><label class="search-box">${icon("search")}<input id="stock-search" type="search" placeholder="搜尋代碼或名稱" aria-label="搜尋股票代碼或名稱" autocomplete="off"/><kbd>/</kbd></label><select id="sector-filter" aria-label="產業篩選"><option value="all">全部產業</option>${[...new Set(dataset.stocks.map((stock) => stock.sector))].map((sector) => `<option>${esc(sector)}</option>`).join("")}</select></div></div>
          <div class="signal-note">${icon("info")}<span>依資料日 KD 交叉與 MA20 趨勢判讀；${isDemo ? "模擬資料技術提示" : "技術提示僅供觀察"}，需搭配風險控管。</span><button class="text-button" data-dialog="signals">判讀規則 ${icon("chevron")}</button></div>
          <p class="table-scroll-hint">左右滑動可看完整數據，收藏與股票名稱固定顯示。</p><div class="table-scroll" tabindex="0" role="region" aria-label="股票觀察清單，可左右捲動"><table><caption class="sr-only">${isDemo ? "模擬股票行情" : "股票收盤行情"}、KD 技術建議與三大法人買賣超。日漲跌幅與前一交易日收盤價比較，成交量位於收盤價下方，以張表示。點選星號可加入或移除上方自選總覽。</caption><colgroup><col class="favorite-column"/><col class="stock-column"/><col class="price-column"/><col class="change-column"/><col class="kd-column"/><col class="signal-column"/><col class="position-column"/><col class="net-column"/></colgroup><thead><tr><th scope="col"><span class="sr-only">自選</span></th><th scope="col">股票</th>${[
            ["close", "收盤價"],
            ["changePercent", "日漲跌幅"],
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
            )}</tr></thead><tbody id="stock-rows"></tbody></table></div><div id="table-empty" class="empty-state" hidden>${icon("search")}<h3>沒有符合條件的股票</h3><p>試試其他關鍵字，或清除篩選條件。</p><button class="outline-button" id="reset-filters">清除篩選</button></div><div class="table-footer"><span id="table-summary"></span><span>點選星號，即時更新我的自選 ${icon("star")}</span></div>
        </section>
        <section id="sector-page" class="sector-page" data-page-panel="sectors" aria-label="法人買株排行榜" hidden>
          <div class="sector-toolbar"><div class="sector-sort-control"><span>排行方式</span><div class="sector-sort-tabs" role="group" aria-label="排行方式"><button data-sector-sort="name-asc" aria-pressed="true">產業</button><button data-sector-sort="net-desc" aria-pressed="false">買超</button><button data-sector-sort="net-asc" aria-pressed="false">賣超</button></div></div><div class="sector-period-control"><span>時間範圍</span><div class="sector-period" role="group" aria-label="法人買株累計區間"><button data-sector-window="day" aria-pressed="true">當日</button><button data-sector-window="5" aria-pressed="false">5 日</button><button data-sector-window="20" aria-pressed="false">20 日</button></div></div></div>
          <div class="sector-ranking-head" aria-hidden="true"><span>產業排名</span><span id="sector-change-label">當日平均漲跌</span><span>法人淨買賣超</span></div>
          <div id="sector-grid" class="sector-grid sector-ranking"></div>
          <p class="sector-note">單位：張。TOP1 百分比為該個股的區間漲跌幅；點選產業可同時查看當日、5 日、20 日買賣超。僅統計目前研究標的。</p>
        </section>
        <footer class="page-footer"><span class="footer-brand">株研 <span>STOCK INSIGHT</span></span><span>技術提示僅供研究參考。</span><button data-dialog="methodology">計算方法 ${icon("arrow")}</button></footer>
      </main>
    </div>
    <dialog id="info-dialog" aria-labelledby="dialog-heading"><div class="dialog-top"><span class="eyebrow">STOCK INSIGHT / GUIDE</span><button class="icon-button" id="close-dialog" aria-label="關閉視窗">${icon("close")}</button></div><div id="dialog-content"></div></dialog>
    <dialog id="institution-dialog" class="institution-dialog" aria-labelledby="institution-heading" aria-describedby="institution-meta"><header class="institution-dialog-top"><div><span class="eyebrow">INSTITUTIONAL FLOWS</span><h2 id="institution-heading">三大法人動向</h2><p id="institution-meta"></p></div><button class="icon-button" id="close-institution-dialog" aria-label="關閉法人動向" autofocus>${icon("close")}</button></header><div id="institution-content" class="institution-dialog-body"></div><footer class="institution-dialog-footer">買賣量以張顯示 · 1 張 = 1,000 股</footer></dialog>
    <dialog id="sector-dialog" class="sector-dialog" aria-labelledby="sector-dialog-heading" aria-describedby="sector-dialog-meta"><div class="sector-dialog-handle" aria-hidden="true"></div><header class="institution-dialog-top sector-dialog-top"><div><span class="eyebrow">SECTOR INSTITUTIONAL FLOWS</span><h2 id="sector-dialog-heading">產業法人買賣超</h2><p id="sector-dialog-meta"></p></div><button class="icon-button" id="close-sector-dialog" aria-label="關閉產業明細" autofocus>${icon("close")}</button></header><div id="sector-dialog-content" class="sector-dialog-body"></div><footer class="institution-dialog-footer sector-dialog-footer">正值為買超、負值為賣超 · 1 張 = 1,000 股 · 僅統計目前研究標的</footer></dialog>
    <div id="toast" role="status" class="toast"></div>`;
}

function refreshData() {
  latestSnapshots = dataset.stocks.map((stock) => getSnapshot(stock, dataset.info.asOf, state.settings));
  snapshots = state.date === dataset.info.asOf ? latestSnapshots
    : dataset.stocks.map((stock) => getSnapshot(stock, state.date, state.settings));
  renderWatchlist();
  renderTable();
  renderSectorOverview();
  renderPage();
  if (document.querySelector("#institution-dialog").open) renderInstitutionDialog();
}

const pageCopy = {
  market: ["MARKET WATCHLIST", "市場觀察清單", "比較全部標的的價量、技術指標與法人籌碼。"],
  favorites: ["MY WATCHLIST", "自選總覽", "集中查看已收藏股票的價量與法人動向。"],
  sectors: ["INSTITUTIONAL RANKING", "法人買株", "依產業排名觀察法人資金方向；點選產業查看個股價格與買賣超張數。"],
};

function renderPage() {
  const [eyebrow, title, description] = pageCopy[state.page];
  document.querySelector("#page-eyebrow").textContent = eyebrow;
  document.querySelector("#page-title").innerHTML = `${title}<span class="heading-dot">.</span>`;
  document.querySelector("#page-description").textContent = description;
  document.querySelector("#breadcrumb-current").textContent = title;
  const sectors = state.page === "sectors";
  const dateSelect = document.querySelector("#trade-date");
  dateSelect.hidden = sectors;
  dateSelect.disabled = sectors;
  document.querySelector(".date-control label").hidden = sectors;
  document.querySelector("#date-hint").textContent = sectors
    ? `最新完整交易日 ${dataset.info.asOf}`
    : isDemo ? "預設顯示前一交易日的模擬資料" : "最近一個價量與法人資料均完整的交易日";
  document.querySelectorAll("[data-page-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.pagePanel !== state.page;
  });
  document.querySelectorAll("[data-page]").forEach((button) => {
    const active = button.dataset.page === state.page;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function renderWatchlist() {
  const previousCards = [...document.querySelectorAll("#watchlist-grid .watch-card")];
  const previousIndex = carouselIndex("price", previousCards);
  const previousSymbol = previousCards[previousIndex]?.dataset.watchSymbol;
  const favorites = state.favorites
    .map((symbol) => snapshots.find((stock) => stock.symbol === symbol))
    .filter((stock) => stock?.latest);
  document.querySelector("#favorite-count").textContent = state.favorites.length;
  document.querySelector("#watchlist-empty").hidden = favorites.length > 0;
  if (state.institutionSymbol && !favorites.some((stock) => stock.symbol === state.institutionSymbol))
    document.querySelector("#institution-dialog").close();
  document.querySelector("#watchlist-grid").innerHTML = favorites.map((stock) => {
    const { latest: bar, signal } = stock;
    const kStatus = bar.k === null ? "資料不足" : bar.k > 80 ? "高檔區間" : bar.k < 20 ? "低檔區間" : "中性區間";
    return `<article class="watch-card" data-watch-symbol="${stock.symbol}" aria-labelledby="watch-title-${stock.symbol}" tabindex="-1">
      <header class="watch-card-heading"><div><span class="watch-symbol">${stock.symbol} <span>${esc(stock.market)} · ${esc(stock.sector)}</span></span><h3 id="watch-title-${stock.symbol}">${esc(stock.name)}</h3></div><button class="icon-button favorite-button is-favorite" data-favorite="${stock.symbol}" aria-label="移除${esc(stock.name)}自選" aria-pressed="true">${icon("star")}</button></header>
      <div class="metrics" aria-label="${esc(stock.name)}關鍵指標">
        <div class="metric-card"><div class="metric-label">收盤價 <span>TWD</span></div><div class="metric-value"><span class="metric-number">${number(bar.close, 2)}</span><span class="change-chip ${direction(bar.changePercent)}">${percent(bar.changePercent)}</span></div><div class="metric-description">較前日 <span class="${direction(bar.change)}">${signed(bar.change)}</span></div></div>
        <div class="metric-card"><div class="metric-label">成交量 <span>當日</span></div><div class="metric-value"><span class="metric-number">${number(bar.volume / 1000)}</span><small>張</small></div><div class="metric-description">三大法人淨額 <span class="${direction(bar.institutionalNet)}">${bar.institutionalNet === null ? "資料不足" : `${signed(bar.institutionalNet / 1000, 0)} 張`}</span></div></div>
        <div class="metric-card"><div class="metric-label">KD 值 <span>(${state.settings.period}, ${state.settings.kSmooth}, ${state.settings.dSmooth})</span></div><div class="metric-value"><span class="metric-number">${number(bar.k, 2)}</span><span class="indicator-tag">${kStatus}</span></div><div class="metric-description"><span class="metric-detail">D 值 ${number(bar.d, 2)}</span><span class="metric-detail">RSV ${number(bar.rsv, 2)}</span></div></div>
        <div class="metric-card quarter-card"><div class="metric-label">股價與季線 <span>MA60</span></div><div class="metric-value ${direction(bar.deviation)}"><span class="metric-number">${percent(bar.deviation)}</span></div><div class="metric-description"><span>${bar.deviation === null ? "資料不足" : bar.deviation > 0 ? "季線之上" : bar.deviation < 0 ? "季線之下" : "季線持平"}</span><span class="metric-detail">季線 ${number(bar.ma60, 2)}</span></div></div>
      </div>
      <div class="watch-signal"><span class="signal-badge ${signal.tone}" data-signal="${signal.code}">${esc(signal.label)}</span><span class="signal-reason">${esc(signal.reason)}</span></div>

    </article>`;
  }).join("");
  renderInstitutionOverview(favorites);
  renderOverviewVisibility();
  setCarouselOptions("price", favorites);
  if (matchMedia("(max-width: 700px)").matches && favorites.length) {
    const nextIndex = Math.max(0, favorites.findIndex((stock) => stock.symbol === previousSymbol));
    scrollToCarouselCard("price", nextIndex, "instant");
  }
  updateCarouselControls("price");
}

const carouselConfig = {
  price: { container: "#watchlist-grid", item: ".watch-card", symbol: "watchSymbol" },
  institutions: { container: "#institution-overview-rows", item: ".institution-overview-row", symbol: "overviewSymbol" },
};

function carouselParts(kind) {
  const config = carouselConfig[kind];
  const grid = document.querySelector(config.container);
  return { grid, cards: [...grid.querySelectorAll(config.item)],
    controls: document.querySelector(`[data-carousel="${kind}"]`), symbol: config.symbol };
}

function carouselIndex(kind, cards = carouselParts(kind).cards) {
  if (!cards.length) return 0;
  const { grid } = carouselParts(kind);
  const left = grid.getBoundingClientRect().left + parseFloat(getComputedStyle(grid).paddingLeft);
  return cards.reduce((nearest, card, index) =>
    Math.abs(card.getBoundingClientRect().left - left) < Math.abs(cards[nearest].getBoundingClientRect().left - left)
      ? index : nearest, 0);
}

function setCarouselOptions(kind, favorites) {
  const jump = carouselParts(kind).controls.querySelector("[data-carousel-jump]");
  jump.innerHTML = favorites.map((stock) =>
    `<option value="${stock.symbol}">${esc(stock.name)} ${stock.symbol}</option>`).join("");
  jump.hidden = favorites.length <= 10;
}

function updateCarouselControls(kind) {
  const { cards, controls, symbol } = carouselParts(kind);
  const index = carouselIndex(kind, cards);
  controls.querySelector('[role="status"]').textContent = cards.length
    ? `第 ${index + 1}／${cards.length} 檔 · 左右滑動` : "";
  controls.querySelector('[data-carousel-step="-1"]').disabled = index === 0;
  controls.querySelector('[data-carousel-step="1"]').disabled = index >= cards.length - 1;
  controls.querySelector("[data-carousel-jump]").value = cards[index]?.dataset[symbol] ?? "";
}

function scrollToCarouselCard(kind, index, behavior = "smooth") {
  const { grid, cards } = carouselParts(kind);
  const card = cards[index];
  if (!card) return;
  const left = card.getBoundingClientRect().left - grid.getBoundingClientRect().left +
    grid.scrollLeft - parseFloat(getComputedStyle(grid).paddingLeft);
  grid.scrollTo({ left, behavior });
  if (behavior === "instant") updateCarouselControls(kind);
}

function renderOverviewVisibility() {
  const empty = state.favorites.length === 0;
  document.querySelector("#watchlist-grid").hidden = empty || state.overview !== "price";
  document.querySelector("#watchlist-carousel-controls").hidden = empty || state.overview !== "price";
  document.querySelector("#institution-overview").hidden = empty || state.overview !== "institutions";
  document.querySelector(".institution-window").hidden = empty || state.overview !== "institutions";
  document.querySelector(".overview-controls").classList.toggle("institutional-active", !empty && state.overview === "institutions");
  document.querySelectorAll("[data-overview]").forEach((tab) => {
    const active = tab.dataset.overview === state.overview;
    tab.setAttribute("aria-selected", active);
    tab.tabIndex = active ? 0 : -1;
  });
}

function renderInstitutionOverview(favorites = state.favorites.map((symbol) =>
  snapshots.find((stock) => stock.symbol === symbol)).filter((stock) => stock?.latest)) {
  const previousRows = carouselParts("institutions").cards;
  const previousSymbol = previousRows[carouselIndex("institutions", previousRows)]?.dataset.overviewSymbol;
  document.querySelectorAll("[data-institution-window]").forEach((button) =>
    button.setAttribute("aria-pressed", button.dataset.institutionWindow === state.institutionWindow));
  document.querySelector("#institution-overview-rows").innerHTML = favorites.map((stock) => {
    const { latest: bar, institutionalSummary: summary } = stock;
    const day = state.institutionWindow === "day";
    const total = day ? bar.institutionalNet : summary.total[`net${state.institutionWindow}`];
    const metric = (name, value, streak = "") => `<div class="overview-metric${name === "total" ? " overview-total" : ""}"><dt>${name === "total" ? "合計買賣超" : esc(name)}</dt><dd class="${direction(value)}" data-overview-net="${name}">${institutionalAmount(value)}</dd>${streak}</div>`;
    return `<article class="institution-overview-row" data-overview-symbol="${stock.symbol}" aria-labelledby="overview-name-${stock.symbol}"><header><div><span class="overview-stock-code">${stock.symbol} · ${esc(stock.market)}</span><h4 id="overview-name-${stock.symbol}">${esc(stock.name)}</h4></div><button class="overview-detail-button" data-institution-details="${stock.symbol}" aria-label="查看${esc(stock.name)}三大法人動向" aria-haspopup="dialog" aria-controls="institution-dialog">明細 ${icon("chevron")}</button></header><dl class="institution-overview-metrics">${metric("total", total)}${["外資", "投信", "自營商"].map((name) => {
      const stats = summary.institutions[name];
      const value = day ? getInstitutionNet(bar.institutions, name) : stats[`net${state.institutionWindow}`];
      const streak = name === "自營商" ? "" : `<span class="watch-streak ${stats.streak.direction}" data-overview-streak="${name}">${institutionalStreak(stats.streak)}</span>`;
      return metric(name, value, streak);
    }).join("")}</dl></article>`;
  }).join("");
  setCarouselOptions("institutions", favorites);
  if (matchMedia("(max-width: 700px)").matches && favorites.length) {
    const nextIndex = Math.max(0, favorites.findIndex((stock) => stock.symbol === previousSymbol));
    scrollToCarouselCard("institutions", nextIndex, "instant");
  }
  updateCarouselControls("institutions");
}

function stockInstitutionValue(stock, name, window) {
  if (window === "day") {
    if (name === "total") return stock.latest.institutionalNet;
    return getInstitutionNet(stock.latest.institutions, name);
  }
  const key = `net${window}`;
  return name === "total" ? stock.institutionalSummary.total[key]
    : stock.institutionalSummary.institutions[name][key];
}

function renderSectorOverview() {
  const groups = new Map();
  for (const stock of latestSnapshots.filter((item) => item.latest)) {
    if (!groups.has(stock.sector)) groups.set(stock.sector, []);
    groups.get(stock.sector).push(stock);
  }
  const sum = (stocks, name) => {
    const values = stocks.map((stock) => stockInstitutionValue(stock, name, state.sectorWindow));
    return values.every(Number.isFinite) ? values.reduce((total, value) => total + value, 0) : null;
  };
  const days = state.sectorWindow === "day" ? 1 : Number(state.sectorWindow);
  const stockReturn = (stock) => {
    if (days === 1) return stock.latest.changePercent;
    const previous = stock.history.at(-(days + 1));
    return previous && Number.isFinite(previous.close) && previous.close !== 0
      ? ((stock.latest.close - previous.close) / previous.close) * 100 : null;
  };
  const sectors = [...groups].map(([name, stocks]) => {
    const returns = stocks.map(stockReturn).filter(Number.isFinite);
    return {
      name,
      stocks,
      total: sum(stocks, "total"),
      change: returns.length === stocks.length
        ? returns.reduce((total, value) => total + value, 0) / returns.length : null,
    };
  });
  sectors.sort((a, b) => {
    if (state.sectorSort === "name-asc") return a.name.localeCompare(b.name, "zh-Hant");
    if (a.total === null) return b.total === null ? 0 : 1;
    if (b.total === null) return -1;
    return (a.total - b.total) * (state.sectorSort === "net-asc" ? 1 : -1);
  });
  document.querySelectorAll("[data-sector-window]").forEach((button) =>
    button.setAttribute("aria-pressed", button.dataset.sectorWindow === state.sectorWindow));
  document.querySelectorAll("[data-sector-sort]").forEach((button) =>
    button.setAttribute("aria-pressed", button.dataset.sectorSort === state.sectorSort));
  document.querySelector("#sector-change-label").textContent = days === 1
    ? "當日平均漲跌" : `${days} 日平均漲跌`;
  const maxAmount = Math.max(1, ...sectors.map((sector) => Math.abs(sector.total ?? 0)));
  document.querySelector("#sector-grid").innerHTML = sectors.map((sector, index) => {
    const candidates = sector.stocks.map((stock) => ({
      stock,
      value: stockInstitutionValue(stock, "total", state.sectorWindow),
    }));
    const { stock: leader, value: leaderValue } = getDirectionalLeader(candidates, sector.total);
    const periodLabel = days === 1 ? "當日" : `${days} 日`;
    const leaderChange = leader ? stockReturn(leader) : null;
    const leaderText = leaderValue === null ? "資料不足" : `TOP1·${leader.name}`;
    const barWidth = `${Math.max(4, Math.round((Math.abs(sector.total ?? 0) / maxAmount) * 100))}%`;
    return `<article class="sector-card" data-sector-name="${esc(sector.name)}" data-sector-details="${esc(sector.name)}" role="button" tabindex="0" aria-haspopup="dialog" aria-controls="sector-dialog" aria-label="查看${esc(sector.name)}產業個股與法人買賣超"><div class="sector-main"><span class="sector-rank">${index + 1}</span><span class="sector-marker ${direction(sector.total)}"></span><div class="sector-identity"><h3>${esc(sector.name)}</h3><p>${periodLabel} <span>${esc(leaderText)}</span> <span class="${direction(leaderChange)}">${percent(leaderChange)}</span></p></div><strong class="sector-change ${direction(sector.change)}">${percent(sector.change)}</strong><div class="sector-total"><strong class="${direction(sector.total)}">${institutionalAmount(sector.total)}</strong><i class="${direction(sector.total)}" style="--sector-bar:${barWidth}"></i></div></div></article>`;
  }).join("");
  if (document.querySelector("#sector-dialog")?.open) renderSectorDialog(state.sectorName);
}

function renderSectorDialog(name) {
  const stocks = latestSnapshots.filter((stock) => stock.sector === name && stock.latest);
  if (!stocks.length) return;
  const periods = [["day", "當日"], ["5", "5 日"], ["20", "20 日"]];
  const sum = (institution, window) => {
    const values = stocks.map((stock) => stockInstitutionValue(stock, institution, window));
    return values.every(Number.isFinite) ? values.reduce((total, value) => total + value, 0) : null;
  };
  const members = stocks.map((stock) => ({
    stock,
    net: stockInstitutionValue(stock, "total", "day"),
  })).sort((a, b) => {
    if (a.net === null) return b.net === null ? a.stock.name.localeCompare(b.stock.name, "zh-Hant") : 1;
    if (b.net === null) return -1;
    return b.net - a.net || a.stock.name.localeCompare(b.stock.name, "zh-Hant");
  });

  document.querySelector("#sector-dialog-heading").textContent = name;
  document.querySelector("#sector-dialog-meta").textContent = `最新完整交易日 ${dataset.info.asOf}`;
  document.querySelector("#sector-dialog-content").innerHTML = `
    <section class="sector-detail-summary" aria-labelledby="sector-summary-heading">
      <div class="sector-detail-heading"><div><h3 id="sector-summary-heading">法人淨買賣超</h3><p>當日與近 5／20 個交易日累計，單位：張</p></div></div>
      <div class="sector-summary-grid">${periods.map(([key, label]) => {
        const total = sum("total", key);
        return `<article class="sector-summary-period" data-sector-period="${key}" aria-label="${label}法人買賣超"><header><h4>${label}</h4><strong class="${direction(total)}" data-sector-summary="total">${institutionalAmount(total, false)}</strong></header><dl>${["外資", "投信", "自營商"].map((institution) => {
          const value = sum(institution, key);
          return `<div><dt>${institution}</dt><dd class="${direction(value)}" data-sector-summary="${institution}">${institutionalAmount(value, false)}</dd></div>`;
        }).join("")}</dl></article>`;
      }).join("")}</div>
    </section>
    <section class="sector-stock-section" aria-labelledby="sector-stock-heading">
      <div class="sector-detail-heading"><div><h3 id="sector-stock-heading">產業個股</h3><p>依當日買賣超排序，單位：張</p></div></div>
      <div class="sector-stock-scroll" tabindex="0" role="region" aria-label="${esc(name)}個股股價與法人買賣超">
        <table class="sector-stock-table"><caption class="sr-only">${esc(name)}各股最新收盤價、日漲跌幅及當日、5 日、20 日法人淨買賣超，單位：張</caption><colgroup><col class="sector-stock-name-column"><col class="sector-stock-price-column">${periods.map(() => '<col class="sector-stock-net-column">').join("")}</colgroup><thead><tr><th scope="col">股票</th><th scope="col">收盤價／日漲跌</th>${periods.map(([, label]) => `<th scope="col">${label}買賣超</th>`).join("")}</tr></thead><tbody>${members.map(({ stock }) => `<tr data-sector-stock="${stock.symbol}"><th scope="row"><span class="sector-stock-name"><strong>${esc(stock.name)}</strong><small>${stock.symbol}</small></span></th><td class="sector-stock-price"><span class="sector-stock-close">${number(stock.latest.close, 2)}</span><small class="sector-stock-change ${direction(stock.latest.changePercent)}">${percent(stock.latest.changePercent)}</small></td>${periods.map(([key, label]) => {
          const value = stockInstitutionValue(stock, "total", key);
          return `<td class="sector-stock-net ${direction(value)}" data-sector-net="${key}"><span class="sector-stock-period-label" aria-hidden="true">${label}</span><strong>${institutionalAmount(value, false)}</strong></td>`;
        }).join("")}</tr>`).join("")}</tbody></table>
      </div>
    </section>`;
}

function openSectorDialog(name) {
  state.sectorName = name;
  renderSectorDialog(name);
  const dialog = document.querySelector("#sector-dialog");
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}


function institutionalDetails(stock) {
  const { latest: bar, institutionalSummary } = stock;
  const buy = bar.institutionalNet === null ? null : bar.institutions.reduce((sum, item) => sum + item.buy, 0);
  const sell = bar.institutionalNet === null ? null : bar.institutions.reduce((sum, item) => sum + item.sell, 0);
  const max = Math.max(...bar.institutions.flatMap((item) => [item.buy, item.sell]), 1);
  return `<section class="watch-flow" data-institution-symbol="${stock.symbol}" aria-label="${esc(stock.name)}三大法人動向"><div class="watch-flow-heading"><h3>買賣超與累計</h3><span>單位：張</span></div>
        <div class="institution-summary"><div class="watch-flow-total"><div><span>合計買賣超</span><strong class="${direction(buy - sell)}">${bar.institutionalNet === null ? "—" : signed(bar.institutionalNet / 1000, 0)}<small> 張</small></strong></div><div class="watch-flow-amounts"><span>買進 ${buy === null ? "—" : number(buy / 1000)}</span><span>賣出 ${sell === null ? "—" : number(sell / 1000)}</span></div></div>
        <div class="watch-total-history" aria-label="三大法人累計買賣超">${institutionalHistory(institutionalSummary.total)}</div></div><p class="watch-history-note">累計含資料日，以交易日計算</p>
        <div class="watch-flow-legend"><span><i class="buy-key"></i>買進</span><span><i class="sell-key"></i>賣出</span><span>右側為買賣超</span></div>
        <div class="watch-institutions">${bar.institutions.map((item) => {
          const stats = institutionalSummary.institutions[item.name];
          const streak = ["外資", "投信"].includes(item.name)
            ? `<span class="watch-streak ${stats.streak.direction}" data-streak>${institutionalStreak(stats.streak)}</span>` : "";
          return `<div class="watch-institution" data-institution="${esc(item.name)}"><div class="watch-institution-heading"><span class="watch-institution-label"><span>${esc(item.name)}</span>${streak}</span><strong class="${direction(item.buy - item.sell)}">${signed((item.buy - item.sell) / 1000, 0)}</strong></div><div class="watch-flow-bar-row"><span class="watch-flow-bar buy" style="width:${(item.buy / max) * 100}%"></span><span>${number(item.buy / 1000)}</span></div><div class="watch-flow-bar-row"><span class="watch-flow-bar sell" style="width:${(item.sell / max) * 100}%"></span><span>${number(item.sell / 1000)}</span></div>${institutionalHistory(stats)}</div>`;
        }).join("")}</div>
      </section>`;
}

function renderInstitutionDialog() {
  const stock = snapshots.find((item) => item.symbol === state.institutionSymbol);
  if (!stock?.latest) return;
  document.querySelector("#institution-heading").textContent = `${stock.name} 三大法人動向`;
  document.querySelector("#institution-meta").textContent =
    `${stock.symbol} · ${stock.market} · ${stock.latest.date}${isDemo ? " · 模擬資料" : ""}`;
  document.querySelector("#institution-content").innerHTML = institutionalDetails(stock);
}

function openInstitutionDialog(symbol) {
  if (!state.favorites.includes(symbol)) return;
  state.institutionSymbol = symbol;
  renderInstitutionDialog();
  const dialog = document.querySelector("#institution-dialog");
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

function renderTable() {
  const visibleStocks = filterStocks(snapshots, state);
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
      const leader = getDominantInstitution(bar.institutions);
      const leaderLabel = bar.institutionalNet === null ? "資料不足" : !leader ? "合計持平"
        : `${leader.names.join("、")}${leader.direction === "buy" ? "買超" : "賣超"}最多`;
      return `<tr data-symbol="${stock.symbol}"><td><button class="icon-button favorite-button ${favorite ? "is-favorite" : ""}" data-favorite="${stock.symbol}" aria-label="${favorite ? "移除" : "加入"}${esc(stock.name)}自選" aria-pressed="${favorite}">${icon("star")}</button></td><th scope="row"><div class="stock-name"><strong>${esc(stock.name)}</strong><span>${stock.symbol}<span class="sector-inline">${esc(stock.sector)}</span></span></div></th><td class="price-cell"><span class="stock-close">${number(bar.close, 2)}</span><small class="stock-volume">量 ${number(bar.volume / 1000)} 張</small></td><td class="change-cell"><span class="change-chip ${direction(bar.changePercent)}">${percent(bar.changePercent)}</span></td><td><span class="k-cell">${number(bar.k, 2)}${bar.k !== null ? `<i style="--k:${Math.max(0, Math.min(100, bar.k))}%"></i>` : ""}</span><small class="kd-detail">D ${number(bar.d, 2)}</small></td><td class="signal-cell"><span class="signal-badge ${signal.tone}" data-signal="${signal.code}">${esc(signal.label)}</span><small class="signal-reason">${esc(signal.reason)}</small></td><td><span class="position-tag ${direction(bar.deviation)}">${bar.deviation === null ? "資料不足" : bar.deviation > 0 ? "季線之上" : bar.deviation < 0 ? "季線之下" : "季線持平"}</span><small class="deviation ${direction(bar.deviation)}">${percent(bar.deviation)}</small></td><td class="${direction(bar.institutionalNet)}"><span class="institution-net">${bar.institutionalNet === null ? "—" : signed(bar.institutionalNet / 1000, 0)}</span><small class="institution-leader">${leaderLabel}</small></td></tr>`;
    })
    .join("");
  document.querySelector("#table-empty").hidden = visibleStocks.length !== 0;
  document.querySelector("#favorite-count").textContent =
    state.favorites.length;
  document.querySelector("#table-summary").textContent =
    `顯示 ${visibleStocks.length} / ${snapshots.length} 檔${isDemo ? "示範" : "觀察"}標的 · ${state.date}`;
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active);
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
    <p class="helper-text">這是本網站訂定、尚未回測的觀察規則；${isDemo ? "目前使用模擬行情；" : ""}沒有預測報酬或交易保證。概念參考：<a class="signal-source" href="https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/slow-stochastic" target="_blank" rel="noopener noreferrer">Fidelity 隨機指標說明 ↗</a>；本網站沿用原有遞迴 KD 算法，MA20 確認為額外條件。</p>`;
}

function openDialog(type) {
  const content = document.querySelector("#dialog-content");
  if (type === "settings") {
    content.innerHTML = `<h2 id="dialog-heading">讓指標符合你的觀察習慣</h2><p class="dialog-intro">調整後，自選總覽與市場觀察清單會一起重新計算。設定會保存在這個瀏覽器。</p><form id="settings-form"><div class="form-field"><label for="period">RSV 回溯週期</label><div><input id="period" name="period" type="number" min="1" max="60" value="${state.settings.period}" required/><span>個交易日</span></div></div><div class="form-field"><label for="kSmooth">K 平滑係數</label><input id="kSmooth" name="kSmooth" type="number" min="1" max="20" value="${state.settings.kSmooth}" required/></div><div class="form-field"><label for="dSmooth">D 平滑係數</label><input id="dSmooth" name="dSmooth" type="number" min="1" max="20" value="${state.settings.dSmooth}" required/></div><p class="helper-text">預設 KD (9, 3, 3)。季線固定為 60 個交易日的收盤價平均。</p><div class="dialog-buttons"><button class="outline-button" type="button" id="default-settings">恢復預設</button><button class="primary-button" type="submit">${icon("check")} 儲存並重新計算</button></div></form>`;
  } else if (type === "signals") {
    content.innerHTML = `<h2 id="dialog-heading">KD 技術建議怎麼看？</h2>${technicalSignalGuide()}`;
  } else if (type === "source" && !isDemo) {
    const checkedAt = new Date(dataset.info.updatedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
    content.innerHTML = `<h2 id="dialog-heading">每日資料，來源與口徑。</h2><p class="dialog-intro">由 FinMind 取得上市、上櫃股票與 ETF 的日行情及三大法人資料，儲存於 Cloudflare 後供網站讀取。</p><div class="source-banner">${icon("info")} ${esc(dataset.info.note)}</div><dl class="source-details"><div><dt>市場與標的</dt><dd>${dataset.stocks.length} 檔上市、上櫃股票與 ETF；非全市場</dd></div><div><dt>共同完整資料日</dt><dd>${esc(dataset.info.asOf)}</dd></div><div><dt>各檔更新檢查時間下限</dt><dd>${esc(checkedAt)}（台灣時間）；檢查成功不代表當日資料已發布</dd></div><div><dt>價格與指標</dt><dd>未還原價格；KD、MA60 於瀏覽器依歷史資料計算，除權息與分割可能影響指標</dd></div><div><dt>法人分類</dt><dd>外資不含外資自營商；投信；自營商自行買賣加避險。買賣量單位為股，畫面換算成張</dd></div><div><dt>更新方式</dt><dd>平日台灣時間 21:00–23:29 分批更新；錯誤時保留上一份成功資料，請以資料交易日判斷新舊</dd></div><div><dt>自選清單</dt><dd>保存在目前瀏覽器；手機與電腦讀取相同行情，但自選清單尚未跨裝置同步</dd></div></dl>`;
  } else if (type === "source") {
    content.innerHTML = `<h2 id="dialog-heading">資料透明，觀察才有依據。</h2><p class="dialog-intro">這是可操作的前端示範版，目前沒有連接交易所或即時行情服務。</p><div class="source-banner">${icon("info")} ${esc(dataset.info.note)}</div><dl class="source-details"><div><dt>市場與標的</dt><dd>14 檔台灣上市、上櫃股票與 ETF 範例</dd></div><div><dt>示範資料截止日</dt><dd>${dataset.info.asOf}（固定資料，不會自動更新）</dd></div><div><dt>買賣量定義</dt><dd>外資、投信、自營商買進與賣出股數；畫面換算成張</dd></div><div><dt>指標計算方式</dt><dd>由模擬 OHLC 歷史資料在瀏覽器計算，並非硬填指標數值</dd></div><div><dt>下一階段</dt><dd>確認正式行情與三大法人資料來源，接上 API，再設定 Cloudflare 部署。</dd></div></dl><p class="helper-text">正式資料需涵蓋交易日曆、除權息還原與法人分類定義。此版資料未經還原，不能用於實際交易。</p>`;
  } else {
    content.innerHTML = `<h2 id="dialog-heading">讀懂價格背後的訊號</h2><p class="dialog-intro">指標提供觀察角度。搭配價量與籌碼，建立更完整的判斷。</p><article class="guide-item"><span>01</span><div><h3>季線 MA60</h3><p>最近 60 個交易日收盤價的簡單移動平均，包含選定資料日。股價高於季線時，位置顯示為正值。</p><code>乖離率 = (收盤價 ÷ MA60 − 1) × 100%</code></div></article><article class="guide-item"><span>02</span><div><h3>KD 隨機指標</h3><p>預設以 9 日最高、最低與當日收盤價計算 RSV，再以平滑係數 3 遞推 K、D。K、D 初始值為 50；不足 9 日不顯示。最高與最低相同時 RSV 採 50。</p><code>RSV = (收盤 − 最低) ÷ (最高 − 最低) × 100<br>K = 前日 K × 2/3 + RSV × 1/3<br>D = 前日 D × 2/3 + 當日 K × 1/3</code><p>K &gt; 80 為高檔區，K &lt; 20 為低檔區，不能單獨視為買賣訊號。你可以在指標設定調整參數。</p></div></article><article class="guide-item"><span>03</span><div><h3>三大法人買賣超</h3><p>外資、投信及自營商的買進股數減去賣出股數。正值為買超，負值為賣超。1 張 = 1,000 股；法人買賣量與全市場成交量的統計範圍不同。近 5／20 日累計包含資料日，依實際交易日加總後換算為張；資料不足不補零。外資、投信的連買／連賣日數從資料日回溯，遇反向、持平或缺漏即中止；若回溯到資料起點或缺漏，顯示「至少」。</p></div></article><article class="guide-item"><span>04</span><div><h3>前一交易日</h3><p>目前預設資料日為 ${dataset.info.asOf}。日期選單可回看最近 30 個${isDemo ? "模擬" : "實際"}交易日，所有指標僅使用選定日及之前的資料。</p></div></article><article class="guide-item"><span>05</span><div><h3>KD 技術建議</h3>${technicalSignalGuide()}</div></article>`;
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

function rememberMarketPosition(button, removing) {
  const row = button.closest("#stock-rows tr");
  if (!row) return null;
  let target = row;
  let top = row.getBoundingClientRect().top;
  if (removing && state.view === "favorites") {
    target = row.nextElementSibling ?? row.previousElementSibling;
    if (!row.nextElementSibling && target) top = target.getBoundingClientRect().top;
  }
  if (!target) top = document.querySelector(".stocks-panel").getBoundingClientRect().top;
  return { symbol: target?.dataset.symbol, top,
    left: document.querySelector(".table-scroll").scrollLeft };
}

function restoreMarketPosition(position) {
  const selector = position.symbol ? `#stock-rows tr[data-symbol="${position.symbol}"]` : ".stocks-panel";
  const target = document.querySelector(selector);
  if (!target) return;
  const focusTarget = target.querySelector("[data-favorite]") ?? document.querySelector('[data-view="favorites"]');
  focusTarget.focus({ preventScroll: true });
  const restore = () => {
    if (document.activeElement !== focusTarget) return;
    document.querySelector(".table-scroll").scrollLeft = position.left;
    window.scrollBy({ top: target.getBoundingClientRect().top - position.top, behavior: "instant" });
  };
  restore();
  // Also settle the position after mobile browsers finish their layout pass.
  requestAnimationFrame(restore);
}

function syncTableFavorite(symbol) {
  const button = document.querySelector(`#stock-rows [data-favorite="${symbol}"]`);
  if (!button) return;
  const favorite = state.favorites.includes(symbol);
  const stock = snapshots.find((item) => item.symbol === symbol);
  button.classList.toggle("is-favorite", favorite);
  button.setAttribute("aria-pressed", favorite);
  button.setAttribute("aria-label", `${favorite ? "移除" : "加入"}${stock.name}自選`);
}

function bindEvents() {
  document.addEventListener("keydown", (event) => {
    const card = event.target.closest?.("#sector-grid [data-sector-details]");
    if (!card || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    openSectorDialog(card.dataset.sectorDetails);
  });
  document.addEventListener("click", (event) => {
    const sectorCard = event.target.closest("#sector-grid [data-sector-details]");
    if (sectorCard) {
      openSectorDialog(sectorCard.dataset.sectorDetails);
      return;
    }
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.dialog) openDialog(button.dataset.dialog);
    if (button.dataset.overview) {
      state.overview = button.dataset.overview;
      renderOverviewVisibility();
    }
    if (button.dataset.carouselStep) {
      const kind = button.closest("[data-carousel]").dataset.carousel;
      const count = carouselParts(kind).cards.length;
      scrollToCarouselCard(kind, Math.max(0, Math.min(count - 1,
        carouselIndex(kind) + Number(button.dataset.carouselStep))),
      matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth");
    }
    if (button.dataset.institutionWindow) {
      state.institutionWindow = button.dataset.institutionWindow;
      renderInstitutionOverview();
    }
    if (button.dataset.sectorWindow) {
      state.sectorWindow = button.dataset.sectorWindow;
      renderSectorOverview();
    }
    if (button.dataset.sectorSort) {
      state.sectorSort = button.dataset.sectorSort;
      renderSectorOverview();
    }
    if (button.dataset.page) {
      state.page = button.dataset.page;
      renderPage();
      window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }
    if (button.dataset.institutionDetails) openInstitutionDialog(button.dataset.institutionDetails);
    if (button.id === "close-sector-dialog")
      document.querySelector("#sector-dialog").close();
    if (button.id === "close-institution-dialog")
      document.querySelector("#institution-dialog").close();
    if (button.id === "close-dialog")
      document.querySelector("#info-dialog").close();
    if (button.dataset.favorite) {
      const symbol = button.dataset.favorite;
      const wasFavorite = state.favorites.includes(symbol);
      const wasInOverview = Boolean(button.closest("#watchlist"));
      const position = rememberMarketPosition(button, wasFavorite);
      state.favorites = wasFavorite
        ? state.favorites.filter((item) => item !== symbol)
        : [...state.favorites, symbol];
      savePreferences();
      renderWatchlist();
      if (state.view === "favorites") renderTable();
      else syncTableFavorite(symbol);
      if (position) restoreMarketPosition(position);
      else {
        const scope = wasInOverview ? "#watchlist" : "#stock-rows";
        const focusTarget = document.querySelector(`${scope} [data-favorite="${symbol}"]`) ||
          document.querySelector(wasInOverview ? '#watchlist .overview-tabs [aria-selected="true"]' : '[data-view="favorites"]');
        focusTarget.focus({ preventScroll: true });
      }
      toast(
        wasFavorite ? `已將 ${symbol} 移出自選` : `已將 ${symbol} 加入自選`,
      );
    }
    if (button.dataset.view) {
      state.view = button.dataset.view;
      renderTable();
    }
    if (button.dataset.sort) {
      state.sortDirection =
        state.sort === button.dataset.sort ? -state.sortDirection : -1;
      state.sort = button.dataset.sort;
      renderTable();
    }
    if (button.id === "reset-filters") resetFilters();
    if (button.hasAttribute("data-manage-favorites")) {
      resetFilters();
      state.page = "market";
      renderPage();
      const table = document.querySelector(".table-scroll");
      table.focus({ preventScroll: true });
      table.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }
    if (button.id === "default-settings") {
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS))
        document.querySelector(`#${key}`).value = value;
    }
  });
  document.querySelector("#stock-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderTable();
  });
  for (const kind of Object.keys(carouselConfig)) {
    const { grid, controls, symbol } = carouselParts(kind);
    grid.addEventListener("scroll", () => updateCarouselControls(kind), { passive: true });
    controls.querySelector("[data-carousel-jump]").addEventListener("change", (event) => {
      const cards = carouselParts(kind).cards;
      scrollToCarouselCard(kind, cards.findIndex((card) => card.dataset[symbol] === event.target.value),
        matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth");
    });
  }
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
    const overviewTab = event.target.closest?.("[data-overview]");
    if (overviewTab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const tabs = [...document.querySelectorAll("[data-overview]")];
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
        : (tabs.indexOf(overviewTab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click();
      tabs[next].focus();
      return;
    }
    if (
      event.key === "/" &&
      state.page === "market" &&
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
  document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      event.currentTarget.close();
  }));
  document.querySelector("#institution-dialog").addEventListener("close", () => {
    const symbol = state.institutionSymbol;
    state.institutionSymbol = null;
    const scope = state.overview === "institutions" ? "#institution-overview" : "#watchlist-grid";
    const trigger = document.querySelector(`${scope} [data-institution-details="${symbol}"]`);
    (trigger ?? document.querySelector('#watchlist .overview-tabs [aria-selected="true"]')).focus({ preventScroll: true });
  });
  const sectorDialog = document.querySelector("#sector-dialog");
  sectorDialog.addEventListener("close", () => {
    const name = state.sectorName;
    state.sectorName = null;
    const trigger = [...document.querySelectorAll("#sector-grid [data-sector-details]")]
      .find((card) => card.dataset.sectorDetails === name);
    trigger?.focus({ preventScroll: true });
  });
}

async function init() {
  dataset = await loadDataset();
  isDemo = dataset.info.mode === "demo";
  state.date = dataset.info.asOf;
  readPreferences();
  state.favorites = [...new Set(state.favorites)].filter((symbol) =>
    dataset.stocks.some((stock) => stock.symbol === symbol),
  );
  shell();
  refreshData();
  bindEvents();
  savePreferences();
}

init().catch((error) => {
  console.error("Unable to initialize stock dashboard", error);
  document.querySelector("#app").innerHTML =
    '<main class="load-error"><h1>暫時無法載入資料</h1><p>請重新整理頁面再試一次。</p></main>';
});

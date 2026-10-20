import "./styles.css";
import "./typography.css";
import { loadDataset } from "./provider.js";
import { startPresence } from "./presence.js";
import { startPwa } from "./pwa.js";
import { isEtf } from "./market-codec.js";
import {
  DEFAULT_SETTINGS,
  getSnapshot,
  filterStocks,
  getDominantInstitution,
  getDirectionalLeader,
  getInstitutionNet,
  getStockInstitutionValue as stockInstitutionValue,
  getSectorInstitutionSummary,
  getSectorInstitutionEstimate,
  getStockInstitutionEstimate,
  getInstitutionVolumeRatio,
  getStockInstitutionSeries,
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
  sort: '<path class="sort-up" d="m8 9 4-4 4 4"/><path class="sort-down" d="m8 15 4 4 4-4"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.chart}</svg>`;
const loadingIcon = (label = "資料載入中") => `<span class="field-loading" role="status" aria-label="${label}"><svg class="loading-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 9 9"/></svg></span>`;
const pendingField = () => loading ? loadingIcon() : '<span class="field-load-error">載入失敗</span>';
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
const institutionalAmount = (value) => value === null
  ? ""
  : `${signed(value / 1000, Number.isInteger(value / 1000) ? 0 : 2)} 張`;
const institutionalMoney = (value) => value === null ? "" : `${signed(value / 100000000)} 億`;
const stockMoney = (stock, name, window, asOf = state.date) => getStockInstitutionEstimate(stock, name, window,
  dataset.dates.filter((date) => date <= asOf));
const institutionalFigures = (amount, shares, moneyAttribute = "", sharesAttribute = "") =>
  `<strong class="institution-money ${direction(amount)}" ${moneyAttribute}>${institutionalMoney(amount)}</strong><small class="institution-lots" ${sharesAttribute}>${institutionalAmount(shares)}</small>`;
function institutionSparkline(stock, tradingDates) {
  const series = getStockInstitutionSeries(stock, tradingDates);
  if (!series.some(({ amount }) => Number.isFinite(amount))) return "";
  const max = Math.max(1, ...series.map(({ amount }) => Math.abs(amount ?? 0)));
  const description = series.filter(({ amount }) => Number.isFinite(amount)).map(({ date, amount }) => `${date} ${institutionalMoney(amount)}`).join("；");
  return `<span class="institution-sparkline" role="img" aria-label="近 5 個交易日每日法人淨買賣超金額，由左至右由舊至新；各股獨立比例尺。${esc(description)}"><svg viewBox="0 0 100 36" aria-hidden="true"><line x1="0" y1="18" x2="100" y2="18"/>${series.map(({ date, amount }, index) => {
    if (amount === null) return "";
    const height = amount === 0 ? 1 : Math.max(1, Math.abs(amount) / max * 16);
    const y = amount === 0 ? 17.5 : amount > 0 ? 18 - height : 18;
    return `<rect class="${direction(amount)}" data-flow-date="${date}" data-flow-amount="${amount}" x="${8 + index * 18}" y="${y}" width="12" height="${height}" rx="1"><title>${date} ${institutionalMoney(amount)}</title></rect>`;
  }).join("")}</svg></span>`;
}
const institutionalStreak = ({ direction, days, atLeast }) => {
  if (direction === "unknown") return "";
  if (direction === "neutral") return "當日持平";
  return `${atLeast ? "至少" : ""}連${direction === "buy" ? "買" : "賣"}${days}日`;
};
const institutionalHistory = (stats, stock, name = "total") =>
  `<div class="watch-history">${[5, 20].map((days) =>
    `<span class="watch-cumulative" data-window="${days}"><span>近 ${days} 日累計</span>${institutionalFigures(stockMoney(stock, name, String(days)), stats[`net${days}`])}</span>`,
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
const latestCache = new Map(), historicalCache = new Map();
const tableRowCache = new WeakMap();
const TABLE_BATCH_SIZE = 30;
let loading = false, loadFailed = false, loadProgress = { loaded: 0, total: 0 };
let pendingPaint, previousFavorites;
let tableVisibleLimit = TABLE_BATCH_SIZE, tableViewKey = "", tableObserver;
let toastTimer;
let isDemo;
let stopPresence, previousWatchLoading, usingCachedData = false;
const pendingSymbols = new Set();

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
      <header class="topbar"><div class="breadcrumb">研究工作台 ${icon("chevron")} <span id="breadcrumb-current">市場觀察清單</span></div><div class="topbar-actions"><span id="online-count" class="online-count" role="status" title="最近 90 秒內活躍的瀏覽器，同一瀏覽器多分頁計一次">${loadingIcon("正在取得在線人數")}<span>在線人數</span></span><span class="demo-badge"><span></span>${esc(dataset.info.label)}</span></div></header>
      <main id="main" tabindex="-1">
        <section class="page-heading"><div><div class="eyebrow" id="page-eyebrow">TAIWAN STOCK EXPLORER</div><h1 id="page-title">市場觀察清單<span class="heading-dot">.</span></h1><p id="page-description">比較全部標的的價量、技術指標與法人籌碼。</p></div><div class="date-control"><label for="trade-date">${icon("calendar")} 資料交易日</label><select id="trade-date">${dataset.dates
          .slice(-30)
          .reverse()
          .map(
            (date) =>
              `<option value="${date}">${date.replaceAll("-", " / ")}</option>`,
          )
          .join(
            "",
          )}</select></div></section>
        <div id="app-status" class="app-status" role="status" hidden><span></span><button class="text-button" id="apply-update" hidden>立即更新</button></div>
        <div id="load-status" class="load-status" role="status" hidden><span></span><button class="text-button" id="reload-data" hidden>重新載入</button></div>
        <section id="watchlist" data-page-panel="favorites" aria-label="自選股票" hidden>
          <div class="overview-controls">
            <div class="overview-tabs">
              <span class="overview-tab-indicator" aria-hidden="true"></span>
              <div class="overview-view-tabs" role="tablist" aria-label="自選總覽視角">
                <button id="watchlist-price-tab" role="tab" data-overview="price" aria-label="價量總覽" aria-controls="watchlist-grid" aria-selected="true" tabindex="0">${icon("grid")}<span class="overview-label-full">價量總覽</span><span class="overview-label-short">價量</span></button>
                <button id="watchlist-institutions-tab" role="tab" data-overview="institutions" aria-label="法人總覽" aria-controls="institution-overview" aria-selected="false" tabindex="-1">${icon("chart")}<span class="overview-label-full">法人總覽</span><span class="overview-label-short">法人</span></button>
              </div>
              <div class="institution-window segmented-control" role="group" aria-label="法人累計區間" hidden><span class="segmented-indicator" aria-hidden="true"></span><button data-institution-window="day" aria-pressed="true">當日</button><button data-institution-window="5" aria-pressed="false">近 5 日</button><button data-institution-window="20" aria-pressed="false">近 20 日</button></div>
            </div>
          </div>
          <div id="watchlist-grid" class="watchlist-grid" role="tabpanel" aria-labelledby="watchlist-price-tab"></div>
          <div id="watchlist-carousel-controls" class="carousel-pagination" data-carousel="price" role="group" aria-label="自選卡片導覽" hidden></div>
          <section id="institution-overview" class="institution-overview" role="tabpanel" aria-labelledby="watchlist-institutions-tab" hidden>
            <div class="institution-overview-head" aria-hidden="true"><span>股票</span><div class="institution-overview-metric-headings"><span>合計買賣超</span><span>外資</span><span>投信</span><span>自營商</span></div></div>
            <div id="institution-overview-rows" class="institution-overview-rows"></div><div id="institution-carousel-controls" class="carousel-pagination" data-carousel="institutions" role="group" aria-label="法人卡片導覽" hidden></div><p class="institution-overview-note">金額：億；張數為輔。金額按每日收盤價換算，非實際成交金額。連買／連賣天數截至資料日。</p>
          </section>
          <div id="watchlist-empty" class="watchlist-empty" hidden>${icon("star")}<h3>建立你的自選清單</h3><p>到市場觀察清單點選星號，股票就會顯示在這裡。</p><button class="outline-button" data-manage-favorites>前往選擇股票</button></div>
        </section>
        <section class="panel stocks-panel" data-page-panel="market" aria-label="市場觀察股票表格">
          <div class="table-toolbar"><div class="filter-tabs segmented-control" role="group" aria-label="清單篩選"><span class="segmented-indicator" aria-hidden="true"></span><button data-view="all" class="active" aria-pressed="true">全部標的</button><button data-view="favorites" aria-pressed="false">我的自選</button><button data-view="above" aria-pressed="false">站上季線</button><button data-view="below" aria-pressed="false">季線之下</button><button data-view="oversold" aria-pressed="false" aria-label="K 值低於 20">K值低於20</button></div><div class="search-controls"><label class="search-box">${icon("search")}<input id="stock-search" type="search" placeholder="搜尋代碼或名稱" aria-label="搜尋股票代碼或名稱" autocomplete="off"/><kbd>/</kbd></label><select id="sector-filter" aria-label="產業篩選"><option value="all">全部產業</option>${[...new Set(dataset.stocks.map((stock) => stock.sector))].map((sector) => `<option>${esc(sector)}</option>`).join("")}</select></div></div>
          <div class="signal-note">${icon("info")}<span>依資料日 KD 交叉與 MA20 趨勢判讀；${isDemo ? "模擬資料技術提示" : "技術提示僅供觀察"}，需搭配風險控管。</span><button class="text-button" data-dialog="signals">判讀規則 ${icon("chevron")}</button></div>
          <div class="table-scroll" tabindex="0" role="region" aria-label="股票觀察清單，可左右捲動"><table><caption class="sr-only">${isDemo ? "模擬股票行情" : "股票收盤行情"}、KD 技術建議與三大法人買賣超。日漲跌幅與前一交易日收盤價比較，成交量位於收盤價下方，以張表示。點選星號可加入或移除上方自選總覽。</caption><colgroup><col class="favorite-column"/><col class="stock-column"/><col class="price-column"/><col class="change-column"/><col class="kd-column"/><col class="signal-column"/><col class="position-column"/><col class="net-column"/></colgroup><thead><tr><th scope="col"><span class="sr-only">自選</span></th><th scope="col">股票</th>${[
            ["close", '<span class="close-label-desktop">收盤價</span><span class="close-label-mobile">收盤／漲跌</span>'],
            ["changePercent", "日漲跌幅"],
            ["k", "K 值"],
            ["deviation", "與季線位置"],
            ["institutionalNet", "法人買賣超（張）"],
          ]
            .map(
              ([key, label]) =>
                `<th scope="col" data-sort-heading="${key}" aria-sort="none"><button data-sort="${key}">${label} ${icon("sort", "sort-icon")}</button></th>${key === "k" ? '<th scope="col" class="signal-heading">KD 技術建議</th>' : ""}`,
            )
            .join(
              "",
            )}</tr></thead><tbody id="stock-rows"></tbody></table></div><div id="table-load-trigger" class="table-load-trigger" aria-hidden="true" hidden></div><div id="table-empty" class="empty-state" hidden>${icon("search")}<h3>沒有符合條件的股票</h3><p>試試其他關鍵字，或清除篩選條件。</p><button class="outline-button" id="reset-filters">清除篩選</button></div><div class="table-footer"><span id="table-summary"></span><span>點選星號，即時更新我的自選 ${icon("star")}</span></div>
        </section>
        <section id="sector-page" class="sector-page panel" data-page-panel="sectors" aria-label="法人買株排行榜" hidden>
          <div class="sector-toolbar"><div class="sector-sort-control"><span>排行方式</span><div class="sector-sort-tabs segmented-control" role="group" aria-label="排行方式"><span class="segmented-indicator" aria-hidden="true"></span><button data-sector-sort="name-asc" aria-pressed="true">產業</button><button data-sector-sort="net-desc" aria-pressed="false">買超</button><button data-sector-sort="net-asc" aria-pressed="false">賣超</button></div></div><div class="sector-period-control"><span>時間範圍</span><div class="sector-period segmented-control" role="group" aria-label="法人買株累計區間"><span class="segmented-indicator" aria-hidden="true"></span><button data-sector-window="day" aria-pressed="true">當日</button><button data-sector-window="5" aria-pressed="false">5 日</button><button data-sector-window="20" aria-pressed="false">20 日</button></div></div></div>
          <div class="sector-ranking-head" aria-hidden="true"><span>產業排名</span><span id="sector-change-label">當日平均漲跌</span><span>法人淨買賣超金額</span></div>
          <div id="sector-grid" class="sector-grid sector-ranking"></div>
          <p class="sector-note">金額以億元顯示，張數為輔。金額依各股每日法人淨買賣股數 × 當日收盤價累計，非實際成交金額。TOP1 百分比為該個股的區間漲跌幅；點選產業可同時查看當日、5 日、20 日買賣超。僅統計目前研究標的。</p>
        </section>
        <footer class="page-footer"><span class="footer-brand">株研 <span>STOCK INSIGHT</span></span><span>技術提示僅供研究參考。</span><button data-dialog="methodology">計算方法 ${icon("arrow")}</button></footer>
      </main>
    </div>
    <dialog id="info-dialog" aria-labelledby="dialog-heading"><div class="dialog-top"><span class="eyebrow">STOCK INSIGHT / GUIDE</span><button class="icon-button" id="close-dialog" aria-label="關閉視窗">${icon("close")}</button></div><div id="dialog-content"></div></dialog>
    <dialog id="institution-dialog" class="institution-dialog" aria-labelledby="institution-heading" aria-describedby="institution-meta"><header class="institution-dialog-top"><div><span class="eyebrow">INSTITUTIONAL FLOWS</span><h2 id="institution-heading">三大法人動向</h2><p id="institution-meta"></p></div><button class="icon-button" id="close-institution-dialog" aria-label="關閉法人動向" autofocus>${icon("close")}</button></header><div id="institution-content" class="institution-dialog-body"></div><footer class="institution-dialog-footer">買賣量以張顯示 · 1 張 = 1,000 股</footer></dialog>
    <dialog id="sector-dialog" class="sector-dialog" aria-labelledby="sector-dialog-heading" aria-describedby="sector-dialog-meta"><div class="sector-dialog-handle" role="button" tabindex="0" aria-label="關閉產業明細，可向下拖曳"></div><header class="institution-dialog-top sector-dialog-top"><div><span class="eyebrow">SECTOR INSTITUTIONAL FLOWS</span><h2 id="sector-dialog-heading">產業法人買賣超</h2><p id="sector-dialog-meta"></p></div><button class="icon-button" id="close-sector-dialog" aria-label="關閉產業明細">${icon("close")}</button></header><div id="sector-dialog-content" class="sector-dialog-body"></div><footer class="institution-dialog-footer sector-dialog-footer">正值為買超、負值為賣超 · 1 張 = 1,000 股 · 僅統計目前研究標的</footer></dialog>
    <div id="toast" role="status" class="toast"></div>`;
  stopPresence?.();
  stopPresence = startPresence(document.querySelector("#online-count"), { demo: isDemo });
}

function refreshData() {
  const forDisplay = (stock, date) => {
    const snapshot = getSnapshot(stock, date, state.settings);
    // Indicators/streaks use the complete source history. The view only needs
    // the current row plus 20 prior rows for sector returns, saving phone memory.
    snapshot.history = snapshot.history.slice(-21);
    return snapshot;
  };
  const settingsKey = [state.settings.period, state.settings.kSmooth, state.settings.dSmooth].join(":");
  const cached = (date, cache) => dataset.stocks.map((stock) => {
    const prior = cache.get(stock.symbol);
    const key = `${date}:${settingsKey}`;
    if (prior?.stock === stock && prior.key === key) return prior.snapshot;
    const snapshot = forDisplay(stock, date);
    cache.set(stock.symbol, { stock, key, snapshot });
    return snapshot;
  });
  latestSnapshots = cached(dataset.info.asOf, latestCache);
  snapshots = state.date === dataset.info.asOf ? latestSnapshots
    : cached(state.date, historicalCache);
  renderWatchlist();
  renderTable();
  renderSectorOverview();
  renderPage();
  if (document.querySelector("#institution-dialog").open) renderInstitutionDialog();
}

function renderLoadState() {
  const status = document.querySelector("#load-status");
  status.hidden = !loadFailed;
  status.querySelector("span").textContent = loadFailed
    ? loadProgress.total ? "資料尚未完整載入，請重新載入再試一次。"
      : "無法取得股票資料，請重新載入再試一次。"
    : "";
  status.querySelector("button").hidden = !loadFailed;
  let dateIcon = document.querySelector("#date-loading");
  if (!dateIcon) {
    dateIcon = document.createElement("span"); dateIcon.id = "date-loading";
    dateIcon.innerHTML = loadingIcon("交易日載入中");
    document.querySelector(".date-control").append(dateIcon);
  }
  dateIcon.hidden = !loading || dataset.dates.length > 0;
  for (const panel of document.querySelectorAll("[data-page-panel]")) panel.setAttribute("aria-busy", String(loading));
}

function renderConnectionState(online = navigator.onLine) {
  const status = document.querySelector("#app-status");
  if (!status) return;
  const button = status.querySelector("#apply-update");
  if (!button.hidden) return;
  const message = !online
    ? `目前離線${dataset?.info?.asOf ? `，顯示 ${dataset.info.asOf} 已保存資料` : ""}`
    : usingCachedData ? `連線不穩定，顯示 ${dataset?.info?.asOf || "上次"} 已保存資料` : "";
  status.querySelector("span").textContent = message;
  status.hidden = !message;
}

function enablePwa() {
  startPwa({
    onConnection: (online) => renderConnectionState(online),
    onUpdate: (apply) => {
      const status = document.querySelector("#app-status");
      const button = status.querySelector("#apply-update");
      status.querySelector("span").textContent = "株研已有新版本可用。";
      button.hidden = false;
      button.onclick = apply;
      status.hidden = false;
    },
  });
}

function scheduleRefresh() {
  if (!pendingPaint) pendingPaint = new Promise((resolve, reject) => {
    const flush = () => {
      cancelAnimationFrame(frame); clearTimeout(timer); pendingPaint = null;
      try { refreshData(); resolve(); } catch (error) { reject(error); }
    };
    const frame = requestAnimationFrame(flush);
    // Background tabs may pause animation frames; keep ingestion resumable.
    const timer = setTimeout(flush, 100);
  });
  return pendingPaint;
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
  dateSelect.disabled = sectors || !dataset.dates.length;
  document.querySelector(".date-control label").hidden = sectors;
  document.querySelector(".date-control").hidden = sectors;
  document.querySelector(".page-heading").classList.toggle("without-date", sectors);
  document.querySelectorAll("[data-page-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.pagePanel !== state.page;
  });
  document.querySelectorAll("[data-page]").forEach((button) => {
    const active = button.dataset.page === state.page;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  renderLoadState();
  updateOverviewTabs();
  updateSegmentedControls();
}

function renderWatchlist() {
  const previousCards = [...document.querySelectorAll("#watchlist-grid .watch-card")];
  const previousIndex = carouselIndex("price", previousCards);
  const previousSymbol = previousCards[previousIndex]?.dataset.watchSymbol;
  const favorites = state.favorites
    .map((symbol) => snapshots.find((stock) => stock.symbol === symbol))
    .filter((stock) => stock?.latest || (stock && pendingSymbols.has(stock.symbol)));
  document.querySelector("#favorite-count").textContent = state.favorites.length;
  document.querySelector("#watchlist-empty").hidden = favorites.length > 0 || ((loading || loadFailed) && state.favorites.length > 0);
  if (previousWatchLoading === loading && previousFavorites?.length === favorites.length && previousFavorites.every((stock, index) => stock === favorites[index])) return;
  previousWatchLoading = loading;
  previousFavorites = favorites;
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

const carouselConfig = {
  price: { container: "#watchlist-grid", item: ".watch-card", index: 0 },
  institutions: { container: "#institution-overview-rows", item: ".institution-overview-row", index: 0 },
};

function carouselEnabled(kind) {
  return kind === "price" || matchMedia("(max-width: 700px)").matches;
}

function carouselParts(kind) {
  const config = carouselConfig[kind];
  const grid = document.querySelector(config.container);
  return { grid, cards: [...grid.querySelectorAll(config.item)],
    controls: document.querySelector(`[data-carousel="${kind}"]`) };
}

function carouselIndex(kind, cards = carouselParts(kind).cards) {
  if (!cards.length) return 0;
  const { grid } = carouselParts(kind);
  const config = carouselConfig[kind];
  // A resize can clamp scrollLeft before ResizeObserver restores the card.
  if (!carouselEnabled(kind) || !grid.getClientRects().length || (config.width !== undefined && config.width !== grid.clientWidth))
    return Math.min(config.index, cards.length - 1);
  const left = grid.getBoundingClientRect().left + parseFloat(getComputedStyle(grid).paddingLeft);
  return cards.reduce((nearest, card, index) =>
    Math.abs(card.getBoundingClientRect().left - left) < Math.abs(cards[nearest].getBoundingClientRect().left - left)
      ? index : nearest, 0);
}

function renderCarouselPagination(kind, favorites) {
  const { grid, controls } = carouselParts(kind);
  grid.style.setProperty("--carousel-count", Math.max(1, favorites.length));
  controls.innerHTML = ["前段", "中段", "後段"].map((label, position) => {
    const index = Math.round(position * Math.max(0, favorites.length - 1) / 2);
    const stock = favorites[index];
    return `<button class="carousel-page" data-carousel-index="${position}" data-carousel-target="${index}" aria-label="${label}${stock ? `，第 ${index + 1} 檔：${esc(stock.name)} ${stock.symbol}` : ""}" aria-controls="${grid.id}"${position === 1 && favorites.length === 2 ? ' aria-disabled="true"' : ""} tabindex="-1"><span class="carousel-dot" aria-hidden="true"></span></button>`;
  }).join("");
}

function fitCarouselTail(kind) {
  const { grid, cards } = carouselParts(kind);
  if (!cards.length || !grid.getClientRects().length) return;
  const style = getComputedStyle(grid);
  const space = grid.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  carouselConfig[kind].width = grid.clientWidth;
  grid.style.setProperty("--carousel-tail", `${Math.max(0, space - cards.at(-1).getBoundingClientRect().width)}px`);
}

function updateCarouselControls(kind) {
  const { cards, controls } = carouselParts(kind);
  const index = carouselIndex(kind, cards);
  const activeDot = cards.length > 1 ? Math.round(index * 2 / (cards.length - 1)) : 0;
  carouselConfig[kind].index = index;
  controls.hidden = !carouselEnabled(kind) || cards.length <= 1 || (kind === "price" && state.overview !== "price");
  controls.querySelectorAll("[data-carousel-index]").forEach((button, position) => {
    const active = position === activeDot;
    button.setAttribute("aria-current", String(active));
    button.tabIndex = active ? 0 : -1;
  });
}

function scrollToCarouselCard(kind, index, behavior = "smooth") {
  const { grid, cards } = carouselParts(kind);
  const card = cards[index];
  if (!card) return;
  carouselConfig[kind].index = index;
  if (!grid.getClientRects().length) { updateCarouselControls(kind); return; }
  if (!carouselEnabled(kind)) {
    carouselConfig[kind].width = grid.clientWidth;
    updateCarouselControls(kind);
    return;
  }
  fitCarouselTail(kind);
  const left = card.getBoundingClientRect().left - grid.getBoundingClientRect().left +
    grid.scrollLeft - parseFloat(getComputedStyle(grid).paddingLeft);
  grid.scrollTo({ left, behavior });
  if (behavior === "instant") updateCarouselControls(kind);
}

function updateSegmentedControl(group) {
  if (!group.getClientRects().length) return;
  const selected = group.querySelector('button[aria-pressed="true"]');
  const bounds = selected.getBoundingClientRect();
  group.style.setProperty("--segment-left", `${bounds.left - group.getBoundingClientRect().left - group.clientLeft + group.scrollLeft}px`);
  group.style.setProperty("--segment-width", `${bounds.width}px`);
}

function updateSegmentedControls() {
  document.querySelectorAll(".segmented-control").forEach(updateSegmentedControl);
}

function updateOverviewTabs() {
  const controls = document.querySelector(".overview-controls");
  const tabs = controls.querySelector(".overview-tabs");
  if (!tabs.getClientRects().length) return;
  const views = tabs.querySelector(".overview-view-tabs");
  const selected = views.querySelector('[aria-selected="true"]');
  const style = getComputedStyle(tabs);
  const controlStyle = getComputedStyle(controls);
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  const expanded = controls.classList.contains("institutional-active");
  const width = expanded
    ? controls.clientWidth - parseFloat(controlStyle.paddingLeft) - parseFloat(controlStyle.paddingRight)
    : views.offsetWidth + padding + borders;
  const left = selected.getBoundingClientRect().left - tabs.getBoundingClientRect().left - tabs.clientLeft;
  tabs.style.setProperty("--overview-width", `${width}px`);
  tabs.style.setProperty("--overview-indicator-left", `${left}px`);
  tabs.style.setProperty("--overview-indicator-width", `${selected.offsetWidth}px`);
  updateSegmentedControl(tabs.querySelector(".institution-window"));
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
  updateOverviewTabs();
  for (const kind of Object.keys(carouselConfig)) {
    scrollToCarouselCard(kind, carouselConfig[kind].index, "instant");
    updateCarouselControls(kind);
  }
}

function renderInstitutionOverview(favorites) {
  const previousRows = carouselParts("institutions").cards;
  const previousIndex = carouselIndex("institutions", previousRows);
  const previousSymbol = previousRows[previousIndex]?.dataset.overviewSymbol;
  document.querySelectorAll("[data-institution-window]").forEach((button) =>
    button.setAttribute("aria-pressed", button.dataset.institutionWindow === state.institutionWindow));
  document.querySelector("#institution-overview-rows").innerHTML = favorites.map((stock) => {
    const { latest: bar, institutionalSummary: summary } = stock;
    if (!bar) return `<article class="institution-overview-row pending-card" data-overview-symbol="${stock.symbol}" aria-busy="${loading}"><header class="institution-overview-stock"><div><span class="watch-symbol">${stock.symbol}</span><h3>${esc(stock.name)}</h3></div></header><dl class="institution-overview-metrics">${["合計買賣超", "外資", "投信", "自營商"].map((label) => `<div class="overview-metric"><dt>${label}</dt><dd>${pendingField()}</dd></div>`).join("")}</dl></article>`;
    const day = state.institutionWindow === "day";
    const total = day ? bar.institutionalNet : summary.total[`net${state.institutionWindow}`];
    const metric = (name, value, streak = "") => `<div class="overview-metric${name === "total" ? " overview-total" : ""}"><dt>${name === "total" ? "合計買賣超" : esc(name)}</dt><dd>${institutionalFigures(stockMoney(stock, name, state.institutionWindow), value, `data-overview-amount="${name}"`, `data-overview-net="${name}"`)}</dd>${streak}</div>`;
    return `<article class="institution-overview-row" data-overview-symbol="${stock.symbol}" aria-labelledby="overview-name-${stock.symbol}"><header><div><span class="overview-stock-code">${stock.symbol} · ${esc(stock.market)}</span><h4 id="overview-name-${stock.symbol}">${esc(stock.name)}</h4></div><button class="overview-detail-button" data-institution-details="${stock.symbol}" aria-label="查看${esc(stock.name)}三大法人動向" aria-haspopup="dialog" aria-controls="institution-dialog">明細 ${icon("chevron")}</button></header><dl class="institution-overview-metrics">${metric("total", total)}${["外資", "投信", "自營商"].map((name) => {
      const stats = summary.institutions[name];
      const value = day ? getInstitutionNet(bar.institutions, name) : stats[`net${state.institutionWindow}`];
      const streak = name === "自營商" ? "" : `<span class="watch-streak ${stats.streak.direction}" data-overview-streak="${name}">${institutionalStreak(stats.streak)}</span>`;
      return metric(name, value, streak);
    }).join("")}</dl></article>`;
  }).join("");
  renderCarouselPagination("institutions", favorites);
  if (favorites.length) {
    const match = favorites.findIndex((stock) => stock.symbol === previousSymbol);
    const nextIndex = match >= 0 ? match : Math.min(previousIndex, favorites.length - 1);
    scrollToCarouselCard("institutions", nextIndex, "instant");
  }
  updateCarouselControls("institutions");
}

function updateInstitutionOverviewWindow() {
  const day = state.institutionWindow === "day";
  const stocksBySymbol = new Map(snapshots.map((stock) => [stock.symbol, stock]));
  document.querySelectorAll("[data-institution-window]").forEach((button) =>
    button.setAttribute("aria-pressed", button.dataset.institutionWindow === state.institutionWindow));
  updateSegmentedControl(document.querySelector(".institution-window"));
  document.querySelectorAll("#institution-overview-rows .institution-overview-row").forEach((row) => {
    const stock = stocksBySymbol.get(row.dataset.overviewSymbol);
    if (!stock?.latest) return;
    const values = {
      total: day ? stock.latest.institutionalNet : stock.institutionalSummary.total[`net${state.institutionWindow}`],
    };
    for (const name of ["外資", "投信", "自營商"])
      values[name] = day ? getInstitutionNet(stock.latest.institutions, name)
        : stock.institutionalSummary.institutions[name][`net${state.institutionWindow}`];
    row.querySelectorAll("[data-overview-net]").forEach((amount) => {
      const value = values[amount.dataset.overviewNet];
      amount.textContent = institutionalAmount(value);
      const primary = row.querySelector(`[data-overview-amount="${amount.dataset.overviewNet}"]`);
      const money = stockMoney(stock, amount.dataset.overviewNet, state.institutionWindow);
      primary.textContent = institutionalMoney(money);
      primary.classList.remove("up", "down", "neutral");
      primary.classList.add(direction(money));
    });
  });
}

function renderSectorOverview() {
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

function renderSectorDialog(name) {
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

function openSectorDialog(name, focusHandle = true) {
  state.sectorName = name;
  renderSectorDialog(name);
  const dialog = document.querySelector("#sector-dialog");
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  const focusTarget = dialog.querySelector(matchMedia("(max-width: 520px)").matches ? ".sector-dialog-handle" : "#close-sector-dialog");
  if (focusHandle) focusTarget.focus({ preventScroll: true });
  else if (document.activeElement === focusTarget) focusTarget.blur();
}


function institutionalDetails(stock) {
  const { latest: bar, institutionalSummary } = stock;
  const buy = bar.institutionalNet === null ? null : bar.institutions.reduce((sum, item) => sum + item.buy, 0);
  const sell = bar.institutionalNet === null ? null : bar.institutions.reduce((sum, item) => sum + item.sell, 0);
  const max = Math.max(...bar.institutions.flatMap((item) => [item.buy, item.sell]), 1);
  return `<section class="watch-flow" data-institution-symbol="${stock.symbol}" aria-label="${esc(stock.name)}三大法人動向"><div class="watch-flow-heading"><h3>買賣超金額與累計</h3><span>金額：億；張數為輔</span></div>
        <div class="institution-summary"><div class="watch-flow-total"><div><span>合計買賣超</span>${institutionalFigures(stockMoney(stock, "total", "day"), bar.institutionalNet)}</div><div class="watch-flow-amounts"><span>${buy === null ? "" : `買進 ${number(buy / 1000)} 張`}</span><span>${sell === null ? "" : `賣出 ${number(sell / 1000)} 張`}</span></div></div>
        <div class="watch-total-history" aria-label="三大法人累計買賣超">${institutionalHistory(institutionalSummary.total, stock)}</div></div><p class="watch-history-note">累計含資料日；金額按每日收盤價換算，非實際成交金額</p>
        <div class="watch-flow-legend"><span><i class="buy-key"></i>買進</span><span><i class="sell-key"></i>賣出</span><span>右側為買賣超</span></div>
        <div class="watch-institutions">${bar.institutions.map((item) => {
          const stats = institutionalSummary.institutions[item.name];
          const streak = ["外資", "投信"].includes(item.name)
            ? `<span class="watch-streak ${stats.streak.direction}" data-streak>${institutionalStreak(stats.streak)}</span>` : "";
          return `<div class="watch-institution" data-institution="${esc(item.name)}"><div class="watch-institution-heading"><span class="watch-institution-label"><span>${esc(item.name)}</span>${streak}</span><div class="watch-institution-value">${institutionalFigures(stockMoney(stock, item.name, "day"), item.buy - item.sell)}</div></div><div class="watch-flow-bar-row"><span class="watch-flow-bar buy" style="width:${(item.buy / max) * 100}%"></span><span>${number(item.buy / 1000)} 張</span></div><div class="watch-flow-bar-row"><span class="watch-flow-bar sell" style="width:${(item.sell / max) * 100}%"></span><span>${number(item.sell / 1000)} 張</span></div>${institutionalHistory(stats, stock, item.name)}</div>`;
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
  if (["all", "favorites"].includes(state.view)) {
    const query = state.query.trim().toLocaleLowerCase();
    visibleStocks.push(...snapshots.filter((stock) => pendingSymbols.has(stock.symbol) &&
      (state.sector === "all" || stock.sector === state.sector) &&
      (state.view !== "favorites" || state.favorites.includes(stock.symbol)) &&
      (!query || `${stock.symbol} ${stock.name}`.toLocaleLowerCase().includes(query))));
  }
  const nextViewKey = [state.date, state.view, state.sector, state.query, state.sort, state.sortDirection].join("|");
  if (nextViewKey !== tableViewKey) {
    tableViewKey = nextViewKey;
    tableVisibleLimit = TABLE_BATCH_SIZE;
  }
  const renderedStocks = visibleStocks.slice(0, tableVisibleLimit);
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
        row.innerHTML = `<td><button class="icon-button favorite-button ${favorite ? "is-favorite" : ""}" data-favorite="${stock.symbol}" aria-label="${favorite ? "移除" : "加入"}${esc(stock.name)}自選" aria-pressed="${favorite}">${icon("star")}</button></td><th scope="row"><div class="stock-name"><strong>${esc(stock.name)}</strong><span>${stock.symbol}</span></div></th>${Array.from({ length: 6 }, () => `<td>${pendingField()}</td>`).join("")}`;
        tableRowCache.set(row, { stock, favorite, loading });
      }
    } else if (!cached || cached.stock !== stock || cached.favorite !== favorite) {
      const { latest: bar, signal } = stock;
      const leader = getDominantInstitution(bar.institutions);
      const leaderLabel = bar.institutionalNet === null ? "" : !leader ? "合計持平"
        : `${leader.names.join("、")}${leader.direction === "buy" ? "買超" : "賣超"}最多`;
      const html = `<tr data-symbol="${stock.symbol}"><td><button class="icon-button favorite-button ${favorite ? "is-favorite" : ""}" data-favorite="${stock.symbol}" aria-label="${favorite ? "移除" : "加入"}${esc(stock.name)}自選" aria-pressed="${favorite}">${icon("star")}</button></td><th scope="row"><div class="stock-name"><strong>${esc(stock.name)}</strong><span>${stock.symbol}<span class="sector-inline">${esc(stock.sector)}</span></span></div></th><td class="price-cell"><span class="stock-price-line"><span class="stock-close">${number(bar.close, 2)}</span><span class="mobile-change change-chip ${direction(bar.changePercent)}">${percent(bar.changePercent)}</span></span><small class="stock-volume">量 ${number(bar.volume / 1000)} 張</small></td><td class="change-cell"><span class="change-chip ${direction(bar.changePercent)}">${percent(bar.changePercent)}</span></td><td><span class="k-cell">${number(bar.k, 2)}${bar.k !== null ? `<i style="--k:${Math.max(0, Math.min(100, bar.k))}%"></i>` : ""}</span><small class="kd-detail">D ${number(bar.d, 2)}</small></td><td class="signal-cell"><span class="signal-badge ${signal.tone}" data-signal="${signal.code}">${esc(signal.label)}</span><small class="signal-reason">${esc(signal.reason)}</small></td><td><span class="position-tag ${direction(bar.deviation)}">${bar.deviation === null ? "資料不足" : bar.deviation > 0 ? "季線之上" : bar.deviation < 0 ? "季線之下" : "季線持平"}</span><small class="deviation ${direction(bar.deviation)}">${percent(bar.deviation)}</small></td><td class="${direction(bar.institutionalNet)}"><span class="institution-net">${bar.institutionalNet === null ? "" : signed(bar.institutionalNet / 1000, 0)}</span><small class="institution-leader">${leaderLabel}</small></td></tr>`;
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
  if (tableObserver) {
    tableObserver.unobserve(trigger);
    if (!trigger.hidden) tableObserver.observe(trigger);
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

function observeTableBatches() {
  tableObserver?.disconnect();
  const trigger = document.querySelector("#table-load-trigger");
  tableObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting) || trigger.hidden) return;
    tableVisibleLimit += TABLE_BATCH_SIZE;
    renderTable();
  }, { rootMargin: "600px 0px" });
  tableObserver.observe(trigger);
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

function marketScope() {
  const etfs = dataset.stocks.filter(isEtf).length;
  return `${dataset.stocks.length - etfs} 家上市公司（含存託憑證）及 ${etfs} 檔新臺幣交易 ETF；不含上櫃與外幣交易櫃檯。法人買株僅統計產業個股，不含 ETF；ETF 歷史自加入日起逐日累積。`;
}

function openDialog(type) {
  const content = document.querySelector("#dialog-content");
  if (type === "settings") {
    content.innerHTML = `<h2 id="dialog-heading">讓指標符合你的觀察習慣</h2><p class="dialog-intro">調整後，自選總覽與市場觀察清單會一起重新計算。設定會保存在這個瀏覽器。</p><form id="settings-form"><div class="form-field"><label for="period">RSV 回溯週期</label><div><input id="period" name="period" type="number" min="1" max="60" value="${state.settings.period}" required/><span>個交易日</span></div></div><div class="form-field"><label for="kSmooth">K 平滑係數</label><input id="kSmooth" name="kSmooth" type="number" min="1" max="20" value="${state.settings.kSmooth}" required/></div><div class="form-field"><label for="dSmooth">D 平滑係數</label><input id="dSmooth" name="dSmooth" type="number" min="1" max="20" value="${state.settings.dSmooth}" required/></div><p class="helper-text">預設 KD (9, 3, 3)。季線固定為 60 個交易日的收盤價平均。</p><div class="dialog-buttons"><button class="outline-button" type="button" id="default-settings">恢復預設</button><button class="primary-button" type="submit">${icon("check")} 儲存並重新計算</button></div></form>`;
  } else if (type === "signals") {
    content.innerHTML = `<h2 id="dialog-heading">KD 技術建議怎麼看？</h2>${technicalSignalGuide()}`;
  } else if (type === "source" && !isDemo && !dataset.info.updatedAt) {
    content.innerHTML = '<h2 id="dialog-heading">資料說明</h2><p>正在取得資料來源與市場範圍，請稍候。</p>';
  } else if (type === "source" && !isDemo) {
    const syncNote = import.meta.env.VITE_SYNC_NOTE || "平日台灣時間 18:30、20:30 檢核全市場法人報表，驗證通過後分批更新快取，全部完成才發布；失敗保留上一份已驗證資料，基準不足時等待確認。";
    const checkedAt = new Date(dataset.info.updatedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
    content.innerHTML = `<h2 id="dialog-heading">每日資料，來源與口徑。</h2><p class="dialog-intro">由臺灣證券交易所取得上市公司名錄、每日收盤行情及三大法人買賣超日報，儲存於 Cloudflare 後供網站讀取。</p><div class="source-banner">${icon("info")} ${esc(dataset.info.note)}</div><dl class="source-details"><div><dt>市場與標的</dt><dd>${esc(marketScope())}</dd></div><div><dt>市場報表交易日</dt><dd>${esc(dataset.info.asOf)}</dd></div><div><dt>整批資料發布時間</dt><dd>${esc(checkedAt)}（台灣時間）；未提供行情的公司不列入當日排行</dd></div><div><dt>價格與指標</dt><dd>未還原價格；KD、MA60 於瀏覽器依歷史資料計算，除權息與分割可能影響指標</dd></div><div><dt>法人分類</dt><dd>外資不含外資自營商；投信；自營商自行買賣加避險。買賣量單位為股，畫面換算成張</dd></div><div><dt>更新方式</dt><dd>${esc(syncNote)}</dd></div><div><dt>自選清單</dt><dd>保存在目前瀏覽器；手機與電腦讀取相同行情，但自選清單尚未跨裝置同步</dd></div></dl>`;
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

function restoreMarketPosition(position, restoreFocus = true) {
  const selector = position.symbol ? `#stock-rows tr[data-symbol="${position.symbol}"]` : ".stocks-panel";
  const target = document.querySelector(selector);
  if (!target) return;
  const focusTarget = target.querySelector("[data-favorite]") ?? document.querySelector('[data-view="favorites"]');
  if (restoreFocus) focusTarget.focus({ preventScroll: true });
  else if (document.activeElement === focusTarget) focusTarget.blur();
  const restore = () => {
    if (restoreFocus && document.activeElement !== focusTarget) return;
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
  const cached = tableRowCache.get(button.closest("tr"));
  if (cached) cached.favorite = favorite;
}

function bindEvents() {
  observeTableBatches();
  const overviewResize = new ResizeObserver(updateOverviewTabs);
  overviewResize.observe(document.querySelector(".overview-controls"));
  overviewResize.observe(document.querySelector(".overview-view-tabs"));
  const segmentedResize = new ResizeObserver(updateSegmentedControls);
  document.querySelectorAll(".segmented-control").forEach((group) => segmentedResize.observe(group));
  const phoneLayout = matchMedia("(max-width: 700px)");
  const searchControls = document.querySelector(".search-controls");
  const arrangeSearchControls = () => {
    const first = phoneLayout.matches ? document.querySelector("#sector-filter")
      : document.querySelector(".search-box");
    if (searchControls.firstElementChild === first) return;
    const focused = document.activeElement;
    searchControls.prepend(first);
    if (first.contains(focused)) focused.focus({ preventScroll: true });
  };
  arrangeSearchControls();
  phoneLayout.addEventListener("change", arrangeSearchControls);
  let touchInteraction = false;
  document.addEventListener("pointerdown", (event) => { touchInteraction = event.pointerType === "touch"; }, { capture: true, passive: true });
  document.addEventListener("touchstart", () => { touchInteraction = true; }, { capture: true, passive: true });
  document.addEventListener("keydown", () => { touchInteraction = false; }, true);
  document.addEventListener("keydown", (event) => {
    const card = event.target.closest?.("#sector-grid [data-sector-details]");
    if (!card || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    openSectorDialog(card.dataset.sectorDetails);
  });
  document.addEventListener("click", (event) => {
    const sectorCard = event.target.closest("#sector-grid [data-sector-details]");
    if (sectorCard) {
      openSectorDialog(sectorCard.dataset.sectorDetails, !touchInteraction);
      return;
    }
    const button = event.target.closest("button");
    if (!button) return;
    if (button.id === "reload-data") { window.location.reload(); return; }
    if (button.dataset.dialog) openDialog(button.dataset.dialog);
    if (button.dataset.overview) {
      state.overview = button.dataset.overview;
      renderOverviewVisibility();
    }
    if (button.dataset.carouselIndex !== undefined && button.getAttribute("aria-disabled") !== "true") {
      const kind = button.closest("[data-carousel]").dataset.carousel;
      scrollToCarouselCard(kind, Number(button.dataset.carouselTarget),
      matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth");
    }
    if (button.dataset.institutionWindow) {
      state.institutionWindow = button.dataset.institutionWindow;
      updateInstitutionOverviewWindow();
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
      if (position) restoreMarketPosition(position, !touchInteraction);
      else {
        const scope = wasInOverview ? "#watchlist" : "#stock-rows";
        const focusTarget = document.querySelector(`${scope} [data-favorite="${symbol}"]`) ||
          document.querySelector(wasInOverview ? '#watchlist .overview-tabs [aria-selected="true"]' : '[data-view="favorites"]');
        if (!touchInteraction) focusTarget.focus({ preventScroll: true });
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
    const { grid } = carouselParts(kind);
    let frame;
    grid.addEventListener("scroll", () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = null; updateCarouselControls(kind); });
    }, { passive: true });
    new ResizeObserver(() => {
      if (grid.getClientRects().length)
        scrollToCarouselCard(kind, carouselConfig[kind].index, "instant");
    }).observe(grid);
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
    const dot = event.target.closest?.("[data-carousel-index]");
    if (dot && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const buttons = [...dot.parentElement.querySelectorAll('[data-carousel-index]:not([aria-disabled="true"])')];
      const current = buttons.indexOf(dot);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : Math.max(0, Math.min(buttons.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)));
      buttons[next].focus({ preventScroll: true });
      buttons[next].click();
      return;
    }
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
    const focusTarget = trigger ?? document.querySelector('#watchlist .overview-tabs [aria-selected="true"]');
    if (touchInteraction) {
      if (document.activeElement === focusTarget) focusTarget.blur();
    } else focusTarget?.focus({ preventScroll: true });
  });
  const sectorDialog = document.querySelector("#sector-dialog");
  const sectorHandle = sectorDialog.querySelector(".sector-dialog-handle");
  let sectorDrag = null;
  let suppressSectorHandleClickUntil = 0;
  const resetSectorDrag = () => {
    sectorDrag = null;
    sectorDialog.classList.remove("is-dragging");
    sectorDialog.style.removeProperty("--sector-drag-y");
  };
  sectorHandle.addEventListener("pointerdown", (event) => {
    if (!sectorDialog.open || !matchMedia("(max-width: 520px)").matches || event.button !== 0) return;
    sectorDrag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    sectorDialog.classList.add("is-dragging");
    sectorHandle.setPointerCapture(event.pointerId);
  });
  sectorHandle.addEventListener("pointermove", (event) => {
    if (event.pointerId !== sectorDrag?.id) return;
    const distance = event.clientY - sectorDrag.y;
    const horizontal = Math.abs(event.clientX - sectorDrag.x);
    sectorDialog.style.setProperty("--sector-drag-y", `${distance > horizontal ? Math.max(0, distance) : 0}px`);
  });
  sectorHandle.addEventListener("pointerup", (event) => {
    if (event.pointerId !== sectorDrag?.id) return;
    const distance = event.clientY - sectorDrag.y;
    const horizontal = Math.abs(event.clientX - sectorDrag.x);
    if (Math.hypot(distance, horizontal) > 8) suppressSectorHandleClickUntil = performance.now() + 350;
    resetSectorDrag();
    if (distance >= 90 && distance > horizontal) sectorDialog.close();
  });
  sectorHandle.addEventListener("pointercancel", resetSectorDrag);
  sectorHandle.addEventListener("click", () => {
    if (sectorDialog.open && performance.now() >= suppressSectorHandleClickUntil)
      sectorDialog.close();
  });
  sectorHandle.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    sectorDialog.close();
  });
  sectorDialog.addEventListener("close", () => {
    resetSectorDrag();
    suppressSectorHandleClickUntil = 0;
    const name = state.sectorName;
    state.sectorName = null;
    const trigger = [...document.querySelectorAll("#sector-grid [data-sector-details]")]
      .find((card) => card.dataset.sectorDetails === name);
    if (touchInteraction) {
      if (document.activeElement === trigger) trigger.blur();
    } else trigger?.focus({ preventScroll: true });
  });
}

async function init() {
  readPreferences();
  const apiMode = import.meta.env.VITE_DATA_MODE === "api";
  const prepare = () => {
    state.date = dataset.info.asOf;
    state.favorites = [...new Set(state.favorites)].filter((symbol) => dataset.stocks.some((stock) => stock.symbol === symbol));
  };
  if (apiMode) {
    loading = true; isDemo = false;
    dataset = { stocks: [], dates: [], info: { mode: "twse", label: "資料載入中", asOf: "" } };
    snapshots = []; latestSnapshots = [];
    pendingSymbols.clear();
    shell(); bindEvents(); enablePwa(); refreshData();
  }
  dataset = await loadDataset({ prioritySymbols: state.favorites,
    onCacheFallback: () => { usingCachedData = true; renderConnectionState(); },
    onManifest: async (next) => {
      dataset = next;
      pendingSymbols.clear();
      for (const stock of dataset.stocks) pendingSymbols.add(stock.symbol);
      prepare();
      loadProgress = { loaded: 0, total: dataset.stocks.length };
      document.querySelector(".demo-badge").innerHTML = `<span></span>${esc(dataset.info.label)}`;
      document.querySelector("#trade-date").innerHTML = dataset.dates.slice(-30).reverse()
        .map((date) => `<option value="${date}">${date.replaceAll("-", " / ")}</option>`).join("");
      document.querySelector("#sector-filter").innerHTML = '<option value="all">全部產業</option>' +
        [...new Set(dataset.stocks.map((stock) => stock.sector))].map((sector) => `<option>${esc(sector)}</option>`).join("");
      await scheduleRefresh();
    },
    onChunk: async ({ loaded, total, stocks }) => {
      for (const stock of stocks) pendingSymbols.delete(stock.symbol);
      loadProgress = { loaded, total };
      await scheduleRefresh();
    },
  });
  loading = false;
  pendingSymbols.clear();
  if (!apiMode) {
    isDemo = dataset.info.mode === "demo";
    prepare(); shell(); bindEvents(); enablePwa();
  }
  refreshData();
  renderConnectionState();
  savePreferences();
}

init().catch((error) => {
  console.error("Unable to initialize stock dashboard", error);
  if (document.querySelector("#load-status")) {
    loading = false; loadFailed = true;
    renderLoadState(); renderWatchlist(); renderTable(); renderSectorOverview();
    return;
  }
  document.querySelector("#app").innerHTML =
    '<main class="load-error"><h1>暫時無法載入資料</h1><p>請重新整理頁面再試一次。</p></main>';
});

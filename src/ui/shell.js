import { brandIntro, aboutPage } from "../about.js";
export function shellMarkup({ dataset, state, isDemo, icon, loadingIcon, esc }) {
  return `
    <aside class="sidebar">
      <a class="brand" href="#main" data-home aria-label="返回市場觀察清單頂端"><span class="brand-mark">${icon("chart")}</span><span>株研<span class="brand-en">STOCK INSIGHT</span></span></a>
      <div class="nav-caption">WORKSPACE <span>研究工作台</span></div>
      <nav aria-label="主要導覽">
        <button class="nav-item active" data-page="market" aria-label="市場觀察清單">${icon("grid")}<span class="nav-label">市場觀察清單</span><span class="nav-label-mobile" aria-hidden="true">市場</span><span class="nav-dot"></span></button>
        <button class="nav-item" data-page="favorites" aria-label="自選總覽">${icon("star")}<span class="nav-label">自選總覽</span><span class="nav-label-mobile" aria-hidden="true">自選</span><span id="favorite-count" class="count-pill"></span></button>
        <button class="nav-item" data-page="sectors" aria-label="法人買株">${icon("chart")}<span class="nav-label">法人買株</span><span class="nav-label-mobile" aria-hidden="true">法人</span><span class="nav-dot"></span></button>
        <button class="nav-item" data-dialog="methodology" aria-label="指標小百科">${icon("book")}<span>指標說明</span>${icon("chevron", "nav-chevron")}</button>
        <button class="nav-item" data-dialog="source" aria-label="資料說明">${icon("info")}<span>資料說明</span>${icon("chevron", "nav-chevron")}</button>
        <button class="nav-item" data-page="about" aria-label="關於株研">${icon("info")}<span>關於株研</span></button>
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
        ${brandIntro()}
        ${aboutPage()}
        <div id="pull-refresh" class="pull-refresh" aria-hidden="true"><span></span>下拉重新整理</div>
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
          <div class="table-toolbar"><div class="filter-tabs segmented-control" role="group" aria-label="清單篩選"><span class="segmented-indicator" aria-hidden="true"></span><button data-view="all" class="active" aria-pressed="true"><span class="filter-label-desktop">全部標的</span><span class="filter-label-mobile">全部</span></button><button data-view="favorites" aria-pressed="false"><span class="filter-label-desktop">我的自選</span><span class="filter-label-mobile">自選</span></button><button data-view="above" aria-pressed="false">站上季線</button><button data-view="below" aria-pressed="false">季線之下</button><button data-view="oversold" aria-pressed="false" aria-label="K 值低於 20">K值低於20</button></div><div class="search-controls"><label class="search-box">${icon("search")}<input id="stock-search" type="search" placeholder="搜尋代碼或名稱" aria-label="搜尋股票代碼或名稱" autocomplete="off"/><kbd>/</kbd></label><select id="sector-filter" aria-label="產業篩選"><option value="all">全部產業</option>${[...new Set(dataset.stocks.map((stock) => stock.sector))].map((sector) => `<option>${esc(sector)}</option>`).join("")}</select></div></div>
          <div class="signal-note">${icon("info")}<span>依資料日 KD 交叉與 MA20 趨勢判讀；${isDemo ? "模擬資料技術提示" : "技術提示僅供觀察"}，需搭配風險控管。</span><button class="text-button" data-dialog="signals">判讀規則 ${icon("chevron")}</button></div>
          <div class="table-scroll" tabindex="0" role="region" aria-label="股票觀察清單，可左右捲動"><table><caption class="sr-only">${isDemo ? "模擬股票行情" : "股票收盤行情"}、KD 技術建議與三大法人買賣超。日漲跌幅與前一交易日收盤價比較，成交量位於收盤價下方，以張表示。點選星號可加入或移除上方自選總覽。</caption><colgroup><col class="favorite-column"/><col class="stock-column"/><col class="price-column"/><col class="net-column-mobile"/><col class="change-column"/><col class="kd-column"/><col class="signal-column"/><col class="position-column"/><col class="net-column"/></colgroup><thead><tr><th scope="col"><span class="sr-only">自選</span></th><th scope="col">股票</th>${[
            ["close", '<span class="close-label-desktop">收盤價</span><span class="close-label-mobile">收盤／漲跌</span>'],
             ["institutionalNetMobile", "法人買賣超"],
            ["changePercent", "日漲跌幅"],
            ["k", "K 值"],
            ["deviation", "與季線位置"],
            ["institutionalNet", "法人買賣超"],
          ]
            .map(
              ([key, label]) => {
                const sortKey = key === "institutionalNetMobile" ? "institutionalNet" : key;
                const className = key === "institutionalNetMobile"
                  ? ' class="net-heading-mobile"'
                  : key === "institutionalNet"
                    ? ' class="net-heading-desktop"'
                    : "";
                return `<th scope="col"${className} data-sort-heading="${sortKey}" aria-sort="none"><button data-sort="${sortKey}">${label} ${icon("sort", "sort-icon")}</button></th>${key === "k" ? '<th scope="col" class="signal-heading">KD 技術建議</th>' : ""}`;
              },
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
        <footer class="page-footer"><span class="footer-brand">株研 <span>STOCK RESEARCH</span></span><span>技術提示僅供研究參考。</span><button data-page="about">關於株研 ${icon("arrow")}</button><button data-dialog="methodology">計算方法 ${icon("arrow")}</button></footer>
      </main>
    </div>
    <dialog id="info-dialog" aria-labelledby="dialog-heading"><div class="dialog-top"><span class="eyebrow">STOCK INSIGHT / GUIDE</span><button class="icon-button" id="close-dialog" aria-label="關閉視窗">${icon("close")}</button></div><div id="dialog-content"></div></dialog>
    <dialog id="institution-dialog" class="institution-dialog" aria-labelledby="institution-heading" aria-describedby="institution-meta"><div class="institution-dialog-handle" role="button" tabindex="0" aria-label="關閉法人動向，可向下拖曳"></div><header class="institution-dialog-top"><div><span class="eyebrow">INSTITUTIONAL FLOWS</span><h2 id="institution-heading">三大法人動向</h2><p id="institution-meta"></p></div><button class="icon-button" id="close-institution-dialog" aria-label="關閉法人動向">${icon("close")}</button></header><div id="institution-content" class="institution-dialog-body"></div><footer class="institution-dialog-footer">買賣量以張顯示 · 1 張 = 1,000 股</footer></dialog>
    <dialog id="sector-dialog" class="sector-dialog" aria-labelledby="sector-dialog-heading" aria-describedby="sector-dialog-meta"><div class="sector-dialog-handle" role="button" tabindex="0" aria-label="關閉產業明細，可向下拖曳"></div><header class="institution-dialog-top sector-dialog-top"><div><span class="eyebrow">SECTOR INSTITUTIONAL FLOWS</span><h2 id="sector-dialog-heading">產業法人買賣超</h2><p id="sector-dialog-meta"></p></div><button class="icon-button" id="close-sector-dialog" aria-label="關閉產業明細">${icon("close")}</button></header><div id="sector-dialog-content" class="sector-dialog-body"></div><footer class="institution-dialog-footer sector-dialog-footer">正值為買超、負值為賣超 · 1 張 = 1,000 股 · 僅統計目前研究標的</footer></dialog>
    <div id="toast" role="status" class="toast"></div>`;
}

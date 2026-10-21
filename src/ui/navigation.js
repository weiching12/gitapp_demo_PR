const pageCopy = {
  about: ["STOCK RESEARCH", "關於株研", "我們的目的、目前提供的工具，以及持續前進的方向。"],
  market: ["MARKET WATCHLIST", "市場觀察清單", "比較全部標的的價量、技術指標與法人籌碼。"],
  favorites: ["MY WATCHLIST", "自選總覽", "集中查看已收藏股票的價量與法人動向。"],
  sectors: ["INSTITUTIONAL RANKING", "法人買株", "依產業排名觀察法人資金方向；點選產業查看個股價格與買賣超張數。"],
};

export function renderPageView({ state, dataset, renderLoadState, updateOverviewTabs, updateSegmentedControls }) {
  const [eyebrow, title, description] = pageCopy[state.page];
  document.querySelector("#page-eyebrow").textContent = eyebrow;
  document.querySelector("#page-title").innerHTML = `${title}<span class="heading-dot">.</span>`;
  document.querySelector("#page-description").textContent = description;
  document.querySelector("#breadcrumb-current").textContent = title;
  const sectors = state.page === "sectors" || state.page === "about";
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


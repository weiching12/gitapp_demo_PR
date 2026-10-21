const DEFAULT_CONFIG = {
  price: { container: "#watchlist-grid", item: ".watch-card", index: 0 },
  institutions: { container: "#institution-overview-rows", item: ".institution-overview-row", index: 0 },
};

export function createCarouselController({ getOverview, escapeHtml, config = DEFAULT_CONFIG }) {
  const state = Object.fromEntries(Object.entries(config).map(([kind, value]) => [kind, { ...value }]));
  const kinds = Object.keys(state);
  const enabled = (kind) => kind === "price" || matchMedia("(max-width: 700px)").matches;
  const parts = (kind) => {
    const entry = state[kind];
    const grid = document.querySelector(entry.container);
    return { grid, cards: [...grid.querySelectorAll(entry.item)], controls: document.querySelector(`[data-carousel="${kind}"]`) };
  };
  const index = (kind, cards = parts(kind).cards) => {
    if (!cards.length) return 0;
    const { grid } = parts(kind);
    const entry = state[kind];
    if (!enabled(kind) || !grid.getClientRects().length || (entry.width !== undefined && entry.width !== grid.clientWidth))
      return Math.min(entry.index, cards.length - 1);
    const left = grid.getBoundingClientRect().left + parseFloat(getComputedStyle(grid).paddingLeft);
    return cards.reduce((nearest, card, cardIndex) => Math.abs(card.getBoundingClientRect().left - left) < Math.abs(cards[nearest].getBoundingClientRect().left - left) ? cardIndex : nearest, 0);
  };
  const renderPagination = (kind, favorites) => {
    const { grid, controls } = parts(kind);
    grid.style.setProperty("--carousel-count", Math.max(1, favorites.length));
    controls.innerHTML = ["第一組", "中間組", "最後組"].map((label, position) => {
      const target = Math.round(position * Math.max(0, favorites.length - 1) / 2);
      const stock = favorites[target];
      return `<button class="carousel-page" data-carousel-index="${position}" data-carousel-target="${target}" aria-label="${label}${stock ? `，第 ${target + 1} 張，${escapeHtml(stock.name)} ${stock.symbol}` : ""}" aria-controls="${grid.id}"${position === 1 && favorites.length === 2 ? ' aria-disabled="true"' : ""} tabindex="-1"><span class="carousel-dot" aria-hidden="true"></span></button>`;
    }).join("");
  };
  const fitTail = (kind) => {
    const { grid, cards } = parts(kind);
    if (!cards.length || !grid.getClientRects().length) return;
    const style = getComputedStyle(grid);
    const space = grid.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    state[kind].width = grid.clientWidth;
    grid.style.setProperty("--carousel-tail", `${Math.max(0, space - cards.at(-1).getBoundingClientRect().width)}px`);
  };
  const updateControls = (kind) => {
    const { cards, controls } = parts(kind);
    const current = index(kind, cards);
    const activeDot = cards.length > 1 ? Math.round(current * 2 / (cards.length - 1)) : 0;
    state[kind].index = current;
    controls.hidden = !enabled(kind) || cards.length <= 1 || (kind === "price" && getOverview() !== "price");
    controls.querySelectorAll("[data-carousel-index]").forEach((button, position) => {
      const active = position === activeDot;
      button.setAttribute("aria-current", String(active));
      button.tabIndex = active ? 0 : -1;
    });
  };
  const scrollToCard = (kind, cardIndex, behavior = "smooth") => {
    const { grid, cards } = parts(kind);
    const card = cards[cardIndex];
    if (!card) return;
    state[kind].index = cardIndex;
    if (!grid.getClientRects().length) { updateControls(kind); return; }
    if (!enabled(kind)) { state[kind].width = grid.clientWidth; updateControls(kind); return; }
    fitTail(kind);
    const left = card.getBoundingClientRect().left - grid.getBoundingClientRect().left + grid.scrollLeft - parseFloat(getComputedStyle(grid).paddingLeft);
    grid.scrollTo({ left, behavior });
    if (behavior === "instant") updateControls(kind);
  };
  const restore = (kind) => { scrollToCard(kind, state[kind].index, "instant"); updateControls(kind); };
  const bind = () => {
    for (const kind of kinds) {
      const { grid } = parts(kind);
      let frame;
      grid.addEventListener("scroll", () => {
        if (frame) return;
        frame = requestAnimationFrame(() => { frame = null; updateControls(kind); });
      }, { passive: true });
      new ResizeObserver(() => { if (grid.getClientRects().length) restore(kind); }).observe(grid);
    }
  };
  return { kinds, parts, index, renderPagination, updateControls, scrollToCard, restore, bind };
}

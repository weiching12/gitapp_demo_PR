const navigationKeys = ["ArrowLeft", "ArrowRight", "Home", "End"];

export function bindKeyboardNavigation({ getPage, onSectorDetails }) {
  document.addEventListener("keydown", (event) => {
    const sectorCard = event.target.closest?.("#sector-grid [data-sector-details]");
    if (sectorCard && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onSectorDetails(sectorCard.dataset.sectorDetails);
      return;
    }

    const dot = event.target.closest?.("[data-carousel-index]");
    if (dot && navigationKeys.includes(event.key)) {
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
    if (overviewTab && navigationKeys.includes(event.key)) {
      event.preventDefault();
      const tabs = [...document.querySelectorAll("[data-overview]")];
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
        : (tabs.indexOf(overviewTab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click();
      tabs[next].focus();
      return;
    }

    if (event.key === "/" && getPage() === "market" && !document.querySelector("dialog[open]") &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      document.querySelector("#stock-search").focus();
    }
  });
}

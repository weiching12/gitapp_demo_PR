export function bindKeyboardNavigation({ getPage, onSectorDetails }) {
  document.addEventListener("keydown", (event) => {
    const sectorCard = event.target.closest?.("#sector-grid [data-sector-details]");
    if (sectorCard && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onSectorDetails(sectorCard.dataset.sectorDetails);
      return;
    }

    if (event.key === "/" && getPage() === "market" && !document.querySelector("dialog[open]") &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      document.querySelector("#stock-search").focus();
    }
  });
}

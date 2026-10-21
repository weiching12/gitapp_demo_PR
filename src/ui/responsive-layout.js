export function bindResponsiveSearchOrder() {
  const phoneLayout = matchMedia("(max-width: 700px)");
  const searchControls = document.querySelector(".search-controls");
  const arrange = () => {
    const first = phoneLayout.matches ? document.querySelector("#sector-filter") : document.querySelector(".search-box");
    if (searchControls.firstElementChild === first) return;
    const focused = document.activeElement;
    searchControls.prepend(first);
    if (first.contains(focused)) focused.focus({ preventScroll: true });
  };
  arrange();
  phoneLayout.addEventListener("change", arrange);
}

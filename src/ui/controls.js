export function createControlsController() {
  const updateSegmented = (group) => {
    if (!group?.getClientRects().length) return;
    const selected = group.querySelector('button[aria-pressed="true"]');
    if (!selected) return;
    const bounds = selected.getBoundingClientRect();
    group.style.setProperty("--segment-left", `${bounds.left - group.getBoundingClientRect().left - group.clientLeft + group.scrollLeft}px`);
    group.style.setProperty("--segment-width", `${bounds.width}px`);
  };

  const updateSegmentedAll = () => {
    document.querySelectorAll(".segmented-control").forEach(updateSegmented);
  };

  const updateOverview = () => {
    const controls = document.querySelector(".overview-controls");
    const tabs = controls?.querySelector(".overview-tabs");
    if (!tabs?.getClientRects().length) return;
    const views = tabs.querySelector(".overview-view-tabs");
    const selected = views.querySelector('[aria-selected="true"]');
    if (!selected) return;
    const style = getComputedStyle(tabs);
    const controlStyle = getComputedStyle(controls);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const width = controls.classList.contains("institutional-active")
      ? controls.clientWidth - parseFloat(controlStyle.paddingLeft) - parseFloat(controlStyle.paddingRight)
      : views.offsetWidth + padding + borders;
    const left = selected.getBoundingClientRect().left - tabs.getBoundingClientRect().left - tabs.clientLeft;
    tabs.style.setProperty("--overview-width", `${width}px`);
    tabs.style.setProperty("--overview-indicator-left", `${left}px`);
    tabs.style.setProperty("--overview-indicator-width", `${selected.offsetWidth}px`);
    updateSegmented(tabs.querySelector(".institution-window"));
  };

  const bind = () => {
    const overviewResize = new ResizeObserver(updateOverview);
    overviewResize.observe(document.querySelector(".overview-controls"));
    overviewResize.observe(document.querySelector(".overview-view-tabs"));
    const segmentedResize = new ResizeObserver(updateSegmentedAll);
    document.querySelectorAll(".segmented-control").forEach((group) => segmentedResize.observe(group));
  };

  return { updateSegmented, updateSegmentedAll, updateOverview, bind };
}

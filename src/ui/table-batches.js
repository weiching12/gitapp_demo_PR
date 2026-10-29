export function createTableBatchController({ state, batchSize, render }) {
  const observe = () => {
    state.observer?.disconnect();
    const trigger = document.querySelector("#table-load-trigger");
    const fillViewport = () => {
      state.fillFrame = undefined;
      if (trigger.hidden || trigger.getBoundingClientRect().top > window.innerHeight + 600) return;
      state.visibleLimit += batchSize;
      render();
      if (!trigger.hidden) state.fillFrame = requestAnimationFrame(fillViewport);
    };
    state.observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || trigger.hidden) return;
      if (!state.fillFrame) state.fillFrame = requestAnimationFrame(fillViewport);
    }, { rootMargin: "600px 0px" });
    state.observer.observe(trigger);
  };
  return { observe };
}

import test from "node:test";
import assert from "node:assert/strict";
import { createScoreAnimator, createScoreHaptics } from "../src/ui/score-feedback.js";

function fixture({ score = "64.25", touch = true, reduced = false } = {}) {
  let value = { dataset: { scoreTarget: score }, textContent: `${score} / 100`, isConnected: true };
  let callback, hidden = false;
  const pulses = [];
  const dialog = { open: true, dataset: { request: "1", entrySymbol: "2330" }, querySelector: () => value };
  const animator = createScoreAnimator({ pulse: kind => pulses.push(kind), canPulse: () => touch,
    hidden: () => hidden, reducedMotion: () => reduced,
    requestFrame: fn => { callback = fn; return 1; }, cancelFrame: () => { callback = null; } });
  return { animator, dialog, pulses, value: () => value,
    frame: now => { const fn = callback; callback = null; fn?.(now); },
    replace: () => { value = { ...value }; }, hide: () => { hidden = true; } };
}

test("score feedback ticks at a bounded rate and finishes once without replaying after detail hydration", () => {
  const f = fixture();
  f.animator.animate(f.dialog);
  for (const time of [0, 120, 240]) f.frame(time);
  f.replace(); f.animator.animate(f.dialog);
  for (const time of [360, 480, 600, 720, 750]) f.frame(time);
  assert.equal(f.value().textContent, "64.25 / 100");
  assert(f.pulses.filter(kind => kind === "tick").length <= 6);
  assert(f.pulses.filter(kind => kind === "tick").length >= 3);
  assert.equal(f.pulses.at(-1), "finish");
  const count = f.pulses.length;
  f.replace(); f.animator.animate(f.dialog); f.frame(900);
  assert.equal(f.pulses.length, count);
});

test("closing or backgrounding stops feedback and leaves the final score ready for return", () => {
  for (const action of [f => { f.dialog.open = false; }, f => f.hide(), f => f.animator.stop()]) {
    const f = fixture(); f.animator.animate(f.dialog); f.frame(0); f.frame(120);
    action(f); f.frame(240);
    const count = f.pulses.length; f.frame(750);
    assert.equal(f.pulses.length, count);
    assert.equal(f.pulses.at(-1), "cancel");
    assert.equal(f.value().textContent, "64.25 / 100");
    assert(!f.pulses.includes("finish"));
  }
});

test("desktop use, reduced motion and zero scores do not generate haptics", () => {
  for (const options of [{ touch: false }, { reduced: true }, { score: "0.00" }]) {
    const f = fixture(options); f.animator.animate(f.dialog);
    for (const time of [0, 120, 240, 750]) f.frame(time);
    assert.deepEqual(f.pulses, []);
    assert.equal(f.value().textContent, `${options.score ?? "64.25"} / 100`);
  }
});

test("switching stock cancels the previous animation and starts a fresh feedback sequence", () => {
  const f = fixture(); f.animator.animate(f.dialog); f.frame(0); f.frame(120);
  f.dialog.dataset.request = "2"; f.dialog.dataset.entrySymbol = "2031";
  f.animator.animate(f.dialog); f.frame(500); f.frame(1250);
  assert.deepEqual(f.pulses, ["tick", "cancel", "finish"]);
  assert.equal(f.value().textContent, "64.25 / 100");
});

test("haptic adapter uses short web pulses and native impact feedback", async () => {
  const web = [], native = [];
  const browserPulse = createScoreHaptics({ vibrate: pattern => web.push(pattern) });
  for (const kind of ["tick", "finish", "cancel"]) browserPulse(kind);
  assert.deepEqual(web, [8, 18, 0]);
  const nativePulse = createScoreHaptics({ impact: style => native.push(style), vibrate: () => assert.fail("Native must not use web vibration") });
  for (const kind of ["tick", "finish", "cancel"]) nativePulse(kind);
  assert.deepEqual(native, ["LIGHT", "MEDIUM"]);
  assert.doesNotThrow(() => createScoreHaptics({ vibrate: () => { throw Error("unavailable"); } })("tick"));
  createScoreHaptics({ impact: async () => { throw Error("unavailable"); } })("tick");
  await new Promise(resolve => setImmediate(resolve));
});

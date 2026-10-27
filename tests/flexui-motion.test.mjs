/**
 * motion.mjs: one timer that writes the step and glow level once a second, only while wanted, visible and allowed.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

/** Elements with an inline style map, enough for style.setProperty. */
const element = () => {
  const props = new Map();
  return { props, style: { setProperty: (k, v) => props.set(k, v) } };
};
const panel = element();
const activeTab = element();
const listeners = {};
let reducedListener = null;
const reduced = { matches: false, addEventListener: (type, fn) => (reducedListener = fn) };
globalThis.matchMedia = query => {
  assert.equal(query, "(prefers-reduced-motion: reduce)");
  return reduced;
};
globalThis.document = {
  hidden: false,
  getElementById: id => (id === "sidebar-content" ? panel : null),
  querySelector: selector => (selector.includes("#sidebar-tabs") ? activeTab : null),
  addEventListener: (type, fn) => (listeners[type] = fn)
};

mock.timers.enable({ apis: ["setInterval"] });
const { GLOW_LEVELS, running, start, stop } = await import("../modules/flexui-revived/scripts/motion.mjs");

test("start runs one timer that writes the step and the glow level each second", () => {
  start("pulse");
  assert.equal(running(), true);
  mock.timers.tick(1000);
  assert.equal(panel.props.get("--fxr-step"), "1");
  assert.equal(activeTab.props.get("--fxr-glow-level"), String(GLOW_LEVELS.pulse[1]));
  mock.timers.tick(3000);
  assert.equal(panel.props.get("--fxr-step"), "4");
  assert.equal(activeTab.props.get("--fxr-glow-level"), String(GLOW_LEVELS.pulse[0]), "levels loop");
  start("flicker");
  mock.timers.tick(1000);
  assert.equal(activeTab.props.get("--fxr-glow-level"), String(GLOW_LEVELS.flicker[5]), "a new style keeps the step");
});

test("the timer stops while the page is hidden and resumes when it shows", () => {
  document.hidden = true;
  listeners.visibilitychange();
  assert.equal(running(), false);
  const step = panel.props.get("--fxr-step");
  mock.timers.tick(5000);
  assert.equal(panel.props.get("--fxr-step"), step, "nothing written while hidden");
  document.hidden = false;
  listeners.visibilitychange();
  assert.equal(running(), true);
});

test("reduced motion stops it, even mid-session", () => {
  reduced.matches = true;
  reducedListener();
  assert.equal(running(), false);
  start("breathe");
  assert.equal(running(), false, "start does nothing while the system asks for less motion");
  reduced.matches = false;
  reducedListener();
  assert.equal(running(), true);
});

test("stop ends the timer and visibility changes don't restart it", () => {
  stop();
  assert.equal(running(), false);
  listeners.visibilitychange();
  assert.equal(running(), false);
});

test("every glow style is a short loop of levels between 0 and 1", () => {
  for ( const [style, levels] of Object.entries(GLOW_LEVELS) ) {
    assert.ok(levels.length >= 4 && levels.length <= 16, style);
    for ( const l of levels ) assert.ok(l >= 0 && l <= 1, `${style} ${l}`);
  }
});

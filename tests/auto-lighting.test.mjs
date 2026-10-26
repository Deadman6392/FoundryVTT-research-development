/**
 * Automatic lighting resolution: steps down only when a computer falls behind, keeps a step only when it helped,
 * tries the sharper step again later, and remembers each scene. The controller is pure; the glue is run against the
 * Foundry mock with short windows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";
import { AutoLighting, RETRY_MS } from "../modules/performance-triage/scripts/lib/auto-lighting.mjs";

const MIN = 60_000;

/** Feed windows; returns the changes made. */
function feed(auto, fpsList, target, start, step = 3000) {
  return fpsList.map((fps, i) => auto.addWindow(fps, target, start + (i * step)));
}

test("a heavy scene steps down while each step helps, and stays there", () => {
  const auto = new AutoLighting();
  assert.equal(auto.setScene("castle", "Castle"), 1);
  const changes = feed(auto, [12, 20, 20, 26, 26, 22, 22, 28], 30, 0);
  assert.equal(changes[0], null, "the first window after drawing a scene is loading");
  assert.equal(changes[1], null, "one slow window isn't enough");
  assert.deepEqual(changes[2], { scale: 0.75, reason: "slow" });
  assert.equal(changes[3], null, "26 fps after 20: kept");
  assert.equal(changes[4], null, "26 of 30 isn't slow");
  assert.deepEqual(changes[6], { scale: 0.5, reason: "slow" });
  assert.equal(changes[7], null);
  assert.equal(auto.scale, 0.5);
  assert.deepEqual(auto.summary().history.map(h => [h.from, h.to, h.before, h.after, h.kept]),
    [[1, 0.75, 20, 26, undefined], [0.75, 0.5, 22, 28, undefined]]);
});

test("a step that doesn't raise the frame rate is undone, and not tried again for a while", () => {
  const auto = new AutoLighting();
  auto.setScene("busy", "Busy");
  // Automation-heavy, not lighting-heavy: 20 fps whatever the lighting does
  const changes = feed(auto, [20, 20, 20, 20, 20, 20, 20], 30, 0);
  assert.deepEqual(changes[2], { scale: 0.75, reason: "slow" });
  assert.deepEqual(changes[3], { scale: 1, reason: "noGain" });
  assert.ok(changes.slice(4).every(c => c === null), "left alone");
  assert.equal(auto.summary().history[0].kept, false);
  // Ten minutes later it is tried once more: still slow, so straight away
  const later = feed(auto, [20], 30, RETRY_MS + MIN);
  assert.deepEqual(later[0], { scale: 0.75, reason: "slow" });
});

test("a computer that has caught up tries the sharper step again, but not one that proved too slow recently", () => {
  const auto = new AutoLighting();
  auto.setScene("castle", "Castle");
  feed(auto, [0, 20, 20, 26], 30, 0); // 100% -> 75%, kept
  // At the cap for a while: 100% was too slow two minutes ago, so not yet
  assert.ok(feed(auto, [30, 30, 30, 30, 30, 30], 30, 2 * MIN).every(c => c === null));
  // Once that has passed, the next window at the cap tries it (it has been at the cap all along)
  const back = feed(auto, [30], 30, RETRY_MS + MIN);
  assert.deepEqual(back[0], { scale: 1, reason: "recovered" });
});

test("each scene keeps its own step", () => {
  const auto = new AutoLighting();
  auto.setScene("castle", "Castle");
  feed(auto, [0, 20, 20, 26], 30, 0);
  assert.equal(auto.setScene("village", "Village"), 1, "a new scene starts sharp");
  assert.equal(auto.setScene("castle", "Castle"), 0.75, "and an old one where it ended");
  assert.deepEqual(auto.summary().scenes, [{ name: "Castle", scale: 0.75 }, { name: "Village", scale: 1 }]);
  assert.equal(auto.addWindow(20, 0, 0), null, "no frame cap known: nothing to judge against");
});

test("the controller counts frames on the canvas, applies its steps, and stops cleanly", async () => {
  const env = installFoundry({ userId: "gm1", role: 4 });
  // A canvas whose frame rate depends on the lighting resolution: 25 fps at full, 50 fps lower
  let scale = 1;
  const listeners = new Set();
  Object.assign(env.ticker, { maxFPS: 60, add: fn => listeners.add(fn), remove: fn => listeners.delete(fn) });
  (function tick() {
    for ( const fn of listeners ) fn();
    setTimeout(tick, scale >= 1 ? 40 : 20).unref();
  })();
  Object.assign(canvas, { ready: true, scene: { id: "s1", name: "Interior" } });
  globalThis.document ??= {};
  const applied = [];
  let paused = false;
  const { startAutoLighting, stopAutoLighting, autoLightingSummary } = await import("../modules/performance-triage/scripts/auto-lighting.mjs");
  startAutoLighting({ apply: s => applied.push(scale = s), isPaused: () => paused, windowMs: 250 });
  assert.deepEqual(applied, [1], "the scene's step is applied at once");
  for ( let i = 0; (i < 80) && (applied.length < 2); i++ ) await new Promise(r => setTimeout(r, 25));
  assert.deepEqual(applied, [1, 0.75], "stepped down after two slow windows");
  assert.equal(env.notifications.filter(([type]) => type === "info").length, 1, "and said so once");
  // Kept: the next window is faster
  await new Promise(r => setTimeout(r, 600));
  assert.deepEqual(applied, [1, 0.75]);
  assert.equal(autoLightingSummary().history[0].kept, undefined);
  // While paused (idle throttle, a measurement), nothing is judged
  paused = true;
  scale = 1; // as if the frame rate dropped
  await new Promise(r => setTimeout(r, 800));
  assert.deepEqual(applied, [1, 0.75], "no change while paused");
  stopAutoLighting();
  assert.equal(listeners.size, 0, "the frame counter is removed");
  assert.equal(env.Hooks.events.canvasReady?.length ?? 0, 0, "and the scene listener");
  assert.equal(autoLightingSummary(), null);
});

test("when 50% isn't enough, a 25% step is tried and kept only if it helps", () => {
  const auto = new AutoLighting();
  auto.setScene("castle", "Castle");
  // Each step helps a little, and 50% still falls behind the cap
  const changes = feed(auto, [0, 12, 12, 16, 16, 16, 20, 20, 20, 26], 30, 0);
  assert.deepEqual(changes.filter(Boolean).map(c => c.scale), [0.75, 0.5, 0.25]);
  assert.equal(auto.scale, 0.25);
  assert.equal(auto.summary().history.at(-1).after, 26);
});

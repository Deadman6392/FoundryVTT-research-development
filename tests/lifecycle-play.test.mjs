/**
 * Render scale changes the PIXI options Foundry passes through canvasConfig, and frame rate tracking during play
 * starts and stops with the GM's world setting, counts frames per scene, charges long frames to token moves, and
 * leaves its summary in localStorage for the next load to share.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

const env = installFoundry({ userId: "gm1", role: 4 });
env.registerCoreSettings();

// A canvas ticker that runs its listeners like a 50 fps render loop
const listeners = new Set();
Object.assign(env.ticker, { add: fn => listeners.add(fn), remove: fn => listeners.delete(fn) });
(function tick() {
  for ( const fn of listeners ) fn();
  setTimeout(tick, 20).unref();
})();
Object.assign(canvas, { scene: { id: "s1", name: "Abbey" }, performance: { fps: 60 } });

const { telemetry } = await import("../modules/performance-triage/scripts/telemetry.mjs");
await import("../modules/performance-triage/scripts/main.mjs");
env.Hooks.callAll("init");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("render scale lowers the resolution the canvas is created with", async () => {
  await game.settings.set("performance-triage", "renderScale", 0.75);
  const config = { width: 1920, height: 1080, resolution: 2 };
  env.Hooks.callAll("canvasConfig", config);
  assert.equal(config.resolution, 1.5, "relative to the pixel ratio Foundry chose");
  assert.equal(game.modules.get("performance-triage").api.renderScale, 0.75, "the report can say it is on");
  const again = { resolution: 2 };
  env.Hooks.callAll("canvasConfig", again);
  assert.equal(again.resolution, 2, "the canvas is created once per page, so only the first call is changed");
});

test("frame rate tracking follows the world setting and measures scenes and token moves", async () => {
  const { startPlayTracker, stopPlayTracker, previousPlay } = await import("../modules/performance-triage/scripts/play-tracker.mjs");
  // Short windows so the test runs in about a second; the defaults are 5 s and 2 s
  const stats = startPlayTracker({ isThrottled: () => false, windowMs: 200, moveWindowMs: 300, graceMs: 50 });
  assert.equal(telemetry.play, stats);
  assert.equal(typeof telemetry.onPlayFrame, "function", "long frames the browser reports are passed on");
  assert.equal(env.Hooks.events.moveToken?.length, 1);

  await wait(450); // one unusable window (just started), then measured ones
  env.Hooks.callAll("moveToken", { parent: { id: "s1" } }, {}, {}, {});
  env.Hooks.callAll("moveToken", { parent: { id: "elsewhere" } }, {}, {}, {}); // another scene: not drawn here
  telemetry.onPlayFrame({ startTime: performance.now(), duration: 120,
    scripts: [{ sourceURL: "http://localhost:30000/modules/chris-premades/scripts/main.js", duration: 90 }] });
  await wait(600);

  const summary = stats.summary();
  assert.equal(summary.scenes[0].name, "Abbey");
  assert.ok(summary.scenes[0].fps > 30 && summary.scenes[0].fps < 60, `about 50 fps, got ${summary.scenes[0].fps}`);
  assert.equal(summary.scenes[0].target, 60);
  assert.equal(summary.moves?.count, 1, "the move on another scene isn't counted");
  assert.deepEqual(summary.moves.packages, [{ key: "module:chris-premades", ms: 90 }]);

  stopPlayTracker();
  assert.equal(telemetry.play, null);
  assert.equal(env.Hooks.events.moveToken?.length ?? 0, 0, "listeners are removed");
  assert.equal(listeners.size, 0, "the frame counter is removed from the ticker");
  const saved = JSON.parse(localStorage.getItem("performance-triage:play"));
  assert.equal(saved.scenes[0].name, "Abbey", "stopping saves this session's summary");
  assert.equal(previousPlay(), null, "this page's own summary isn't the previous session");
  // The next page load sees it as the previous session
  saved.page = -1;
  localStorage.setItem("performance-triage:play", JSON.stringify(saved));
  assert.equal(previousPlay().scenes[0].name, "Abbey");
});

test("turning the setting on starts tracking on this computer", async () => {
  await game.settings.set("performance-triage", "trackPlay", true);
  for ( let i = 0; (i < 50) && !telemetry.play; i++ ) await wait(10);
  assert.ok(telemetry.play, "started by the setting's onChange");
  await game.settings.set("performance-triage", "trackPlay", false);
  for ( let i = 0; (i < 50) && telemetry.play; i++ ) await wait(10);
  assert.equal(telemetry.play, null);
});

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
  let finishAnimation;
  const animation = new Promise(resolve => finishAnimation = resolve);
  assert.equal(telemetry.play, stats);
  assert.equal(typeof telemetry.onPlayFrame, "function", "long frames the browser reports are passed on");
  assert.equal(env.Hooks.events.moveToken?.length, 1);

  await wait(450); // one unusable window (just started), then measured ones
  env.Hooks.callAll("moveToken", { parent: { id: "s1" }, object: { movementAnimationPromise: animation } }, {}, {}, {});
  env.Hooks.callAll("moveToken", { parent: { id: "elsewhere" } }, {}, {}, {}); // another scene: not drawn here
  await wait(500); // the animation is still running, so the move's window is still open
  // Automation that waited for the animation runs after it: still charged to the move
  finishAnimation();
  telemetry.onPlayFrame({ startTime: performance.now(), duration: 120,
    scripts: [{ sourceURL: "http://localhost:30000/modules/chris-premades/scripts/main.js", duration: 90 }] });
  assert.equal(stats.summary().moves, null, "not closed while waiting");
  // The move closes on a check after its window and grace period; give a loaded machine's timers some slack
  for ( let i = 0; (i < 60) && !stats.summary().moves; i++ ) await wait(50);

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

test("lighting resolution lowers the lighting layers' filters, follows new scenes and restores Foundry's values", async () => {
  const api = game.modules.get("performance-triage").api;
  // Each canvas draw creates the layers' masking filters afresh; null means "the render target's resolution"
  // (PIXI's default is 1 whatever the canvas resolution)
  const drawEffects = () => ({ illumination: { filter: { resolution: null } }, coloration: { filter: { resolution: 1 } } });
  Object.assign(canvas, { ready: true, effects: drawEffects() });
  canvas.app.renderer.resolution = 0.75; // Render scale at 75%
  const listeners = () => env.Hooks.events.canvasReady?.length ?? 0;
  const before = listeners();

  await game.settings.set("performance-triage", "lightingScale", 0.5);
  assert.equal(api.lightingScale, 0.5);
  assert.equal(canvas.effects.illumination.filter.resolution, 0.375, "half of what the canvas draws at");
  assert.equal(canvas.effects.coloration.filter.resolution, 0.375, "of the canvas, not of PIXI's default");
  assert.equal(listeners(), before + 1, "one listener while it's on");

  canvas.effects = drawEffects(); // Another scene
  env.Hooks.callAll("canvasReady", canvas); // Also ends one-time startup listeners
  assert.equal(canvas.effects.illumination.filter.resolution, 0.375, "applied to the new scene's filters");
  const withOurs = listeners();

  await game.settings.set("performance-triage", "lightingScale", 1);
  assert.equal(canvas.effects.illumination.filter.resolution, null, "Foundry's own values are back");
  assert.equal(canvas.effects.coloration.filter.resolution, 1);
  assert.equal(listeners(), withOurs - 1, "and the listener is gone");

  // A canvas without these layers (another core version, or no canvas) is left alone
  canvas.effects = {};
  assert.deepEqual(api.setLightingScale(0.5), []);
});

test("Automatic lighting resolution runs its controller only while chosen", async () => {
  const api = game.modules.get("performance-triage").api;
  Object.assign(canvas, { ready: true, scene: { id: "s2", name: "Crypt" },
    effects: { illumination: { filter: { resolution: null } }, coloration: { filter: { resolution: null } } } });
  const listeners = () => env.Hooks.events.canvasReady?.length ?? 0;
  const before = listeners();
  await game.settings.set("performance-triage", "lightingScale", 0);
  for ( let i = 0; (i < 100) && !api.autoLightingSummary(); i++ ) await wait(10); // its code loads on demand
  assert.equal(api.lightingAuto, true);
  assert.deepEqual(api.autoLightingSummary().scenes, [{ name: "Crypt", scale: 1 }], "it starts sharp on the scene in view");
  assert.equal(listeners(), before + 1);
  assert.equal(canvas.effects.illumination.filter.resolution, null, "full resolution means Foundry's own value");

  await game.settings.set("performance-triage", "lightingScale", 0.75);
  assert.equal(api.lightingAuto, false);
  assert.equal(api.autoLightingSummary(), null, "stopped");
  assert.equal(canvas.effects.illumination.filter.resolution, 0.5625, "and the fixed choice applies");
  assert.equal(listeners(), before + 1, "one listener, the fixed choice's");
  await game.settings.set("performance-triage", "lightingScale", 1);
  assert.equal(listeners(), before);
});

test("long frames while the frame rate isn't the scene's own (a measurement, the idle throttle) aren't stutters", async () => {
  const { startPlayTracker, stopPlayTracker } = await import("../modules/performance-triage/scripts/play-tracker.mjs");
  let paused = true;
  const stats = startPlayTracker({ isThrottled: () => paused, windowMs: 100 });
  const longFrame = () => telemetry.onPlayFrame({ startTime: performance.now(), duration: 400, scripts: [] });
  longFrame();
  paused = false;
  longFrame();
  assert.equal(stats.current.stutters, 1, "only the one outside the measurement");
  stopPlayTracker();
});

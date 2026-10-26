/**
 * Runs the real module entry point through init -> setup -> ready against the Foundry mock, as a player the GM has
 * assigned the "low" profile, with Token Magic FX active. Each test file runs in its own process, so main.mjs
 * evaluates exactly once here. Tests in a file run in order and share this state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

const env = installFoundry({ userId: "player1", activeModules: ["tokenmagic", "sequencer"] });
const MODULE = "performance-triage";

// World state that exists before the client loads
env.settings.world.set(`${MODULE}.assignments`, { player1: "low" });
env.localStorage.setItem("core.maxFPS", "60");        // The player had explicitly saved 60
env.localStorage.setItem(`${MODULE}.shareSummary`, "false"); // Keep the test from waiting on FPS sampling

// The canvas ticker takes listeners (automatic lighting resolution counts frames on it)
Object.assign(env.ticker, { add() {}, remove() {} });

await import("../modules/performance-triage/scripts/main.mjs");
const api = () => game.modules.get(MODULE).api;
const flush = () => new Promise(r => setTimeout(r, 0));

test("init registers settings, resolves the assigned profile and lowers the chat batch size", () => {
  env.registerCoreSettings();
  env.Hooks.callAll("init");
  // Token Magic FX registers its own settings during its init
  env.settings.register("tokenmagic", "disableAnimations", { scope: "client", default: false, requiresReload: true });
  assert.equal(api().profileId, "low");
  assert.equal(CONFIG.ChatMessage.batchSize, 25);
  assert.ok(env.settings.menus.has(`${MODULE}.report`));
  assert.ok(env.settings.menus.has(`${MODULE}.profiles`));
});

test("setup writes profile values to client storage before the canvas exists", async () => {
  env.Hooks.callAll("setup");
  await flush();
  assert.equal(env.localStorage.getItem("core.performanceMode"), "0");
  assert.equal(env.localStorage.getItem("core.maxFPS"), "30");
  assert.equal(env.localStorage.getItem("core.pixelRatioResolutionScaling"), "false");
  assert.equal(env.localStorage.getItem("core.lightAnimation"), "false");
  assert.equal(env.localStorage.getItem("tokenmagic.disableAnimations"), "true");
  assert.equal(env.localStorage.getItem(`${MODULE}.lightingScale`), "0", "Lighting resolution on Automatic");
  assert.equal(game.settings.get("core", "maxFPS"), 30);

  const backup = game.settings.get(MODULE, "backup");
  assert.equal(backup["core.maxFPS"], "60", "the player's explicit value is backed up");
  assert.equal(backup["core.performanceMode"], null, "unset values are backed up as null");
  assert.equal(game.settings.get(MODULE, "appliedProfile"), "low");
});

test("ready prompts for a reload because a third-party setting needs one, and starts the idle throttle", async () => {
  game.user = { id: "player1", isGM: false, update: async () => {}, getFlag: () => null };
  env.Hooks.callAll("ready");
  await flush();
  assert.equal(env.dialogs.length, 1, "Token Magic FX reads disableAnimations at its own init");
  const idle = api().idle;
  assert.ok(idle, "idle throttle running");
  assert.equal(idle.idleFps, 10);
  assert.equal(idle.delaySeconds, 15);
});

test("the profile's Automatic lighting resolution takes effect on the load that applied it", async () => {
  // Setup wrote it to storage after init had read the old value; ready picks it up
  for ( let i = 0; (i < 100) && !api().autoLightingSummary(); i++ ) await new Promise(r => setTimeout(r, 10));
  assert.equal(api().lightingAuto, true);
  assert.ok(api().autoLightingSummary(), "its controller is running");
});

test("idle throttle lowers and restores the ticker frame cap", async () => {
  canvas.performance.fps = 30;
  env.ticker.maxFPS = 30;
  // Pretend the player has been inactive for a minute and let the 1 s check run
  const realNow = performance.now.bind(performance);
  const offset = 60_000;
  performance.now = () => realNow() + offset;
  try {
    await new Promise(r => setTimeout(r, 1100));
    assert.equal(env.ticker.maxFPS, 10);
    assert.equal(api().idle.throttled, true);
    env.window.dispatchEvent(new Event("pointermove"));
    assert.equal(env.ticker.maxFPS, 30, "any input restores Foundry's own frame cap immediately");
    assert.equal(api().idle.throttled, false);
  } finally {
    performance.now = realNow;
  }
});

test("idle throttle does not engage while a canvas animation is running", async () => {
  foundry.canvas.animation.CanvasAnimation.animations = { "Token.abc.animate": {} };
  const realNow = performance.now.bind(performance);
  performance.now = () => realNow() + 120_000;
  try {
    await new Promise(r => setTimeout(r, 1100));
    assert.equal(env.ticker.maxFPS, 30);
  } finally {
    performance.now = realNow;
    foundry.canvas.animation.CanvasAnimation.animations = {};
  }
});

test("changing the GM assignment asks the player to reload", async () => {
  await game.settings.set(MODULE, "assignments", { player1: "minimum" });
  await flush();
  assert.equal(env.dialogs.length, 2);
  assert.match(env.dialogs[1].content, /PTRIAGE\.Reload\.Assigned/);
});

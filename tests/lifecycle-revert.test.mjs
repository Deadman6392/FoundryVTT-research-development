/**
 * A client that previously ran the "minimum" profile loads after the GM removed the assignment.
 * Its own settings must come back exactly as they were, including keys that were never set.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

const env = installFoundry({ userId: "player2", activeModules: ["fxmaster", "sequencer"] });
const MODULE = "performance-triage";
const ls = env.localStorage;

// State left behind by the previous session on "minimum"
ls.setItem(`${MODULE}.appliedProfile`, JSON.stringify("minimum"));
ls.setItem(`${MODULE}.backup`, JSON.stringify({
  "core.maxFPS": "60",
  "core.performanceMode": null,
  "core.mipmap": null,
  "fxmaster.enable": "true",
  "sequencer.effectsEnabled": null
}));
ls.setItem(`${MODULE}.shareSummary`, "false");
ls.setItem("core.maxFPS", "20");
ls.setItem("core.performanceMode", "0");
ls.setItem("core.mipmap", "false");
ls.setItem("fxmaster.enable", "false");
ls.setItem("sequencer.effectsEnabled", "false");

await import("../modules/performance-triage/scripts/main.mjs");
const flush = () => new Promise(r => setTimeout(r, 0));

test("with no assignment the profile resolves to none and the chat batch size is untouched", () => {
  env.registerCoreSettings();
  env.Hooks.callAll("init");
  // FXMaster registers its settings in its own init; Sequencer has not registered yet at setup in this scenario
  env.settings.register("fxmaster", "enable", { scope: "client", default: true, requiresReload: true });
  assert.equal(game.modules.get(MODULE).api.profileId, "none");
  assert.equal(CONFIG.ChatMessage.batchSize, 100);
});

test("setup restores every backed-up value verbatim, registered or not", async () => {
  env.Hooks.callAll("setup");
  await flush();
  assert.equal(ls.getItem("core.maxFPS"), "60");
  assert.equal(ls.getItem("core.performanceMode"), null, "a value that was never set is removed again");
  assert.equal(ls.getItem("core.mipmap"), null);
  assert.equal(ls.getItem("fxmaster.enable"), "true");
  assert.equal(ls.getItem("sequencer.effectsEnabled"), null, "restoring raw storage does not need registration");
  assert.deepEqual(game.settings.get(MODULE, "backup"), {});
  assert.equal(game.settings.get(MODULE, "appliedProfile"), "none");
});

test("ready asks for a reload because FXMaster read its setting during init", async () => {
  game.user = { id: "player2", isGM: false, update: async () => {}, getFlag: () => null };
  env.Hooks.callAll("ready");
  await flush();
  assert.equal(env.dialogs.length, 1);
  assert.equal(game.modules.get(MODULE).api.idle, null, "no idle throttle without a profile");
});

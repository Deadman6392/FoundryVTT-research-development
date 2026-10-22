/**
 * With the profiler flag set, the module installs the hook profiler before other modules register hooks and
 * measures the world data right after init from a file it only loads in that case.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

const env = installFoundry({ userId: "gm1", role: 4 });
env.localStorage.setItem("performance-triage:hookProfiler", "1");
game.data.scenes = [{ _id: "s1", name: "Crypt", tokens: [{ _id: "t1", name: "Zombie", actorId: null, delta: { items: [] } }] }];
game.data.settings = [{ key: "performance-triage.profile", value: "\"low\"" }, { key: "removed-module.cache", value: "{}" }];

const { telemetry } = await import("../modules/performance-triage/scripts/telemetry.mjs");
await import("../modules/performance-triage/scripts/main.mjs");

test("measures the world data after init when profiling", async () => {
  assert.ok(telemetry.hookProfiler?.stats().installed, "profiler installed at script evaluation");
  env.registerCoreSettings();
  env.Hooks.callAll("init");
  // The measurement waits for its lazily imported file; give it a moment
  for ( let i = 0; (i < 50) && !telemetry.payload; i++ ) await new Promise(r => setTimeout(r, 10));
  assert.ok(telemetry.payload, "payload measured");
  assert.equal(telemetry.payload.detail.scenes.tokens.count, 1);
  assert.ok(Number.isFinite(telemetry.payload.ms));
  assert.deepEqual(telemetry.payload.detail.settings.unowned.packages.map(g => [g.key, g.state]), [["removed-module", "missing"]],
    "installed modules are read from game.modules");
});

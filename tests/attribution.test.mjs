import { test } from "node:test";
import assert from "node:assert/strict";
import { packageFromUrl, packageFromStack, isTextResource } from "../modules/performance-triage/scripts/lib/attribution.mjs";

const ORIGIN = "http://localhost:30000";

test("packageFromUrl classifies package, core, media and external URLs", () => {
  assert.equal(packageFromUrl(`${ORIGIN}/modules/midi-qol/dist/midi-qol.js`, ORIGIN), "module:midi-qol");
  assert.equal(packageFromUrl(`${ORIGIN}/systems/dnd5e/dnd5e.mjs?v=6.0.6`, ORIGIN), "system:dnd5e");
  assert.equal(packageFromUrl(`${ORIGIN}/worlds/my-campaign/assets/map.webp`, ORIGIN), "world:my-campaign");
  assert.equal(packageFromUrl(`${ORIGIN}/scripts/foundry.mjs`, ORIGIN), "core");
  assert.equal(packageFromUrl(`${ORIGIN}/tokens/goblin.png`, ORIGIN), "media");
  assert.equal(packageFromUrl("https://assets.forge-vtt.com/x/map.webp", ORIGIN), "external:assets.forge-vtt.com");
});

test("packageFromUrl tolerates a route prefix and encoded paths", () => {
  assert.equal(packageFromUrl(`${ORIGIN}/foundry/modules/lib-wrapper/src/index.js`, ORIGIN), "module:lib-wrapper");
  assert.equal(packageFromUrl(`${ORIGIN}/modules/my%20module/a.js`, ORIGIN), "module:my module");
});

test("packageFromStack skips our own frames and finds the caller (V8 format)", () => {
  const stack = [
    "Error",
    `    at Hooks.on (${ORIGIN}/modules/performance-triage/scripts/lib/hook-profiler.mjs:70:47)`,
    `    at Object.init (${ORIGIN}/modules/token-action-hud-core/scripts/main.js:12:9)`,
    `    at ${ORIGIN}/scripts/foundry.mjs:1:2`
  ].join("\n");
  assert.equal(packageFromStack(stack, "module:performance-triage", ORIGIN), "module:token-action-hud-core");
});

test("packageFromStack handles SpiderMonkey frames and self-only stacks", () => {
  const ff = `on@${ORIGIN}/modules/performance-triage/scripts/x.mjs:1:1\ninit@${ORIGIN}/modules/dae/dae.js:5:3`;
  assert.equal(packageFromStack(ff, "module:performance-triage", ORIGIN), "module:dae");
  const self = `on@${ORIGIN}/modules/performance-triage/scripts/x.mjs:1:1`;
  assert.equal(packageFromStack(self, "module:performance-triage", ORIGIN), "module:performance-triage");
  assert.equal(packageFromStack("", "module:performance-triage", ORIGIN), "unknown");
});

test("isTextResource recognizes compressible files", () => {
  assert.ok(isTextResource("/modules/x/a.mjs?v=1"));
  assert.ok(isTextResource("/modules/x/lang/en.json"));
  assert.ok(!isTextResource("/modules/x/art.webp"));
});

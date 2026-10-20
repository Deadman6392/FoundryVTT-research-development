/**
 * Runs the layer cost measurement against a mock canvas whose frame rate depends on what is visible, and checks
 * that the costs come out right and that every toggle, the frame cap and the idle throttle are restored afterwards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

const env = installFoundry({ userId: "gm1", role: 4 });
const display = (extra = {}) => ({ visible: true, filters: null, ...extra });

// Two tokens (one with a filter, like Token Magic FX), one tile, and the canvas groups
const filterA = [{ name: "glow" }];
const tokens = [0, 1].map(i => ({ ...display(), mesh: display(i === 0 ? { filters: filterA } : {}), renderFlags: { set() {} } }));
const tiles = [{ ...display(), mesh: display(), renderFlags: { set() {} } }];
const smaa = [{ name: "smaa" }];
Object.assign(canvas, {
  scene: { name: "Test" },
  tokens: { placeables: tokens },
  tiles: { placeables: tiles },
  stage: display(),
  rendered: display(),
  environment: display(),
  primary: display({ filters: smaa }),
  effects: display(),
  visibility: display({ visible: false }), // Already hidden (e.g. GM view): must be skipped, not "restored" to visible
  interface: display()
});
let perceptionUpdates = 0;
canvas.perception = { update: () => perceptionUpdates++ };

/** Frame time in ms: 20 ms base, plus 10 for token filters, 5 for tiles, 15 for screen filters. */
function frameTime() {
  let ms = 20;
  if ( tokens[0].mesh.filters && tokens[0].mesh.visible ) ms += 10;
  if ( tiles[0].mesh.visible ) ms += 5;
  if ( canvas.primary.filters ) ms += 15;
  if ( !canvas.primary.visible ) ms = 16.7;
  return ms;
}

// A ticker that calls its listeners at the rate the mock scene allows
const listeners = new Set();
Object.assign(env.ticker, {
  maxFPS: 30,
  add: fn => listeners.add(fn),
  remove: fn => listeners.delete(fn)
});
(function tick() {
  for ( const fn of listeners ) fn();
  setTimeout(tick, frameTime()).unref();
})();

await import("../modules/performance-triage/scripts/main.mjs");
env.registerCoreSettings();
env.Hooks.callAll("init");
let suspended = [];
game.modules.get("performance-triage").api.suspendIdle = s => suspended.push(s);

// Shorter windows than the real 2.5 s keep the suite fast while leaving ~30 frames per measurement
const FAST = { windowMs: 1500, settleMs: 100 };
const { measureFrameCost } = await import("../modules/performance-triage/scripts/frame-cost.mjs");

test("measures each layer and restores everything", { timeout: 60_000 }, async () => {
  const result = await measureFrameCost(FAST);
  const by = Object.fromEntries(result.rows.map(r => [r.id, r]));

  // Baseline 50 ms/frame (20 fps). Timer jitter makes exact numbers impossible, so check the ordering and ranges.
  assert.ok(result.baseline > 15 && result.baseline < 23, `baseline ${result.baseline}`);
  assert.ok(by.screenFilters.savedMs > by.tokenFilters.savedMs, "screen filters (15 ms) cost more than token filters (10 ms)");
  assert.ok(by.tokenFilters.savedMs > by.tiles.savedMs, "token filters (10 ms) cost more than tiles (5 ms)");
  assert.ok(by.tiles.savedMs > 2, `tiles ${by.tiles.savedMs}`);
  assert.equal(by.visibility, undefined, "an already hidden group is skipped");
  assert.equal(result.rows[0].id, "primary");

  // Everything is back the way it was
  assert.equal(tokens[0].mesh.filters, filterA);
  assert.equal(canvas.primary.filters, smaa);
  assert.ok(tokens.every(t => t.visible && t.mesh.visible));
  assert.ok(tiles[0].visible && tiles[0].mesh.visible);
  assert.equal(canvas.visibility.visible, false);
  assert.ok(canvas.primary.visible && canvas.interface.visible && canvas.effects.visible);
  assert.equal(env.ticker.maxFPS, 30, "frame cap restored");
  assert.deepEqual(suspended, [true, false], "idle throttle paused and resumed");
  assert.equal(perceptionUpdates, 1);
});

test("restores state even when an experiment throws", async () => {
  const brokenTile = tiles[0];
  // A getter that throws on the second read simulates a module object failing mid-measurement
  let reads = 0;
  Object.defineProperty(canvas, "effects", {
    configurable: true,
    get() {
      if ( ++reads === 1 ) throw new Error("boom");
      return display();
    }
  });
  await assert.rejects(measureFrameCost(FAST), /boom/);
  assert.ok(brokenTile.visible && brokenTile.mesh.visible);
  assert.equal(tokens[0].mesh.filters, filterA);
  assert.equal(env.ticker.maxFPS, 30);
  assert.deepEqual(suspended.slice(-2), [true, false]);
});

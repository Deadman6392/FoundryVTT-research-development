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
  // Lighting's parts (v13 EffectsCanvasGroup members); background and darkness are absent here and are skipped.
  // Each layer draws through a masking filter; two lights each have a mesh on both layers.
  effects: Object.assign(display(), {
    illumination: display({ filter: { resolution: null } }),
    coloration: display({ filter: { resolution: null } }),
    lightSources: [0, 1].map(() => ({ layers: { illumination: { mesh: display() }, coloration: { mesh: display() } } }))
  }),
  visibility: display({ visible: false }), // Already hidden (e.g. GM view): must be skipped, not "restored" to visible
  interface: Object.assign(display(), { children: [display({ options: { name: "grid" } })] })
});
// The frame time below reads these directly: a later test swaps canvas.effects for a getter that throws
const lighting = canvas.effects;
const ui = canvas.interface;
let perceptionUpdates = 0;
canvas.perception = { update: () => perceptionUpdates++ };

/**
 * Frame time in ms: 20 ms base, plus 10 for token filters, 5 for tiles, 15 for screen filters, 12 for illumination
 * (4 fixed, 8 per light) and 6 for light colours (2 fixed, 2 per light), and 1 for the grid. Lighting is costly
 * enough to break down; the interface isn't. A light's cost goes with the pixels its layer draws it at.
 */
const canvasResolution = 1;
canvas.app.renderer.resolution = canvasResolution;
function layerTime(layer, fixed, perLight) {
  if ( !lighting.visible || !lighting[layer].visible ) return 0;
  const scale = (lighting[layer].filter.resolution || canvasResolution) / canvasResolution;
  const lights = lighting.lightSources.filter(s => s.layers[layer].mesh.visible).length;
  return fixed + (perLight * lights * scale * scale);
}
function frameTime() {
  let ms = 20;
  if ( tokens[0].mesh.filters && tokens[0].mesh.visible ) ms += 10;
  if ( tiles[0].mesh.visible ) ms += 5;
  if ( canvas.primary.filters ) ms += 15;
  ms += layerTime("illumination", 4, 8) + layerTime("coloration", 2, 2);
  if ( ui.visible && ui.children[0].visible ) ms += 1;
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

  // Baseline 77 ms/frame (13 fps). Timer jitter makes exact numbers impossible, so check the ordering and ranges.
  assert.ok(result.baseline > 11 && result.baseline < 18, `baseline ${result.baseline}`);
  assert.ok(by.screenFilters.savedMs > by.tokenFilters.savedMs, "screen filters (15 ms) cost more than token filters (10 ms)");
  assert.ok(by.tokenFilters.savedMs > by.tiles.savedMs, "token filters (10 ms) cost more than tiles (5 ms)");
  assert.ok(by.tiles.savedMs > 2, `tiles ${by.tiles.savedMs}`);
  assert.equal(by.visibility, undefined, "an already hidden group is skipped");
  // Lighting cost more than 5 ms, so its parts were measured and listed under it, costliest first
  const effectsAt = result.rows.findIndex(r => r.id === "effects");
  const parts = result.rows.slice(effectsAt + 1).filter(r => r.parent === "effects");
  assert.deepEqual(parts.map(r => r.id).sort(), ["coloration", "illumination", "lightMeshes", "lightingHalf"]);
  assert.ok(by.illumination.savedMs > by.coloration.savedMs, "illumination (20 ms) costs more than colours (6 ms)");
  // Hiding the lights saves their 20 ms but not the layers' fixed 6 ms; half resolution saves three quarters of 20 ms.
  // Frame counts are whole numbers, so allow a few ms either way.
  assert.ok(by.lightMeshes.savedMs > 14 && by.lightMeshes.savedMs < by.effects.savedMs, `lights ${by.lightMeshes.savedMs}`);
  assert.ok(by.lightingHalf.savedMs > 9 && by.lightingHalf.savedMs < by.effects.savedMs, `half ${by.lightingHalf.savedMs}`);
  assert.equal(by.grid, undefined, "the interface cost too little to break down");
  assert.ok(canvas.effects.illumination.visible && canvas.effects.coloration.visible, "parts are restored");
  assert.ok(lighting.lightSources.every(s => s.layers.illumination.mesh.visible && s.layers.coloration.mesh.visible));
  assert.equal(lighting.illumination.filter.resolution, null, "Foundry's own filter resolution is restored");
  assert.equal(lighting.coloration.filter.resolution, null);
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

test("a part Foundry shows again while it is being counted isn't reported", { timeout: 30_000 }, async () => {
  // Lights whose meshes Foundry re-shows on every refresh: hiding them measures nothing
  const stubborn = () => ({ get visible() { return true; }, set visible(v) {} });
  Object.defineProperty(canvas, "effects", { configurable: true, writable: true, value: lighting });
  const saved = lighting.lightSources;
  lighting.lightSources = [{ layers: { illumination: { mesh: stubborn() }, coloration: { mesh: stubborn() } } }];
  try {
    const result = await measureFrameCost({ windowMs: 400, settleMs: 50 });
    assert.ok(result.rows.some(r => r.id === "illumination"), "lighting was broken down");
    assert.ok(!result.rows.some(r => r.id === "lightMeshes"), "no row for a hide that didn't hold");
  } finally {
    lighting.lightSources = saved;
  }
});

/**
 * Measure what each part of the canvas costs on this computer by hiding it briefly and counting frames.
 *
 * Browsers don't expose GPU timings, but when the canvas can't reach its frame cap the frame rate is set by how much
 * there is to draw, so hiding a layer and watching the frame rate rise is a direct measurement of that layer's cost.
 * Everything is a local, temporary visibility or filter change on this client: no documents or settings are touched,
 * and every change is undone even if something fails. Loaded on demand.
 */
import { MODULE_ID } from "./constants.mjs";
import { telemetry, countFps } from "./telemetry.mjs";
import { frameCostRows } from "./lib/frames.mjs";

const WINDOW_MS = 2500;
const SETTLE_MS = 500;
const wait = ms => new Promise(r => setTimeout(r, ms));

/** Hide display objects; returns an undo function, or null when there was nothing to hide. */
function hide(objects) {
  const saved = objects.filter(o => o && o.visible).map(o => [o, o.visible]);
  if ( !saved.length ) return null;
  for ( const [o] of saved ) o.visible = false;
  return () => {
    for ( const [o, v] of saved ) o.visible = v;
  };
}

/** Remove filters from display objects; returns an undo function, or null when none had filters. */
function stripFilters(objects) {
  const saved = objects.filter(o => o?.filters?.length).map(o => [o, o.filters]);
  if ( !saved.length ) return null;
  for ( const [o] of saved ) o.filters = null;
  return () => {
    for ( const [o, f] of saved ) o.filters = f;
  };
}

const tokenObjects = () => (canvas.tokens?.placeables ?? []).flatMap(t => [t, t.mesh]);
const tileObjects = () => (canvas.tiles?.placeables ?? []).flatMap(t => [t, t.mesh]);

const EXPERIMENTS = [
  { id: "tokenFilters", label: "Token filters (Token Magic FX and similar)", apply: () => stripFilters(tokenObjects()) },
  { id: "tokens", label: "Tokens", apply: () => hide(tokenObjects()) },
  { id: "tiles", label: "Tiles (floors, roofs, overlays)", apply: () => hide(tileObjects()) },
  { id: "effects", label: "Lighting and vision effects", apply: () => hide([canvas.effects]) },
  { id: "visibility", label: "Fog of war and vision masking", apply: () => hide([canvas.visibility]) },
  { id: "interface", label: "Interface (grid, token bars and names, borders, drawings, templates)", apply: () => hide([canvas.interface]) },
  {
    id: "screenFilters",
    label: "Full-screen filters (anti-aliasing, weather and other screen effects)",
    apply: () => stripFilters([canvas.stage, canvas.rendered, canvas.environment, canvas.primary, canvas.effects, canvas.interface])
  },
  { id: "primary", label: "Everything on the map (background, tiles, tokens)", apply: () => hide([canvas.primary]) }
];

/** Ask Foundry to recompute anything a toggle could have disturbed. */
function refreshCanvas() {
  try {
    for ( const p of [...(canvas.tokens?.placeables ?? []), ...(canvas.tiles?.placeables ?? [])] ) {
      p.renderFlags?.set({ refreshState: true });
    }
    canvas.perception?.update({ refreshVision: true, refreshLighting: true, refreshOcclusion: true });
  } catch(err) {
    console.warn(`${MODULE_ID} | Canvas refresh after measurement failed`, err);
  }
}

/**
 * Run the experiments. Takes about (experiments + 2) * 3 seconds with the default windows.
 * @param {object} [options]
 * @param {number} [options.windowMs]  How long to count frames for each measurement
 * @param {number} [options.settleMs]  How long to wait after each change before counting
 * @returns {Promise<object|null>}  null without a drawn canvas
 */
export async function measureFrameCost({ windowMs = WINDOW_MS, settleMs = SETTLE_MS } = {}) {
  if ( !canvas?.ready ) return null;
  const api = game.modules.get(MODULE_ID).api;
  const ticker = canvas.app.ticker;
  const previousCap = ticker.maxFPS;
  api.suspendIdle?.(true);
  ticker.maxFPS = 0; // Uncapped (the display's refresh rate still limits it)
  const rows = [];
  let baseline = null;
  let baselineEnd = null;
  try {
    await wait(settleMs);
    baseline = await countFps(windowMs);
    for ( const experiment of EXPERIMENTS ) {
      let undo = null;
      try {
        undo = experiment.apply();
        if ( !undo ) continue; // Nothing of this kind on the scene
        await wait(settleMs);
        rows.push({ id: experiment.id, label: experiment.label, fps: await countFps(windowMs) });
      } finally {
        undo?.();
      }
    }
    await wait(settleMs);
    baselineEnd = await countFps(windowMs);
  } finally {
    ticker.maxFPS = previousCap;
    api.suspendIdle?.(false);
    refreshCanvas();
  }
  const displayLimit = Math.max(60, ...rows.map(r => r.fps));
  return telemetry.frameCost = {
    measuredAt: new Date().toISOString(),
    scene: canvas.scene?.name ?? "",
    baseline,
    baselineEnd,
    // Results are only comparable if nothing else changed the load during the run
    stable: Math.abs(baselineEnd - baseline) <= Math.max(2, baseline * 0.15),
    rows: frameCostRows(baseline, rows, displayLimit)
  };
}

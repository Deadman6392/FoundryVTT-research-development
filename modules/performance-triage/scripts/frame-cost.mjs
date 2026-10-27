/**
 * Measure what each part of the canvas costs on this computer by hiding it briefly and timing how long a frame takes
 * to draw.
 *
 * Browsers don't expose GPU timings, but reading one pixel back from the canvas waits until the graphics card has
 * finished everything sent to it. So drawing the canvas once between two read-backs, and timing it, gives the full
 * cost of a frame (the CPU's part and the GPU's), whatever the frame cap or the screen's refresh rate. Counting
 * frames, as this did before 0.12, can't see anything on a computer that already keeps up with its screen.
 * Everything is a local, temporary visibility or filter change on this client: no documents or settings are touched,
 * and every change is undone even if something fails. Loaded on demand.
 */
import { MODULE_ID } from "./constants.mjs";
import { telemetry, countFps } from "./telemetry.mjs";
import { drawCostRows } from "./lib/frames.mjs";

const WINDOW_MS = 2500;
const SETTLE_MS = 500;
const SAMPLES = 9;
const wait = ms => new Promise(r => setTimeout(r, ms));

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/**
 * How far the median of these values could be off by chance: the standard error of a median, from the median absolute
 * deviation (1.4826 x MAD estimates the spread; a median's error is about 1.25 times the mean's). On the work PC a
 * part that can't cost anything measured as much as -4 ms; this says how big such noise is on that computer.
 */
function medianError(values) {
  const m = median(values);
  const spread = 1.4826 * median(values.map(v => Math.abs(v - m)));
  return (1.253 * spread) / Math.sqrt(values.length);
}

/**
 * Draw the canvas once between two pixel read-backs and return how long it took in ms. Application#render is PIXI
 * 7's single-frame draw (`renderer.render(stage)`), the one the ticker calls each frame.
 */
function timeDraw() {
  const app = canvas.app;
  const gl = app.renderer.gl;
  const pixel = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); // Whatever the ticker drew before isn't counted
  const start = performance.now();
  app.render();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return performance.now() - start;
}

/** The median of `samples` timed draws. The page gets a turn between them, so the canvas keeps running. */
async function drawMs(samples) {
  const times = [];
  for ( let i = 0; i < samples; i++ ) {
    times.push(timeDraw());
    await wait(0);
  }
  return median(times);
}

/**
 * Time drawing with a change and without it, in pairs, so that anything else speeding the computer up or slowing it
 * down during the test (another program, the graphics card's clock) affects both alike: a run on the work PC that
 * timed each part against one baseline showed two parts as costing minus 6 ms. The first pair warms up whatever the
 * change allocates and isn't counted.
 * @param {() => (Function|null)} apply  Makes the change and returns how to undo it, or null when there's nothing to do
 * @param {number} samples
 * @returns {Promise<{ms: number, savedMs: number}|null>}  null when there was nothing to change, or the change
 *   didn't hold (something else undid it while it was being timed)
 */
async function pairedDraws(apply, samples) {
  const changed = [];
  const saved = [];
  for ( let i = 0; i <= samples; i++ ) {
    const undo = apply();
    if ( !undo ) return null;
    let on;
    try {
      on = timeDraw();
      if ( undo.held?.() === false ) return null;
    } finally {
      undo();
    }
    const off = timeDraw();
    if ( i ) {
      changed.push(on);
      saved.push(off - on);
    }
    await wait(0);
  }
  return { ms: median(changed), savedMs: median(saved), noiseMs: medianError(saved) };
}

/**
 * Hide display objects; returns an undo function, or null when there was nothing to hide. The undo function's `held`
 * says whether most of them are still hidden: Foundry can show an object again during a refresh, and then the
 * measurement isn't of it being hidden.
 */
function hide(objects) {
  const saved = objects.filter(o => o && o.visible).map(o => [o, o.visible]);
  if ( !saved.length ) return null;
  for ( const [o] of saved ) o.visible = false;
  const undo = () => {
    for ( const [o, v] of saved ) o.visible = v;
  };
  undo.held = () => saved.filter(([o]) => !o.visible).length >= (saved.length / 2);
  return undo;
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

/**
 * When a part of the canvas costs at least this much per frame, or this share of the frame, its own parts are
 * measured too, so the report can say which knob matters. Below both, the extra seconds aren't worth spending.
 */
const BREAKDOWN_MS = 5;
const BREAKDOWN_SHARE = 0.2;

/**
 * Every mesh of a set of sources, with the lighting layers left in place. For lights, what this saves is the part of
 * lighting that grows with lights and the area they cover; the rest is each layer's fixed full-screen work. For vision,
 * it is what tokens' vision draws: a pass over everything each token sees, in its vision mode. Sources are
 * EffectsCanvasGroup#lightSources and #visionSources, and each layer's mesh is RenderedEffectSource#layers[id].mesh
 * (v13 and v14 API).
 */
function hideSourceMeshes(sources) {
  const meshes = [];
  for ( const source of sources ?? [] ) {
    for ( const layer of Object.values(source?.layers ?? {}) ) meshes.push(layer?.mesh);
  }
  return hide(meshes);
}

/** Lighting at half the resolution it is drawn at now, down to the lowest step (25%). */
function halveLighting() {
  const api = game.modules.get(MODULE_ID).api;
  const current = api.lightingScale ?? 1;
  if ( (current <= 0.25) || !api.setLightingScale ) return null;
  const changed = api.setLightingScale(Math.max(0.25, current / 2));
  if ( !changed.length ) return null;
  const undo = () => api.setLightingScale(current);
  undo.held = () => changed.every(c => canvas.effects?.[c.layer]?.filter?.resolution === c.resolution);
  return undo;
}

/**
 * The parts of the costlier experiments. Lighting's four layers are EffectsCanvasGroup members in the v13 and v14
 * API docs; interface layers are found by CanvasLayer#options.name (v13 docs), and any that aren't there are skipped.
 * A part either hides an object or applies a change of its own and returns how to undo it.
 */
const interfaceLayer = name => () => (canvas.interface?.children ?? []).find(c => c?.options?.name === name);
const PARTS = {
  effects: [
    { id: "illumination", label: "Lighting: how brightly lights illuminate the map", object: () => canvas.effects?.illumination },
    { id: "coloration", label: "Lighting: light colours", object: () => canvas.effects?.coloration },
    { id: "background", label: "Lighting and vision: the map redrawn under lights and through tokens' vision",
      object: () => canvas.effects?.background },
    { id: "darkness", label: "Lighting: darkness sources", object: () => canvas.effects?.darkness },
    { id: "lightMeshes", label: "Lighting: the lights themselves (every light hidden, layers kept)",
      apply: () => hideSourceMeshes(canvas.effects?.lightSources) },
    { id: "visionMeshes", label: "Vision: what tokens' vision draws (every vision source hidden, layers kept)",
      apply: () => hideSourceMeshes(canvas.effects?.visionSources) },
    { id: "lightingHalf", label: "Lighting drawn at half its current resolution (nothing hidden)", apply: halveLighting }
  ],
  interface: [
    { id: "grid", label: "Interface: grid", object: interfaceLayer("grid") },
    { id: "drawings", label: "Interface: drawings", object: interfaceLayer("drawings") },
    { id: "templates", label: "Interface: measured templates", object: interfaceLayer("templates") },
    { id: "regions", label: "Interface: regions", object: interfaceLayer("regions") },
    { id: "notes", label: "Interface: map notes", object: interfaceLayer("notes") },
    { id: "tokenInterface", label: "Interface: token bars, names, borders and effect icons", object: interfaceLayer("tokens") }
  ]
};

/**
 * What was on screen: the zoom (Canvas#stage is the PIXI container Foundry scales to zoom) and the tokens whose vision
 * was being drawn (PointVisionSource#visionMode, v13 and v14 API). Lighting costs more zoomed in, and each vision source
 * draws its own pass, so two measurements are only comparable with these alongside.
 */
function viewNow() {
  const vision = [];
  for ( const source of canvas.effects?.visionSources ?? [] ) {
    if ( !source?.active ) continue;
    vision.push({ name: source.object?.document?.name ?? "", mode: source.visionMode?.id ?? source.data?.visionMode ?? "" });
  }
  const zoom = canvas.stage?.scale?.x;
  return { zoom: Number.isFinite(zoom) ? Math.round(zoom * 100) / 100 : null, vision };
}

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
 * Run the experiments: the frame rate before and after, and the time to draw a frame with each part hidden.
 * @param {object} [options]
 * @param {number} [options.windowMs]  How long to count frames for the frame rate before and after
 * @param {number} [options.settleMs]  How long to let the canvas settle before counting frames or timing the baseline
 * @param {number} [options.samples]   Frames drawn and timed for each measurement
 * @returns {Promise<object|null>}  null without a drawn canvas
 */
export async function measureFrameCost({ windowMs = WINDOW_MS, settleMs = SETTLE_MS, samples = SAMPLES } = {}) {
  if ( !canvas?.ready || !canvas.app?.renderer?.gl ) return null;
  const api = game.modules.get(MODULE_ID).api;
  const ticker = canvas.app.ticker;
  const previousCap = ticker.maxFPS;
  // The frame rate is counted uncapped (the screen's refresh rate still limits it), to show the headroom
  const fpsUncapped = async () => {
    ticker.maxFPS = 0;
    try {
      await wait(settleMs);
      return await countFps(windowMs);
    } finally {
      ticker.maxFPS = previousCap;
    }
  };
  api.suspendIdle?.(true);
  const rows = [];
  let baseline = null;
  let baselineEnd = null;
  let baseMs = null;
  let baseMsEnd = null;
  try {
    baseline = await fpsUncapped();
    await wait(settleMs);
    baseMs = await drawMs(samples);
    const measure = async (id, label, apply, parent) => {
      const result = await pairedDraws(apply, samples);
      if ( result ) rows.push({ id, label, ...result, ...(parent ? { parent } : {}) });
    };
    for ( const experiment of EXPERIMENTS ) await measure(experiment.id, experiment.label, experiment.apply);
    // Break down the parts that cost the most, so the report can say which knob to turn
    for ( const [parent, parts] of Object.entries(PARTS) ) {
      const saved = rows.find(r => r.id === parent)?.savedMs ?? 0;
      if ( (saved < BREAKDOWN_MS) && (saved < baseMs * BREAKDOWN_SHARE) ) continue;
      for ( const part of parts ) await measure(part.id, part.label, part.apply ?? (() => hide([part.object()])), parent);
    }
    await wait(settleMs);
    baseMsEnd = await drawMs(samples);
    baselineEnd = await fpsUncapped();
  } finally {
    ticker.maxFPS = previousCap;
    api.suspendIdle?.(false);
    refreshCanvas();
  }
  const round = v => Math.round(v * 10) / 10;
  return telemetry.frameCost = {
    measuredAt: new Date().toISOString(),
    scene: canvas.scene?.name ?? "",
    view: viewNow(),
    baseline,
    baselineEnd,
    baseMs: round(baseMs),
    baseMsEnd: round(baseMsEnd),
    // Results are only comparable if nothing else changed the load during the run
    stable: Math.abs(baseMsEnd - baseMs) <= Math.max(0.5, baseMs * 0.15),
    rows: drawCostRows(baseMs, rows)
  };
}

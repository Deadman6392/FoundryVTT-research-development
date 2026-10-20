/**
 * Always-on, low-overhead measurements started as soon as this module's script evaluates.
 *
 * Costs: two PerformanceObservers that only fire when the browser already produced an entry (a resource finished
 * loading, or a frame took longer than 50 ms), plus one tiny listener per startup hook. Entries are folded into
 * aggregates immediately and not retained. The hook profiler and payload measurement only run when opted in.
 */
import { SELF_KEY, STORAGE_KEYS } from "./constants.mjs";
import { ResourceAggregator, LongFrameAggregator, measurePayload } from "./lib/aggregate.mjs";
import { createHookProfiler } from "./lib/hook-profiler.mjs";

export const telemetry = {
  marks: {},
  resources: { load: null, play: null },
  longFrames: { supported: false, load: null, play: null },
  hookProfiler: null,
  payload: null,
  fps: null,
  sampler: null,
  prep: null
};

const PHASES = ["init", "i18nInit", "setup", "canvasInit", "canvasReady", "ready"];

export function readStorageFlag(key) {
  try {
    return globalThis.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeStorageFlag(key, enabled) {
  try {
    if ( enabled ) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch(err) {
    console.warn("performance-triage | Could not write to localStorage", err);
  }
}

function mark(name) {
  telemetry.marks[name] ??= performance.now();
}

export function bootstrap() {
  mark("scriptEval");
  const origin = globalThis.location?.origin;

  // Install first so our own listeners below are profiled too; our overhead should be visible in our own report
  if ( readStorageFlag(STORAGE_KEYS.hookProfiler) ) {
    telemetry.hookProfiler = createHookProfiler({ hooks: Hooks, selfKey: SELF_KEY, origin });
    telemetry.hookProfiler.install();
    Hooks.once("init", () => {
      telemetry.payload = measurePayload(game.data);
    });
  }

  observeResources(origin);
  observeLongFrames(origin);
  for ( const phase of PHASES ) Hooks.once(phase, () => mark(phase));
}

function observe(type, onEntry) {
  if ( !globalThis.PerformanceObserver?.supportedEntryTypes?.includes(type) ) return false;
  try {
    const observer = new PerformanceObserver(list => {
      for ( const entry of list.getEntries() ) onEntry(entry);
    });
    observer.observe({ type, buffered: true });
    return true;
  } catch(err) {
    console.warn(`performance-triage | Could not observe ${type} entries`, err);
    return false;
  }
}

function observeResources(origin) {
  const load = telemetry.resources.load = new ResourceAggregator(origin);
  const play = telemetry.resources.play = new ResourceAggregator(origin);
  observe("resource", e => {
    const ready = telemetry.marks.ready;
    ((ready === undefined) || (e.startTime <= ready) ? load : play).add(e);
  });
}

function observeLongFrames(origin) {
  const load = new LongFrameAggregator(origin);
  const play = new LongFrameAggregator(origin);
  telemetry.longFrames.supported = observe("long-animation-frame", e => {
    const ready = telemetry.marks.ready;
    if ( (ready === undefined) || (e.startTime <= ready) ) load.add(e, "load");
    else play.add(e, "play");
  });
  telemetry.longFrames.load = load;
  telemetry.longFrames.play = play;
}

/** GPU and WebGL limits of this client, or an empty object when the canvas is not running. */
export function rendererInfo() {
  const gl = globalThis.canvas?.app?.renderer?.gl;
  if ( !gl ) return {};
  let gpu = "";
  try {
    gpu = foundry.applications.sidebar.apps.SupportDetails.getWebGLRendererInfo(gl);
  } catch {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  }
  return {
    gpu: String(gpu ?? "").slice(0, 120),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    webgl2: (typeof WebGL2RenderingContext !== "undefined") && (gl instanceof WebGL2RenderingContext)
  };
}

/**
 * Sample the canvas frame rate for a short window after startup, skipping samples while the tab is hidden,
 * unfocused or throttled by the idle controller, so the number reflects what the player actually sees.
 * @param {() => boolean} isThrottled
 * @returns {Promise<{target: number, achieved: number, samples: number}|null>}
 */
export function sampleFps(isThrottled, { seconds = 60, every = 5 } = {}) {
  return new Promise(resolve => {
    const values = [];
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += every;
      const ticker = globalThis.canvas?.ready ? canvas.app?.ticker : null;
      if ( ticker && !document.hidden && document.hasFocus() && !isThrottled() ) values.push(ticker.FPS);
      if ( elapsed < seconds ) return;
      clearInterval(timer);
      if ( !values.length ) return resolve(null);
      const target = canvas.performance?.fps || 60;
      const achieved = values.reduce((a, b) => a + b, 0) / values.length;
      resolve(telemetry.fps = { target, achieved: Math.round(achieved * 10) / 10, samples: values.length });
    }, every * 1000);
  });
}

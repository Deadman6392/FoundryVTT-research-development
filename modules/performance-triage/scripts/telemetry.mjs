/**
 * Always-on, low-overhead measurements started as soon as this module's script evaluates.
 *
 * Costs: two PerformanceObservers that only fire when the browser already produced an entry (a resource finished
 * loading, or a frame took longer than 50 ms), plus one tiny listener per startup hook. Entries are folded into
 * aggregates immediately and not retained. The hook profiler and payload measurement only run when opted in.
 */
import { SELF_KEY, STORAGE_KEYS } from "./constants.mjs";
import { ResourceAggregator, LongFrameAggregator } from "./lib/aggregate.mjs";
import { createHookProfiler } from "./lib/hook-profiler.mjs";

export const telemetry = {
  marks: {},
  resources: { load: null, play: null, truncated: false },
  longFrames: { supported: false, load: null, play: null },
  hookProfiler: null,
  payload: null,
  fps: null,
  sampler: null,
  prep: null,
  frameCost: null
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
    // Only needed while profiling, so it is fetched here instead of on every load. Scripts finish seconds before
    // the world data arrives, so the file is in long before init and the measurement runs right after the init
    // hook, before setup builds the world from game.data. Timed so the report can state its cost.
    const payload = import("./lib/payload.mjs");
    Hooks.once("init", () => {
      payload.then(({ measurePayload }) => {
        const t0 = performance.now();
        telemetry.payload = measurePayload(game.data);
        telemetry.payload.ms = Math.round(performance.now() - t0);
      }).catch(err => console.warn("performance-triage | Could not measure the world data", err));
    });
  }

  observeResources(origin);
  observeLongFrames(origin);
  for ( const phase of PHASES ) Hooks.once(phase, () => mark(phase));

  // Our ready listener runs early, so the "ready" mark is when the hook started. This timeout runs once the whole
  // task finishes: every other module's ready handler and anything else done synchronously after it.
  Hooks.once("ready", () => setTimeout(() => mark("readyComplete"), 0));
}

/** Browsers keep at most this many resource entries until a script asks for more. */
const DEFAULT_RESOURCE_BUFFER = 250;

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
  // If the buffer filled before this module ran, entries for the earliest files (stylesheets, early scripts) are gone
  const buffered = performance.getEntriesByType?.("resource")?.length ?? 0;
  telemetry.resources.truncated = buffered >= DEFAULT_RESOURCE_BUFFER;
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
 * Count frames the canvas actually renders over a short window. Ticker callbacks only run on frames that render,
 * so this reflects what the player sees, including any frame cap.
 * @param {number} ms
 * @returns {Promise<number|null>}  Frames per second, or null without a drawn canvas
 */
export function countFps(ms) {
  const ticker = globalThis.canvas?.ready ? canvas.app?.ticker : null;
  if ( typeof ticker?.add !== "function" ) return Promise.resolve(null);
  return new Promise(resolve => {
    let frames = 0;
    const count = () => frames++;
    const start = performance.now();
    ticker.add(count);
    setTimeout(() => {
      ticker.remove(count);
      resolve(Math.round((frames * 10000) / (performance.now() - start)) / 10);
    }, ms);
  });
}

/**
 * Sample the canvas frame rate for a short window after startup, skipping intervals in which the tab was hidden,
 * unfocused or throttled by the idle controller, so the number reflects what the player actually sees. The throttle
 * is checked on every frame and the tab's visibility on every change, since either can start and end inside one
 * interval and pull the average down.
 *
 * Frames are counted rather than read from `ticker.FPS`: PIXI 7's Ticker#update sets `elapsedMS` before it checks
 * the frame cap and returns early, so under a cap below the display rate `FPS` mostly reports skipped frames. A
 * 30 fps cap on a 144 Hz screen read as 63 fps that way. Cost: one increment per rendered frame for `seconds`.
 * @param {() => boolean} isThrottled
 * @returns {Promise<{target: number, achieved: number, samples: number}|null>}
 */
export function sampleFps(isThrottled, { seconds = 60, every = 5 } = {}) {
  return new Promise(resolve => {
    const values = [];
    let elapsed = 0;
    let frames = 0;
    let throttledFrame = false;
    let ticker = null;
    const count = () => {
      frames++;
      if ( isThrottled() ) throttledFrame = true;
    };
    const onVisibility = () => throttledFrame = true;
    document.addEventListener?.("visibilitychange", onVisibility);
    const currentTicker = () => {
      const t = globalThis.canvas?.ready ? canvas.app?.ticker : null;
      return (typeof t?.add === "function") ? t : null;
    };
    const usable = () => !document.hidden && document.hasFocus() && !isThrottled();
    // Attach to whichever ticker is live (none while the canvas is torn down between scenes); an interval only
    // counts if it ran on one ticker and was usable at both ends
    const attach = () => {
      const t = currentTicker();
      if ( t === ticker ) return false;
      ticker?.remove(count);
      ticker = t;
      ticker?.add(count);
      return true;
    };
    attach();
    let since = performance.now();
    let wasUsable = usable();
    const timer = setInterval(() => {
      elapsed += every;
      const now = performance.now();
      const isUsable = usable();
      const switched = attach();
      if ( ticker && !switched && wasUsable && isUsable && !throttledFrame ) values.push((frames * 1000) / (now - since));
      frames = 0;
      throttledFrame = false;
      since = now;
      wasUsable = isUsable;
      if ( elapsed < seconds ) return;
      clearInterval(timer);
      ticker?.remove(count);
      document.removeEventListener?.("visibilitychange", onVisibility);
      if ( !values.length ) return resolve(null);
      const target = canvas.performance?.fps || 60;
      const achieved = values.reduce((a, b) => a + b, 0) / values.length;
      resolve(telemetry.fps = { target, achieved: Math.round(achieved * 10) / 10, samples: values.length });
    }, every * 1000);
  });
}

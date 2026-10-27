/**
 * Ambient motion: one timer, once a second, writes the step the stylesheet's motion rules read. Loaded only when a
 * player turns motion on.
 *
 * The timer stops while the page is hidden and never starts for players whose system asks for reduced motion. Between
 * ticks the browser has nothing to do; each tick restyles two elements (the custom properties are registered as
 * non-inherited) and repaints the sidebar panel and the active tab.
 */
import { DRIFT_LOOP_SECONDS } from "./lib/stylesheet.mjs";

/** Glow size (0-1) at each second, per theme glow style. */
export const GLOW_LEVELS = {
  breathe: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1, 0.9, 0.75, 0.6, 0.45, 0.3, 0.15],
  pulse: [0.1, 0.55, 1, 0.55],
  flicker: [0.45, 0.8, 0.25, 0.9, 0.5, 1, 0.3, 0.7, 0.55, 0.85]
};

const STEP_MS = 1000;

const state = {
  /** The glow style while motion is wanted, null while it isn't. */
  style: null,
  timer: null,
  step: 0,
  reduced: null
};

function tick() {
  state.step = (state.step + 1) % DRIFT_LOOP_SECONDS;
  document.getElementById("sidebar-content")?.style.setProperty("--fxr-step", String(state.step));
  const levels = GLOW_LEVELS[state.style] ?? GLOW_LEVELS.breathe;
  const active = document.querySelector("#sidebar-tabs [aria-pressed=\"true\"], #sidebar-tabs .ui-control.active");
  active?.style.setProperty("--fxr-glow-level", String(levels[state.step % levels.length]));
}

function run() {
  const wanted = state.style && !document.hidden && !state.reduced?.matches;
  if ( wanted && !state.timer ) state.timer = setInterval(tick, STEP_MS);
  else if ( !wanted && state.timer ) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

/**
 * Start motion for a theme's glow style, or switch style if it is already running.
 * @param {string} style   A key of GLOW_LEVELS
 */
export function start(style) {
  if ( !state.reduced ) {
    state.reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    state.reduced?.addEventListener?.("change", run);
    document.addEventListener("visibilitychange", run);
  }
  state.style = style;
  run();
}

/** Stop motion; the stylesheet without motion rules ignores whatever step was last written. */
export function stop() {
  state.style = null;
  run();
}

/** Whether the timer is running, for tests and the module API. */
export function running() {
  return Boolean(state.timer);
}

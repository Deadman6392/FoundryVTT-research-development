/**
 * Frame rate and stutters during play, per scene, and the work that follows each token move. Runs on every computer
 * while the GM has "Measure frame rate during play" on. Nothing here writes to the world: results stay in memory for
 * the report, and a summary is saved to this browser's localStorage when the page is hidden or closed, so the next
 * load can share it with the GM inside the summary it already sends once per session.
 *
 * Cost while on: one increment per rendered frame, a check every 5 seconds, a moveToken listener, two short timers per
 * token move, and folding in the long frames the browser already reports.
 */
import { MODULE_ID, STORAGE_KEYS } from "./constants.mjs";
import { telemetry } from "./telemetry.mjs";
import { PlayStats, MOVE_WINDOW_MS } from "./lib/play-stats.mjs";

const WINDOW_MS = 5000;

let tracker = null;

/** The canvas ticker while a scene is drawn, or null. */
function liveTicker() {
  const t = globalThis.canvas?.ready ? canvas.app?.ticker : null;
  return (typeof t?.add === "function") ? t : null;
}

/** The frame cap Foundry wants right now; 0 means uncapped. */
function targetFps() {
  return canvas?.performance?.fps ?? game.settings.get("core", "maxFPS") ?? 0;
}

/**
 * @param {object} options
 * @param {() => boolean} options.isThrottled  Whether the idle throttle has lowered the frame cap
 * @param {number} [options.windowMs]          Length of each measured stretch
 * @param {number} [options.moveWindowMs]      How long after a token move its effects are counted
 * @param {number} [options.graceMs]           Extra wait for long frame entries after a move's window
 */
export function startPlayTracker({ isThrottled, windowMs = WINDOW_MS, moveWindowMs = MOVE_WINDOW_MS, graceMs = 500 }) {
  if ( tracker ) return tracker.stats;
  const stats = new PlayStats({ origin: globalThis.location?.origin, moveWindowMs, graceMs });
  let ticker = null;
  let frames = 0;
  let dirty = true; // this window can't be used: a throttled frame, a visibility change, or a scene change
  let windowStart = performance.now();
  let windowFrames = 0;
  const count = () => {
    frames++;
    if ( isThrottled() ) dirty = true;
  };
  const attach = () => {
    const t = liveTicker();
    if ( t === ticker ) return;
    ticker?.remove(count);
    ticker = t;
    ticker?.add(count);
  };
  const onScene = () => {
    attach();
    stats.setScene(canvas.scene?.id, canvas.scene?.name);
    dirty = true;
  };
  const onVisibility = () => {
    dirty = true;
    if ( document.hidden ) save();
  };
  const timer = setInterval(() => {
    const now = performance.now();
    attach();
    if ( ticker && !dirty && !document.hidden && document.hasFocus() ) {
      stats.addWindow(frames - windowFrames, now - windowStart, targetFps());
    }
    windowStart = now;
    windowFrames = frames;
    dirty = false;
    stats.closeMoves(now);
  }, windowMs);
  const onMove = token => {
    if ( !ticker || (token?.parent?.id !== canvas.scene?.id) ) return;
    const move = stats.addMove(performance.now(), frames);
    if ( !move ) return;
    setTimeout(() => stats.endMove(move, performance.now(), frames), moveWindowMs);
  };
  // This session's summary replaces itself on each save; an earlier session's is kept alongside it, so hiding the
  // tab early in a session can't lose the previous one before it is shared
  const save = () => {
    const summary = stats.summary();
    if ( !summary.scenes.length && !summary.moves ) return;
    try {
      const saved = readSaved();
      const previous = (saved && (saved.page !== performance.timeOrigin)) ? saved : saved?.previous;
      localStorage.setItem(STORAGE_KEYS.play, JSON.stringify({
        at: Date.now(), page: performance.timeOrigin, user: game.user?.name ?? null, ...summary,
        previous: previous ? { ...previous, previous: undefined } : undefined
      }));
    } catch(err) {
      console.warn(`${MODULE_ID} | Could not save the play summary`, err);
    }
  };

  const hooks = [["canvasReady", Hooks.on("canvasReady", onScene)], ["moveToken", Hooks.on("moveToken", onMove)]];
  document.addEventListener("visibilitychange", onVisibility);
  globalThis.addEventListener?.("pagehide", save);
  telemetry.onPlayFrame = e => stats.addLongFrame(e);
  if ( canvas?.ready ) onScene();

  tracker = {
    stats,
    stop() {
      save();
      clearInterval(timer);
      ticker?.remove(count);
      for ( const [hook, id] of hooks ) Hooks.off(hook, id);
      document.removeEventListener("visibilitychange", onVisibility);
      globalThis.removeEventListener?.("pagehide", save);
      telemetry.onPlayFrame = null;
      telemetry.play = null;
      tracker = null;
    }
  };
  telemetry.play = stats;
  return stats;
}

export function stopPlayTracker() {
  tracker?.stop();
}

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.play) ?? "null");
  } catch {
    return null;
  }
}

/** The summary saved by the most recent earlier page load in this browser, or null. */
export function previousPlay() {
  const saved = readSaved();
  if ( !saved ) return null;
  const previous = (saved.page !== performance.timeOrigin) ? saved : saved.previous;
  if ( !previous ) return null;
  const { previous: _, ...rest } = previous;
  return rest;
}

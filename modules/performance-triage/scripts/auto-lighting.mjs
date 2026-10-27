/**
 * Runs automatic lighting resolution on this computer. Loaded only while the Lighting resolution setting is on
 * Automatic. Cost while on: a timestamp and an increment per rendered frame, a check every 3 seconds, and a
 * canvasReady listener.
 */
import { AutoLighting, WINDOW_MS } from "./lib/auto-lighting.mjs";

let running = null;

/**
 * @param {object} options
 * @param {(scale: number) => void} options.apply   Set the lighting resolution on the current canvas
 * @param {() => boolean} options.isPaused          True while the frame rate isn't the scene's own (idle throttle, a
 *                                                  measurement running)
 * @param {number} [options.windowMs]               How often to judge the frame rate
 * @returns {AutoLighting}
 */
export function startAutoLighting({ apply, isPaused, windowMs = WINDOW_MS }) {
  stopAutoLighting();
  const auto = new AutoLighting();
  let frames = 0;
  let windowStart = performance.now();
  let lastFrame = 0;
  let longestFrame = 0;
  let ticker = null;
  let notified = false;
  // The longest gap between frames shows a stall in the window; one subtraction and comparison per frame
  const count = () => {
    const now = performance.now();
    if ( lastFrame && ((now - lastFrame) > longestFrame) ) longestFrame = now - lastFrame;
    lastFrame = now;
    frames++;
  };

  const onScene = () => {
    ticker?.remove(count);
    ticker = canvas.app?.ticker ?? null;
    ticker?.add(count);
    frames = 0;
    windowStart = performance.now();
    lastFrame = longestFrame = 0;
    if ( !canvas.scene ) return;
    apply(auto.setScene(canvas.scene.id, canvas.scene.name));
  };

  const check = () => {
    const now = performance.now();
    const ms = now - windowStart;
    const counted = frames;
    // A freeze still going on at the check counts too
    const longest = Math.max(longestFrame, lastFrame ? now - lastFrame : 0);
    frames = 0;
    longestFrame = 0;
    windowStart = now;
    // Hidden tabs don't draw, and a throttled or measured canvas isn't running at the scene's own pace
    if ( !canvas?.ready || document.hidden || isPaused() || !(ms > 0) ) return;
    const target = canvas.app.ticker.maxFPS || 60;
    const change = auto.addWindow((counted * 1000) / ms, target, now, longest);
    if ( !change ) return;
    apply(change.scale);
    // Once a session, so whoever is at this computer knows why lights look softer; the report lists every step
    if ( (change.reason === "slow") && !notified ) {
      notified = true;
      ui.notifications?.info(game.i18n.format("PTRIAGE.Notify.LightingLowered", { scale: Math.round(change.scale * 100) }));
    }
  };

  const hook = Hooks.on("canvasReady", onScene);
  const timer = setInterval(check, windowMs);
  running = { auto, stop: () => {
    Hooks.off("canvasReady", hook);
    clearInterval(timer);
    ticker?.remove(count);
  } };
  if ( globalThis.canvas?.ready ) onScene();
  return auto;
}

/** Stop and forget; the caller restores whatever lighting resolution it wants. */
export function stopAutoLighting() {
  running?.stop();
  running = null;
}

/** The controller's state for the report, or null when it isn't running. */
export function autoLightingSummary() {
  return running ? running.auto.summary() : null;
}

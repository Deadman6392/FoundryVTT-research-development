/**
 * Idle frame-rate throttle.
 *
 * Foundry's canvas re-renders at the configured frame rate even when nothing on screen changes. While a player is
 * reading a sheet, talking, or has another window focused, that is wasted GPU/CPU time and heat on a weak laptop.
 * This lowers the canvas ticker's frame cap after a period with no input and no canvas activity, and restores it
 * the moment the player moves the mouse, presses a key, or something on the scene changes.
 *
 * Cost while running: one passive input listener that stores a timestamp, a handful of cheap hook listeners, and a
 * one-second interval check.
 */

const WAKE_HOOKS = [
  "canvasReady", "canvasPan", "updateToken", "createToken", "deleteToken", "controlToken", "targetToken",
  "updateTile", "updateAmbientLight", "updateWall", "updateScene", "updateCombat", "createChatMessage", "pauseGame"
];
const INPUT_EVENTS = ["pointermove", "pointerdown", "wheel", "keydown"];
const BLUR_GRACE_MS = 2000;

export class IdleThrottle {
  constructor({ fps, delay, onBlur }) {
    this.idleFps = Math.max(10, fps); // PIXI clamps maxFPS to the ticker's minFPS (10) anyway
    this.delayMs = delay * 1000;
    this.onBlur = onBlur;
    this.throttled = false;
    this.lastActivity = performance.now();
    this.hookIds = [];
    this.timer = null;
    this.wake = this.wake.bind(this);
    this.onVisibility = () => { if ( !document.hidden ) this.wake(); };
  }

  start() {
    for ( const type of INPUT_EVENTS ) window.addEventListener(type, this.wake, { passive: true, capture: true });
    window.addEventListener("focus", this.wake);
    document.addEventListener("visibilitychange", this.onVisibility);
    for ( const hook of WAKE_HOOKS ) this.hookIds.push([hook, Hooks.on(hook, this.wake)]);
    this.timer = setInterval(() => this.check(), 1000);
    return this;
  }

  stop() {
    for ( const type of INPUT_EVENTS ) window.removeEventListener(type, this.wake, { capture: true });
    window.removeEventListener("focus", this.wake);
    document.removeEventListener("visibilitychange", this.onVisibility);
    for ( const [hook, id] of this.hookIds ) Hooks.off(hook, id);
    this.hookIds = [];
    clearInterval(this.timer);
    this.restore();
  }

  get ticker() {
    return globalThis.canvas?.ready ? canvas.app?.ticker : null;
  }

  /** The frame cap Foundry itself wants right now (0 means uncapped). */
  get targetFps() {
    return canvas.performance?.fps ?? game.settings.get("core", "maxFPS");
  }

  wake() {
    this.lastActivity = performance.now();
    if ( this.throttled ) this.restore();
  }

  /** Stop throttling while something else needs control of the frame cap (the layer cost measurement). */
  suspend(suspended) {
    this.suspended = suspended;
    if ( suspended && this.throttled ) this.restore();
    this.lastActivity = performance.now();
  }

  check() {
    const ticker = this.ticker;
    if ( !ticker || this.suspended ) return;
    if ( this.throttled ) {
      // Foundry reconfigured the ticker under us (e.g. a settings change); accept its value
      if ( ticker.maxFPS !== this.idleFps ) this.throttled = false;
      return;
    }
    const target = this.targetFps;
    if ( target && (target <= this.idleFps) ) return;
    const quiet = performance.now() - this.lastActivity;
    const unfocused = this.onBlur && !document.hasFocus() && (quiet > BLUR_GRACE_MS);
    if ( (quiet < this.delayMs) && !unfocused ) return;
    if ( this.isAnimating() ) return;
    this.throttled = true;
    ticker.maxFPS = this.idleFps;
  }

  restore() {
    this.throttled = false;
    const ticker = this.ticker;
    if ( ticker ) ticker.maxFPS = this.targetFps;
  }

  isAnimating() {
    const animations = foundry.canvas?.animation?.CanvasAnimation?.animations;
    if ( !animations ) return false;
    const names = Object.keys(animations);
    this.blockedBy = names.slice(0, 5).map(String);
    return names.length > 0;
  }

  /** Snapshot for the diagnostics report. */
  status() {
    return {
      throttled: this.throttled,
      idleFps: this.idleFps,
      delaySeconds: this.delayMs / 1000,
      onBlur: this.onBlur,
      targetFps: this.ticker ? this.targetFps : null,
      blockedBy: this.blockedBy ?? []
    };
  }
}

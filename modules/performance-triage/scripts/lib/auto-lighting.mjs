/**
 * Automatic lighting resolution: lower it a step when this computer can't keep up on a scene, keep the step only if
 * it actually helped, and try the sharper step again later. Nobody optimizes lights mid-session; this does it for
 * the computer that needs it, and leaves the others alone.
 * Pure decision logic with no Foundry globals, so every path can be tested in Node.
 */

/** Lighting resolution steps, sharpest first. */
export const STEPS = [1, 0.75, 0.5];

/** Frames are counted over windows this long. */
export const WINDOW_MS = 3000;

/** Below this share of the frame cap, the computer isn't keeping up... */
const SLOW = 0.8;
/** ...for this many windows in a row before anything changes, so one busy moment (a spell effect) doesn't count. */
const SLOW_WINDOWS = 2;

/** At or above this share of the cap for this many windows, the next sharper step is tried. */
const FAST = 0.95;
const FAST_WINDOWS = 5;

/** A step down must raise the frame rate by this much, or it is undone: lighting wasn't what held the frame back. */
const MIN_GAIN = 0.08;

/** A step that proved too slow, or a step down that didn't help, isn't tried again on that scene for this long. */
export const RETRY_MS = 10 * 60_000;

/** Kept for the report. */
const MAX_HISTORY = 12;

/**
 * @typedef {object} LightingChange
 * @property {number} scale       The lighting resolution to use now
 * @property {"slow"|"recovered"|"noGain"|"scene"} reason
 */

export class AutoLighting {
  constructor() {
    this.scenes = new Map();
    this.scene = null;
    this.history = [];
  }

  /** The scale in use on the current scene. */
  get scale() {
    return STEPS[this.scene?.step ?? 0];
  }

  /**
   * Start judging a scene. A scene seen before starts at the step it ended on.
   * @param {string} id
   * @param {string} [name]
   * @returns {number}  The scale to use on it
   */
  setScene(id, name) {
    let s = this.scenes.get(id);
    if ( !s ) this.scenes.set(id, s = { id, name: name || "", step: 0, slow: 0, fast: 0, trial: null, blocked: new Map(), noGainUntil: 0 });
    s.slow = s.fast = 0;
    s.trial = null;
    s.settle = true; // The first window after drawing a scene is loading, not play
    this.scene = s;
    return STEPS[s.step];
  }

  /**
   * One measured window of play on the current scene.
   * @param {number} fps     Frame rate over the window
   * @param {number} target  The frame cap in force
   * @param {number} now     A timestamp in ms
   * @returns {LightingChange|null}  A change to apply, or null to leave it
   */
  addWindow(fps, target, now) {
    const s = this.scene;
    if ( !s || !(target > 0) || !Number.isFinite(fps) ) return null;
    if ( s.settle ) {
      s.settle = false;
      return null;
    }

    // Judge the last step down on the first full window after it
    if ( s.trial ) {
      const { from, before } = s.trial;
      s.trial = null;
      const entry = this.history.at(-1);
      if ( entry ) entry.after = Math.round(fps * 10) / 10;
      if ( fps >= before * (1 + MIN_GAIN) ) return null;
      // No better: lighting isn't the bottleneck here, so go back to the sharper step and leave it for a while
      s.step = from;
      s.noGainUntil = now + RETRY_MS;
      if ( entry ) entry.kept = false;
      return { scale: STEPS[s.step], reason: "noGain" };
    }

    if ( fps < target * SLOW ) {
      s.fast = 0;
      if ( (++s.slow < SLOW_WINDOWS) || (s.step >= STEPS.length - 1) || (now < s.noGainUntil) ) return null;
      s.slow = 0;
      // This step was too slow on this scene; don't come back to it for a while
      s.blocked.set(s.step, now + RETRY_MS);
      s.trial = { from: s.step, before: fps };
      s.step++;
      this.#record(s, STEPS[s.step - 1], STEPS[s.step], fps, now);
      return { scale: STEPS[s.step], reason: "slow" };
    }

    if ( fps >= target * FAST ) {
      s.slow = 0;
      if ( (++s.fast < FAST_WINDOWS) || (s.step === 0) || ((s.blocked.get(s.step - 1) ?? 0) > now) ) return null;
      s.fast = 0;
      s.step--;
      this.#record(s, STEPS[s.step + 1], STEPS[s.step], fps, now);
      return { scale: STEPS[s.step], reason: "recovered" };
    }

    s.slow = s.fast = 0;
    return null;
  }

  #record(s, from, to, fps, now) {
    this.history.push({ scene: s.name, from, to, before: Math.round(fps * 10) / 10, at: now });
    if ( this.history.length > MAX_HISTORY ) this.history.shift();
  }

  /** For the report: the scale on each scene seen, and the recent changes. */
  summary() {
    return {
      scenes: [...this.scenes.values()].map(s => ({ name: s.name, scale: STEPS[s.step] })),
      history: this.history.map(h => ({ ...h }))
    };
  }
}

/**
 * Frame rate and stutter statistics gathered during play, per scene, plus the work that follows each token move.
 * Frame rates in Foundry depend on what is on the scene (lights, walls, weather, filters, tokens with automation),
 * so a single number per computer hides the scenes where players actually struggle.
 * Pure aggregation with no Foundry globals, so it can be tested in Node.
 */
import { packageFromUrl } from "./attribution.mjs";

/** Frame rate histogram buckets are this many fps wide, up to the last one, which holds everything above. */
export const FPS_BUCKET = 5;
const FPS_BUCKETS = 26; // 0-5 ... 120-125, 125+

/**
 * A token move's effects (perception, hooks, automation) are counted from the move until this long after its
 * animation ends: automation modules often wait for the animation before doing their work.
 */
export const MOVE_WINDOW_MS = 2000;

/** Moves that start this close together (a group of tokens moved at once) are one event. */
const MOVE_GROUP_MS = 250;

/** Kept per summary, so a shared copy stays small. */
const MAX_SCENES = 8;
const MAX_PACKAGES = 6;

/** Value at quantile q (0..1) of a bucket histogram, as the bucket's middle. */
export function histogramQuantile(hist, q) {
  const total = hist.reduce((a, n) => a + n, 0);
  if ( !total ) return null;
  let seen = 0;
  for ( let i = 0; i < hist.length; i++ ) {
    seen += hist[i];
    if ( seen >= q * total ) return (i * FPS_BUCKET) + (FPS_BUCKET / 2);
  }
  return null;
}

/** Median of a list of numbers, or null. */
function median(values) {
  if ( !values.length ) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return (s.length % 2) ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export class PlayStats {
  /**
   * @param {object} [options]
   * @param {string} [options.origin]   Page origin, for attributing scripts to packages
   * @param {number} [options.graceMs]  Extra wait for long frame entries, which arrive shortly after the frame
   */
  constructor({ origin, graceMs = 500 } = {}) {
    this.origin = origin;
    this.graceMs = graceMs;
    this.scenes = new Map();
    this.current = null;
    this.moves = [];   // open move events, waiting for their window to end
    this.done = [];    // finished move events: {scene, tokens, frames, ms, long, byPackage}
  }

  /** Start counting for a scene; later windows, frames and moves go to it. */
  setScene(id, name) {
    if ( !id ) {
      this.current = null;
      return;
    }
    let s = this.scenes.get(id);
    if ( !s ) {
      this.scenes.set(id, s = { id, name: name || "(unnamed)", ms: 0, target: 0, hist: new Array(FPS_BUCKETS).fill(0),
        longFrames: 0, longMs: 0, moves: 0 });
    }
    this.current = s;
  }

  /**
   * One measured stretch of play on the current scene.
   * @param {number} frames  Frames rendered
   * @param {number} ms      Length of the stretch
   * @param {number} target  The frame cap in force
   */
  addWindow(frames, ms, target) {
    const s = this.current;
    if ( !s || !(ms > 0) ) return;
    const fps = (frames * 1000) / ms;
    s.hist[Math.min(FPS_BUCKETS - 1, Math.floor(fps / FPS_BUCKET))]++;
    s.ms += ms;
    s.target = target || s.target;
  }

  /**
   * A token moved on the scene being viewed.
   * @param {number} at       performance.now() when the move was processed
   * @param {number} frames   The frame counter at that moment
   * @returns {object|null}   A new move event, or null when the move joined one that just started
   */
  addMove(at, frames) {
    const s = this.current;
    if ( !s ) return null;
    const last = this.moves.at(-1);
    if ( last && (at - last.at < MOVE_GROUP_MS) && (last.scene === s) ) {
      last.tokens++;
      return null;
    }
    s.moves++;
    const move = { scene: s, at, frames, endAt: null, endFrames: null, tokens: 1, long: 0, ms: 0, byPackage: new Map() };
    this.moves.push(move);
    return move;
  }

  /** The move's window is over (the tracker decides when): note how many frames were drawn during it. */
  endMove(move, at, frames) {
    move.endAt = at;
    move.endFrames = frames;
  }

  /**
   * A long animation frame (over 50 ms) during play. It counts against the current scene, and against any move whose
   * window it overlaps: the frame that processed the move starts before the move's hook fires, and a move's window
   * stays open until the tracker ends it.
   * @param {PerformanceEntry} e
   */
  addLongFrame(e) {
    if ( this.current ) {
      this.current.longFrames++;
      this.current.longMs += e.duration;
    }
    const start = e.startTime;
    const end = e.startTime + e.duration;
    for ( const m of this.moves ) {
      if ( (end < m.at) || ((m.endAt !== null) && (start > m.endAt)) ) continue;
      m.long++;
      m.ms += e.duration;
      for ( const sc of e.scripts ?? [] ) {
        const url = sc.sourceURL || String(sc.sourceLocation ?? "").replace(/(:\d+){1,2}$/, "");
        const key = packageFromUrl(url, this.origin);
        m.byPackage.set(key, (m.byPackage.get(key) ?? 0) + (sc.duration ?? 0));
      }
    }
  }

  /**
   * Close moves whose window has ended and whose long frames have had time to arrive.
   * @param {number} now       performance.now()
   */
  closeMoves(now) {
    const open = [];
    for ( const m of this.moves ) {
      if ( (m.endAt === null) || (now < m.endAt + this.graceMs) ) {
        open.push(m);
        continue;
      }
      const fps = (m.endAt > m.at) ? ((m.endFrames - m.frames) * 1000) / (m.endAt - m.at) : 0;
      this.done.push({ scene: m.scene.id, tokens: m.tokens, fps, long: m.long, ms: m.ms, byPackage: m.byPackage });
    }
    this.moves = open;
  }

  /**
   * A compact summary, small enough to share with the GM.
   * @returns {{scenes: object[], moves: object|null}}
   */
  summary() {
    const scenes = [...this.scenes.values()].filter(s => s.ms > 0)
      .sort((a, b) => b.ms - a.ms).slice(0, MAX_SCENES)
      .map(s => {
        const minutes = s.ms / 60000;
        const moves = this.done.filter(m => m.scene === s.id);
        return {
          name: s.name,
          minutes: Math.round(minutes * 10) / 10,
          target: s.target,
          fps: histogramQuantile(s.hist, 0.5),
          low: histogramQuantile(s.hist, 0.1),
          longPerMin: minutes ? Math.round((s.longFrames / minutes) * 10) / 10 : 0,
          moves: moves.length,
          moveMs: moves.length ? Math.round(median(moves.map(m => m.ms))) : null
        };
      });
    const all = this.done;
    let moves = null;
    if ( all.length ) {
      const byPackage = new Map();
      for ( const m of all ) for ( const [k, v] of m.byPackage ) byPackage.set(k, (byPackage.get(k) ?? 0) + v);
      const total = all.reduce((a, m) => a + m.ms, 0);
      moves = {
        count: all.length,
        medianMs: Math.round(median(all.map(m => m.ms))),
        worstMs: Math.round(Math.max(...all.map(m => m.ms))),
        stuttered: all.filter(m => m.long > 0).length,
        fps: Math.round(median(all.map(m => m.fps)) ?? 0),
        totalMs: Math.round(total),
        packages: [...byPackage.entries()].map(([key, ms]) => ({ key, ms: Math.round(ms) }))
          .sort((a, b) => b.ms - a.ms).slice(0, MAX_PACKAGES)
      };
    }
    return { scenes, moves };
  }
}

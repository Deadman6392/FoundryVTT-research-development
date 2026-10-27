/**
 * A voice plays one track for one deck on this client. It turns the deck's transport into runs (stretches of
 * uninterrupted file playback, see runsFrom) and keeps exactly two of them planned: the one playing and the one after
 * it, crossfaded at the seam. When a new transport arrives it keeps whatever is already playing in the right place,
 * so a control press elsewhere in the arrangement (a pending jump, a speed change) never interrupts the sound.
 *
 * Subclasses provide the sound itself: a decoded buffer (sample-accurate) or streamed audio elements.
 */
import { runsFrom } from "../lib/transport.mjs";
import { trackArrangement } from "../lib/deck.mjs";

/** Fade used when this client has to move to where everyone else is, or start mid-track. */
export const CATCH_UP_FADE = 0.12;
const START_FADE = 0.012;
const PAUSE_FADE = 0.12;
const STOP_FADE = 0.4;

/** File seconds within which the sound already playing counts as being in the right place. */
const MATCH_TOLERANCE = 0.04;

/**
 * Seconds the audio clock may slip against the server clock before this client catches up. An overloaded computer
 * can skip audio callbacks, and its sound then falls behind everyone else's (headless Chromium in a busy container
 * slipped 20 to 160 ms); the check runs every few seconds while something plays.
 */
const CLOCK_TOLERANCE = 0.03;
const CLOCK_CHECK = 5000;

const POINTS = 64;
export const FADE_IN = Float32Array.from({ length: POINTS }, (_, i) => Math.sin((i / (POINTS - 1)) * (Math.PI / 2)));
export const FADE_OUT = Float32Array.from({ length: POINTS }, (_, i) => Math.cos((i / (POINTS - 1)) * (Math.PI / 2)));

/**
 * Schedule an equal-power fade on a gain parameter that starts at `start` and lasts `length` seconds. Each gain in
 * this engine gets at most one fade at a time, but a fade can still be running when a new one is asked for (a
 * control pressed mid-crossfade); the browser refuses overlapping curves, so fall back to a ramp, and if that is
 * refused too, let the running fade finish.
 */
export function scheduleFade(param, curve, start, length) {
  const target = curve[curve.length - 1];
  try {
    if ( length < 0.004 ) param.setValueAtTime(target, start + length);
    else param.setValueCurveAtTime(curve, start, length);
  } catch {
    try {
      param.linearRampToValueAtTime(target, start + length);
    } catch {}
  }
}

export class Voice {
  /** @type {"buffer"|"stream"} */
  static kind = "buffer";

  /** Shortest crossfade at a jump, in seconds. */
  static minSeam = 0.008;

  constructor(engine, track) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.track = track;
    this.src = track.src;
    this.arr = trackArrangement(track);
    this.duration = track.duration ?? undefined;
    this.rate = 1;
    this.keepPitch = true;
    // Two gains so a track crossfade in and a fade out on release never fight over one parameter
    this.input = this.ctx.createGain();
    this.output = this.ctx.createGain();
    this.input.connect(this.output).connect(engine.fx.input);
    this.entries = [];
    this.plan = null;
    this.timer = null;
    this.disposed = false;
    this.ready = null;
    this.deck = null;
    this.clock = null;
  }

  get kind() {
    return this.constructor.kind;
  }

  /** Is anything playing or about to? */
  get active() {
    return this.entries.length > 0;
  }

  /** Load enough to start. Subclasses set this.duration once they know it. */
  load() {
    this.ready ??= this._load();
    return this.ready;
  }

  async _load() {}

  /** Server time to audio-context time, including output and effect latency. */
  toContext(serverMs) {
    return this.engine.toContext(serverMs);
  }

  /**
   * Bring playback in line with a deck.
   * @param {object} deck   A normalized deck whose track is this voice's track
   */
  sync(deck) {
    if ( this.disposed ) return;
    const t = deck.transport;
    this.deck = deck;
    this.track = deck.track;
    this.arr = trackArrangement(deck.track);
    this.setKeepPitch(deck.fx.keepPitch);
    clearTimeout(this.timer);
    const now = this.engine.serverNow();
    this.plan = runsFrom(t, this.arr, this.duration, now);
    const first = this.plan.next().value;
    if ( !first ) {
      this.silence((t.status === "paused") ? PAUSE_FADE : STOP_FADE);
      this.rate = t.rate;
      return;
    }
    let current = this.#current(now);
    if ( current && this.#same(current, first, now) ) {
      current.run = first;
      if ( t.rate !== this.rate ) {
        this._setRate(current, t.rate);
        current.ctxAt = this.toContext(first.start);
        current.fileAt = first.from;
      }
      this.rate = t.rate;
    }
    else {
      const fade = this.entries.length ? CATCH_UP_FADE : START_FADE;
      for ( const entry of this.entries ) this._kill(entry, fade);
      this.entries = [];
      this.rate = t.rate;
      current = this.#open(first, this.toContext(first.start), first.from, (first.start > now) ? START_FADE : fade);
    }
    const spare = this.entries.filter(e => e !== current);
    this.entries = [current];
    this.#extend(current, spare);
    this.clock ??= setInterval(() => this.#checkClock(), CLOCK_CHECK);
  }

  /** Open an entry and remember where on the audio clock it was put, to notice the clock slipping later. */
  #open(run, at, offset, fade) {
    const entry = this._open(run, at, offset, fade);
    entry.ctxAt = at;
    entry.fileAt = offset;
    return entry;
  }

  /** Seconds between where an entry was put on the audio clock and where the server clock now says it belongs. */
  #slip(entry) {
    const planned = entry.ctxAt + ((entry.run.from - entry.fileAt) / this.rate);
    return this.toContext(entry.run.start) - planned;
  }

  #checkClock() {
    if ( this.disposed || !this.entries.length ) {
      clearInterval(this.clock);
      this.clock = null;
      return;
    }
    const now = this.engine.serverNow();
    const current = this.#current(now);
    if ( current && (current.run.start <= now) && (Math.abs(this.#slip(current)) > CLOCK_TOLERANCE) ) this.sync(this.deck);
  }

  /** Plan what follows an entry: when it ends and the run after it, reusing an already planned entry that matches. */
  #extend(entry, spare = []) {
    clearTimeout(this.timer);
    const run = entry.run;
    const next = (run.last || !Number.isFinite(run.end)) ? null : this.plan.next().value;
    if ( !next ) {
      for ( const e of spare ) this._kill(e, 0.02);
      this._close(entry, Number.isFinite(run.end) ? this.toContext(run.end) : Infinity, 0.01);
      return;
    }
    const fade = this.#crossfade(run, next);
    const seam = this.toContext(next.start);
    this._close(entry, seam + fade.post, fade.pre + fade.post);
    let follower = spare.find(e => (Math.abs(e.run.start - next.start) < 2) && (Math.abs(e.run.from - next.from) < 0.002));
    for ( const e of spare ) if ( e !== follower ) this._kill(e, 0.02);
    if ( follower ) follower.run = next;
    else follower = this.#open(next, seam - fade.pre, next.from - (fade.pre * this.rate), fade.pre + fade.post);
    this.entries.push(follower);
    // Once the next run is under way, plan the one after it. One timer per run, so a 30-second loop wakes the page
    // every 30 seconds and nothing runs in between.
    const wait = Math.max(0, next.start - this.engine.serverNow()) + 25;
    this.timer = setTimeout(() => this.#advance(follower), wait);
  }

  #advance(entry) {
    if ( this.disposed || !this.entries.includes(entry) ) return;
    this.entries = [entry];
    this.#extend(entry);
  }

  /**
   * How a seam between two runs is crossfaded, in wall seconds before and after the seam. Centred on the seam where
   * there is audio on both sides; at the start or end of the file the fade shifts to the side that has audio.
   */
  #crossfade(a, b) {
    const seam = Math.max(this.arr.seam, this.constructor.minSeam);
    const want = (seam * this.rate) / 2;
    const after = Math.max(0, (this.duration ?? Infinity) - a.to);
    const before = Math.max(0, b.from);
    let post = Math.min(want, after);
    let pre = Math.min(want, before);
    if ( post < want ) pre = Math.min(before, (2 * want) - post);
    if ( pre < want ) post = Math.min(after, (2 * want) - pre);
    return { pre: pre / this.rate, post: post / this.rate };
  }

  /** The entry sounding at a server time, or the first one waiting to start. */
  #current(now) {
    let found = null;
    for ( const e of this.entries ) {
      if ( (e.run.start <= now + 1) && (now < e.run.end) ) found = e;
    }
    return found ?? this.entries.find(e => e.run.start > now) ?? null;
  }

  #same(entry, run, now) {
    const r = entry.run;
    if ( (run.start > now + 1) || (r.start > now + 1) ) {
      return (Math.abs(run.start - r.start) < 2) && (Math.abs(run.from - r.from) < 0.002);
    }
    const pos = r.from + (((now - r.start) / 1000) * this.rate);
    return (Math.abs(pos - run.from) < MATCH_TOLERANCE) && (Math.abs(this.#slip(entry)) <= CLOCK_TOLERANCE);
  }

  /** Fade everything out and forget the plan. The track stays loaded, so resuming is immediate. */
  silence(fade = PAUSE_FADE) {
    clearTimeout(this.timer);
    clearInterval(this.clock);
    this.clock = null;
    for ( const entry of this.entries ) this._kill(entry, fade);
    this.entries = [];
    this.plan = null;
  }

  /** Fade the whole voice in over a track crossfade starting at audio-context time `at`. */
  fadeIn(seconds, at = this.ctx.currentTime) {
    if ( seconds <= 0.004 ) return;
    const g = this.input.gain;
    const now = this.ctx.currentTime;
    g.setValueAtTime(0, now);
    scheduleFade(g, FADE_IN, Math.max(now + 0.001, at), seconds);
  }

  /** Fade out and free everything. */
  release(seconds = STOP_FADE) {
    if ( this.disposed ) return;
    this.disposed = true;
    clearTimeout(this.timer);
    clearInterval(this.clock);
    const length = Math.max(0.01, seconds);
    scheduleFade(this.output.gain, FADE_OUT, this.ctx.currentTime + 0.001, length);
    setTimeout(() => {
      for ( const entry of this.entries ) this._kill(entry, 0);
      this.entries = [];
      this.input.disconnect();
      this.output.disconnect();
      this._dispose();
    }, (length * 1000) + 100);
  }

  setKeepPitch(keep) {
    this.keepPitch = keep;
  }

  /* -------------------------------------------- */
  /*  For subclasses                              */
  /* -------------------------------------------- */

  /**
   * Start a run.
   * @param {object} run        The run (see runsFrom)
   * @param {number} at         Audio-context time at which `offset` should be heard
   * @param {number} offset     File position to start from (may be slightly before the run, for a crossfade)
   * @param {number} fadeIn     Seconds to fade in over, starting at `at`
   * @returns {object}          An entry with at least {run}
   */
  _open(run, at, offset, fadeIn) {
    throw new Error("not implemented");
  }

  /** Fade an entry out so it is silent at audio-context time `end` (Infinity: never), then stop it. */
  _close(entry, end, fade) {}

  /** Fade an entry out now. */
  _kill(entry, fade) {
    this._close(entry, this.ctx.currentTime + fade, fade);
  }

  _setRate(entry, rate) {}

  _dispose() {}
}

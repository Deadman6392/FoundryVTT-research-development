/**
 * The streamed voice: <audio> elements routed through the audio graph. It starts as soon as the first seconds have
 * arrived, keeps only a little of the file in memory however long it is, and keeps pitch natively when the speed
 * changes. Elements can't be started on an exact sample, so a seam is crossfaded (at least 0.15 s) and the element
 * that takes over is started a moment early, muted, and nudged into step by its speed before it is heard.
 */
import { FADE_IN, FADE_OUT, Voice, scheduleFade } from "./voice.mjs";

/** Seconds an element runs muted before its fade-in, to settle and be nudged into step. */
const PREROLL = 0.35;
/** Milliseconds between alignment checks while an element is being brought into step. */
const SETTLE_CHECK = 100;
/** Milliseconds between drift checks while elements play. */
const DRIFT_CHECK = 2000;
/** Seconds out of step beyond which an element seeks instead of nudging. */
const RESEEK = 0.3;
/** A guess at how long a seek takes, used to aim ahead of where playback will be. */
const SEEK_GUESS = 0.06;

/**
 * How an element is nudged back into step: out by more than `deadband` seconds, its speed changes by up to
 * `nudge` for exactly as long as it takes to close the gap over about `horizon` seconds, then returns to the plain
 * speed. Chromium's pitch-keeping stretcher skips or repeats a few tens of milliseconds whenever the speed changes, so
 * audible corrections are rare and small: a dead band of 25 ms, and at most 2% (0.4% when pitch follows speed, about
 * 7 cents, below what most people hear). While muted before a seam, anything goes.
 */
const SETTLE = { deadband: 0.006, nudge: 0.1, horizon: 0.2 };
const DRIFT = { deadband: 0.025, nudge: 0.02, horizon: 1.5 };
const TAPE_DRIFT = { deadband: 0.025, nudge: 0.004, horizon: 1.5 };

/**
 * In Chromium the sound of a media element routed through the audio graph is heard about 45 ms after the position
 * its currentTime reports (measured in headless Chromium against the decoded voice, which has no such lag), so a
 * streamed element is kept that far ahead to line up with clients playing the decoded voice. Other browsers haven't
 * been measured and get no correction.
 */
const ELEMENT_LAG = /\bChrom(e|ium)\//.test(globalThis.navigator?.userAgent ?? "") ? 0.045 : 0;

function crossOrigin(url) {
  try {
    return new URL(url, document.baseURI).origin !== globalThis.location?.origin;
  } catch {
    return false;
  }
}

export class StreamVoice extends Voice {
  static kind = "stream";

  static minSeam = 0.15;

  async _load() {
    this.url = this.engine.resolve(this.src);
    this.slots = [];
    this.drift = null;
    const { el } = this.#slot();
    if ( el.readyState < 1 ) {
      await new Promise((resolve, reject) => {
        el.addEventListener("loadedmetadata", () => resolve(), { once: true });
        el.addEventListener("error", () => reject(new Error(el.error?.message || `can't load ${this.src}`)), { once: true });
      });
    }
    if ( Number.isFinite(el.duration) ) this.duration = el.duration;
  }

  /** A new element and its gains. A media element can only ever be connected to one source node, so they're kept. */
  #slot() {
    const el = new Audio();
    el.preload = "auto";
    if ( crossOrigin(this.url) ) el.crossOrigin = "anonymous";
    el.src = this.url;
    this.#pitch(el);
    el.addEventListener("error", () => this.engine.report("error", el.error?.message || this.src));
    const node = this.ctx.createMediaElementSource(el);
    const fade = new GainNode(this.ctx, { gain: 0 });
    const close = new GainNode(this.ctx, { gain: 1 });
    node.connect(fade).connect(close).connect(this.input);
    const slot = { el, node, fade, close, entry: null };
    this.slots.push(slot);
    return slot;
  }

  #pitch(el) {
    el.preservesPitch = this.keepPitch;
    if ( "webkitPreservesPitch" in el ) el.webkitPreservesPitch = this.keepPitch;
  }

  #later(entry, fn, ms) {
    const id = setTimeout(() => {
      entry.timers.delete(id);
      fn();
    }, Math.max(0, ms));
    entry.timers.add(id);
  }

  #seek(el, time) {
    return new Promise(resolve => {
      if ( !el.seeking && (Math.abs(el.currentTime - time) < 0.003) ) return resolve();
      const done = () => {
        el.removeEventListener("seeked", done);
        resolve();
      };
      el.addEventListener("seeked", done);
      el.currentTime = time;
      setTimeout(done, 3000);
    });
  }

  _open(run, at, offset, fadeIn) {
    const ctx = this.ctx;
    const slot = this.slots.find(s => !s.entry) ?? this.#slot();
    const entry = { run, slot, at, offset, rate: this.rate, timers: new Set(), fading: null, stopAt: Infinity, settled: false };
    slot.entry = entry;
    const { el } = slot;
    const now = ctx.currentTime;
    for ( const g of [slot.fade.gain, slot.close.gain] ) g.cancelScheduledValues(0);
    slot.fade.gain.setValueAtTime(0, now);
    slot.close.gain.setValueAtTime(1, now);
    const fadeStart = Math.max(at, now + 0.002);
    scheduleFade(slot.fade.gain, FADE_IN, fadeStart, Math.max(0.003, (at + fadeIn) - fadeStart));
    el.playbackRate = this.rate;
    this.#pitch(el);

    // Seek to where the element should be when it starts its muted pre-roll; if this client is already late, aim
    // ahead by the lateness plus a seek
    const lead = at - now;
    const preroll = Math.min(PREROLL, Math.max(0, lead));
    let target = offset - ((preroll - ELEMENT_LAG) * this.rate);
    if ( lead <= 0 ) target = offset + ((SEEK_GUESS + ELEMENT_LAG - lead) * this.rate);
    let startAt = at - preroll;
    if ( target < 0 ) {
      startAt += -target / this.rate;
      target = 0;
    }
    this.#seek(el, target).then(() => {
      if ( slot.entry !== entry ) return;
      this.#later(entry, () => this.#start(entry), (startAt - ctx.currentTime) * 1000);
    });
    return entry;
  }

  #start(entry) {
    const { el } = entry.slot;
    el.play().catch(err => this.engine.report("error", err?.message ?? String(err)));
    const settle = () => {
      if ( entry.slot.entry !== entry ) return;
      if ( this.ctx.currentTime < entry.at ) {
        this.#align(entry, SETTLE);
        this.#later(entry, settle, SETTLE_CHECK);
        return;
      }
      // Heard from here on: back to the plain speed, and only gentle corrections from now (one straight away, for
      // an element that started late)
      clearTimeout(entry.restore);
      el.playbackRate = entry.rate;
      entry.settled = true;
      this.#align(entry, this.keepPitch ? DRIFT : TAPE_DRIFT);
    };
    this.#later(entry, settle, SETTLE_CHECK);
    this.drift ??= setInterval(() => this.#checkDrift(), DRIFT_CHECK);
  }

  /** Where an entry's element should report it is now. */
  #expected(entry) {
    return entry.offset + ((this.ctx.currentTime - entry.at + ELEMENT_LAG) * entry.rate);
  }

  /** Nudge an element back into step for just as long as the gap needs, or seek if it is far off. */
  #align(entry, { deadband, nudge, horizon }) {
    const { el } = entry.slot;
    if ( el.paused || el.seeking ) return;
    const expected = this.#expected(entry);
    const error = el.currentTime - expected;
    clearTimeout(entry.restore);
    if ( Math.abs(error) > RESEEK ) {
      el.playbackRate = entry.rate;
      el.currentTime = Math.max(0, expected + (SEEK_GUESS * entry.rate));
      return;
    }
    if ( Math.abs(error) <= deadband ) {
      if ( el.playbackRate !== entry.rate ) el.playbackRate = entry.rate;
      return;
    }
    const correction = Math.max(-nudge, Math.min(nudge, -error / horizon));
    el.playbackRate = entry.rate * (1 + correction);
    const seconds = Math.abs(error / (correction * entry.rate));
    entry.restore = setTimeout(() => {
      if ( entry.slot.entry === entry ) el.playbackRate = entry.rate;
    }, seconds * 1000);
  }

  #checkDrift() {
    if ( !this.entries.length ) {
      clearInterval(this.drift);
      this.drift = null;
      return;
    }
    for ( const slot of this.slots ?? [] ) {
      if ( slot.entry?.settled ) this.#align(slot.entry, this.keepPitch ? DRIFT : TAPE_DRIFT);
    }
  }

  _close(entry, end, fade) {
    if ( entry.slot.entry !== entry ) return;
    const now = this.ctx.currentTime;
    if ( (entry.fading !== null) && (entry.fading <= now) ) {
      if ( end < entry.stopAt ) this.#stopAt(entry, end);
      return;
    }
    const g = entry.slot.close.gain;
    g.cancelScheduledValues(now);
    clearTimeout(entry.stopTimer);
    if ( !Number.isFinite(end) ) {
      entry.fading = null;
      entry.stopAt = Infinity;
      return;
    }
    const begin = Math.max(now, end - fade);
    scheduleFade(g, FADE_OUT, begin, Math.max(0, end - begin));
    entry.fading = begin;
    this.#stopAt(entry, end);
  }

  #stopAt(entry, end) {
    entry.stopAt = end;
    clearTimeout(entry.stopTimer);
    entry.stopTimer = setTimeout(() => this.#free(entry), ((end - this.ctx.currentTime) * 1000) + 30);
  }

  #free(entry) {
    const slot = entry.slot;
    if ( slot.entry !== entry ) return;
    clearTimeout(entry.restore);
    for ( const id of entry.timers ) clearTimeout(id);
    entry.timers.clear();
    slot.el.pause();
    slot.fade.gain.cancelScheduledValues(0);
    slot.fade.gain.setValueAtTime(0, this.ctx.currentTime);
    slot.entry = null;
  }

  _setRate(entry, rate) {
    entry.offset = this.#expected(entry) - (ELEMENT_LAG * entry.rate);
    entry.at = this.ctx.currentTime;
    entry.rate = rate;
    clearTimeout(entry.restore);
    entry.slot.el.playbackRate = rate;
  }

  setKeepPitch(keep) {
    super.setKeepPitch(keep);
    for ( const slot of this.slots ?? [] ) this.#pitch(slot.el);
  }

  _dispose() {
    clearInterval(this.drift);
    for ( const slot of this.slots ?? [] ) {
      if ( slot.entry ) this.#free(slot.entry);
      slot.el.removeAttribute("src");
      slot.el.load();
      slot.node.disconnect();
      slot.fade.disconnect();
      slot.close.disconnect();
    }
    this.slots = [];
  }
}

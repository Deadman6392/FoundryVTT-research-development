/**
 * The precise voice: the whole track decoded into memory and played from AudioBufferSourceNodes scheduled on the
 * audio clock, so a loop going round or a jump to the ending lands on the exact sample. Used for arranged tracks up to
 * ten minutes (the same limit Foundry uses before it streams), at the cost of the decoded audio in memory: about
 * 23 MB per stereo minute at 48 kHz.
 */
import { FADE_IN, FADE_OUT, Voice, scheduleFade } from "./voice.mjs";

/** Decoded tracks per audio context, newest last. Two are kept so switching back and forth doesn't decode again. */
const decoded = new WeakMap();
const KEEP = 2;

/**
 * Fetch and decode a file once per context, sharing the work between voices that ask at the same time.
 * @returns {Promise<AudioBuffer>}
 */
export function decodeTrack(ctx, url) {
  let cache = decoded.get(ctx);
  if ( !cache ) decoded.set(ctx, cache = new Map());
  if ( cache.has(url) ) {
    const hit = cache.get(url);
    cache.delete(url);
    cache.set(url, hit);
    return hit;
  }
  const work = fetch(url).then(response => {
    if ( !response.ok ) throw new Error(`${response.status} ${response.statusText}`);
    return response.arrayBuffer();
  }).then(bytes => ctx.decodeAudioData(bytes));
  work.catch(() => cache.delete(url));
  cache.set(url, work);
  while ( cache.size > KEEP ) cache.delete(cache.keys().next().value);
  return work;
}

export class BufferVoice extends Voice {
  static kind = "buffer";

  static minSeam = 0.008;

  async _load() {
    this.buffer = await decodeTrack(this.ctx, this.engine.resolve(this.src));
    this.duration = this.buffer.duration;
  }

  _open(run, at, offset, fadeIn) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const source = new AudioBufferSourceNode(ctx, { buffer: this.buffer, playbackRate: this.rate });
    const fadeGain = new GainNode(ctx, { gain: 0 });
    const closeGain = new GainNode(ctx, { gain: 1 });
    source.connect(fadeGain).connect(closeGain).connect(this.input);
    let when = at;
    let start = offset;
    if ( start < 0 ) {
      when += -start / this.rate;
      start = 0;
    }
    if ( when < now ) {
      start += (now - when) * this.rate;
      when = now;
    }
    const fadeEnd = at + fadeIn;
    scheduleFade(fadeGain.gain, FADE_IN, when, Math.max(0.003, fadeEnd - when));
    source.start(when, Math.min(start, this.buffer.duration));
    const entry = { run, source, fadeGain, closeGain, stopped: false, fading: null, stopAt: Infinity };
    source.onended = () => {
      entry.stopped = true;
      source.disconnect();
      fadeGain.disconnect();
      closeGain.disconnect();
    };
    return entry;
  }

  _close(entry, end, fade) {
    if ( entry.stopped ) return;
    const now = this.ctx.currentTime;
    // Once a fade-out has begun it can't be taken back; it can only end sooner
    if ( (entry.fading !== null) && (entry.fading <= now) ) {
      if ( end < entry.stopAt ) this.#stop(entry, end);
      return;
    }
    const g = entry.closeGain.gain;
    g.cancelScheduledValues(now);
    if ( !Number.isFinite(end) ) {
      entry.fading = null;
      // Calling stop again replaces the earlier stop time; this one is past the end of the buffer
      this.#stop(entry, now + ((this.buffer.duration / Math.max(0.25, this.rate)) * 2) + 1);
      return;
    }
    const begin = Math.max(now, end - fade);
    scheduleFade(g, FADE_OUT, begin, Math.max(0, end - begin));
    entry.fading = begin;
    this.#stop(entry, end);
  }

  #stop(entry, end) {
    entry.stopAt = end;
    entry.source.stop(Math.max(this.ctx.currentTime, end) + 0.005);
  }

  _setRate(entry, rate) {
    entry.source.playbackRate.setValueAtTime(rate, this.ctx.currentTime);
  }

  _dispose() {
    this.buffer = null;
  }
}

/**
 * The effect chain a deck's audio passes through on every client: pitch, bass, treble, muffle, reverb, then the deck
 * volume. An effect at its neutral value is disconnected, not just set to zero, so a deck with no effects costs
 * nothing beyond one gain node. Loaded with the engine, on the first play.
 */

/** Average delay the pitch worklet adds, in seconds (its SPLICE constant). */
export const PITCH_LATENCY = 0.05;

const SMOOTH = 0.04;
const MUFFLE_MAX_HZ = 20000;
const MUFFLE_MIN_HZ = 350;

/** One worklet load per audio context; resolves false if the browser can't run it. */
const worklets = new WeakMap();

export function loadPitchWorklet(ctx, url) {
  let loading = worklets.get(ctx);
  if ( !loading ) {
    loading = ctx.audioWorklet ? ctx.audioWorklet.addModule(url).then(() => true, err => {
      console.warn("Dal Segno | The pitch shifter could not be loaded; pitch changes are off on this computer.", err);
      return false;
    }) : Promise.resolve(false);
    worklets.set(ctx, loading);
  }
  return loading;
}

/** A small stereo room: decaying noise, decorrelated between channels. Built once per context and size. */
const rooms = new WeakMap();

function roomImpulse(ctx, seconds = 1.4) {
  let byContext = rooms.get(ctx);
  if ( !byContext ) rooms.set(ctx, byContext = new Map());
  if ( byContext.has(seconds) ) return byContext.get(seconds);
  const length = Math.round(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for ( let c = 0; c < 2; c++ ) {
    const data = buffer.getChannelData(c);
    let seed = (c + 1) * 2654435761;
    for ( let i = 0; i < length; i++ ) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = (seed / 2147483648) - 1;
      const t = i / length;
      // A short pre-delay, then an exponential tail
      data[i] = (i < ctx.sampleRate * 0.012) ? 0 : noise * Math.pow(1 - t, 2.2) * Math.exp(-3 * t);
    }
  }
  byContext.set(seconds, buffer);
  return buffer;
}

export class FxChain {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination   Where the deck's sound goes (the channel's volume node)
   * @param {object} options
   * @param {string} options.workletUrl
   * @param {boolean} [options.lite]  Skip reverb and pitch on this computer
   */
  constructor(ctx, destination, { workletUrl, lite = false }) {
    this.ctx = ctx;
    this.workletUrl = workletUrl;
    this.lite = lite;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.output.connect(destination);
    this.nodes = {};
    this.wiring = "";
    this.pitchReady = false;
    this.latency = 0;
  }

  /** Lazily created nodes, so a deck that never uses an effect never builds it. */
  #node(name) {
    const ctx = this.ctx;
    if ( this.nodes[name] ) return this.nodes[name];
    let node;
    switch ( name ) {
      case "bass": node = new BiquadFilterNode(ctx, { type: "lowshelf", frequency: 180 }); break;
      case "treble": node = new BiquadFilterNode(ctx, { type: "highshelf", frequency: 3500 }); break;
      case "muffle": node = new BiquadFilterNode(ctx, { type: "lowpass", frequency: MUFFLE_MAX_HZ, Q: 0.9 }); break;
      case "reverb": node = new ConvolverNode(ctx, { buffer: roomImpulse(ctx), disableNormalization: false }); break;
      case "wet": node = new GainNode(ctx, { gain: 0 }); break;
      case "dry": node = new GainNode(ctx, { gain: 1 }); break;
      case "pitch": node = new AudioWorkletNode(ctx, "dal-segno-pitch", { outputChannelCount: [2] }); break;
    }
    return (this.nodes[name] = node);
  }

  /**
   * Apply effect settings.
   * @param {object} fx               Normalized effect settings
   * @param {object} options
   * @param {number} [options.ratio]  Pitch ratio for the worklet (1 = untouched)
   * @param {number} [options.volume] Deck volume, 0-1
   */
  async set(fx, { ratio = 1, volume = 1 } = {}) {
    const now = this.ctx.currentTime;
    this.output.gain.setTargetAtTime(volume, now, SMOOTH);
    const wantPitch = !this.lite && (Math.abs(ratio - 1) > 0.0005);
    if ( wantPitch && !this.pitchReady ) this.pitchReady = await loadPitchWorklet(this.ctx, this.workletUrl);
    const active = [];
    if ( wantPitch && this.pitchReady ) active.push("pitch");
    if ( fx.bass ) active.push("bass");
    if ( fx.treble ) active.push("treble");
    if ( fx.muffle > 0 ) active.push("muffle");
    const reverb = !this.lite && (fx.reverb > 0);
    const wiring = `${active.join(",")}|${reverb}`;
    if ( active.includes("pitch") ) this.#node("pitch").parameters.get("ratio").setValueAtTime(ratio, now);
    if ( fx.bass ) this.#node("bass").gain.setTargetAtTime(fx.bass, now, SMOOTH);
    if ( fx.treble ) this.#node("treble").gain.setTargetAtTime(fx.treble, now, SMOOTH);
    if ( fx.muffle > 0 ) {
      const hz = MUFFLE_MAX_HZ * Math.pow(MUFFLE_MIN_HZ / MUFFLE_MAX_HZ, fx.muffle);
      this.#node("muffle").frequency.setTargetAtTime(hz, now, SMOOTH);
    }
    if ( reverb ) {
      this.#node("wet").gain.setTargetAtTime(fx.reverb * 0.9, now, SMOOTH);
      this.#node("dry").gain.setTargetAtTime(1 - (fx.reverb * 0.45), now, SMOOTH);
    }
    this.latency = active.includes("pitch") ? PITCH_LATENCY : 0;
    if ( wiring !== this.wiring ) this.#rewire(active, reverb, wiring);
  }

  #rewire(active, reverb, wiring) {
    this.input.disconnect();
    for ( const node of Object.values(this.nodes) ) node.disconnect();
    let tail = this.input;
    for ( const name of active ) {
      const node = this.#node(name);
      tail.connect(node);
      tail = node;
    }
    if ( reverb ) {
      tail.connect(this.#node("dry")).connect(this.output);
      tail.connect(this.#node("reverb")).connect(this.#node("wet")).connect(this.output);
    }
    else tail.connect(this.output);
    this.wiring = wiring;
  }

  /** Is anything beyond volume running? */
  get idle() {
    return this.wiring === "|false";
  }

  dispose() {
    this.input.disconnect();
    this.output.disconnect();
    for ( const node of Object.values(this.nodes) ) node.disconnect();
    this.nodes = {};
  }
}

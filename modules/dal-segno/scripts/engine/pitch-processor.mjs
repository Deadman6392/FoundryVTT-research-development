/**
 * AudioWorklet pitch shifter, loaded into an audio context only when a deck shifts pitch (or keeps pitch while a
 * precisely looped track changes speed). Runs on the audio thread, never the page's main thread.
 *
 * It reads the input back through a moving delay line: a delay that shrinks raises the pitch, one that grows lowers
 * it. When the delay runs out of room it starts a second read head one splice length away and crossfades to it over
 * 15 ms. Close to the original pitch splices are rare (one a second at 5%), so the sound stays clean; large shifts
 * splice constantly and sound grainy, which is the honest limit of a shifter this cheap: about four multiply-adds
 * per sample per channel and no FFT.
 */
// The engine compensates for the delay this adds (about SPLICE seconds); keep PITCH_LATENCY in fx.mjs in step
const SPLICE = 0.05;
const FADE = 0.015;
const MIN_DELAY = 4;
const SIZE = 32768;

class DalSegnoPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "ratio", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" }];
  }

  constructor() {
    super();
    this.splice = Math.round(SPLICE * sampleRate);
    this.fadeLength = Math.round(FADE * sampleRate);
    this.mask = SIZE - 1;
    this.lines = [];
    this.write = 0;
    this.delay = MIN_DELAY + this.splice;
    this.fading = 0;
    this.oldDelay = 0;
  }

  read(line, delay) {
    const pos = this.write - delay;
    const i = Math.floor(pos);
    const frac = pos - i;
    const a = line[i & this.mask];
    const b = line[(i + 1) & this.mask];
    return a + ((b - a) * frac);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const channels = output.length;
    if ( !channels ) return true;
    while ( this.lines.length < channels ) this.lines.push(new Float32Array(SIZE));
    const ratio = parameters.ratio[0];
    const drift = 1 - ratio;
    // Splice early enough that the old head, still moving during its fade, never reads ahead of the write position
    const minDelay = MIN_DELAY + (this.fadeLength * Math.max(0, -drift));
    const maxDelay = minDelay + (2 * this.splice);
    const frames = output[0].length;
    const startWrite = this.write;
    const startDelay = this.delay;
    const startFading = this.fading;
    const startOld = this.oldDelay;
    for ( let c = 0; c < channels; c++ ) {
      const line = this.lines[c];
      const src = input[c] ?? input[0];
      const out = output[c];
      this.write = startWrite;
      this.delay = startDelay;
      this.fading = startFading;
      this.oldDelay = startOld;
      for ( let n = 0; n < frames; n++ ) {
        line[this.write & this.mask] = src ? src[n] : 0;
        let value = this.read(line, this.delay);
        if ( this.fading > 0 ) {
          const g = this.fading / this.fadeLength;
          value = (value * (1 - g)) + (this.read(line, this.oldDelay) * g);
          this.oldDelay += drift;
          this.fading--;
        }
        out[n] = value;
        this.delay += drift;
        if ( (this.fading === 0) && ((this.delay < minDelay) || (this.delay > maxDelay)) ) {
          this.oldDelay = this.delay;
          this.delay += (this.delay < minDelay) ? this.splice : -this.splice;
          this.fading = this.fadeLength;
        }
        this.write++;
      }
    }
    return true;
  }
}

registerProcessor("dal-segno-pitch", DalSegnoPitch);

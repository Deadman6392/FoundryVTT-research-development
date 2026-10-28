/**
 * Waveform helpers for the section editor: drawing data and loop-point matching on a low-rate mono copy of a track.
 * Pure functions on Float32Arrays.
 */

/**
 * Average channels into one.
 * @param {Float32Array[]} channels
 * @returns {Float32Array}
 */
export function mixToMono(channels) {
  if ( channels.length === 1 ) return channels[0];
  const out = new Float32Array(channels[0].length);
  for ( const data of channels ) {
    for ( let i = 0; i < out.length; i++ ) out[i] += data[i];
  }
  const scale = 1 / channels.length;
  for ( let i = 0; i < out.length; i++ ) out[i] *= scale;
  return out;
}

/**
 * Minimum and maximum per bucket over a stretch of samples, for drawing.
 * @param {Float32Array} samples
 * @param {number} buckets
 * @param {number} [from=0]   First sample
 * @param {number} [to]       One past the last sample
 * @returns {Float32Array}    [min0, max0, min1, max1, ...]
 */
export function peaks(samples, buckets, from = 0, to = samples.length) {
  const out = new Float32Array(buckets * 2);
  const span = Math.max(0, to - from);
  for ( let b = 0; b < buckets; b++ ) {
    const start = from + Math.floor((b * span) / buckets);
    const end = Math.max(start + 1, from + Math.floor(((b + 1) * span) / buckets));
    let min = 0;
    let max = 0;
    for ( let i = Math.max(0, start); i < Math.min(end, samples.length); i++ ) {
      const v = samples[i];
      if ( v < min ) min = v;
      if ( v > max ) max = v;
    }
    out[b * 2] = min;
    out[(b * 2) + 1] = max;
  }
  return out;
}

/**
 * How alike two stretches of the same signal are: normalized cross-correlation, 1 for identical shapes.
 */
function similarity(samples, a, b, length) {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for ( let i = 0; i < length; i++ ) {
    const x = samples[a + i] ?? 0;
    const y = samples[b + i] ?? 0;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return (aa && bb) ? ab / Math.sqrt(aa * bb) : 0;
}

/**
 * Suggest a loop end near a rough one, so that jumping from it back to the loop start sounds continuous: the point
 * whose following audio best matches the audio after the loop start. Searches `search` seconds either side.
 * @param {Float32Array} samples   Mono
 * @param {number} rate            Sample rate of `samples`
 * @param {number} loopStart       Seconds
 * @param {number} roughEnd        Seconds
 * @param {object} [options]
 * @param {number} [options.search=0.25]  Seconds either side of roughEnd to try
 * @param {number} [options.window=0.08]  Seconds of audio compared
 * @returns {{end: number, score: number}}
 */
export function matchLoopEnd(samples, rate, loopStart, roughEnd, { search = 0.25, window = 0.08 } = {}) {
  const start = Math.round(loopStart * rate);
  const length = Math.max(8, Math.round(window * rate));
  const center = Math.round(roughEnd * rate);
  const reach = Math.round(search * rate);
  let best = { index: center, score: -Infinity };
  // Coarse pass every few samples, then every sample around the best
  const step = Math.max(1, Math.round(rate / 4000));
  const consider = i => {
    if ( (i <= start) || (i + length > samples.length) ) return;
    const score = similarity(samples, start, i, length);
    if ( score > best.score ) best = { index: i, score };
  };
  for ( let i = center - reach; i <= center + reach; i += step ) consider(i);
  const coarse = best.index;
  for ( let i = coarse - step; i <= coarse + step; i++ ) consider(i);
  if ( best.score === -Infinity ) return { end: roughEnd, score: 0 };
  return { end: best.index / rate, score: best.score };
}

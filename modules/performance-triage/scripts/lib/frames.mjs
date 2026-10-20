/**
 * Pure helpers for interpreting frame rate measurements.
 */

/** Milliseconds per frame at a given frame rate. */
export const frameMs = fps => (fps > 0 ? 1000 / fps : Infinity);

/**
 * Turn "frame rate with layer X hidden" measurements into per-layer costs.
 * Frame time is what adds up, not frame rate: going from 18 to 30 fps saves 22 ms per frame.
 * @param {number} baseline                   Frame rate with everything visible
 * @param {{id: string, label: string, fps: number}[]} measurements
 * @param {number} [displayLimit]             Rates near this are capped by the display, so savings are a minimum
 * @returns {{id: string, label: string, fps: number, savedMs: number, atLimit: boolean}[]}
 */
export function frameCostRows(baseline, measurements, displayLimit = 60) {
  const base = frameMs(baseline);
  return measurements.map(m => ({
    ...m,
    savedMs: Math.round((base - frameMs(m.fps)) * 10) / 10,
    atLimit: m.fps >= displayLimit * 0.95
  })).sort((a, b) => b.savedMs - a.savedMs);
}

/**
 * Estimate when startup actually finished: start at the end of the ready handlers and extend through any long
 * frames that begin within `gapMs` of the previous one, so a module's post-ready freeze counts as loading.
 * @param {number} readyComplete
 * @param {{start: number, duration: number}[]} frames
 */
export function settledAt(readyComplete, frames, gapMs = 2000) {
  if ( !Number.isFinite(readyComplete) ) return null;
  let end = readyComplete;
  for ( const f of [...frames].sort((a, b) => a.start - b.start) ) {
    if ( (f.start + f.duration) <= end ) continue;
    if ( f.start > end + gapMs ) break;
    end = f.start + f.duration;
  }
  return end;
}

/** Which startup phases (marks) fall inside a frame. */
export function phasesWithin(frame, marks) {
  const end = frame.start + frame.duration;
  return Object.entries(marks ?? {})
    .filter(([, at]) => (at >= frame.start) && (at <= end))
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name);
}

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

/**
 * Estimate how long the page sat idle waiting for the world data. Foundry receives the whole world in one WebSocket
 * message and calls init in the task that handles it (in every report so far, the long frame containing init starts
 * with that message), so that frame's start is when the data arrived. Before it, back to the point the page's own
 * scripts had run, the browser was waiting on the server and the network.
 * @param {{navigation?: object, marks?: object}} timeline
 * @param {{start: number, duration: number}[]} frames   Long frames recorded during startup
 * @returns {{from: number, to: number, ms: number}|null}  Null when no long frame contains init
 */
export function worldDataWait(timeline, frames) {
  const init = timeline?.marks?.init;
  if ( !Number.isFinite(init) ) return null;
  const frame = (frames ?? []).find(f => (f.start <= init) && (init <= f.start + f.duration));
  if ( !frame ) return null;
  const from = Math.max(timeline.navigation?.domContentLoaded ?? 0, timeline.marks.scriptEval ?? 0);
  if ( frame.start <= from ) return null;
  return { from, to: frame.start, ms: frame.start - from };
}

/**
 * The transport: where playback is, as a function of the server's clock, so every client computes the same answer.
 *
 * A transport is an anchor ("at server time `at`, playback was at `pos` in section `section`") plus a rate and an
 * optional scheduled jump ("at server time `jump.at`, continue from the start of section `jump.section`"). Clients never
 * exchange positions while playing: each one walks the arrangement forward from the anchor using
 * `game.time.serverTime`. The GM writes a new transport only when someone presses a control, and every change that
 * moves the playhead is a jump a fraction of a second in the future, so all clients receive it before it happens and
 * switch together.
 *
 * Pure functions; times are server milliseconds, positions are file seconds.
 */
import {
  CONTIGUOUS, advance, isContiguous, locate, nextSegment, sectionEnd, secondsToEnd, segmentFrom
} from "./arrangement.mjs";

export const MIN_RATE = 0.25;
export const MAX_RATE = 4;

/** @typedef {{at: number, section: number, pos: number, timing: "now"|"boundary"}} Jump */
/**
 * @typedef {object} Transport
 * @property {"playing"|"paused"|"stopped"} status
 * @property {number} at          Server time of the anchor
 * @property {number} section     Section index at the anchor
 * @property {number} pos         File position at the anchor
 * @property {number} rate        Playback speed
 * @property {Jump|null} jump     A change of place that takes effect at jump.at
 */

/** A transport parked at the start of an arrangement. */
export function stopped(arr, now = 0, rate = 1) {
  return { status: "stopped", at: now, section: 0, pos: arr.sections[0].start, rate: clampRate(rate), jump: null };
}

export function clampRate(rate) {
  const r = Number(rate);
  return Number.isFinite(r) ? Math.min(MAX_RATE, Math.max(MIN_RATE, r)) : 1;
}

/**
 * Where playback is at a server time.
 * `waiting` is true before a start that was scheduled slightly in the future.
 * @returns {{section: number, pos: number, ended: boolean, waiting: boolean}}
 */
export function positionAt(t, arr, duration, now) {
  if ( t.status !== "playing" ) return { section: t.section, pos: t.pos, ended: false, waiting: false };
  const base = (t.jump && (now >= t.jump.at)) ? t.jump : t;
  const elapsed = (now - base.at) / 1000;
  if ( elapsed < 0 ) return { section: base.section, pos: base.pos, ended: false, waiting: true };
  return { ...advance(arr, duration, base, elapsed * t.rate), waiting: false };
}

/**
 * Server time at which playback reaches the end of the arrangement, or null if it never will without a jump.
 * @returns {number|null}
 */
export function endsAt(t, arr, duration) {
  if ( t.status !== "playing" ) return null;
  const fromAnchor = t.at + (secondsToEnd(arr, duration, t, t.rate) * 1000);
  if ( t.jump && (t.jump.at < fromAnchor) ) {
    const fromJump = t.jump.at + (secondsToEnd(arr, duration, t.jump, t.rate) * 1000);
    return Number.isFinite(fromJump) ? fromJump : null;
  }
  return Number.isFinite(fromAnchor) ? fromAnchor : null;
}

/**
 * The same playback re-anchored at `now`. A jump that has already happened is folded into the anchor; one still in
 * the future is kept.
 * @returns {Transport}
 */
export function rebase(t, arr, duration, now) {
  if ( t.status !== "playing" ) return { ...t, jump: null };
  const p = positionAt(t, arr, duration, now);
  if ( p.waiting ) return { ...t };
  const jump = (t.jump && (t.jump.at > now)) ? t.jump : null;
  if ( p.ended ) return { ...t, status: "stopped", at: now, section: 0, pos: arr.sections[0].start, jump: null };
  return { ...t, at: now, section: p.section, pos: p.pos, jump };
}

/**
 * Server time of the first section boundary (the end of the current pass through a section, including the current
 * loop iteration) at least `lead` ms from now, or null if there is none (a section of unknown length).
 */
export function nextBoundary(t, arr, duration, now, lead) {
  const soonest = now + lead;
  const p = positionAt(t, arr, duration, soonest);
  if ( p.ended ) return null;
  const end = sectionEnd(arr.sections[p.section], duration);
  if ( !Number.isFinite(end) ) return null;
  return soonest + (((end - p.pos) / t.rate) * 1000);
}

/* -------------------------------------------- */
/*  Controls                                    */
/* -------------------------------------------- */

/**
 * Start or resume. A stopped transport starts from the first section; a paused one from where it paused.
 * @param {number} lead   Milliseconds to wait so every client can load and start together
 */
export function play(t, arr, duration, now, lead) {
  if ( t.status === "playing" ) return { ...t };
  const from = (t.status === "stopped") ? { section: 0, pos: arr.sections[0].start } : { section: t.section, pos: t.pos };
  return { ...t, status: "playing", at: now + lead, ...from, jump: null };
}

/** Pause where playback is now. */
export function pause(t, arr, duration, now) {
  if ( t.status !== "playing" ) return { ...t };
  const p = positionAt(t, arr, duration, now);
  if ( p.ended ) return stopped(arr, now, t.rate);
  return { ...t, status: "paused", at: now, section: p.section, pos: p.pos, jump: null };
}

/**
 * Move the playhead to a file position. While playing this is a jump `lead` ms ahead so clients switch together; a
 * position in a skipped gap moves to the next section's start.
 */
export function seek(t, arr, duration, now, lead, pos) {
  const target = locate(arr, duration, Math.max(0, Number(pos) || 0));
  if ( t.status !== "playing" ) return { ...t, status: "paused", at: now, ...target, jump: null };
  const base = rebase(t, arr, duration, now);
  if ( base.status !== "playing" ) return { ...base, status: "paused", ...target };
  return { ...base, jump: { at: now + lead, ...target, timing: "now" } };
}

/**
 * Go to the start of a section: at the end of the current pass through the current section ("boundary", the musical
 * choice, so a loop finishes its phrase), or `lead` ms from now ("now").
 */
export function jumpTo(t, arr, duration, now, lead, target, timing = "boundary") {
  const section = Math.min(arr.sections.length - 1, Math.max(0, Math.trunc(target) || 0));
  const pos = arr.sections[section].start;
  if ( t.status !== "playing" ) return { ...t, status: (t.status === "stopped") ? "paused" : t.status, at: now, section, pos, jump: null };
  const base = rebase(t, arr, duration, now);
  if ( base.status !== "playing" ) return base;
  const unanchored = { ...base, jump: null };
  const boundary = (timing === "boundary") ? nextBoundary(unanchored, arr, duration, now, lead) : null;
  const at = boundary ?? (now + lead);
  return { ...base, jump: { at, section, pos, timing: (boundary === null) ? "now" : "boundary" } };
}

/** Drop a scheduled jump that hasn't happened yet. */
export function cancelJump(t, arr, duration, now) {
  return { ...rebase(t, arr, duration, now), jump: null };
}

/**
 * Change speed from now on. A jump waiting for a section boundary is re-timed, since the boundary moves with the speed.
 */
export function setRate(t, arr, duration, now, lead, rate) {
  const base = { ...rebase(t, arr, duration, now), rate: clampRate(rate) };
  const pending = base.jump;
  if ( !pending || (base.status !== "playing") ) return base;
  if ( pending.timing !== "boundary" ) return base;
  return jumpTo({ ...base, jump: null }, arr, duration, now, lead, pending.section, "boundary");
}

/* -------------------------------------------- */
/*  Runs: what the audio engine schedules       */
/* -------------------------------------------- */

/**
 * @typedef {object} Run
 * @property {number} from      File position the run starts at
 * @property {number} to        File position it ends at
 * @property {number} start     Server time it starts
 * @property {number} end       Server time it ends (Infinity if open-ended)
 * @property {number} section   Section it starts in
 * @property {boolean} last     Playback ends when this run does
 */

/**
 * The stretches of uninterrupted file playback from a server time on. A run ends wherever playback jumps to another
 * place in the file (a loop going round, a skipped gap, a scheduled jump); where one section simply continues into
 * the next, including a jump that lands exactly where playback already is, the run carries on, so the engine plays
 * it from one source with no seam at all. Lazy, because a loop yields runs forever.
 * @param {Transport} t
 * @param {object} arr
 * @param {number} duration
 * @param {number} now      Server time to start from
 * @returns {Generator<Run>}
 */
export function* runsFrom(t, arr, duration, now) {
  if ( t.status !== "playing" ) return;
  const p = positionAt(t, arr, duration, now);
  if ( p.ended ) return;
  let jump = t.jump;
  let time = now;
  if ( p.waiting ) time = (jump && (now >= jump.at)) ? jump.at : t.at;
  if ( jump && (jump.at <= now) ) jump = null;
  const rate = t.rate;
  let seg = segmentFrom(arr, duration, p.section, p.pos);
  let run = { from: seg.from, start: time, section: seg.section };
  for ( let guard = 0; guard < 100_000; guard++ ) {
    const segEnd = time + (((seg.to - seg.from) / rate) * 1000);
    // A jump timed for a section boundary lands on it within rounding, and must win over the natural next segment
    if ( jump && (jump.at <= segEnd + 1) ) {
      const cut = Math.min(seg.to, seg.from + (((jump.at - time) / 1000) * rate));
      const landing = segmentFrom(arr, duration, jump.section, jump.pos);
      if ( Math.abs(cut - landing.from) >= CONTIGUOUS ) {
        yield { ...run, to: cut, end: jump.at, last: false };
        run = { from: landing.from, start: jump.at, section: landing.section };
      }
      seg = landing;
      time = jump.at;
      jump = null;
      continue;
    }
    if ( !Number.isFinite(segEnd) ) {
      yield { ...run, to: seg.to, end: Infinity, last: true };
      return;
    }
    const next = nextSegment(arr, duration, seg);
    if ( !next ) {
      yield { ...run, to: seg.to, end: segEnd, last: true };
      return;
    }
    if ( !isContiguous(seg, next) ) {
      yield { ...run, to: seg.to, end: segEnd, last: false };
      run = { from: next.from, start: segEnd, section: next.section };
    }
    seg = next;
    time = segEnd;
  }
}

/**
 * Arrangements: how one audio file is played as a sequence of sections.
 *
 * A section is a region of the file. Sections play in list order; a looping section repeats until the GM moves on,
 * and anything between sections is skipped. Intro, loop and ending is three sections; "loop only the good part" is
 * one looping section; cutting out a bad stretch is two sections with a gap between them.
 *
 * Positions here are file positions in seconds. A section's `end` may be null, meaning the end of the file, which
 * every function resolves with the file's duration when it is known and treats as unbounded when it is not.
 * Nothing in this file touches Foundry or the browser.
 */

export const MAX_SECTIONS = 16;

/** Sections shorter than this are dropped: they could not be heard and would make a loop spin. */
export const MIN_SECTION = 0.05;

/** Longest crossfade a GM can set at a jump, in seconds. */
export const MAX_SEAM = 4;

/** Two positions closer than this are the same point in the file: the second section simply continues the first. */
export const CONTIGUOUS = 0.002;

const finite = (value, fallback) => (Number.isFinite(Number(value)) && (value !== null) && (value !== "") ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Clean up an arrangement from a flag, a form or a macro. Returns null when nothing playable is left, so callers fall
 * back to playing the whole file.
 * @param {object} raw
 * @param {number} [duration]   The file's duration, when known; sections are clipped to it
 * @returns {{sections: {label: string, start: number, end: number|null, loop: boolean}[], seam: number}|null}
 */
export function normalizeArrangement(raw, duration) {
  if ( !raw || !Array.isArray(raw.sections) ) return null;
  const limit = Number.isFinite(duration) && (duration > 0) ? duration : Infinity;
  const sections = [];
  for ( const s of raw.sections.slice(0, MAX_SECTIONS) ) {
    if ( !s || (typeof s !== "object") ) continue;
    const start = clamp(finite(s.start, 0), 0, limit);
    let end = finite(s.end, null);
    if ( end !== null ) end = Math.min(end, limit);
    if ( (end !== null) && (end - start < MIN_SECTION) ) continue;
    if ( (end === null) && (limit - start < MIN_SECTION) ) continue;
    sections.push({ label: String(s.label ?? "").slice(0, 40), start, end: (end === limit) ? null : end, loop: Boolean(s.loop) });
  }
  if ( !sections.length ) return null;
  return { sections, seam: clamp(finite(raw.seam, 0), 0, MAX_SEAM) };
}

/**
 * The arrangement a sound without one plays: the whole file, looping if the sound repeats.
 * @param {boolean} repeat
 */
export function wholeFile(repeat = false) {
  return { sections: [{ label: "", start: 0, end: null, loop: Boolean(repeat) }], seam: 0 };
}

/** Does this arrangement do anything beyond playing the file straight through (or looping it whole)? */
export function isArranged(arr) {
  if ( !arr?.sections?.length ) return false;
  if ( arr.sections.length > 1 ) return true;
  const [s] = arr.sections;
  return (s.start > 0) || (s.end !== null);
}

/** Where a section ends, in file seconds. */
export function sectionEnd(section, duration) {
  const limit = Number.isFinite(duration) && (duration > 0) ? duration : Infinity;
  return (section.end === null) ? limit : Math.min(section.end, limit);
}

/**
 * The section a file position belongs to: the first section in play order that contains it, else the first that
 * starts after it (the position is in a skipped gap), else the last section.
 * @returns {number}
 */
export function sectionAt(arr, duration, pos) {
  const { sections } = arr;
  const inside = sections.findIndex(s => (pos >= s.start - CONTIGUOUS) && (pos < sectionEnd(s, duration)));
  if ( inside >= 0 ) return inside;
  let best = -1;
  for ( const [i, s] of sections.entries() ) {
    if ( (s.start > pos) && ((best < 0) || (s.start < sections[best].start)) ) best = i;
  }
  return (best >= 0) ? best : sections.length - 1;
}

/**
 * Clamp a requested position into a section: a position in a skipped gap moves to the section's start.
 * @returns {{section: number, pos: number}}
 */
export function locate(arr, duration, pos) {
  const section = sectionAt(arr, duration, pos);
  const s = arr.sections[section];
  const end = sectionEnd(s, duration);
  return { section, pos: clamp(pos, s.start, Number.isFinite(end) ? Math.max(s.start, end - MIN_SECTION) : pos) };
}

/**
 * Walk forward through the arrangement by an amount of file time.
 * @param {object} arr
 * @param {number} duration
 * @param {{section: number, pos: number}} from
 * @param {number} elapsed      File seconds to advance (wall seconds times the playback rate)
 * @returns {{section: number, pos: number, ended: boolean}}
 */
export function advance(arr, duration, from, elapsed) {
  const { sections } = arr;
  let i = clamp(Math.trunc(from.section) || 0, 0, sections.length - 1);
  let pos = from.pos;
  let left = Math.max(0, elapsed);
  for ( ;; ) {
    const s = sections[i];
    const end = sectionEnd(s, duration);
    const remaining = end - pos;
    if ( left < remaining ) return { section: i, pos: pos + left, ended: false };
    left -= Math.max(0, remaining);
    if ( s.loop ) {
      const length = end - s.start;
      if ( !(length > 0) ) return { section: i, pos: s.start, ended: false };
      return { section: i, pos: s.start + (left % length), ended: false };
    }
    if ( i + 1 >= sections.length ) return { section: i, pos: end, ended: true };
    i += 1;
    pos = sections[i].start;
  }
}

/**
 * Wall-clock seconds from a point until playback reaches the end of the arrangement, or Infinity if a looping
 * section (or a section of unknown length) comes first.
 */
export function secondsToEnd(arr, duration, from, rate = 1) {
  const { sections } = arr;
  let total = 0;
  let pos = from.pos;
  for ( let i = from.section; i < sections.length; i++ ) {
    const s = sections[i];
    if ( s.loop ) return Infinity;
    const end = sectionEnd(s, duration);
    if ( !Number.isFinite(end) ) return Infinity;
    total += Math.max(0, end - pos);
    pos = sections[i + 1]?.start ?? 0;
  }
  return total / rate;
}

/* -------------------------------------------- */
/*  Segments: what the audio engine schedules   */
/* -------------------------------------------- */

/**
 * The stretch of file the engine plays next, from a position to the end of its section.
 * @returns {{section: number, from: number, to: number}}
 */
export function segmentFrom(arr, duration, section, pos) {
  return { section, from: pos, to: sectionEnd(arr.sections[section], duration) };
}

/**
 * The segment that follows one when it plays out: the same section again if it loops, else the next section.
 * @returns {{section: number, from: number, to: number}|null}   null when the arrangement ends
 */
export function nextSegment(arr, duration, segment) {
  const s = arr.sections[segment.section];
  if ( s.loop ) return segmentFrom(arr, duration, segment.section, s.start);
  const i = segment.section + 1;
  if ( i >= arr.sections.length ) return null;
  return segmentFrom(arr, duration, i, arr.sections[i].start);
}

/** Does playback continue straight on from one segment into the other, with no jump in the file? */
export function isContiguous(a, b) {
  return Boolean(a && b) && (Math.abs(a.to - b.from) < CONTIGUOUS);
}

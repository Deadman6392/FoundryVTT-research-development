/**
 * A short history of this computer's loads, so changes to the world (archiving scenes, disabling a module) can be
 * compared with real numbers instead of memory. Pure helpers; the glue that reads and writes storage is history.mjs.
 */
import { settledAt, worldDataWait } from "./frames.mjs";

/** Loads kept per computer; enough to see a trend across a few sessions of changes. */
export const HISTORY_LIMIT = 20;

const round = n => (Number.isFinite(n) ? Math.round(n) : null);

/**
 * Summarize one load.
 * @param {object} input
 * @param {object} input.timeline      {navigation, marks}
 * @param {{start: number, duration: number}[]} input.frames   Long frames, load and play
 * @param {object} [input.counts]      {scenes, tokens, actors, modules}
 * @param {number|null} [input.worldBytes]  World data size, when the hook profiler measured it
 * @param {number|null} [input.fps]
 * @param {string} [input.profile]
 * @param {string} [input.user]       Who logged in: one browser can be used for several logins, sharing storage
 * @param {boolean} [input.gm]
 * @param {number} [input.now]
 */
export function loadEntry({ timeline, frames, counts = {}, worldBytes = null, fps = null, profile = "none", user = "",
  gm = false, now = Date.now() }) {
  const marks = timeline?.marks ?? {};
  const wait = worldDataWait(timeline, frames);
  return {
    at: now,
    user,
    gm,
    usable: round(settledAt(marks.readyComplete, frames) ?? marks.readyComplete ?? marks.ready),
    wait: round(wait?.ms),
    build: round(marks.setup - marks.init),
    readyHandlers: round(marks.readyComplete - marks.ready),
    scenes: counts.scenes ?? null,
    tokens: counts.tokens ?? null,
    actors: counts.actors ?? null,
    modules: counts.modules ?? null,
    worldBytes: Number.isFinite(worldBytes) ? worldBytes : null,
    fps: Number.isFinite(fps) ? fps : null,
    profile
  };
}

/** Parse stored history defensively: storage can hold anything, including another version's format. */
export function parseHistory(raw) {
  try {
    const list = JSON.parse(raw ?? "[]");
    return Array.isArray(list) ? list.filter(e => e && Number.isFinite(e.at)) : [];
  } catch {
    return [];
  }
}

/** Newest first, at most `limit` entries. */
export function appendHistory(list, entry, limit = HISTORY_LIMIT) {
  return [entry, ...list].slice(0, limit);
}

/** The middle value, which a single slow server response doesn't drag around the way an average does. */
export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if ( !v.length ) return null;
  const mid = Math.floor(v.length / 2);
  return (v.length % 2) ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

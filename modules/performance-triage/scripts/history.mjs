/**
 * Records one entry per load in this browser's localStorage, about a minute after the game is ready (long frames and
 * the frame rate sample are in by then). Loaded on demand; one small local write per load, nothing is sent anywhere.
 */
import { MODULE_ID, STORAGE_KEYS } from "./constants.mjs";
import { telemetry, timelineSnapshot } from "./telemetry.mjs";
import { loadEntry, parseHistory, appendHistory } from "./lib/history.mjs";

function longFrames() {
  return [...(telemetry.longFrames.load?.worst?.items ?? []), ...(telemetry.longFrames.play?.worst?.items ?? [])];
}

export function readHistory() {
  try {
    return parseHistory(globalThis.localStorage?.getItem(STORAGE_KEYS.history));
  } catch {
    return [];
  }
}

/** @param {string} profile   The profile this client is running */
export function recordLoad(profile) {
  let tokens = 0;
  for ( const scene of game.scenes ?? [] ) tokens += scene.tokens?.size ?? 0;
  const worldBytes = telemetry.payload?.sections?.reduce((a, s) => a + s.bytes, 0) ?? null;
  const entry = loadEntry({
    timeline: timelineSnapshot(),
    frames: longFrames(),
    counts: {
      scenes: game.scenes?.size ?? null,
      tokens,
      actors: game.actors?.size ?? null,
      modules: game.modules?.filter ? game.modules.filter(m => m.active).length : null
    },
    worldBytes,
    fps: telemetry.fps?.achieved ?? null,
    profile
  });
  try {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(appendHistory(readHistory(), entry)));
  } catch(err) {
    console.warn(`${MODULE_ID} | Could not save load history`, err);
  }
  return entry;
}

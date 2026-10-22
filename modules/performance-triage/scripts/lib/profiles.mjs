/**
 * Client performance profiles and the pure planning logic used to apply and revert them.
 *
 * A profile is a set of client-scoped setting overrides plus a few runtime tweaks (chat batch size, idle throttle).
 * Settings keys are "namespace.key". Third-party keys are only applied when that package registered the setting as
 * client-scoped, so a profile never touches world data and never fails because a module is missing.
 */

export const PROFILE_IDS = ["none", "balanced", "low", "minimum", "nocanvas"];

const LOW_SETTINGS = {
  "core.performanceMode": 0,
  "core.maxFPS": 30,
  "core.pixelRatioResolutionScaling": false,
  "core.lightAnimation": false,
  "core.visionAnimation": false,
  "tokenmagic.disableAnimations": true,
  // Draws Sequencer's above-interface effects in the canvas instead of a second full-window canvas over the UI
  // (Sequencer's own hint warns of "a significant performance hit"); read in its init hook, so it needs a reload
  "sequencer.enable-above-ui-screenspace": false
};

export const PROFILES = {
  none: {
    id: "none",
    settings: {},
    chatBatchSize: null,
    idle: null
  },
  balanced: {
    id: "balanced",
    settings: {
      "core.performanceMode": 1
    },
    chatBatchSize: 50,
    idle: { fps: 20, delay: 30, onBlur: true }
  },
  low: {
    id: "low",
    settings: LOW_SETTINGS,
    chatBatchSize: 25,
    idle: { fps: 10, delay: 15, onBlur: true }
  },
  minimum: {
    id: "minimum",
    settings: {
      ...LOW_SETTINGS,
      "core.maxFPS": 20,
      "core.mipmap": false,
      "core.tokenDragPreview": false,
      "core.chatBubbles": false,
      "core.scrollingStatusText": false,
      "core.animateRollTable": false,
      "sequencer.effectsEnabled": false,
      "fxmaster.enable": false,
      // Aura radius drawings off on this computer; the auras themselves still apply
      "auraeffects.disableVisuals": true
    },
    chatBatchSize: 15,
    idle: { fps: 10, delay: 5, onBlur: true }
  },
  nocanvas: {
    id: "nocanvas",
    settings: {
      "core.noCanvas": true,
      "core.chatBubbles": false,
      "core.animateRollTable": false,
      "tokenmagic.disableAnimations": true,
      "sequencer.effectsEnabled": false,
      "fxmaster.enable": false
    },
    chatBatchSize: 15,
    idle: null
  }
};

/** Setting keys whose new value is only read during early startup, so changing them needs a reload. */
export const EARLY_KEYS = new Set(["core.noCanvas"]);

/**
 * Decide which profile this client should use.
 * A player's own choice wins over the GM's assignment, which wins over the GM's default for players.
 * The default never applies to GM users; they can still be assigned explicitly or choose for themselves.
 * @param {object} args
 * @param {string} args.selfChoice     The client's own setting: "gm" to follow the GM, or a profile id
 * @param {object} args.assignments    The world setting: { [userId]: profileId, "*": profileId }
 * @param {string} args.userId
 * @param {boolean} [args.isGM]
 */
export function resolveProfileId({ selfChoice, assignments, userId, isGM = false }) {
  if ( selfChoice && (selfChoice !== "gm") && PROFILES[selfChoice] ) return selfChoice;
  const assigned = assignments?.[userId];
  if ( assigned && (assigned !== "default") && PROFILES[assigned] ) return assigned;
  const fallback = assignments?.["*"];
  if ( !isGM && fallback && PROFILES[fallback] ) return fallback;
  return "none";
}

/** Split "namespace.key" at the first dot; setting keys themselves may contain dots. */
export function splitSettingKey(fullKey) {
  const i = fullKey.indexOf(".");
  return [fullKey.slice(0, i), fullKey.slice(i + 1)];
}

/**
 * Plan the storage changes needed to move from the currently applied state to a target profile.
 * The backup always holds the user's own value from before we first touched a key, so switching between profiles
 * never overwrites it, and dropping a key from management restores exactly what the user had.
 *
 * @param {object} args
 * @param {Record<string, *>} args.target      Desired values for the keys we can manage on this client
 * @param {Record<string, *>} args.current     Current values for every key in target or in the backup
 * @param {Record<string, string|null>} args.raw   Raw stored strings for the same keys (null when unset)
 * @param {Record<string, string|null>} args.backup  The existing backup
 * @returns {{writes: {key: string, value: *}[], restores: {key: string, raw: string|null}[], backup: Record<string, string|null>}}
 */
export function planProfile({ target, current, raw, backup }) {
  const next = { ...backup };
  const writes = [];
  const restores = [];

  // Keys we managed before that the new profile no longer covers go back to the user's own value
  for ( const [key, original] of Object.entries(backup ?? {}) ) {
    if ( key in target ) continue;
    restores.push({ key, raw: original });
    delete next[key];
  }

  for ( const [key, value] of Object.entries(target) ) {
    if ( !(key in next) ) next[key] = raw[key] ?? null;
    if ( !valuesEqual(current[key], value) ) writes.push({ key, value });
  }
  return { writes, restores, backup: next };
}

export function valuesEqual(a, b) {
  if ( a === b ) return true;
  if ( (typeof a === "object") || (typeof b === "object") ) return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/**
 * Suggest a profile for a client from the summary it shared.
 * Deliberately conservative: it only suggests stepping down when there is concrete evidence of struggle.
 */
export function suggestProfile(summary) {
  if ( !summary ) return null;
  const fps = summary.fps;
  // A scene where the previous session's median stayed under half the cap counts as much as a slow first minute
  const slowScene = (summary.play?.scenes ?? [])
    .some(s => (s.minutes >= 2) && Number.isFinite(s.fps) && (s.fps < Math.min(s.target || 60, 60) * 0.5));
  const lowFps = (fps && fps.target && (fps.achieved < Math.min(fps.target, 60) * 0.5)) || slowScene;
  const slowLoad = summary.loadSeconds > 90;
  const weakHardware = ((summary.memory ?? 8) <= 4) || ((summary.cores ?? 8) <= 2) || ((summary.maxTexture ?? 16384) <= 4096);
  if ( lowFps && weakHardware ) return "minimum";
  if ( lowFps || (slowLoad && weakHardware) ) return "low";
  if ( weakHardware || slowLoad ) return "balanced";
  return null;
}

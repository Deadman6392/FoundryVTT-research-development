/**
 * Applies the effective profile to this client's settings.
 *
 * Client-scoped settings live in localStorage as JSON strings. Writing them during the "setup" hook, before the canvas
 * is created, means the canvas starts with the right settings and no redraw happens. Every write is verified by
 * reading the value back through the settings API; if that ever disagrees (a future storage change), the write is
 * reverted and redone through game.settings.set once the game is ready.
 */
import { MODULE_ID } from "./constants.mjs";
import { PROFILES, EARLY_KEYS, planProfile, splitSettingKey, valuesEqual } from "./lib/profiles.mjs";

function clientStorage() {
  return game.settings.storage.get("client");
}

function settingConfig(fullKey) {
  return game.settings.settings.get(fullKey);
}

function getValue(fullKey) {
  try {
    return game.settings.get(...splitSettingKey(fullKey));
  } catch {
    return undefined;
  }
}

function needsReloadFor(fullKey) {
  if ( EARLY_KEYS.has(fullKey) ) return true;
  // Third-party modules usually read reload-flagged settings in their own init, which has already run
  return !fullKey.startsWith("core.") && !!settingConfig(fullKey)?.requiresReload;
}

/** Profile settings this client can manage right now: registered, client-scoped keys only. */
function manageableTarget(profile) {
  const target = {};
  const pending = [];
  for ( const [key, value] of Object.entries(profile.settings) ) {
    const config = settingConfig(key);
    if ( !config ) {
      const ns = key.split(".")[0];
      if ( (ns === "core") || game.modules.get(ns)?.active ) pending.push(key);
      continue;
    }
    if ( config.scope === "client" ) target[key] = value;
  }
  return { target, pending };
}

/**
 * Apply or revert profile settings. Safe to call more than once; it only writes what differs.
 * @param {string} profileId
 * @param {"setup"|"ready"} phase
 * @returns {Promise<{changed: string[], deferred: string[], needsReload: boolean}>}
 */
export async function applyProfile(profileId, phase) {
  const profile = PROFILES[profileId] ?? PROFILES.none;
  const storage = clientStorage();
  const backup = game.settings.get(MODULE_ID, "backup") ?? {};
  const { target, pending } = manageableTarget(profile);

  // Keys that belong to a module which has not registered them yet must keep their backup until it does
  const keepBackup = {};
  for ( const key of pending ) if ( key in backup ) keepBackup[key] = backup[key];
  const workingBackup = { ...backup };
  for ( const key of Object.keys(keepBackup) ) delete workingBackup[key];

  const keys = new Set([...Object.keys(target), ...Object.keys(workingBackup)]);
  const current = {};
  const raw = {};
  for ( const key of keys ) {
    current[key] = getValue(key);
    raw[key] = storage.getItem(key);
  }
  const plan = planProfile({ target, current, raw, backup: workingBackup });

  const changed = [];
  const deferred = [];
  let needsReload = false;

  for ( const { key, raw: original } of plan.restores ) {
    if ( original === null ) storage.removeItem(key);
    else storage.setItem(key, original);
    changed.push(key);
    needsReload ||= needsReloadFor(key);
  }

  for ( const { key, value } of plan.writes ) {
    if ( phase === "setup" ) {
      const before = storage.getItem(key);
      storage.setItem(key, JSON.stringify(value));
      if ( !valuesEqual(getValue(key), value) ) {
        if ( before === null ) storage.removeItem(key);
        else storage.setItem(key, before);
        deferred.push(key);
        continue;
      }
    } else {
      try {
        await game.settings.set(...splitSettingKey(key), value);
      } catch(err) {
        console.warn(`${MODULE_ID} | Could not apply ${key}`, err);
        continue;
      }
    }
    changed.push(key);
    needsReload ||= needsReloadFor(key);
  }

  await game.settings.set(MODULE_ID, "backup", { ...plan.backup, ...keepBackup });
  await game.settings.set(MODULE_ID, "appliedProfile", profile.id);
  if ( changed.length ) console.info(`${MODULE_ID} | Profile "${profile.id}" (${phase}) changed: ${changed.join(", ")}`);
  return { changed, deferred: [...deferred, ...pending], needsReload };
}

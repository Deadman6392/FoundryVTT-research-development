/**
 * Settings of popular dnd5e modules that add work on every token move or every frame, with what each one costs and
 * what to change. Each entry was read from that module's source at the version named in it; an entry is only
 * judged when the setting is registered in the world. Pure, so the advice can be tested in Node.
 */

/** Compare dotted version strings numerically ("0.12.10" > "0.12.7"). */
export function compareVersions(a, b) {
  const pa = String(a ?? "").split(".").map(n => parseInt(n, 10) || 0);
  const pb = String(b ?? "").split(".").map(n => parseInt(n, 10) || 0);
  for ( let i = 0; i < Math.max(pa.length, pb.length); i++ ) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if ( d ) return Math.sign(d);
  }
  return 0;
}

const CPR_LEVELS = ["Low", "Medium", "High", "Ultra"];

/**
 * @typedef {object} KnownSetting
 * @property {string} module      Module id
 * @property {string} key         Setting key, or "key.path" into an object setting
 * @property {string} read        The version the behavior was read from
 * @property {(value: *, version: string) => boolean} costly
 * @property {(value: *) => string} detail
 * @property {string} fix
 */

/** @type {KnownSetting[]} */
export const KNOWN_SETTINGS = [
  {
    module: "chris-premades",
    key: "movementPerformance",
    read: "1.5.51",
    costly: value => Number(value) >= 2,
    detail: value => `Chris's Premades' Movement Event Accuracy is ${CPR_LEVELS[value] ?? value}. CPR does its movement `
      + "work on one GM's computer only. On each leg of a move it measures the distance, with walls, from the moving "
      + "token to every token on the scene before checking whether any of them has a movement macro; Ultra adds "
      + "cover. Medium does that only for the last leg, so moves with several waypoints get cheaper; Low also drops "
      + "the wall test from those checks, so a \"moves near\" effect could trigger through a wall. Auras are checked "
      + "when a move ends, with walls, at every level, so lowering it keeps them working.",
    fix: "Set Movement Event Accuracy to Medium (CPR settings, General), or Low if wall-accurate \"moves near\" "
      + "triggers don't matter at your table."
  },
  {
    module: "chris-premades",
    key: "movementPerformanceDisable",
    read: "1.5.51",
    costly: value => value === true,
    detail: () => "Chris's Premades' option to disable the movement lag warning is on. It only hides the warning; the "
      + "movement work it warned about still runs.",
    fix: "Leave it on if the warning annoys you, but use Movement Event Accuracy to change the cost."
  },
  {
    module: "ActiveAuras",
    key: "combatOnly",
    read: "0.12.7",
    // The check became an Array test in 0.12.4 (commit ae11188), which is never empty-falsy
    costly: (value, version) => (value === true) && (compareVersions(version, "0.12.4") >= 0)
      && (compareVersions(version, "0.12.7") <= 0),
    detail: () => "ActiveAuras' combat-only option is on, but in versions 0.12.4 to 0.12.7 it doesn't stop the aura "
      + "checks on token moves: its test for a running combat is always true. Auras are still checked on every move "
      + "outside combat, on the GM's computer.",
    fix: "Nothing to change on your side; a later ActiveAuras version may fix it. Report it to the module if you rely on it."
  },
  {
    module: "ActiveAuras",
    key: "wall-block",
    read: "0.12.7",
    costly: value => value === true,
    detail: () => "ActiveAuras' walls block auras option is on. For auras that follow it, each token and aura pair can "
      + "take up to 50 wall collision tests on every token move, on the GM's computer.",
    fix: "If walls don't matter for most of your auras, turn it off and set walls on the auras that need them."
  },
  {
    module: "levels",
    key: "exactTokenVisibility",
    read: "6.1.0",
    costly: value => value === true,
    detail: () => "Levels' exact token visibility is on: 11 sight tests per token instead of 5 (or 1), on every "
      + "computer, whenever token visibility is checked.",
    fix: "Turn it off unless players need to see a sliver of a token around corners."
  },
  {
    module: "levels",
    key: "tokenElevScale",
    read: "6.1.0",
    costly: value => value === true,
    detail: () => "Levels' token elevation scale is on: every token is refreshed on each elevation change and on "
      + "every change of selected token, on every computer.",
    fix: "Turn it off if the size change by elevation isn't important to your table."
  },
  {
    module: "midi-qol",
    key: "ConfigSettings.optionalRules.wallsBlockRange",
    read: "13.0.69",
    costly: value => ["centerLevels", "levelsautocover", "simplecover5e"].includes(value),
    detail: value => `midi-qol's walls block range rule is "${value}". Every range and distance check midi makes, `
      + "including the ones Chris's Premades runs for movement and auras, tests walls twice through Levels or "
      + "computes cover, instead of one wall test.",
    fix: "That rule is a game rule, not just a setting; only change it if the extra precision isn't needed."
  }
];

/** Read "a.b.c" from an object. */
function dig(value, path) {
  return path.reduce((v, k) => ((v && (typeof v === "object")) ? v[k] : undefined), value);
}

/**
 * The known settings whose current value adds cost.
 * @param {{module: string, key: string, value: *, version: string}[]} current  Values read in the world
 * @returns {{module: string, key: string, detail: string, fix: string}[]}
 */
export function costlySettings(current) {
  const out = [];
  for ( const known of KNOWN_SETTINGS ) {
    const [settingKey, ...path] = known.key.split(".");
    const found = current.find(c => (c.module === known.module) && (c.key === settingKey));
    if ( !found ) continue;
    const value = path.length ? dig(found.value, path) : found.value;
    if ( value === undefined ) continue;
    if ( known.costly(value, found.version) ) {
      out.push({ module: known.module, key: known.key, detail: known.detail(value), fix: known.fix });
    }
  }
  return out;
}

/** The setting keys to read in the world: module id and top-level key. */
export function knownSettingKeys() {
  const keys = new Map();
  for ( const k of KNOWN_SETTINGS ) keys.set(`${k.module}.${k.key.split(".")[0]}`, [k.module, k.key.split(".")[0]]);
  return [...keys.values()];
}

/* -------------------------------------------- */
/*  Aura systems                                */
/* -------------------------------------------- */

/** Modules that check auras on token moves, and where each does that work (read from their source). */
export const AURA_MODULES = {
  "chris-premades": "Chris's Premades (on one GM's computer, when a move ends)",
  ActiveAuras: "ActiveAuras (on the GM's computer, on every waypoint, and on every wall or door change)",
  auraeffects: "Aura Effects (on the computer of whoever moved the token, plus drawing radii on every computer)"
};

/** Which aura systems an embedded document (item or active effect source data) defines an aura for. */
export function auraSystemsOf(doc) {
  const found = [];
  const cpr = doc?.flags?.["chris-premades"];
  if ( (cpr?.macros?.aura?.length) || (Array.isArray(cpr?.embeddedMacros) && cpr.embeddedMacros.some(m => m?.type === "aura")) ) {
    found.push("chris-premades");
  }
  if ( doc?.flags?.ActiveAuras?.isAura === true ) found.push("ActiveAuras");
  if ( doc?.type === "auraeffects.aura" ) found.push("auraeffects");
  return found;
}

/**
 * Count aura definitions per system across actors' and tokens' items and effects (effects on items included).
 * @param {object[]} owners  Actor source data, or token delta data, each with items and effects
 * @returns {Map<string, {sources: number, owners: Set<string>}>}
 */
export function countAuras(owners) {
  const counts = new Map();
  const note = (system, owner) => {
    let c = counts.get(system);
    if ( !c ) counts.set(system, c = { sources: 0, owners: new Set() });
    c.sources++;
    if ( owner ) c.owners.add(owner);
  };
  for ( const owner of owners ) {
    const name = owner?.name ?? "";
    for ( const effect of owner?.effects ?? [] ) for ( const s of auraSystemsOf(effect) ) note(s, name);
    for ( const item of owner?.items ?? [] ) {
      for ( const s of auraSystemsOf(item) ) note(s, name);
      for ( const effect of item?.effects ?? [] ) for ( const s of auraSystemsOf(effect) ) note(s, name);
    }
  }
  return counts;
}

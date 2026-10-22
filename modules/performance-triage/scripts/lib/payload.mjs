/**
 * Size the world data the server sends every client at startup, with breakdowns of the parts that are usually
 * largest. Only loaded while the hook profiler is on, so its code costs nothing on a normal load.
 * Works on plain objects (game.data) so it can be exercised in Node tests.
 */
import { TopN } from "./aggregate.mjs";

/** Embedded collections worth naming in the scene breakdown; anything else is "other". */
const SCENE_PARTS = new Set(["tokens", "walls", "tiles", "drawings", "notes", "lights", "sounds", "regions",
  "templates", "levels", "flags"]);

/** Parts of a token's actor delta worth naming; anything else is "other". */
const DELTA_PARTS = new Set(["items", "effects", "system", "flags"]);

/** JSON of an embedded item without its edit timestamps, which differ between copies that are otherwise equal. */
function itemJson(item) {
  if ( !item || (typeof item !== "object") ) return "";
  const { _stats, ...rest } = item;
  try {
    return JSON.stringify(rest) ?? "";
  } catch {
    return "";
  }
}

/**
 * Sizes every token's actor delta. An unlinked token stores its own copy of each item that differs from the
 * sidebar actor's, so a token carrying a copy of every item weighs as much as a whole actor. Items that still match
 * the base actor exactly are counted separately:
 * they make the world bigger without making the token any different. Items whose id the base actor doesn't have
 * are additions, which the token shows on top of the base actor's items; an addition with the same name and type as
 * a base item usually means the token shows that item twice.
 */
class TokenStats {
  constructor(actorsById) {
    this.actorsById = actorsById;
    this.baseItems = new Map(); // actorId -> {byId: Map(itemId -> JSON), names: Set}, only for actors with delta items
    this.count = 0;
    this.linked = 0;
    this.deltaBytes = 0;
    this.parts = new Map();
    this.items = 0;
    this.withItems = 0;
    this.same = { items: 0, bytes: 0 };
    this.added = { items: 0, duplicates: 0, examples: [] };
    this.linkedDelta = { tokens: 0, bytes: 0 };
    this.missingActor = { tokens: 0, bytes: 0 };
    this.largest = new TopN(10, t => t.bytes);
    this.byActor = new Map();
    // Added items that look the same on many tokens: same type, name and serialized size (ids are always 16
    // characters, so they don't change the size). Items a module adds to every placed token show up here.
    this.repeated = new Map();
  }

  #base(actorId) {
    let base = this.baseItems.get(actorId);
    if ( base ) return base;
    base = { byId: new Map(), names: new Set() };
    for ( const item of this.actorsById.get(actorId)?.items ?? [] ) {
      base.byId.set(item?._id, itemJson(item));
      base.names.add(`${item?.type}:${item?.name}`);
    }
    this.baseItems.set(actorId, base);
    return base;
  }

  /** @returns {number} Serialized size of the token */
  add(token, sceneName) {
    this.count++;
    const linked = token?.actorLink === true;
    if ( linked ) this.linked++;
    let bytes = 0;
    let delta = 0;
    let items = 0;
    let same = 0;
    let effects = 0;
    const doubled = [];
    for ( const [key, value] of Object.entries(token ?? {}) ) {
      if ( (key !== "delta") || !value || (typeof value !== "object") ) {
        bytes += safeSize(value) + key.length + 3;
        continue;
      }
      for ( const [dk, dv] of Object.entries(value) ) {
        let size;
        if ( (dk === "items") && Array.isArray(dv) ) {
          size = dk.length + 5;
          const base = (!linked && dv.length && this.actorsById.has(token.actorId)) ? this.#base(token.actorId) : null;
          for ( const item of dv ) {
            const json = itemJson(item);
            const itemSize = json.length + safeSize(item?._stats) + 10;
            size += itemSize;
            if ( item?._tombstone ) continue;
            items++;
            if ( !base ) continue;
            const baseJson = base.byId.get(item?._id);
            if ( baseJson === undefined ) {
              this.added.items++;
              const key = `${item?.type}:${item?.name}:${json.length}`;
              let r = this.repeated.get(key);
              if ( !r ) {
                this.repeated.set(key, r = { name: item?.name ?? "", type: item?.type ?? "", tokens: 0, bytes: 0,
                  flags: Object.keys(item?.flags ?? {}).slice(0, 4) });
              }
              r.tokens++;
              r.bytes += itemSize;
              if ( base.names.has(`${item?.type}:${item?.name}`) ) {
                this.added.duplicates++;
                doubled.push(item?.name ?? "");
              }
            } else if ( json && (baseJson === json) ) {
              same++;
              this.same.bytes += itemSize;
            }
          }
        } else {
          size = safeSize(dv) + dk.length + 3;
          if ( (dk === "effects") && Array.isArray(dv) ) effects += dv.length;
        }
        delta += size;
        const part = DELTA_PARTS.has(dk) ? dk : "other";
        this.parts.set(part, (this.parts.get(part) ?? 0) + size);
      }
      bytes += delta + key.length + 3;
    }
    // A few examples are enough for the GM to open those tokens and check
    if ( doubled.length && (this.added.examples.length < 10) ) {
      this.added.examples.push({ scene: sceneName, token: token?.name ?? "", items: [...new Set(doubled)].slice(0, 5) });
    }
    this.deltaBytes += delta;
    this.items += items;
    this.same.items += same;
    if ( items ) this.withItems++;
    if ( linked ) {
      if ( items || effects ) {
        this.linkedDelta.tokens++;
        this.linkedDelta.bytes += delta;
      }
    } else if ( !token?.actorId || !this.actorsById.has(token.actorId) ) {
      this.missingActor.tokens++;
      this.missingActor.bytes += bytes;
    }
    this.largest.add({ scene: sceneName, name: token?.name ?? "", linked, bytes, delta, items, same, effects });
    const actorKey = token?.actorId ?? "";
    let g = this.byActor.get(actorKey);
    if ( !g ) {
      const name = this.actorsById.get(actorKey)?.name ?? null;
      this.byActor.set(actorKey, g = { actor: name, tokens: 0, bytes: 0, items: 0, same: 0, names: new Map() });
    }
    // Tokens are often renamed (an adventure's named NPCs built on one generic actor), so keep what they're called
    const tokenName = token?.name ?? "";
    g.names.set(tokenName, (g.names.get(tokenName) ?? 0) + 1);
    g.tokens++;
    g.bytes += bytes;
    g.items += items;
    g.same += same;
    return bytes;
  }

  summary() {
    return {
      count: this.count,
      linked: this.linked,
      unlinked: this.count - this.linked,
      deltaBytes: this.deltaBytes,
      parts: [...this.parts.entries()].map(([key, b]) => ({ key, bytes: b })).sort((a, b) => b.bytes - a.bytes),
      items: this.items,
      withItems: this.withItems,
      same: this.same,
      added: this.added,
      linkedDelta: this.linkedDelta,
      missingActor: this.missingActor,
      largest: this.largest.items,
      byActor: [...this.byActor.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 10).map(g => ({
        ...g,
        names: [...g.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count })),
        distinctNames: g.names.size
      })),
      repeated: this.#repeatedSummary()
    };
  }

  /** Added items found on at least `min` tokens, largest share first. */
  #repeatedSummary(min = 5) {
    const list = [...this.repeated.values()].filter(r => r.tokens >= min);
    return {
      items: list.reduce((a, r) => a + r.tokens, 0),
      bytes: list.reduce((a, r) => a + r.bytes, 0),
      top: list.sort((a, b) => b.bytes - a.bytes).slice(0, 15)
    };
  }
}

/**
 * Size scenes part by part, so the report can say what makes them big. Each value is stringified once; part sizes
 * add up to the scene total (give or take punctuation). Tokens are broken down further because unlinked tokens'
 * own actor data ("delta") is often most of a world.
 */
function sceneBreakdown(scenes, actorsById) {
  const parts = new Map();
  const top = new TopN(10, s => s.bytes);
  const tokens = new TokenStats(actorsById);
  let bytes = 0;
  for ( const scene of scenes ) {
    let sceneBytes = 0;
    for ( const [key, value] of Object.entries(scene ?? {}) ) {
      let size = 0;
      if ( (key === "tokens") && Array.isArray(value) ) {
        for ( const token of value ) size += tokens.add(token, scene?.name ?? "");
      } else size = safeSize(value) + key.length + 3;
      sceneBytes += size;
      const part = SCENE_PARTS.has(key) ? key : "other";
      parts.set(part, (parts.get(part) ?? 0) + size);
    }
    bytes += sceneBytes;
    top.add({ name: scene?.name ?? "", bytes: sceneBytes, tokens: scene?.tokens?.length ?? 0, walls: scene?.walls?.length ?? 0 });
  }
  return {
    bytes,
    tokenDelta: tokens.deltaBytes,
    parts: [...parts.entries()].map(([key, b]) => ({ key, bytes: b })).sort((a, b) => b.bytes - a.bytes),
    largest: top.items,
    tokens: tokens.summary()
  };
}

/**
 * How many entries a large setting holds, and how many repeat an earlier entry's label or name or all of its
 * content. A menu that was imported twice shows up as many repeats. Settings are stored as JSON strings.
 */
function entryStats(value) {
  let parsed = value;
  try {
    if ( typeof value === "string" ) parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if ( !parsed || (typeof parsed !== "object") ) return {};
  const list = Array.isArray(parsed) ? parsed : Object.values(parsed);
  const labels = new Set();
  const contents = new Set();
  let sameLabel = 0;
  let identical = 0;
  for ( const entry of list ) {
    const label = (entry && (typeof entry === "object")) ? (entry.label ?? entry.name) : undefined;
    if ( typeof label === "string" ) {
      if ( labels.has(label) ) sameLabel++;
      else labels.add(label);
    }
    const json = safeJson(entry);
    if ( contents.has(json) ) identical++;
    else contents.add(json);
  }
  return { entries: list.length, sameLabel, identical };
}

/**
 * Size world settings grouped by the package that owns them (the part of the key before the first dot). Settings
 * stay in the world after their module is disabled or uninstalled and are still sent to every client, so groups are
 * marked when no active package owns them.
 * @param {object[]} settings
 * @param {Map<string, "active"|"inactive">|null} packages  Installed packages by id, or null if unknown
 */
function settingsBreakdown(settings, packages) {
  const groups = new Map();
  const top = new TopN(10, s => s.bytes);
  let bytes = 0;
  for ( const s of settings ) {
    const size = safeSize(s);
    bytes += size;
    top.add({ key: String(s?.key ?? ""), bytes: size, setting: s });
    const ns = String(s?.key ?? "").split(".")[0] || "unknown";
    const g = groups.get(ns) ?? { key: ns, bytes: 0, count: 0 };
    g.bytes += size;
    g.count++;
    groups.set(ns, g);
  }
  const unowned = packages ? [...groups.values()]
    .filter(g => packages.get(g.key) !== "active")
    .map(g => ({ ...g, state: packages.has(g.key) ? "inactive" : "missing" }))
    .sort((a, b) => b.bytes - a.bytes) : null;
  return {
    bytes,
    byPackage: [...groups.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 10),
    largest: top.items.map(({ setting, ...x }) => ({ ...x, ...entryStats(setting?.value) })),
    unowned: unowned && {
      bytes: unowned.reduce((a, g) => a + g.bytes, 0),
      count: unowned.reduce((a, g) => a + g.count, 0),
      packages: unowned.slice(0, 10)
    }
  };
}

/** User ids that make an actor player-owned: users below Assistant GM, as Actor#hasPlayerOwner counts them. */
function playerIds(users) {
  return new Set((users ?? []).filter(u => (u?.role ?? 0) < 3).map(u => u._id));
}

function playerOwned(actor, players) {
  const ownership = actor?.ownership ?? {};
  for ( const id of players ) if ( (ownership[id] ?? ownership.default ?? 0) >= 3 ) return true;
  return false;
}

/**
 * Size each world actor; the largest are usually player characters or imported NPCs carrying full item
 * descriptions. Actors that no token on a world scene uses and no player owns are counted separately: they are
 * the ones a GM can move to a compendium without anything in the world noticing.
 * @param {object[]} actors
 * @param {Set<string>} onScenes   Actor ids some token on a world scene uses
 * @param {Set<string>} players    Ids of non-GM users
 */
function actorBreakdown(actors, onScenes, players) {
  const top = new TopN(10, a => a.bytes);
  const unused = { count: 0, bytes: 0, byType: new Map() };
  const owned = { count: 0, bytes: 0 };
  let bytes = 0;
  for ( const a of actors ) {
    const size = safeSize(a);
    bytes += size;
    top.add({ name: a?.name ?? "", type: a?.type ?? "", bytes: size, items: a?.items?.length ?? 0 });
    if ( playerOwned(a, players) ) {
      owned.count++;
      owned.bytes += size;
    } else if ( !onScenes.has(a?._id) ) {
      unused.count++;
      unused.bytes += size;
      const type = a?.type ?? "";
      const t = unused.byType.get(type) ?? { type, count: 0, bytes: 0 };
      t.count++;
      t.bytes += size;
      unused.byType.set(type, t);
    }
  }
  return {
    bytes,
    largest: top.items,
    playerOwned: owned,
    unused: { ...unused, byType: [...unused.byType.values()].sort((a, b) => b.bytes - a.bytes) }
  };
}

/**
 * Which packages can own settings, from Foundry's package collections: core, the system, the world and every
 * installed module with whether it is active.
 * @param {{modules?: Iterable<{id: string, active: boolean}>, systemId?: string, worldId?: string}} [packages]
 * @returns {Map<string, "active"|"inactive">|null}
 */
function packageStates({ modules, systemId, worldId } = {}) {
  if ( !modules ) return null;
  const states = new Map([["core", "active"]]);
  for ( const m of modules ) if ( m?.id ) states.set(m.id, m.active ? "active" : "inactive");
  if ( systemId ) states.set(systemId, "active");
  if ( worldId ) states.set(worldId, "active");
  return states;
}

/**
 * Estimate the serialized size of each part of the world payload, with breakdowns of the parts that are usually
 * largest (scenes, actors, settings) and compendium indexes by package.
 * @param {object} data       game.data at init time
 * @param {object} [packages] Installed modules (game.modules) and the system and world ids, to tell which settings
 *   belong to a package that is no longer active
 */
export function measurePayload(data, packages) {
  const sections = [];
  const packs = new Map();
  const detail = {};
  const actorsById = new Map();
  for ( const a of Array.isArray(data?.actors) ? data.actors : [] ) if ( a?._id ) actorsById.set(a._id, a);
  const onScenes = new Set();
  for ( const scene of Array.isArray(data?.scenes) ? data.scenes : [] ) {
    for ( const t of Array.isArray(scene?.tokens) ? scene.tokens : [] ) if ( t?.actorId ) onScenes.add(t.actorId);
  }
  const states = packageStates(packages);
  const players = playerIds(data?.users);
  const breakdowns = {
    scenes: scenes => sceneBreakdown(scenes, actorsById),
    settings: settings => settingsBreakdown(settings, states),
    actors: actors => actorBreakdown(actors, onScenes, players)
  };
  for ( const [key, value] of Object.entries(data ?? {}) ) {
    if ( breakdowns[key] && Array.isArray(value) ) {
      detail[key] = breakdowns[key](value);
      sections.push({ key, bytes: detail[key].bytes, count: value.length });
      continue;
    }
    if ( key === "packs" && Array.isArray(value) ) {
      let bytes = 0;
      for ( const p of value ) {
        const size = safeSize(p);
        bytes += size;
        const pkey = `${p.packageType ?? "module"}:${p.packageName ?? "unknown"}`;
        let b = packs.get(pkey);
        if ( !b ) packs.set(pkey, b = { key: pkey, bytes: 0, packs: 0, entries: 0 });
        b.bytes += size;
        b.packs++;
        b.entries += Array.isArray(p.index) ? p.index.length : 0;
      }
      sections.push({ key, bytes, count: value.length });
      continue;
    }
    sections.push({ key, bytes: safeSize(value), count: Array.isArray(value) ? value.length : 0 });
  }
  return {
    sections: sections.sort((a, b) => b.bytes - a.bytes),
    packs: [...packs.values()].sort((a, b) => b.bytes - a.bytes),
    detail
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function safeSize(value) {
  return safeJson(value).length;
}

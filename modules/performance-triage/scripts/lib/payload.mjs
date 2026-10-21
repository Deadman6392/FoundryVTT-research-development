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
      this.byActor.set(actorKey, g = { actor: name, tokens: 0, bytes: 0, items: 0, same: 0 });
    }
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
      byActor: [...this.byActor.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 10)
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

/** Size world settings grouped by the package that owns them (the part of the key before the first dot). */
function settingsBreakdown(settings) {
  const groups = new Map();
  const top = new TopN(10, s => s.bytes);
  let bytes = 0;
  for ( const s of settings ) {
    const size = safeSize(s);
    bytes += size;
    top.add({ key: String(s?.key ?? ""), bytes: size });
    const ns = String(s?.key ?? "").split(".")[0] || "unknown";
    const g = groups.get(ns) ?? { key: ns, bytes: 0, count: 0 };
    g.bytes += size;
    g.count++;
    groups.set(ns, g);
  }
  return { bytes, byPackage: [...groups.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 10), largest: top.items };
}

/** Size each world actor; the largest are usually imported NPCs carrying full item descriptions. */
function actorBreakdown(actors) {
  const top = new TopN(10, a => a.bytes);
  let bytes = 0;
  for ( const a of actors ) {
    const size = safeSize(a);
    bytes += size;
    top.add({ name: a?.name ?? "", type: a?.type ?? "", bytes: size, items: a?.items?.length ?? 0 });
  }
  return { bytes, largest: top.items };
}

/**
 * Estimate the serialized size of each part of the world payload, with breakdowns of the parts that are usually
 * largest (scenes, actors, settings) and compendium indexes by package.
 * @param {object} data       game.data at init time
 */
export function measurePayload(data) {
  const sections = [];
  const packs = new Map();
  const detail = {};
  const actorsById = new Map();
  for ( const a of Array.isArray(data?.actors) ? data.actors : [] ) if ( a?._id ) actorsById.set(a._id, a);
  const breakdowns = {
    scenes: scenes => sceneBreakdown(scenes, actorsById),
    settings: settingsBreakdown,
    actors: actorBreakdown
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

function safeSize(value) {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

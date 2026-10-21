/**
 * Collects a diagnostics report on demand. Loaded lazily; nothing here runs unless someone opens the report.
 * Every section is collected defensively so one missing API (a different core version, no canvas) never hides the rest.
 */
import { MODULE_ID } from "./constants.mjs";
import { telemetry, rendererInfo, countFps } from "./telemetry.mjs";
import { recommend } from "./lib/recommend.mjs";
import { PROFILES, valuesEqual, splitSettingKey } from "./lib/profiles.mjs";

/** How long to count frames when the report opens before the one-minute startup sample has finished. */
const LIVE_FPS_MS = 1500;

const VIDEO_EXT = /\.(webm|mp4|m4v|ogv|mov)(\?|#|$)/i;
const MAX_LISTENER_ROWS = 200;

function safe(fn, fallback = null) {
  try {
    return fn();
  } catch(err) {
    console.debug(`${MODULE_ID} | report section failed`, err);
    return fallback;
  }
}

function setting(ns, key) {
  return safe(() => game.settings.get(ns, key));
}

export async function collectReport() {
  const api = game.modules.get(MODULE_ID).api;
  const hooks = telemetry.hookProfiler?.installed ? telemetry.hookProfiler.stats() : null;
  if ( hooks ) hooks.listeners = hooks.listeners.slice(0, MAX_LISTENER_ROWS);

  // Counted before anything else so building the report doesn't skew it
  const liveFps = telemetry.fps ? null : await countFps(LIVE_FPS_MS);

  const report = {
    generatedAt: new Date().toISOString(),
    env: safe(collectEnv, {}),
    profile: {
      id: api.profileId,
      applied: setting(MODULE_ID, "appliedProfile"),
      selfChoice: setting(MODULE_ID, "selfProfile"),
      idle: api.idle,
      chatBatchSize: CONFIG.ChatMessage?.batchSize ?? null,
      overridden: safe(() => profileDrift(api.profileId), [])
    },
    client: { ...safe(collectClient, {}), liveFps },
    timeline: safe(collectTimeline, {}),
    network: {
      load: telemetry.resources.load?.toJSON(),
      play: telemetry.resources.play?.toJSON(),
      truncated: telemetry.resources.truncated
    },
    longFrames: {
      supported: telemetry.longFrames.supported,
      load: telemetry.longFrames.load?.toJSON(),
      play: telemetry.longFrames.play?.toJSON()
    },
    hooks,
    hookProfilerEnabled: !!telemetry.hookProfiler,
    payload: telemetry.payload,
    canvas: safe(collectCanvas, { ready: false }),
    modules: safe(collectModules, {}),
    world: safe(collectWorld),
    players: game.user.isGM ? safe(collectPlayers, []) : null,
    sampler: telemetry.sampler,
    prep: telemetry.prep,
    frameCost: telemetry.frameCost
  };
  report.findings = recommend(report);
  return report;
}

/** Profile settings that no longer hold the profile's value, meaning something else changed them after we did. */
function profileDrift(profileId) {
  const drift = [];
  for ( const [key, wanted] of Object.entries(PROFILES[profileId]?.settings ?? {}) ) {
    const config = game.settings.settings.get(key);
    if ( config?.scope !== "client" ) continue;
    const actual = game.settings.get(...splitSettingKey(key));
    if ( !valuesEqual(actual, wanted) ) drift.push({ key, wanted, actual });
  }
  return drift;
}

function collectEnv() {
  const brands = navigator.userAgentData?.brands?.filter(b => !/not.?a.?brand/i.test(b.brand))
    .map(b => `${b.brand} ${b.version}`).join(", ");
  return {
    core: game.version,
    generation: game.release?.generation ?? null,
    system: `${game.system.id} ${game.system.version}`,
    world: game.world.id,
    user: game.user.name,
    isGM: game.user.isGM,
    browser: brands || navigator.userAgent,
    cores: navigator.hardwareConcurrency ?? null,
    memory: navigator.deviceMemory ?? null,
    dpr: globalThis.devicePixelRatio ?? 1,
    screen: `${screen.width}x${screen.height}`,
    viewport: `${innerWidth}x${innerHeight}`,
    ...rendererInfo()
  };
}

function collectClient() {
  return {
    fps: telemetry.fps,
    performanceMode: setting("core", "performanceMode"),
    maxFPS: setting("core", "maxFPS"),
    resolutionScaling: setting("core", "pixelRatioResolutionScaling"),
    noCanvas: setting("core", "noCanvas"),
    canvasPerformance: globalThis.canvas?.performance ? { ...canvas.performance } : null,
    rendererResolution: globalThis.canvas?.app?.renderer?.resolution ?? null
  };
}

function collectTimeline() {
  const nav = performance.getEntriesByType?.("navigation")?.[0];
  const round = n => (Number.isFinite(n) ? Math.round(n) : null);
  return {
    navigation: nav ? {
      responseEnd: round(nav.responseEnd),
      domInteractive: round(nav.domInteractive),
      domContentLoaded: round(nav.domContentLoadedEventEnd),
      load: round(nav.loadEventEnd)
    } : null,
    marks: Object.fromEntries(Object.entries(telemetry.marks).map(([k, v]) => [k, round(v)]))
  };
}

/** Width/height/bytes of a placeable's texture, deduplicated by source. */
function textureInfo(src, texture, kind, seen) {
  const bt = texture?.baseTexture;
  if ( !bt || !src || seen.has(src) ) return null;
  seen.add(src);
  const width = Math.round(bt.realWidth ?? bt.width ?? 0);
  const height = Math.round(bt.realHeight ?? bt.height ?? 0);
  const video = (bt.resource?.source instanceof HTMLVideoElement) || VIDEO_EXT.test(src);
  return { src, kind, width, height, video, bytes: width * height * 4 };
}

function collectCanvas() {
  if ( !globalThis.canvas?.ready ) return { ready: false };
  const scene = canvas.scene;
  const seen = new Set();
  const textures = [];
  const push = info => info && textures.push(info);

  push(textureInfo(scene.background?.src, canvas.primary?.background?.texture, "background", seen));
  for ( const tile of canvas.tiles?.placeables ?? [] ) {
    push(textureInfo(tile.document.texture?.src, tile.mesh?.texture ?? tile.texture, "tile", seen));
  }
  for ( const token of canvas.tokens?.placeables ?? [] ) {
    push(textureInfo(token.document.texture?.src, token.mesh?.texture ?? token.texture, "token", seen));
  }
  textures.sort((a, b) => b.bytes - a.bytes);

  const estimated = textures.reduce((sum, t) => sum + t.bytes, 0);
  const loaderUsage = safe(() => foundry.canvas.TextureLoader.approximateTotalMemoryUsage);
  const lights = scene.lights?.contents ?? [];
  const tiles = scene.tiles?.contents ?? [];
  const d = canvas.dimensions ?? {};
  return {
    ready: true,
    textureMemory: Number.isFinite(loaderUsage) ? loaderUsage : estimated,
    textureMemorySource: Number.isFinite(loaderUsage) ? "TextureLoader" : "estimate",
    textures: textures.slice(0, 15),
    scene: {
      name: scene.name,
      width: d.width ?? null,
      height: d.height ?? null,
      gridSize: d.size ?? null,
      tokens: scene.tokens?.size ?? 0,
      lights: lights.length,
      animatedLights: lights.filter(l => l.config?.animation?.type).length,
      walls: scene.walls?.size ?? 0,
      tiles: tiles.length,
      videoTiles: tiles.filter(t => VIDEO_EXT.test(t.texture?.src ?? "")).length,
      regions: scene.regions?.size ?? 0,
      sounds: scene.sounds?.size ?? 0,
      drawings: scene.drawings?.size ?? 0,
      notes: scene.notes?.size ?? 0,
      fogExploration: scene.fog?.exploration ?? null
    }
  };
}

function verifiedGeneration(verified) {
  const n = parseInt(String(verified ?? "").split(".")[0], 10);
  return Number.isFinite(n) ? n : null;
}

function collectDebugFlags() {
  const flags = [];
  for ( const [key, value] of Object.entries(CONFIG.debug ?? {}) ) {
    if ( value === true ) {
      flags.push({ label: `CONFIG.debug.${key}`, value, fix: `Run \`CONFIG.debug.${key} = false\` or remove the world script / module that sets it.` });
    } else if ( value && (typeof value === "object") ) {
      for ( const [sub, v] of Object.entries(value) ) {
        if ( v === true ) flags.push({ label: `CONFIG.debug.${key}.${sub}`, value: v, fix: `Run \`CONFIG.debug.${key}.${sub} = false\`.` });
      }
    }
  }
  if ( game.modules.get("midi-qol")?.active ) {
    const v = setting("midi-qol", "Debug");
    if ( v && !/^none$/i.test(String(v)) ) {
      flags.push({ label: "midi-qol Debug setting", value: v, fix: "Set Midi QOL's Debug setting to None in Configure Settings." });
    }
  }
  return flags;
}

function collectModules() {
  const generation = game.release?.generation ?? null;
  const list = game.modules.filter(m => m.active).map(m => ({
    id: m.id,
    title: m.title,
    version: m.version,
    verified: m.compatibility?.verified ?? "",
    library: !!m.library,
    packs: m.packs?.size ?? 0,
    esmodules: m.esmodules?.size ?? 0,
    scripts: m.scripts?.size ?? 0,
    styles: m.styles?.size ?? 0
  }));
  const unverified = generation ? list.filter(m => (verifiedGeneration(m.verified) ?? 0) < generation) : [];
  // Content packs (maps, compendiums) run no code, so an old "verified" field costs nothing at runtime
  const hasCode = m => (m.esmodules + m.scripts) > 0;
  return {
    active: list.length,
    list,
    outdated: unverified.filter(hasCode),
    outdatedContent: unverified.filter(m => !hasCode(m)).length,
    debug: collectDebugFlags()
  };
}

function collectWorld() {
  const counts = {
    actors: game.actors.size,
    items: game.items.size,
    journal: game.journal.size,
    scenes: game.scenes.size,
    messages: game.messages.size,
    tables: game.tables.size,
    playlists: game.playlists.size,
    macros: game.macros.size,
    cards: game.cards?.size ?? 0,
    combats: game.combats.size,
    folders: game.folders.size,
    users: game.users.size
  };
  const actors = game.actors.contents.map(a => ({
    name: a.name, type: a.type, items: a.items.size, effects: a.effects.size, total: a.items.size + a.effects.size
  })).sort((a, b) => b.total - a.total);

  const byPackage = new Map();
  let entries = 0;
  for ( const pack of game.packs ) {
    const size = pack.index?.size ?? 0;
    entries += size;
    const key = `${pack.metadata.packageType}:${pack.metadata.packageName}`;
    let b = byPackage.get(key);
    if ( !b ) byPackage.set(key, b = { key, packs: 0, entries: 0 });
    b.packs++;
    b.entries += size;
  }
  return {
    counts,
    actorEffects: actors.reduce((sum, a) => sum + a.effects, 0),
    heavyActors: actors.slice(0, 10),
    packs: {
      count: game.packs.size,
      entries,
      byPackage: [...byPackage.values()].sort((a, b) => b.entries - a.entries).slice(0, 15)
    }
  };
}

function collectPlayers() {
  const assignments = setting(MODULE_ID, "assignments") ?? {};
  return game.users.contents.map(u => {
    const summary = u.getFlag(MODULE_ID, "summary") ?? null;
    return {
      id: u.id,
      name: u.name,
      isGM: u.isGM,
      active: u.active,
      assigned: assignments[u.id] ?? "default",
      profile: summary?.profile ?? "none",
      summary
    };
  });
}

/** Let the browser paint between batches. The callback is defined here so long-frame timing credits this module. */
const yieldToBrowser = () => new Promise(resolve => setTimeout(() => resolve(), 0));

/** Time actor.reset() and describe the actor; slow or throwing actors are reported, never fatal. */
function timeReset(actor) {
  const t0 = performance.now();
  try {
    actor.reset();
  } catch(err) {
    console.warn(`${MODULE_ID} | Preparing ${actor.name} threw`, err);
  }
  return { ms: performance.now() - t0, items: actor.items?.size ?? 0, effects: actor.effects?.size ?? 0 };
}

/**
 * Re-prepare every world actor, and the actor of every unlinked token on every scene, and time it. actor.reset()
 * re-derives data exactly as an update does (dnd5e relies on this), so the results reflect what every client pays
 * at load and after each change to that actor.
 *
 * v14 defers unlinked tokens' actors until first use; TokenDocument#isLazyDelta and _preventActorDeltaAccess ("prevents
 * ActorDelta documents from materializing until after all world documents are first initialized") exist only in
 * the v14 API, so on v13 they are built with the world. On v14, tokens not built yet are skipped: timing them would
 * build them, and they cost nothing at load.
 * Yields to the event loop periodically so the UI stays responsive on large worlds.
 */
export async function benchmarkActors() {
  const rows = [];
  let total = 0;
  for ( const actor of game.actors ) {
    const r = timeReset(actor);
    total += r.ms;
    rows.push({ name: actor.name, type: actor.type, ms: Math.round(r.ms * 10) / 10, items: r.items, effects: r.effects });
    if ( rows.length % 20 === 0 ) await yieldToBrowser();
  }
  rows.sort((a, b) => b.ms - a.ms);

  const tokenRows = [];
  let tokenTotal = 0;
  for ( const scene of game.scenes ?? [] ) {
    for ( const token of scene.tokens ?? [] ) {
      if ( token.actorLink || token.isLazyDelta ) continue;
      const actor = token.actor;
      if ( !actor ) continue;
      const r = timeReset(actor);
      tokenTotal += r.ms;
      tokenRows.push({ name: token.name, scene: scene.name, ms: Math.round(r.ms * 10) / 10, items: r.items, effects: r.effects });
      if ( tokenRows.length % 20 === 0 ) await yieldToBrowser();
    }
  }
  tokenRows.sort((a, b) => b.ms - a.ms);

  return telemetry.prep = {
    count: rows.length,
    totalMs: Math.round(total),
    actors: rows.slice(0, 25),
    tokens: { count: tokenRows.length, totalMs: Math.round(tokenTotal), rows: tokenRows.slice(0, 25) }
  };
}

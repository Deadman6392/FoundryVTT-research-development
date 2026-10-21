/**
 * Gathers what the scene archive planner needs from the world. GM-only and on demand: it reads every scene's source
 * data (about a second on a 100 MB world) and changes nothing.
 */
import { telemetry } from "./telemetry.mjs";
import { planScenes } from "./lib/scene-plan.mjs";

/** Scene folder id -> "Parent / Child" path, so nested folders with the same name can be told apart. */
function folderPaths() {
  const all = new Map();
  for ( const f of game.folders ) all.set(f.id, f);
  const paths = new Map();
  for ( const f of all.values() ) {
    if ( f.type !== "Scene" ) continue;
    const names = [];
    const seen = new Set();
    for ( let cur = f; cur && !seen.has(cur.id); cur = all.get(cur._source?.folder) ) {
      seen.add(cur.id);
      names.unshift(cur.name);
    }
    paths.set(f.id, names.join(" / "));
  }
  return paths;
}

/** Scene compendiums in this world and the scenes their indexes list; the GM's archives live here. */
function archivedScenes() {
  const out = [];
  for ( const pack of game.packs ) {
    if ( (pack.documentName !== "Scene") || (pack.metadata?.packageType !== "world") ) continue;
    const scenes = [];
    for ( const entry of pack.index ) scenes.push({ id: entry._id, name: entry.name ?? "" });
    out.push({ id: pack.collection, title: pack.title, scenes });
  }
  return out;
}

/**
 * Scene id -> names of players who have explored fog of war there. FogExploration documents aren't loaded with the
 * world, so this asks the server for an index of them (scene and user only). Null when that isn't possible.
 */
async function exploredScenes() {
  const cls = CONFIG.FogExploration?.documentClass;
  if ( typeof cls?.database?.get !== "function" ) return null;
  try {
    const entries = await cls.database.get(cls, { query: {}, index: true, indexFields: ["scene", "user"] });
    const players = new Map();
    for ( const u of game.users ) if ( !u.isGM ) players.set(u.id, u.name);
    const out = new Map();
    for ( const e of entries ?? [] ) {
      const name = players.get(e.user);
      if ( !name || !e.scene ) continue;
      if ( !out.has(e.scene) ) out.set(e.scene, []);
      if ( !out.get(e.scene).includes(name) ) out.get(e.scene).push(name);
    }
    return out;
  } catch(err) {
    console.warn("performance-triage | Could not read which scenes players have explored", err);
    return null;
  }
}

export async function collectScenePlan() {
  // Never suggest archiving a scene someone is on
  const inUse = new Set();
  for ( const scene of game.scenes ) if ( scene.active ) inUse.add(scene.id);
  for ( const user of game.users ) if ( user.active && user.viewedScene ) inUse.add(user.viewedScene);
  const playerActors = new Set();
  for ( const actor of game.actors ) if ( actor.hasPlayerOwner ) playerActors.add(actor.id);
  const byScene = telemetry.prep?.tokens?.byScene;
  // _source is read as is, not cloned: toObject() would copy every scene first
  return planScenes({
    scenes: game.scenes.map(s => s._source),
    journals: game.journal.map(j => j._source),
    macros: game.macros.map(m => m._source),
    inUse,
    playerActors,
    folders: folderPaths(),
    prepMs: byScene ? new Map(byScene.map(s => [s.id, s.ms])) : null,
    archived: archivedScenes(),
    explored: await exploredScenes()
  });
}

/**
 * Gathers what the scene archive planner needs from the world. GM-only and on demand: it reads every scene's source
 * data (a second or two on a 100 MB world) and changes nothing.
 */
import { planScenes } from "./lib/scene-plan.mjs";

export function collectScenePlan() {
  // Never suggest archiving a scene someone is on
  const inUse = new Set();
  for ( const scene of game.scenes ) if ( scene.active ) inUse.add(scene.id);
  for ( const user of game.users ) if ( user.active && user.viewedScene ) inUse.add(user.viewedScene);
  const playerActors = new Set();
  for ( const actor of game.actors ) if ( actor.hasPlayerOwner ) playerActors.add(actor.id);
  const folders = new Map();
  for ( const folder of game.folders ) if ( folder.type === "Scene" ) folders.set(folder.id, folder.name);
  // _source is read as is, not cloned: toObject() would copy every scene first
  return planScenes({
    scenes: game.scenes.map(s => s._source),
    journals: game.journal.map(j => j._source),
    macros: game.macros.map(m => m._source),
    inUse,
    playerActors,
    folders
  });
}

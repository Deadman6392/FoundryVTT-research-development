/**
 * The planner's glue reads scenes, journals, macros, users, actors and folders the way Foundry exposes them, and
 * the planner window opens for the GM only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

installFoundry({ userId: "gm1", role: 4 });

/** Minimal Foundry Collection: iterable, with map. */
const collection = items => Object.assign([...items], { get size() { return items.length; } });
const doc = (source, extra = {}) => ({ id: source._id, _source: source, ...source, ...extra });

const huge = { items: [{ name: "Claw", system: { description: { value: "x".repeat(300_000) } } }] };
Object.assign(game, {
  scenes: collection([
    doc({ _id: "scene00000000001", name: "Village", folder: "f1", active: true, tokens: [],
      regions: [{ behaviors: [{ system: { destination: "Scene.archived00000001.Region.r000000000000001" } }] }] }),
    doc({ _id: "scene00000000002", name: "Castle", folder: "f1", tokens: [{ _id: "t1", actorId: "a1", actorLink: false, delta: huge }] }),
    doc({ _id: "scene00000000003", name: "Crypt", folder: null, tokens: [{ _id: "t2", actorId: "a2", actorLink: true, delta: huge }] })
  ]),
  journal: collection([doc({ _id: "j1", name: "Lore", pages: [{ text: { content: "@UUID[Scene.scene00000000002]" } }] })]),
  macros: collection([]),
  users: collection([{ id: "p1", name: "Alice", active: true, viewedScene: "scene00000000003" },
    { id: "p2", name: "Bob", active: false, viewedScene: "scene00000000002" }, { id: "gm1", name: "GM", isGM: true, active: true }]),
  actors: collection([{ id: "a1", hasPlayerOwner: false }, { id: "a2", hasPlayerOwner: true }]),
  packs: collection([
    // The GM's archive: one scene still in the world (kept after a restore), one only in the compendium
    { documentName: "Scene", metadata: { packageType: "world" }, collection: "world.archive-vallaki", title: "Archive: Vallaki",
      index: collection([{ _id: "archived00000001", name: "Wachterhaus" }, { _id: "scene00000000002", name: "Castle" }]) },
    { documentName: "Actor", metadata: { packageType: "world" }, collection: "world.npcs", title: "NPCs", index: collection([{ _id: "x", name: "Bandit" }]) },
    { documentName: "Scene", metadata: { packageType: "module" }, collection: "maps.pack", title: "Map pack", index: collection([{ _id: "m", name: "Cave" }]) }
  ]),
  folders: collection([
    { id: "f0", name: "Barovia", type: "Scene", _source: { folder: null } },
    { id: "f1", name: "Village", type: "Scene", _source: { folder: "f0" } },
    { id: "f9", name: "Monsters", type: "Actor", _source: { folder: null } }
  ])
});

// Fog of war is fetched from the server as an index of (scene, user) pairs
let fogQuery = null;
CONFIG.FogExploration = { documentClass: { database: { get: async (cls, operation) => {
  fogQuery = operation;
  return [
    { _id: "f1", scene: "scene00000000002", user: "p1" },
    { _id: "f2", scene: "scene00000000002", user: "gm1" },  // the GM's own fog doesn't count
    { _id: "f3", scene: "scene00000000002", user: "p1" }
  ];
} } } };

const { collectScenePlan } = await import("../modules/performance-triage/scripts/scene-plan.mjs");
const { telemetry } = await import("../modules/performance-triage/scripts/telemetry.mjs");

test("collects the plan from world collections", async () => {
  const plan = await collectScenePlan();
  const by = Object.fromEntries(plan.rows.map(r => [r.name, r]));
  assert.equal(by.Village.status, "inUse", "the active scene");
  assert.equal(by.Crypt.status, "inUse", "a scene an online player is viewing");
  assert.equal(by.Crypt.playerTokens, 1);
  assert.equal(by.Castle.status, "prep", "an offline player's view doesn't count, but Alice explored it");
  assert.deepEqual(by.Castle.exploredBy, ["Alice"]);
  assert.deepEqual([fogQuery.index, fogQuery.indexFields], [true, ["scene", "user"]], "only an index is fetched");
  assert.equal(plan.fogKnown, true);
  assert.equal(by.Castle.folder, "Barovia / Village", "nested folders show their path");
  assert.deepEqual(by.Castle.docLinks, [{ type: "journal", name: "Lore" }]);
  assert.deepEqual(plan.archive.map(a => [a.title, a.names]), [["Archive: Vallaki", ["Wachterhaus"]]],
    "only world scene compendiums, and only scenes that aren't also in the world");
  assert.deepEqual(plan.archive[0].waysIn, [{ from: "Village", fromFolder: "Barovia / Village", to: "Wachterhaus" }]);
  assert.equal(plan.hasPrepTimes, false);
});

test("uses token actor timings from this session when there are some", async () => {
  telemetry.prep = { count: 0, totalMs: 0, actors: [], tokens: { count: 1, totalMs: 40, rows: [], byScene: [{ id: "scene00000000002", name: "Castle", tokens: 1, ms: 40 }] } };
  try {
    const by = Object.fromEntries((await collectScenePlan()).rows.map(r => [r.name, r]));
    assert.equal(by.Castle.prepMs, 40);
    assert.equal(by.Village.prepMs, null);
  } finally {
    telemetry.prep = null;
  }
});

test("the planner window is GM only", async () => {
  const { ScenePlanApp } = await import("../modules/performance-triage/scripts/apps/scene-plan-app.mjs");
  game.user = { isGM: false };
  assert.equal(ScenePlanApp.open(), null);
});

test("without a way to read fog, the plan says so instead of guessing", async () => {
  const saved = CONFIG.FogExploration;
  CONFIG.FogExploration = { documentClass: { database: { get: async () => { throw new Error("denied"); } } } };
  try {
    const plan = await collectScenePlan();
    assert.equal(plan.fogKnown, false);
    assert.equal(plan.rows.find(r => r.name === "Castle").status, "ready");
  } finally {
    CONFIG.FogExploration = saved;
  }
});


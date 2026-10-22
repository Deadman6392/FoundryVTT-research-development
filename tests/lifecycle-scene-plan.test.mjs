/**
 * The planner's glue reads scenes, journals, macros, users, actors and folders the way Foundry exposes them, and
 * the planner window opens for the GM only. Its token tab follows token changes while open and can take the GM to
 * any token.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

const env = installFoundry({ userId: "gm1", role: 4 });
env.registerCoreSettings();

/** Minimal Foundry Collection: iterable, with map and get by id. */
const collection = items => Object.assign([...items], {
  get size() { return items.length; },
  get: id => items.find(i => (i.id ?? i._id) === id)
});
/** A document: its source data, plus embedded tokens as a collection like Scene#tokens. */
const doc = (source, extra = {}) => ({ id: source._id, _source: source, ...source,
  ...(source.tokens ? { tokens: collection(source.tokens.map(t => ({ id: t._id, ...t }))) } : {}), ...extra });

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
  actors: collection([{ id: "a1", name: "Bandit", type: "npc", hasPlayerOwner: false },
    { id: "a2", name: "Ezmerelda", type: "character", hasPlayerOwner: true }]),
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

const { collectScenePlan, collectTokenCensus } = await import("../modules/performance-triage/scripts/scene-plan.mjs");
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

test("counts tokens by actor from world collections", () => {
  const census = collectTokenCensus();
  assert.equal(census.tokens, 2);
  const pc = census.actors.find(g => g.id === "a2");
  assert.deepEqual([pc.name, pc.type, pc.player, pc.tokens], ["Ezmerelda", "character", true, 1]);
  assert.equal(pc.scenes[0].name, "Crypt");
  assert.equal(pc.scenes[0].inUse, true, "an online player is viewing it");
  assert.equal(census.actors.find(g => g.id === "a1").scenes[0].folder, "Barovia / Village");
});

test("the token tab recounts once per burst of token changes and stops listening when closed", async () => {
  game.user = { isGM: true };
  const { ScenePlanApp } = await import("../modules/performance-triage/scripts/apps/scene-plan-app.mjs");
  const app = new ScenePlanApp();
  app.tab = "tokens";
  let renders = 0;
  app.rendered = true;
  app.render = () => { renders++; return app; };
  const context = await app._prepareContext();
  assert.equal(context.census.tokens, 2);
  assert.equal(Hooks.events.createToken?.length, 1);
  assert.equal(Hooks.events.deleteToken?.length, 1);
  Hooks.callAll("deleteToken", {});
  Hooks.callAll("deleteToken", {});
  assert.equal(app.census, null, "the count is stale");
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(renders, 1, "two deletions, one recount");

  document.createElement ??= () => ({});
  const html = await app._renderHTML(await app._prepareContext());
  assert.match(html, /data-action="switchTab" data-tab="tokens" class="active"/, "not the reserved \"tab\" action");
  assert.match(html, /data-actor="a2"/);
  assert.equal(Hooks.events.createToken.length, 1, "recounting doesn't add listeners");

  app._onClose({});
  assert.equal(Hooks.events.createToken.length + Hooks.events.deleteToken.length, 0);
  assert.equal(app.census, null, "counted again when reopened");
});

test("going to a token views its scene, selects the token and centres on it", async () => {
  const { ScenePlanApp } = await import("../modules/performance-triage/scripts/apps/scene-plan-app.mjs");
  const showToken = ScenePlanApp.DEFAULT_OPTIONS.actions.showToken;
  const scene = game.scenes.get("scene00000000002");
  const calls = [];
  scene.view = async () => {
    calls.push("view");
    canvas.scene = { id: scene.id };
  };
  const placed = { center: { x: 500, y: 300 }, control: options => calls.push(["control", options]) };
  const saved = { ...canvas };
  Object.assign(canvas, {
    scene: { id: "scene00000000001" },
    tokens: { get: id => ((id === "t1") ? placed : undefined), activate: () => calls.push("activate") },
    stage: { scale: { x: 0.5 } },
    animatePan: async view => calls.push(["pan", view])
  });
  const app = new ScenePlanApp();
  app.minimize = async () => calls.push("minimize");
  try {
    await showToken.call(app, {}, { dataset: { scene: scene.id, token: "t1" } });
    assert.deepEqual(calls, ["view", "activate", ["control", { releaseOthers: true }], "minimize",
      ["pan", { x: 500, y: 300, scale: 1 }]]);

    await showToken.call(app, {}, { dataset: { scene: scene.id, token: "deleted00000001" } });
    assert.deepEqual(env.notifications.at(-1), ["warn", "PTRIAGE.Census.Gone"], "a token deleted since the count");

    calls.length = 0;
    await game.settings.set("core", "noCanvas", true);
    await showToken.call(app, {}, { dataset: { scene: scene.id, token: "t1" } });
    assert.deepEqual(env.notifications.at(-1), ["warn", "PTRIAGE.Census.NoCanvas"]);
    assert.deepEqual(calls, [], "nothing is viewed without a canvas");
  } finally {
    await game.settings.set("core", "noCanvas", false);
    for ( const key of Object.keys(canvas) ) delete canvas[key];
    Object.assign(canvas, saved);
  }
});

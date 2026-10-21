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
    doc({ _id: "scene00000000001", name: "Village", folder: "f1", active: true, tokens: [] }),
    doc({ _id: "scene00000000002", name: "Castle", folder: "f1", tokens: [{ _id: "t1", actorId: "a1", actorLink: false, delta: huge }] }),
    doc({ _id: "scene00000000003", name: "Crypt", folder: null, tokens: [{ _id: "t2", actorId: "a2", actorLink: true, delta: huge }] })
  ]),
  journal: collection([doc({ _id: "j1", name: "Lore", pages: [{ text: { content: "@UUID[Scene.scene00000000002]" } }] })]),
  macros: collection([]),
  users: collection([{ id: "p1", active: true, viewedScene: "scene00000000003" }, { id: "p2", active: false, viewedScene: "scene00000000002" }]),
  actors: collection([{ id: "a1", hasPlayerOwner: false }, { id: "a2", hasPlayerOwner: true }]),
  folders: collection([{ id: "f1", name: "Barovia", type: "Scene" }, { id: "f9", name: "Monsters", type: "Actor" }])
});

const { collectScenePlan } = await import("../modules/performance-triage/scripts/scene-plan.mjs");

test("collects the plan from world collections", () => {
  const plan = collectScenePlan();
  const by = Object.fromEntries(plan.rows.map(r => [r.name, r]));
  assert.equal(by.Village.status, "inUse", "the active scene");
  assert.equal(by.Crypt.status, "inUse", "a scene an online player is viewing");
  assert.equal(by.Crypt.playerTokens, 1);
  assert.equal(by.Castle.status, "prep", "an offline player's view doesn't count; the journal link does");
  assert.equal(by.Castle.folder, "Barovia");
  assert.deepEqual(by.Castle.linkedFrom, [{ type: "journal", name: "Lore" }]);
});

test("the planner window is GM only", async () => {
  const { ScenePlanApp } = await import("../modules/performance-triage/scripts/apps/scene-plan-app.mjs");
  game.user = { isGM: false };
  assert.equal(ScenePlanApp.open(), null);
});

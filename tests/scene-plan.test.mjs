/**
 * The scene archive planner: which scenes cost the most at load, which can go to a compendium with no prep, and
 * which have map notes or links that need attention while they are out of the world.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planScenes, scenePlanToHtml, scenePlanToMarkdown, SMALL_SCENE_BYTES } from "../modules/performance-triage/scripts/lib/scene-plan.mjs";

const big = n => ({ items: [{ name: "Claw", system: { description: { value: "x".repeat(n) } } }] });
const ID = { castle: "castle0000000001", village: "village000000001", crypt: "crypt00000000001", tavern: "tavern0000000001" };

function world() {
  const scenes = [
    // Large, no notes, nothing points at it: archive with no prep
    { _id: ID.castle, name: "Castle", folder: "f1", walls: [{}, {}], lights: [{}],
      tokens: [{ _id: "t1", actorId: "npc", actorLink: false, delta: big(400_000) }] },
    // Large, has map notes and a teleport region pointing at the castle, and the party's token
    { _id: ID.village, name: "Village", folder: "f1", journal: "j3",
      notes: [{ entryId: "j1" }, { entryId: "j1" }, { entryId: "j2" }],
      regions: [{ behaviors: [{ type: "teleportToken", system: { destination: `Scene.${ID.castle}.Region.r0000000000000001` } }] }],
      tokens: [{ _id: "t2", actorId: "pc", actorLink: true }, { _id: "t3", actorId: "npc", actorLink: false, delta: big(300_000) }] },
    // Large, but the party is on it
    { _id: ID.crypt, name: "Crypt", folder: "f2", tokens: [{ _id: "t4", actorId: "npc", actorLink: false, delta: big(300_000) }] },
    // Small
    { _id: ID.tavern, name: "Tavern", folder: null, tokens: [] }
  ];
  const journals = [
    { _id: "j1", name: "Village notes", pages: [{ text: { content: `See @UUID[Scene.${ID.crypt}]{the crypt}` } }] },
    { _id: "j2", name: "Burgomaster", pages: [] },
    { _id: "j3", name: "Village overview", pages: [] }
  ];
  const macros = [{ _id: "m1", name: "Go to tavern", command: `game.scenes.get("${ID.tavern}").view()` }];
  return { scenes, journals, macros, inUse: new Set([ID.crypt]), playerActors: new Set(["pc"]),
    folders: new Map([["f1", "Barovia"], ["f2", "Dungeons"]]) };
}

test("ranks scenes into no-prep, needs-prep, small and in-use, largest first", () => {
  const plan = planScenes(world());
  assert.deepEqual(plan.rows.map(r => [r.name, r.status]),
    [["Castle", "prep"], ["Village", "prep"], ["Tavern", "small"], ["Crypt", "inUse"]]);
  const by = Object.fromEntries(plan.rows.map(r => [r.name, r]));
  assert.equal(by.Crypt.status, "inUse", "never suggest archiving a scene someone is on");
  assert.equal(by.Tavern.status, "small");
  assert.ok(by.Tavern.bytes < SMALL_SCENE_BYTES);
  assert.ok(by.Castle.copies > 400_000, "token item copies are measured");
  assert.ok(by.Castle.bytes > by.Castle.copies);
  assert.equal(plan.totalBytes, plan.rows.reduce((a, r) => a + r.bytes, 0));
});

test("finds map notes, the scene's own journal and links from journals, macros and other scenes", () => {
  const by = Object.fromEntries(planScenes(world()).rows.map(r => [r.name, r]));
  assert.deepEqual(by.Village.pinned.map(p => p.name), ["Village overview", "Village notes", "Burgomaster"],
    "the scene journal and each pinned entry once");
  assert.equal(by.Village.notes, 3);
  assert.equal(by.Village.playerTokens, 1);
  assert.equal(by.Village.status, "prep");
  assert.deepEqual(by.Castle.linkedFrom, [{ type: "scene", name: "Village" }], "a teleport region in another scene");
  assert.equal(by.Castle.status, "prep");
  assert.deepEqual(by.Crypt.linkedFrom, [{ type: "journal", name: "Village notes" }]);
  assert.deepEqual(by.Tavern.linkedFrom, [{ type: "macro", name: "Go to tavern" }], "a bare id in a macro");
  assert.equal(by.Village.linkedFrom.length, 0, "a scene's own id inside itself is not a link");
});

test("a large scene with nothing pointing at it needs no prep", () => {
  const input = world();
  input.scenes[1].regions = [];
  const by = Object.fromEntries(planScenes(input).rows.map(r => [r.name, r]));
  assert.equal(by.Castle.status, "ready");
  assert.equal(planScenes(input).rows[0].name, "Castle", "no-prep scenes come first");
});

test("folder totals and output", () => {
  const plan = planScenes(world());
  const barovia = plan.folders.find(f => f.folder === "Barovia");
  assert.deepEqual([barovia.scenes, barovia.prep, barovia.ready, barovia.inUse], [2, 2, 0, 0]);
  assert.equal(plan.groups.inUse.count, 1);
  const html = scenePlanToHtml(plan);
  assert.ok(html.includes("map notes open 3 journal entries: Village overview, Village notes, Burgomaster"));
  assert.ok(html.includes("linked from Village (scene)"));
  assert.ok(html.includes("data-action=\"copyMarkdown\""));
  const md = scenePlanToMarkdown(plan);
  assert.match(md, /## Archive after prep: 2 scenes/);
  assert.match(md, /- \[ \] Village \(Barovia\), [\d.]+ KB: map notes open 3 journal entries/);
  assert.ok(!md.includes("Crypt"), "in-use and small scenes are not on the checklist");
});

test("names are escaped in HTML", () => {
  const input = world();
  input.scenes[0].name = "<img src=x onerror=alert(1)>";
  assert.ok(!scenePlanToHtml(planScenes(input)).includes("<img src=x"));
});

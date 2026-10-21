/**
 * The scene archive planner: which scenes and areas cost the most at load, which can go to a compendium with no
 * prep, and which have journal entries on their maps or ways in from scenes that stay in the world.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planScenes, scenePlanToHtml, scenePlanToMarkdown, sceneNote, SMALL_SCENE_BYTES } from "../modules/performance-triage/scripts/lib/scene-plan.mjs";

const big = n => ({ items: [{ name: "Claw", system: { description: { value: "x".repeat(n) } } }] });
const npc = (id, n) => ({ _id: id, actorId: "npc", actorLink: false, delta: big(n) });
const ID = {
  castle: "castle0000000001", village: "village000000001", crypt: "crypt00000000001", hall: "hall000000000001",
  tavern: "tavern0000000001", road: "road000000000001", shrine: "shrine0000000001"
};
const teleportTo = id => [{ behaviors: [{ type: "teleportToken", system: { destination: `Scene.${id}.Region.r000000000000001` } }] }];

function world() {
  const scenes = [
    // Barovia: the village teleports to the castle, but both are in the same folder, so that is not a way in
    { _id: ID.castle, name: "Castle", folder: "f1", walls: [{}, {}], lights: [{}], tokens: [npc("t1", 500_000)] },
    { _id: ID.village, name: "Village", folder: "f1", journal: "j3", navigation: true,
      notes: [{ entryId: "j1" }, { entryId: "j1" }, { entryId: "j2" }], regions: teleportTo(ID.castle),
      tokens: [{ _id: "t2", actorId: "pc", actorLink: true }, npc("t3", 300_000)] },
    // Dungeons: the party is here
    { _id: ID.crypt, name: "Crypt", folder: "f2", tokens: [npc("t4", 400_000)] },
    // Ravenloft / Interiors: a tile trigger into the village is a way into Barovia from another area
    { _id: ID.hall, name: "Hall", folder: "f3", tokens: [npc("t5", 350_000)],
      tiles: [{ flags: { "monks-active-tiles": { actions: [{ data: { sceneid: ID.village } }] } } }] },
    // No folder: each scene is its own area, so the road's teleport to the shrine is a way in
    { _id: ID.tavern, name: "Tavern", folder: null, tokens: [] },
    { _id: ID.road, name: "Road", folder: null, regions: teleportTo(ID.shrine), tokens: [npc("t6", 300_000)] },
    { _id: ID.shrine, name: "Shrine", folder: null, tokens: [npc("t7", 300_000)] }
  ];
  const journals = [
    { _id: "j1", name: "Village notes", pages: [{ text: { content: `See @UUID[Scene.${ID.crypt}]{the crypt}` } }] },
    { _id: "j2", name: "Burgomaster", pages: [] },
    { _id: "j3", name: "Village overview", pages: [] }
  ];
  const macros = [{ _id: "m1", name: "Go to tavern", command: `game.scenes.get("${ID.tavern}").view()` }];
  return {
    scenes, journals, macros, inUse: new Set([ID.crypt]), playerActors: new Set(["pc"]),
    folders: new Map([["f1", "Barovia"], ["f2", "Dungeons"], ["f3", "Ravenloft / Interiors"]])
  };
}

const rowsByName = plan => Object.fromEntries(plan.rows.map(r => [r.name, r]));

test("sorts scenes into no prep, after prep, small and in use, largest first", () => {
  const plan = planScenes(world());
  assert.deepEqual(plan.rows.map(r => [r.name, r.status]), [
    ["Castle", "ready"], ["Hall", "ready"], ["Road", "ready"],
    ["Village", "prep"], ["Shrine", "prep"],
    ["Tavern", "small"],
    ["Crypt", "inUse"]
  ]);
  const by = rowsByName(plan);
  assert.ok(by.Tavern.bytes < SMALL_SCENE_BYTES);
  assert.ok(by.Castle.copies > 500_000, "token item copies are measured");
  assert.ok(by.Castle.bytes > by.Castle.copies);
  assert.equal(plan.totalBytes, plan.rows.reduce((a, r) => a + r.bytes, 0));
  assert.equal(plan.groups.ready.count, 3);
  assert.equal(plan.groups.inUse.count, 1);
});

test("journal entries on a map and ways in from other areas need prep; journal and macro links don't", () => {
  const by = rowsByName(planScenes(world()));
  assert.deepEqual(by.Village.pinned.map(p => p.name), ["Village overview", "Village notes", "Burgomaster"],
    "the scene's own journal and each pinned entry once");
  assert.deepEqual(by.Village.entrances, [{ id: ID.hall, name: "Hall", folder: "Ravenloft / Interiors" }],
    "a tile trigger in another folder, found by its bare scene id");
  assert.deepEqual(by.Castle.entrances, [], "a teleport within the same folder is not a way in");
  assert.deepEqual(by.Shrine.entrances.map(e => e.name), ["Road"], "scenes outside folders are separate areas");
  assert.deepEqual(by.Crypt.docLinks, [{ type: "journal", name: "Village notes" }]);
  assert.deepEqual(by.Tavern.docLinks, [{ type: "macro", name: "Go to tavern" }], "a quoted id inside macro code");
  assert.equal(by.Village.playerTokens, 1);
  assert.match(sceneNote(by.Village), /journal entries on this map: Village overview, Village notes, Burgomaster; ways in from other areas: Hall \(Ravenloft \/ Interiors\); 1 player character token; in the navigation bar/);
});

test("areas follow folders, are ranked by what archiving them saves, and leave scenes in use out of it", () => {
  const plan = planScenes(world());
  assert.deepEqual(plan.areas.map(a => a.folder), ["Barovia", "Ravenloft / Interiors", "Dungeons", ""],
    "scenes outside folders come last, together");
  const [barovia, , dungeons, loose] = plan.areas;
  assert.equal(barovia.saves, barovia.bytes);
  assert.deepEqual([barovia.ready, barovia.prep], [1, 1]);
  assert.deepEqual(barovia.pinned, ["Burgomaster", "Village notes", "Village overview"]);
  assert.deepEqual(barovia.entrances, [{ from: "Hall", fromFolder: "Ravenloft / Interiors", to: "Village" }]);
  assert.equal(dungeons.saves, 0, "the only scene is in use");
  assert.deepEqual([dungeons.pinned, dungeons.entrances], [[], []]);
  assert.equal(loose.scenes.length, 3);
  assert.deepEqual(loose.entrances, [{ from: "Road", fromFolder: "", to: "Shrine" }]);
});

test("token actor prep time is shown per scene once measured", () => {
  const input = world();
  assert.equal(planScenes(input).hasPrepTimes, false);
  assert.ok(scenePlanToHtml(planScenes(input)).includes("data-action=\"timeActors\""));
  input.prepMs = new Map([[ID.castle, 1234]]);
  const plan = planScenes(input);
  assert.equal(rowsByName(plan).Castle.prepMs, 1234);
  assert.equal(rowsByName(plan).Hall.prepMs, null);
  const html = scenePlanToHtml(plan);
  assert.ok(html.includes("Token actor prep") && html.includes("1.2 s"));
  assert.ok(!html.includes("data-action=\"timeActors\""), "no need to offer the timing again");
});

test("the window shows steps, areas and all scenes, remembering which sections are open", () => {
  const plan = planScenes(world());
  const html = scenePlanToHtml(plan, { open: new Set(["area:f1"]), measuredMs: 812 });
  assert.match(html, /<details class="ptriage-area" data-section="area:f1" open>/);
  assert.match(html, /<details class="ptriage-section" data-section="areas">/, "closed when not in the open set");
  assert.ok(html.includes("1. Barovia"));
  assert.ok(html.includes("2 scenes (1 no prep, 1 after prep), archiving saves"));
  assert.ok(html.includes("Ways in from scenes that stay: Hall (Ravenloft / Interiors) → Village."));
  assert.ok(html.includes("In use now, keep in the world: Crypt."));
  assert.ok(html.includes("Put the ones you want to archive in one"), "advice for scenes outside folders");
  assert.ok(html.includes("Measured in 812 ms"));
  assert.ok(html.includes("tick the option to keep IDs"));
});

test("the checklist covers areas worth archiving", () => {
  const md = scenePlanToMarkdown(planScenes(world()));
  assert.match(md, /^# Scene archive plan/);
  assert.match(md, /\n1\. In the Compendium Packs tab, create a compendium of type Scene/);
  assert.match(md, /\n## Barovia\n\n2 scenes \(1 no prep, 1 after prep\), archiving saves [\d.]+ KB\n\n- Journal entries on these maps: Burgomaster, Village notes, Village overview\.\n- Ways in from scenes that stay: Hall \(Ravenloft \/ Interiors\) → Village\.\n- \[ \] Archived\n/);
  assert.match(md, /- \[ \] Archived\n  - Castle, [\d.]+ KB, no prep\n  - Village, [\d.]+ KB, after prep \(journal entries on this map/);
  assert.ok(!md.includes("## Dungeons"), "nothing to gain there while the party is on it");
  assert.match(md, /## Scenes outside any folder/);
});

test("names are escaped in HTML", () => {
  const input = world();
  input.scenes[0].name = "<img src=x onerror=alert(1)>";
  input.folders.set("f1", "<b>Barovia</b>");
  const html = scenePlanToHtml(planScenes(input));
  assert.ok(!html.includes("<img src=x") && !html.includes("<b>Barovia"));
});

test("a scene in use adds no prep to its area", () => {
  const input = world();
  input.inUse = new Set([ID.village]);
  const barovia = planScenes(input).areas.find(a => a.folder === "Barovia");
  assert.deepEqual(barovia.pinned, [], "the village stays, so its journal entries stay reachable on its map");
  assert.deepEqual(barovia.entrances, [], "and its way in from the hall still leads somewhere");
  assert.equal(barovia.saves, barovia.bytes - planScenes(input).rows.find(r => r.name === "Village").bytes);
});

test("archived areas list what is in compendiums and the ways into them from the world", () => {
  const input = world();
  const stored = "stored0000000001";
  input.scenes[0].regions = teleportTo(stored);                 // Castle has a teleport into an archived scene
  input.journals[1].pages = [{ text: { content: `@UUID[Scene.${stored}]{the old mill}` } }];
  input.archived = [
    { id: "world.archive-mill", title: "Archive: Mill", scenes: [{ id: stored, name: "Old Mill" }, { id: ID.hall, name: "Hall" }] },
    { id: "world.empty", title: "Archive: restored", scenes: [{ id: ID.road, name: "Road" }] }
  ];
  const plan = planScenes(input);
  assert.deepEqual(plan.archive.map(a => a.title), ["Archive: Mill"], "a pack whose scenes are all back in the world is not listed");
  assert.deepEqual(plan.archive[0].names, ["Old Mill"], "Hall is in the world, so not archived");
  assert.deepEqual(plan.archive[0].waysIn, [{ from: "Castle", fromFolder: "Barovia", to: "Old Mill" }]);
  assert.deepEqual(plan.archive[0].journals, ["Burgomaster"]);
  const castle = rowsByName(plan).Castle;
  assert.match(sceneNote(castle), /leads into archived scenes: Old Mill \(Archive: Mill\)/);
  const html = scenePlanToHtml(plan);
  assert.ok(html.includes("In compendiums: 1 pack, 1 way in from the world"));
  assert.ok(html.includes("Castle (Barovia) → Old Mill"));
  assert.match(scenePlanToMarkdown(plan), /## Ways into archived areas\n\nBring the area back before players use one of these\.\n\n- Castle \(Barovia\) → Old Mill \(Archive: Mill\)/);
});


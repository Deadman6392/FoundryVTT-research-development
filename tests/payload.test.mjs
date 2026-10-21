/**
 * World data measurement: what the server sends every client at startup, and which parts make it big.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { measurePayload } from "../modules/performance-triage/scripts/lib/payload.mjs";

test("measurePayload sizes sections and groups compendium indexes by package", () => {
  const out = measurePayload({
    actors: [{ name: "A" }, { name: "B" }],
    messages: new Array(3).fill({ content: "x".repeat(100) }),
    packs: [
      { packageType: "module", packageName: "cpr", index: [{ _id: 1 }, { _id: 2 }] },
      { packageType: "module", packageName: "cpr", index: [{ _id: 3 }] },
      { packageType: "system", packageName: "dnd5e", index: [] }
    ]
  });
  assert.equal(out.sections[0].key, "messages");
  const cpr = out.packs.find(p => p.key === "module:cpr");
  assert.equal(cpr.packs, 2);
  assert.equal(cpr.entries, 3);
});

test("measurePayload breaks scenes, settings and actors down so the report can say what is big", () => {
  const bigDelta = { items: new Array(20).fill({ name: "Claw", system: { description: { value: "x".repeat(500) } } }) };
  const out = measurePayload({
    scenes: [
      { _id: "s1", name: "Castle", walls: new Array(50).fill({ c: [0, 0, 100, 100] }), flags: { levels: { a: 1 } },
        tokens: [{ _id: "t1", name: "Zombie", delta: bigDelta }, { _id: "t2", name: "Zombie", delta: bigDelta }] },
      { _id: "s2", name: "Field", walls: [], tokens: [] }
    ],
    settings: [
      { key: "fa-nexus.cache", value: "y".repeat(5000) },
      { key: "core.time", value: 0 },
      { key: "fa-nexus.other", value: "z" }
    ],
    actors: [{ name: "Strahd", type: "npc", items: new Array(3).fill({ name: "Bite" }) }, { name: "Bat", type: "npc", items: [] }]
  });
  const sc = out.detail.scenes;
  assert.equal(sc.parts[0].key, "tokens", "token data is the largest part");
  assert.ok(sc.tokenDelta > 0.9 * sc.parts[0].bytes, "almost all token bytes are actor deltas");
  assert.ok(sc.parts.some(p => p.key === "flags") && sc.parts.some(p => p.key === "other"));
  const partSum = sc.parts.reduce((a, p) => a + p.bytes, 0);
  assert.equal(partSum, sc.bytes, "parts add up to the scene total");
  assert.equal(sc.largest[0].name, "Castle");
  assert.equal(sc.largest[0].tokens, 2);
  assert.equal(out.sections.find(s => s.key === "scenes").bytes, sc.bytes);
  assert.deepEqual(out.detail.settings.byPackage.map(g => [g.key, g.count]), [["fa-nexus", 2], ["core", 1]]);
  assert.equal(out.detail.actors.largest[0].name, "Strahd");
});

test("measurePayload breaks token deltas down by part, base actor and items that still match the base actor", () => {
  const claw = { _id: "i1", name: "Claw", system: { description: { value: "x".repeat(400) } }, _stats: { modifiedTime: 1 } };
  const bite = { _id: "i2", name: "Bite", system: { uses: { spent: 0 } }, _stats: { modifiedTime: 1 } };
  const actors = [
    { _id: "a1", name: "Zombie", type: "npc", items: [claw, bite] },
    { _id: "a2", name: "Hero", type: "character", items: [] }
  ];
  const later = { modifiedTime: 99 };
  const tokens = [
    // A migration rewrote every item: the copies only differ in their timestamps
    { _id: "t1", name: "Zombie", actorId: "a1", actorLink: false,
      delta: { items: [{ ...claw, _stats: later }, { ...bite, _stats: later }], effects: [] } },
    // Real token state: a used Bite, a removed Claw, and an effect
    { _id: "t2", name: "Zombie 2", actorId: "a1", actorLink: false,
      delta: { items: [{ ...bite, system: { uses: { spent: 1 } } }, { _id: "i1", _tombstone: true }],
        effects: [{ _id: "e1", name: "Prone" }], system: { attributes: { hp: { value: 3 } } } } },
    { _id: "t3", name: "Hero", actorId: "a2", actorLink: true, delta: { items: [{ _id: "old", name: "Rope" }] } },
    { _id: "t4", name: "Ghost", actorId: "deleted", actorLink: false, delta: { items: [] } }
  ];
  const out = measurePayload({ actors, scenes: [{ _id: "s1", name: "Crypt", tokens }] });
  const t = out.detail.scenes.tokens;
  assert.equal(t.count, 4);
  assert.equal(t.linked, 1);
  assert.equal(t.unlinked, 3);
  assert.equal(t.items, 4, "tombstones are not items");
  assert.equal(t.withItems, 3);
  assert.equal(t.same.items, 2, "only t1's copies match the base actor once timestamps are ignored");
  assert.ok(t.same.bytes > 400);
  assert.deepEqual(t.linkedDelta, { tokens: 1, bytes: t.largest.find(x => x.name === "Hero").delta });
  assert.equal(t.missingActor.tokens, 1);
  assert.equal(t.parts[0].key, "items");
  assert.equal(t.deltaBytes, out.detail.scenes.tokenDelta);
  const partSum = t.parts.reduce((a, p) => a + p.bytes, 0);
  assert.equal(partSum, t.deltaBytes, "delta parts add up to the delta total");
  const zombie = t.byActor[0];
  assert.deepEqual([zombie.actor, zombie.tokens, zombie.items, zombie.same], ["Zombie", 2, 3, 2]);
  assert.equal(t.byActor.find(g => g.actor === null).tokens, 1, "tokens of a deleted actor are grouped without a name");
  assert.equal(t.largest[0].scene, "Crypt");
});

test("measurePayload names the largest individual world settings", () => {
  const out = measurePayload({
    settings: [
      { key: "autoanimations.aaAutorec-melee", value: "m".repeat(3000) },
      { key: "autoanimations.version", value: "5" },
      { key: "beneos-module.cache", value: "b".repeat(2000) }
    ]
  });
  assert.deepEqual(out.detail.settings.largest.map(s => s.key),
    ["autoanimations.aaAutorec-melee", "beneos-module.cache", "autoanimations.version"]);
});

test("token item copies are split into matching, differing and added items, and doubled names are counted", () => {
  const claw = { _id: "i1", name: "Claw", type: "weapon", system: { damage: "1d6" } };
  const bite = { _id: "i2", name: "Bite", type: "weapon", system: { damage: "1d8" } };
  const actors = [{ _id: "a1", name: "Ghoul", items: [claw, bite] }];
  const tokens = [
    { _id: "t1", name: "Ghoul", actorId: "a1", actorLink: false, delta: { items: [
      { ...claw },                                          // identical
      { ...bite, system: { damage: "2d8" } },               // differs: an override
      { _id: "i9", name: "Claw", type: "weapon", system: {} }, // added, same name and type as a base item: shown twice
      { _id: "i8", name: "Rope", type: "loot", system: {} }  // added, new
    ] } },
    // Without its sidebar actor nothing can be compared; these items are counted but not classified
    { _id: "t2", name: "Lost", actorId: "gone", actorLink: false, delta: { items: [{ _id: "x", name: "Claw", type: "weapon" }] } }
  ];
  const t = measurePayload({ actors, scenes: [{ _id: "s1", name: "Crypt", tokens }] }).detail.scenes.tokens;
  assert.equal(t.items, 5);
  assert.equal(t.same.items, 1);
  assert.deepEqual(t.added, { items: 2, duplicates: 1 });
});


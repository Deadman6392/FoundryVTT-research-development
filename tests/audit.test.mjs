/**
 * Collect a real report from the audit module against the Foundry mock, to catch mistakes in the glue code that the
 * pure-function tests cannot see (wrong property names, missing guards when there is no canvas, and so on).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

const env = installFoundry({ userId: "gm1", role: 4, activeModules: ["midi-qol"] });

/** Minimal stand-in for Foundry's Collection: iterable, with size, contents and filter. */
function collection(items) {
  return Object.assign([...items], {
    get size() { return items.length; },
    get contents() { return [...items]; }
  });
}

function actor(name, items, effects) {
  return { name, type: "npc", items: collection(new Array(items).fill({})), effects: collection(new Array(effects).fill({})), reset() {} };
}

const actors = collection([actor("Goblin", 3, 0), actor("Lich", 120, 30)]);
const empty = collection([]);
Object.assign(game, {
  system: { id: "dnd5e", version: "5.3.3" },
  world: { id: "test-world" },
  user: { name: "GM", isGM: true },
  actors, items: empty, journal: empty, scenes: empty, messages: collection(new Array(42).fill({})), tables: empty,
  playlists: empty, macros: empty, cards: empty, combats: empty, folders: empty,
  users: collection([{ id: "gm1", name: "GM", isGM: true, active: true, getFlag: () => null }]),
  packs: collection([{ index: { size: 300 }, metadata: { packageType: "module", packageName: "big-content" } }])
});
game.modules.set("midi-qol", {
  id: "midi-qol", title: "Midi QOL", version: "13.0.68", active: true,
  compatibility: { verified: "13.351" }, packs: { size: 4 }, esmodules: { size: 1 }, scripts: { size: 0 }, styles: { size: 1 }
});
game.modules.set("old-module", {
  id: "old-module", title: "Old", version: "1.0", active: true,
  compatibility: { verified: "11.315" }, packs: { size: 0 }, esmodules: { size: 1 }, scripts: { size: 0 }, styles: { size: 0 }
});
game.modules.set("old-map-pack", {
  id: "old-map-pack", title: "Old maps", version: "1.0", active: true,
  compatibility: { verified: "12" }, packs: { size: 2 }, esmodules: { size: 0 }, scripts: { size: 0 }, styles: { size: 0 }
});
game.modules.filter = fn => [...game.modules.values()].filter(fn);
CONFIG.debug = { hooks: true, fog: { manager: false } };
globalThis.navigator ??= {};
globalThis.innerWidth = 1600;
globalThis.innerHeight = 900;
env.settings.register("midi-qol", "Debug", { scope: "world", default: "none" });
await game.settings.set("midi-qol", "Debug", "all");

await import("../modules/performance-triage/scripts/main.mjs");
env.registerCoreSettings();
env.Hooks.callAll("init");

const { collectReport, benchmarkActors } = await import("../modules/performance-triage/scripts/audit.mjs");
const { reportToHtml } = await import("../modules/performance-triage/scripts/lib/report-format.mjs");

test("collectReport gathers world, module and debug data without a drawn canvas", async () => {
  canvas.ready = false;
  const report = await collectReport();
  assert.equal(report.canvas.ready, false);
  assert.equal(report.world.counts.actors, 2);
  assert.equal(report.world.counts.messages, 42);
  assert.equal(report.world.heavyActors[0].name, "Lich");
  assert.equal(report.world.packs.byPackage[0].key, "module:big-content");
  assert.deepEqual(report.modules.outdated.map(m => m.id), ["old-module"], "content-only packs are not code");
  assert.equal(report.modules.outdatedContent, 1);
  assert.equal(report.client.liveFps, null, "no live frame rate without a drawn canvas");
  assert.deepEqual(report.profile.overridden, []);
  assert.deepEqual(report.modules.debug.map(d => d.label), ["CONFIG.debug.hooks", "midi-qol Debug setting"]);
  assert.ok(report.findings.some(f => f.title.includes("CONFIG.debug.hooks")));
  assert.ok(reportToHtml(report, {}).includes("Lich"));
});

test("benchmarkActors times every world actor and sorts the slowest first", async () => {
  actors[1].reset = () => {
    const end = performance.now() + 5;
    while ( performance.now() < end ) { /* spin */ }
  };
  const prep = await benchmarkActors();
  assert.equal(prep.count, 2);
  assert.equal(prep.actors[0].name, "Lich");
  assert.ok(prep.actors[0].ms >= 5);
});

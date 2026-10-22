/**
 * Module settings known to add work on token moves are judged from the values in the world, version-specific
 * behaviour only applies to the versions it was read from, and aura definitions are counted per aura module.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { costlySettings, knownSettingKeys, compareVersions, countAuras, auraSystemsOf }
  from "../modules/performance-triage/scripts/lib/known-settings.mjs";
import { recommend } from "../modules/performance-triage/scripts/lib/recommend.mjs";

test("versions compare numerically", () => {
  assert.equal(compareVersions("0.12.10", "0.12.7"), 1);
  assert.equal(compareVersions("0.12.4", "0.12.4"), 0);
  assert.equal(compareVersions("1.5", "1.5.0"), 0);
  assert.equal(compareVersions("13.0.64", "13.0.69"), -1);
});

test("costly values are reported, cheap ones and missing modules are not", () => {
  const found = costlySettings([
    { module: "chris-premades", key: "movementPerformance", value: 2, version: "1.5.49" },
    { module: "chris-premades", key: "movementPerformanceDisable", value: false, version: "1.5.49" },
    { module: "ActiveAuras", key: "combatOnly", value: true, version: "0.12.7" },
    { module: "ActiveAuras", key: "wall-block", value: false, version: "0.12.7" },
    { module: "midi-qol", key: "ConfigSettings", value: { optionalRules: { wallsBlockRange: "centerLevels" } }, version: "13.0.64" }
  ]);
  assert.deepEqual(found.map(f => `${f.module}.${f.key}`),
    ["chris-premades.movementPerformance", "ActiveAuras.combatOnly", "midi-qol.ConfigSettings.optionalRules.wallsBlockRange"]);
  assert.match(found[0].detail, /Movement Event Accuracy is High\. CPR does its movement work on one GM's computer only/);
  assert.match(found[2].detail, /walls block range rule is "centerLevels"/);
  assert.deepEqual(costlySettings([{ module: "chris-premades", key: "movementPerformance", value: 1 }]), [], "Medium is fine");
});

test("version-specific behaviour is only claimed for the versions it was read from", () => {
  const combatOnly = version => costlySettings([{ module: "ActiveAuras", key: "combatOnly", value: true, version }]).length;
  assert.equal(combatOnly("0.12.3"), 0);
  assert.equal(combatOnly("0.12.4"), 1);
  assert.equal(combatOnly("0.12.8"), 0, "a later version may have fixed it");
});

test("the keys to read are the top-level settings, once each", () => {
  const keys = knownSettingKeys().map(k => k.join("."));
  assert.ok(keys.includes("midi-qol.ConfigSettings"));
  assert.equal(new Set(keys).size, keys.length);
});

test("aura definitions are recognised per module, on items, effects and effects on items", () => {
  assert.deepEqual(auraSystemsOf({ flags: { "chris-premades": { macros: { aura: [{ pass: "create" }] } } } }), ["chris-premades"]);
  assert.deepEqual(auraSystemsOf({ flags: { "chris-premades": { embeddedMacros: [{ type: "aura" }] } } }), ["chris-premades"]);
  assert.deepEqual(auraSystemsOf({ flags: { "chris-premades": { macros: { aura: [] } } } }), []);
  assert.deepEqual(auraSystemsOf({ flags: { ActiveAuras: { isAura: true } } }), ["ActiveAuras"]);
  assert.deepEqual(auraSystemsOf({ type: "auraeffects.aura" }), ["auraeffects"]);
  const counts = countAuras([
    { name: "Paladin", items: [{ flags: { "chris-premades": { macros: { aura: [{}] } } }, effects: [{ type: "auraeffects.aura" }] }] },
    { name: "Cleric", effects: [{ type: "auraeffects.aura" }] }
  ]);
  assert.equal(counts.get("auraeffects").sources, 2);
  assert.deepEqual([...counts.get("auraeffects").owners], ["Paladin", "Cleric"]);
  assert.equal(counts.get("ActiveAuras"), undefined);
});

test("the report names costly settings and aura modules with nothing to do", () => {
  const report = {
    env: { isGM: true },
    knownSettings: [{ module: "chris-premades", key: "movementPerformance", value: 3, version: "1.5.49" }],
    auras: [
      { module: "chris-premades", sources: 2, owners: ["Lyra"] },
      { module: "ActiveAuras", sources: 0, owners: [] },
      { module: "auraeffects", sources: 5, owners: ["Orendir", "Sir Ocelot"] }
    ]
  };
  const findings = recommend(report);
  const settings = findings.find(f => f.title === "1 module setting adds work on token moves or every frame");
  assert.ok(settings, findings.map(f => f.title).join("\n"));
  assert.equal(settings.severity, "medium");
  assert.match(settings.detail, /Accuracy is Ultra/);
  const auras = findings.find(f => f.title === "3 aura modules check auras when tokens move");
  assert.equal(auras.severity, "info", "using several aura modules is a choice; with no auras in play their cost is small");
  assert.match(auras.detail, /ActiveAuras \(on the GM's computer, on every waypoint, and on every wall or door change\): 0 auras on actors, tokens and sidebar items/);
  assert.match(auras.fix, /cheap with a few tokens/);
});

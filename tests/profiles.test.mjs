import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROFILES, PROFILE_IDS, resolveProfileId, planProfile, suggestProfile, splitSettingKey
} from "../modules/performance-triage/scripts/lib/profiles.mjs";

test("every profile id has a definition", () => {
  for ( const id of PROFILE_IDS ) assert.equal(PROFILES[id].id, id);
});

test("core.maxFPS values respect the core field (10-60 in steps of 10)", () => {
  for ( const p of Object.values(PROFILES) ) {
    const fps = p.settings["core.maxFPS"];
    if ( fps === undefined ) continue;
    assert.ok((fps >= 10) && (fps <= 60) && (fps % 10 === 0), `${p.id} maxFPS ${fps}`);
  }
});

test("resolveProfileId: player choice > assignment > default for players", () => {
  const assignments = { u1: "low", "*": "balanced" };
  assert.equal(resolveProfileId({ selfChoice: "minimum", assignments, userId: "u1" }), "minimum");
  assert.equal(resolveProfileId({ selfChoice: "gm", assignments, userId: "u1" }), "low");
  assert.equal(resolveProfileId({ selfChoice: "gm", assignments, userId: "u2" }), "balanced");
  assert.equal(resolveProfileId({ selfChoice: "gm", assignments, userId: "gm", isGM: true }), "none", "default skips GMs");
  assert.equal(resolveProfileId({ selfChoice: "gm", assignments: { gm: "low" }, userId: "gm", isGM: true }), "low");
  assert.equal(resolveProfileId({ selfChoice: "bogus", assignments: {}, userId: "u1" }), "none");
});

test("planProfile backs up original values once and only writes differences", () => {
  const plan = planProfile({
    target: { "core.maxFPS": 30, "core.lightAnimation": false },
    current: { "core.maxFPS": 60, "core.lightAnimation": false },
    raw: { "core.maxFPS": "60", "core.lightAnimation": null },
    backup: {}
  });
  assert.deepEqual(plan.writes, [{ key: "core.maxFPS", value: 30 }]);
  assert.deepEqual(plan.restores, []);
  assert.deepEqual(plan.backup, { "core.maxFPS": "60", "core.lightAnimation": null });
});

test("planProfile switching profiles keeps the user's original backup and restores dropped keys", () => {
  // Previously on "minimum": mipmap was managed and maxFPS was 20
  const plan = planProfile({
    target: { "core.maxFPS": 30 },
    current: { "core.maxFPS": 20, "core.mipmap": false },
    raw: { "core.maxFPS": "20", "core.mipmap": "false" },
    backup: { "core.maxFPS": "60", "core.mipmap": "true" }
  });
  assert.deepEqual(plan.writes, [{ key: "core.maxFPS", value: 30 }]);
  assert.deepEqual(plan.restores, [{ key: "core.mipmap", raw: "true" }]);
  assert.deepEqual(plan.backup, { "core.maxFPS": "60" }, "original 60 is kept, not the 20 from the old profile");
});

test("planProfile to an empty target restores everything", () => {
  const plan = planProfile({
    target: {},
    current: {},
    raw: {},
    backup: { "core.maxFPS": "60", "core.performanceMode": null }
  });
  assert.equal(plan.writes.length, 0);
  assert.deepEqual(plan.restores, [{ key: "core.maxFPS", raw: "60" }, { key: "core.performanceMode", raw: null }]);
  assert.deepEqual(plan.backup, {});
});

test("suggestProfile only steps down on evidence", () => {
  assert.equal(suggestProfile(null), null);
  assert.equal(suggestProfile({ fps: { target: 60, achieved: 58 }, cores: 16, memory: 8, maxTexture: 16384, loadSeconds: 20 }), null);
  assert.equal(suggestProfile({ fps: { target: 60, achieved: 20 }, cores: 8, memory: 8, loadSeconds: 30 }), "low");
  assert.equal(suggestProfile({ fps: { target: 60, achieved: 12 }, cores: 2, memory: 4, loadSeconds: 30 }), "minimum");
  assert.equal(suggestProfile({ fps: { target: 30, achieved: 29 }, cores: 4, memory: 4, loadSeconds: 40 }), "balanced");
});

test("splitSettingKey splits at the first dot only", () => {
  assert.deepEqual(splitSettingKey("core.nue.shownTips"), ["core", "nue.shownTips"]);
  assert.deepEqual(splitSettingKey("tokenmagic.disableAnimations"), ["tokenmagic", "disableAnimations"]);
});

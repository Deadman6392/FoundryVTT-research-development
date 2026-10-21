/**
 * Load history: one small local entry per load, so a GM can compare loads before and after a change.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";
import { loadEntry, parseHistory, appendHistory, median, HISTORY_LIMIT } from "../modules/performance-triage/scripts/lib/history.mjs";

const env = installFoundry({ userId: "gm1", role: 4 });

test("an entry summarizes the load from marks and long frames", () => {
  const entry = loadEntry({
    timeline: {
      navigation: { domContentLoaded: 2747 },
      marks: { scriptEval: 1945, init: 11286, setup: 20524, ready: 24829, readyComplete: 36016 }
    },
    frames: [{ start: 10553, duration: 1075 }, { start: 24800, duration: 11213 }],
    counts: { scenes: 89, tokens: 751, actors: 377, modules: 157 },
    worldBytes: 98.6 * 1024 * 1024,
    fps: 59.3,
    profile: "none",
    now: 1000
  });
  assert.deepEqual({ ...entry, worldBytes: Math.round(entry.worldBytes) }, {
    at: 1000, usable: 36016, wait: 10553 - 2747, build: 9238, readyHandlers: 11187,
    scenes: 89, tokens: 751, actors: 377, modules: 157, worldBytes: Math.round(98.6 * 1024 * 1024), fps: 59.3, profile: "none"
  });
});

test("history is parsed defensively, kept newest first and capped", () => {
  assert.deepEqual(parseHistory("not json"), []);
  assert.deepEqual(parseHistory('{"a":1}'), []);
  assert.deepEqual(parseHistory('[{"at":1},null,{"x":2}]'), [{ at: 1 }]);
  let list = [];
  for ( let i = 0; i < HISTORY_LIMIT + 5; i++ ) list = appendHistory(list, { at: i });
  assert.equal(list.length, HISTORY_LIMIT);
  assert.equal(list[0].at, HISTORY_LIMIT + 4);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([null, undefined]), null);
});

test("recordLoad writes one entry per call to local storage and the report shows it", async () => {
  const { telemetry } = await import("../modules/performance-triage/scripts/telemetry.mjs");
  Object.assign(telemetry.marks, { init: 100, setup: 600, ready: 900, readyComplete: 1000 });
  game.scenes = Object.assign([{ tokens: { size: 3 } }, { tokens: { size: 2 } }], { size: 2 });
  game.actors = { size: 7 };
  const { recordLoad, readHistory } = await import("../modules/performance-triage/scripts/history.mjs");
  recordLoad("low");
  recordLoad("low");
  const history = readHistory();
  assert.equal(history.length, 2);
  assert.deepEqual([history[0].scenes, history[0].tokens, history[0].actors, history[0].build, history[0].profile], [2, 5, 7, 500, "low"]);
  assert.ok(env.localStorage.getItem("performance-triage:history").startsWith("["));

  const { reportToHtml } = await import("../modules/performance-triage/scripts/lib/report-format.mjs");
  const html = reportToHtml({ env: {}, timeline: { marks: telemetry.marks }, history, findings: [] }, {});
  assert.ok(html.includes("Load history on this computer: 2 loads, median time until usable 1.0 s"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { frameMs, drawCostRows, settledAt, phasesWithin, worldDataWait } from "../modules/performance-triage/scripts/lib/frames.mjs";

test("drawCostRows turns draw times into time saved per frame, costliest first, parts under their layer", () => {
  const rows = drawCostRows(20, [
    { id: "tokens", label: "Tokens", ms: 12.04 },
    { id: "tiles", label: "Tiles", ms: 19 },
    { id: "coloration", label: "Light colours", ms: 18, parent: "effects" },
    { id: "effects", label: "Lighting", ms: 15 },
    { id: "illumination", label: "Illumination", ms: 17, parent: "effects" }
  ]);
  assert.deepEqual(rows.map(r => r.id), ["tokens", "effects", "illumination", "coloration", "tiles"]);
  assert.equal(rows[0].savedMs, 8);
  assert.equal(rows[0].ms, 12);
  assert.equal(frameMs(0), Infinity);
});

test("settledAt extends through freezes that follow closely and stops at a quiet gap", () => {
  const frames = [
    { start: 54866, duration: 42926 },  // ready handlers, ends 97792
    { start: 98339, duration: 7506 },   // a module's timer 0.5 s later
    { start: 125165, duration: 220 }    // much later: not part of startup
  ];
  assert.equal(settledAt(97792, frames), 98339 + 7506);
  assert.equal(settledAt(97792, []), 97792);
  assert.equal(settledAt(undefined, frames), null);
});

test("phasesWithin lists the startup marks inside a frame in order", () => {
  // readyComplete is recorded by a timeout that runs after the frame, so it is never inside it
  const marks = { init: 18273, i18nInit: 18762, setup: 41155, canvasReady: 54949, ready: 54981, readyComplete: 97800 };
  assert.deepEqual(phasesWithin({ start: 54866, duration: 42926 }, marks), ["canvasReady", "ready"]);
  assert.deepEqual(phasesWithin({ start: 18870, duration: 22682 }, marks), ["setup"]);
});

test("worldDataWait measures the idle gap before the frame that runs init", () => {
  const timeline = { navigation: { domContentLoaded: 619 }, marks: { scriptEval: 455, init: 11618, setup: 21454 } };
  const frames = [{ start: 11911, duration: 9693 }, { start: 10334, duration: 1388 }];
  assert.deepEqual(worldDataWait(timeline, frames), { from: 619, to: 10334, ms: 9715 });
  assert.equal(worldDataWait(timeline, [{ start: 11911, duration: 9693 }]), null, "no frame contains init");
  assert.equal(worldDataWait({ marks: {} }, frames), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { frameMs, frameCostRows, settledAt, phasesWithin } from "../modules/performance-triage/scripts/lib/frames.mjs";

test("frameCostRows converts frame rates into time saved per frame, largest first", () => {
  const rows = frameCostRows(18, [
    { id: "tokens", label: "Tokens", fps: 30 },
    { id: "tiles", label: "Tiles", fps: 19 },
    { id: "primary", label: "Everything", fps: 60 }
  ]);
  assert.deepEqual(rows.map(r => r.id), ["primary", "tokens", "tiles"]);
  assert.equal(rows[1].savedMs, 22.2, "18 -> 30 fps saves 55.6 - 33.3 ms");
  assert.equal(rows[0].atLimit, true, "60 fps is the display limit, so the saving is a minimum");
  assert.equal(rows[2].atLimit, false);
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

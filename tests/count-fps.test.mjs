/**
 * countFps measures the rate between frames, not whole frames per window: on a slow scene a short window holds only a
 * few frames, and one more or less would swing the result by more than a cheap layer costs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

const env = installFoundry({ userId: "gm1", role: 4 });

// A canvas drawing at about 13 fps (77 ms frames), recording when each frame actually ran
const listeners = new Set();
const frameTimes = [];
Object.assign(env.ticker, { add: fn => listeners.add(fn), remove: fn => listeners.delete(fn) });
(function tick() {
  frameTimes.push(performance.now());
  for ( const fn of listeners ) fn();
  setTimeout(tick, 77).unref();
})();

const { countFps } = await import("../modules/performance-triage/scripts/telemetry.mjs");

test("a short window on a slow canvas reads the frame rate, not a whole number of frames", async () => {
  for ( let i = 0; i < 4; i++ ) {
    const from = performance.now();
    const fps = await countFps(500);
    // The true rate over the frames that fell in the window; frames per window would read 12 or 14 here
    const inWindow = frameTimes.filter(t => t >= from);
    const actual = ((inWindow.length - 1) * 1000) / (inWindow.at(-1) - inWindow[0]);
    assert.ok(Math.abs(fps - actual) <= 0.3, `measured ${fps} fps, frames ran at ${actual.toFixed(2)} fps`);
  }
  assert.equal(listeners.size, 0, "the counter is removed from the ticker");
});

test("without a drawn canvas there is nothing to count", async () => {
  canvas.ready = false;
  assert.equal(await countFps(100), null);
  canvas.ready = true;
});

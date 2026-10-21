/**
 * The startup frame rate sample must count frames the canvas renders. PIXI's own `ticker.FPS` overstates the rate
 * whenever a frame cap is below the display's refresh rate, which is exactly the case on low-spec profiles.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

const env = installFoundry();
const { sampleFps } = await import("../modules/performance-triage/scripts/telemetry.mjs");

// A capped ticker: listeners run at ~30 fps while FPS reads like a 144 Hz display's skipped frames
const listeners = new Set();
Object.assign(env.ticker, {
  maxFPS: 30,
  FPS: 144,
  add: fn => listeners.add(fn),
  remove: fn => listeners.delete(fn)
});
(function tick() {
  for ( const fn of listeners ) fn();
  setTimeout(tick, 1000 / 30).unref();
})();

/** The mock unrefs intervals and long timeouts; hold the process open while a sample (a few seconds) runs. */
async function held(promise) {
  const keep = setTimeout(() => {}, 9_000);
  try {
    return await promise;
  } finally {
    clearTimeout(keep);
  }
}

test("counts rendered frames instead of reading ticker.FPS", async () => {
  canvas.performance.fps = 30;
  const result = await held(sampleFps(() => false, { seconds: 1.5, every: 0.5 }));
  assert.equal(result.target, 30);
  assert.equal(result.samples, 3);
  assert.ok(result.achieved > 20 && result.achieved < 34, `achieved ${result.achieved}`);
  assert.equal(listeners.size, 0, "the frame counter is removed when sampling ends");
});

test("skips intervals that were throttled at either end", async () => {
  let throttled = true;
  setTimeout(() => throttled = false, 750).unref();
  const result = await held(sampleFps(() => throttled, { seconds: 2, every: 0.5 }));
  // Intervals ending at 0.5 s and 1.0 s touch the throttled period; 1.5 s and 2.0 s are clean
  assert.equal(result.samples, 2);
  assert.ok(result.achieved > 20, `achieved ${result.achieved}`);
});

test("skips an interval when the throttle starts and ends inside it", async () => {
  // Throttled from 0.6 s to 0.8 s: both ends of the 0.5-1.0 s interval look clean, but frames inside it were slowed
  let throttled = false;
  setTimeout(() => throttled = true, 600).unref();
  setTimeout(() => throttled = false, 800).unref();
  const result = await held(sampleFps(() => throttled, { seconds: 1.5, every: 0.5 }));
  assert.equal(result.samples, 2, "0-0.5 s and 1.0-1.5 s count; 0.5-1.0 s does not");
});

test("returns null without a drawn canvas", async () => {
  canvas.ready = false;
  try {
    assert.equal(await held(sampleFps(() => false, { seconds: 0.4, every: 0.2 })), null);
  } finally {
    canvas.ready = true;
  }
});

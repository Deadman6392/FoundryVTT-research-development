/**
 * Frame rate during play is kept per scene, from five-second stretches, and token moves are charged with the long
 * frames that overlap the two seconds after them, by package.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayStats, histogramQuantile, FPS_BUCKET, MOVE_WINDOW_MS } from "../modules/performance-triage/scripts/lib/play-stats.mjs";

const ORIGIN = "http://localhost:30000";
const frame = (startTime, duration, scripts = []) => ({ startTime, duration,
  scripts: scripts.map(([pkg, d]) => ({ sourceURL: `${ORIGIN}/modules/${pkg}/main.js`, duration: d })) });

test("frame rate is kept per scene as a histogram, with the median and the lowest tenth", () => {
  const stats = new PlayStats({ origin: ORIGIN });
  stats.setScene("s1", "Village");
  for ( let i = 0; i < 8; i++ ) stats.addWindow(300, 5000, 60); // 60 fps
  stats.addWindow(60, 5000, 60);                                  // 12 fps, twice: the lowest tenth of 11
  stats.addWindow(60, 5000, 60);
  stats.setScene("s2", "Castle");
  for ( let i = 0; i < 24; i++ ) stats.addWindow(110, 5000, 60);  // 22 fps
  stats.setScene("s1", "Village");                                // back again: same entry
  stats.addWindow(300, 5000, 60);
  const { scenes } = stats.summary();
  assert.deepEqual(scenes.map(s => s.name), ["Castle", "Village"], "longest first");
  const village = scenes[1];
  assert.equal(village.minutes, 0.9);
  assert.equal(village.fps, 60 + FPS_BUCKET / 2, "bucket middle");
  assert.equal(village.low, 10 + FPS_BUCKET / 2);
  assert.equal(scenes[0].fps, 22.5);
  assert.equal(scenes[0].target, 60);
});

test("histogram quantiles", () => {
  assert.equal(histogramQuantile([0, 0, 0], 0.5), null);
  assert.equal(histogramQuantile([1, 0, 3], 0.5), 2 * FPS_BUCKET + FPS_BUCKET / 2);
  assert.equal(histogramQuantile([1, 0, 3], 0.1), FPS_BUCKET / 2);
});

test("long frames count against the scene and the moves they overlap, by package", () => {
  const stats = new PlayStats({ origin: ORIGIN });
  stats.setScene("s1", "Abbey");
  const move = stats.addMove(10_000, 600);
  assert.ok(move);
  assert.equal(stats.addMove(10_100, 606), null, "a token moved with it joins the same event");
  // The frame that processed the move started just before its hook fired
  stats.addLongFrame(frame(9_950, 180, [["chris-premades", 120], ["ActiveAuras", 30]]));
  stats.addLongFrame(frame(10_900, 60, [["chris-premades", 40]]));
  stats.addLongFrame(frame(10_000 + MOVE_WINDOW_MS + 100, 70, [["dice-so-nice", 60]]), "after the window");
  stats.endMove(move, 10_000 + MOVE_WINDOW_MS, 660);
  stats.closeMoves(10_000 + MOVE_WINDOW_MS + 100);
  assert.equal(stats.summary().moves, null, "still waiting for late long frame entries");
  stats.closeMoves(10_000 + MOVE_WINDOW_MS + 600);
  const { scenes, moves } = stats.summary();
  assert.deepEqual([moves.count, moves.medianMs, moves.stuttered, moves.fps], [1, 240, 1, 30]);
  assert.deepEqual(moves.packages, [{ key: "module:chris-premades", ms: 160 }, { key: "module:ActiveAuras", ms: 30 }]);
  assert.equal(scenes.length, 0, "no measured stretch on the scene yet");
  stats.addWindow(300, 5000, 60);
  const abbey = stats.summary().scenes[0];
  assert.deepEqual([abbey.moves, abbey.moveMs], [1, 240]);
  assert.equal(abbey.longPerMin, 36, "three long frames in five seconds");
});

test("nothing is counted without a scene", () => {
  const stats = new PlayStats();
  stats.addWindow(300, 5000, 60);
  assert.equal(stats.addMove(1, 1), null);
  stats.addLongFrame(frame(0, 80));
  assert.deepEqual(stats.summary(), { scenes: [], moves: null });
});

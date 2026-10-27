import { test } from "node:test";
import assert from "node:assert/strict";
import { mixToMono, peaks, matchLoopEnd } from "../modules/dal-segno/scripts/lib/peaks.mjs";

test("mixToMono averages channels", () => {
  const mono = mixToMono([Float32Array.of(1, 0, -1), Float32Array.of(0, 0, 1)]);
  assert.deepEqual([...mono], [0.5, 0, 0]);
});

test("peaks gives min and max per bucket", () => {
  const samples = Float32Array.from({ length: 100 }, (_, i) => ((i < 50) ? 0.5 : -0.25) * ((i % 2) ? 1 : -1));
  const p = peaks(samples, 2);
  assert.deepEqual([...p], [-0.5, 0.5, -0.25, 0.25]);
  assert.deepEqual([...peaks(samples, 1, 50, 60)], [-0.25, 0.25]);
});

test("matchLoopEnd finds the point that repeats the loop start", () => {
  const rate = 8000;
  // A 3-second phrase of two mixed tones: its period is exactly 1 s, so 2.0 s matches a loop starting at 1.0 s
  const samples = Float32Array.from({ length: rate * 3 }, (_, i) => Math.sin(2 * Math.PI * 3 * (i / rate))
    + (0.5 * Math.sin(2 * Math.PI * 7 * (i / rate))));
  const { end, score } = matchLoopEnd(samples, rate, 1.0, 1.93, { search: 0.25, window: 0.25 });
  assert.ok(Math.abs(end - 2.0) < 0.002, `end ${end}`);
  assert.ok(score > 0.99);
});

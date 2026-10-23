/**
 * Light coverage: the area lights reach and how many overlap, which is what lighting costs to draw.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { polygonArea, polygonContains, lightCoverage } from "../modules/performance-triage/scripts/lib/light-coverage.mjs";

const square = (x, y, size) => [x, y, x + size, y, x + size, y + size, x, y + size];

test("polygon area and containment", () => {
  assert.equal(polygonArea(square(0, 0, 10)), 100);
  assert.equal(polygonArea([...square(0, 0, 10)].reverse()), 100, "winding doesn't matter");
  assert.equal(polygonArea([0, 0, 10, 0, 0, 10]), 50);
  assert.ok(polygonContains(square(0, 0, 10), 5, 5));
  assert.ok(!polygonContains(square(0, 0, 10), 15, 5));
  // An L shape: the notch is outside
  const ell = [0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10];
  assert.ok(polygonContains(ell, 2, 8));
  assert.ok(!polygonContains(ell, 8, 8));
});

test("coverage counts the area lights reach and how deep they overlap", () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 };
  const lights = [
    { id: "a", kind: "light", radius: 30, walls: true, points: square(0, 0, 40) },
    { id: "b", kind: "light", radius: 30, walls: true, points: square(20, 0, 40) }, // overlaps a on 20x40
    { id: "c", kind: "token", name: "Ireena", radius: 20, walls: true, points: square(70, 70, 20) },
    { id: "d", kind: "light", radius: 60, walls: false, points: square(0, 50, 100) } // ignores walls; partly outside
  ];
  const c = lightCoverage(lights, rect, { samples: 40000 });
  assert.equal(c.count, 4);
  // 1600 + 1600 + 400 + 10000 = 13600 of 10000
  assert.equal(c.cover, 1.36);
  // Reached: a∪b is 60x40 = 2400, d covers y 50..100 (5000), c lies inside d: 7400 of 10000
  assert.ok(Math.abs(c.lit - 0.74) <= 0.02, `lit ${c.lit}`);
  // Depth: a and b paint 3200 over 2400 reached, d and c 5400 over 5000, so 8600 / 7400
  assert.ok(Math.abs(c.overlap - 1.16) <= 0.06, `overlap ${c.overlap}`);
  assert.equal(c.unwalled, 1);
  assert.deepEqual(c.largest.map(l => l.id), ["d", "a", "b", "c"]);
  const [d, a, , token] = c.largest;
  assert.equal(d.walls, false);
  assert.equal(d.cover, 1, "a light may reach past the scene's edge");
  assert.ok(Math.abs(a.overlap - 0.5) <= 0.05, `half of a is under b: ${a.overlap}`);
  assert.equal(token.name, "Ireena");
  assert.ok(Math.abs(token.overlap - 1) <= 0.05, "the token's light is entirely under d");
});

test("nothing to measure", () => {
  assert.equal(lightCoverage([], { x: 0, y: 0, width: 0, height: 0 }), null);
  const none = lightCoverage([{ id: "x", kind: "light", points: [0, 0, 1, 1] }], { x: 0, y: 0, width: 10, height: 10 });
  assert.equal(none.count, 0, "degenerate shapes are skipped");
  assert.equal(none.lit, 0);
  assert.deepEqual(none.largest, []);
});

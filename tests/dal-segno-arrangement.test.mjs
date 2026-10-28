import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeArrangement, wholeFile, isArranged, sectionAt, locate, advance, secondsToEnd, segmentFrom, nextSegment,
  isContiguous, MAX_SECTIONS
} from "../modules/dal-segno/scripts/lib/arrangement.mjs";

/** Intro 0-10, loop 10-40, ending 40-end of a 60 s file. */
const ILO = { sections: [
  { label: "Intro", start: 0, end: 10, loop: false },
  { label: "Loop", start: 10, end: 40, loop: true },
  { label: "Ending", start: 40, end: null, loop: false }
], seam: 0 };

test("normalizeArrangement clips to the file, drops empty sections and caps the count", () => {
  const arr = normalizeArrangement({ sections: [
    { label: "A", start: -5, end: 12, loop: 1 },
    { label: "too short", start: 20, end: 20.01 },
    { label: "past the end", start: 70, end: 90 },
    { label: "to end", start: 50, end: 80 },
    null,
    { start: "x", end: "" }
  ], seam: 9 }, 60);
  assert.deepEqual(arr.sections, [
    { label: "A", start: 0, end: 12, loop: true },
    { label: "to end", start: 50, end: null, loop: false },
    { label: "", start: 0, end: null, loop: false }
  ]);
  assert.equal(arr.seam, 4, "seam capped");
  const many = normalizeArrangement({ sections: Array.from({ length: 40 }, (_, i) => ({ start: i, end: i + 1 })) });
  assert.equal(many.sections.length, MAX_SECTIONS);
  assert.equal(normalizeArrangement({ sections: [] }), null);
  assert.equal(normalizeArrangement(null), null);
  assert.equal(normalizeArrangement({ sections: [{ start: 59.99, end: null }] }, 60), null);
});

test("an unknown duration keeps explicit ends and open-ended sections", () => {
  const arr = normalizeArrangement({ sections: [{ start: 5, end: 300 }, { start: 400, end: null }] });
  assert.deepEqual(arr.sections.map(s => s.end), [300, null]);
});

test("isArranged distinguishes a plain file from a trimmed or sectioned one", () => {
  assert.equal(isArranged(wholeFile(true)), false);
  assert.equal(isArranged(normalizeArrangement({ sections: [{ start: 2, end: null }] })), true);
  assert.equal(isArranged(ILO), true);
});

test("sectionAt and locate send positions in skipped gaps to the next section", () => {
  const gappy = { sections: [{ start: 0, end: 10, loop: false }, { start: 20, end: 30, loop: true }], seam: 0 };
  assert.equal(sectionAt(gappy, 60, 5), 0);
  assert.equal(sectionAt(gappy, 60, 15), 1);
  assert.equal(sectionAt(gappy, 60, 50), 1, "past everything: the last section");
  assert.deepEqual(locate(gappy, 60, 15), { section: 1, pos: 20 });
  assert.deepEqual(locate(ILO, 60, 25), { section: 1, pos: 25 });
});

test("advance plays the intro once, then loops the middle forever", () => {
  assert.deepEqual(advance(ILO, 60, { section: 0, pos: 0 }, 5), { section: 0, pos: 5, ended: false });
  assert.deepEqual(advance(ILO, 60, { section: 0, pos: 0 }, 10), { section: 1, pos: 10, ended: false });
  assert.deepEqual(advance(ILO, 60, { section: 0, pos: 0 }, 45), { section: 1, pos: 15, ended: false }, "10 intro + 30 loop + 5");
  const hours = advance(ILO, 60, { section: 0, pos: 0 }, 10 + (30 * 1000) + 7.5);
  assert.equal(hours.section, 1);
  assert.ok(Math.abs(hours.pos - 17.5) < 1e-6);
});

test("advance runs the ending out to the end of the file", () => {
  assert.deepEqual(advance(ILO, 60, { section: 2, pos: 40 }, 15), { section: 2, pos: 55, ended: false });
  assert.deepEqual(advance(ILO, 60, { section: 2, pos: 40 }, 25), { section: 2, pos: 60, ended: true });
  assert.equal(advance(ILO, undefined, { section: 2, pos: 40 }, 1e6).ended, false, "unknown length never ends");
});

test("advance skips the gap between sections", () => {
  const skip = { sections: [{ start: 0, end: 10, loop: false }, { start: 30, end: 40, loop: false }], seam: 0 };
  assert.deepEqual(advance(skip, 60, { section: 0, pos: 8 }, 4), { section: 1, pos: 32, ended: false });
  assert.deepEqual(advance(skip, 60, { section: 0, pos: 8 }, 12), { section: 1, pos: 40, ended: true });
});

test("secondsToEnd is infinite while a loop lies ahead and scales with speed", () => {
  assert.equal(secondsToEnd(ILO, 60, { section: 0, pos: 0 }), Infinity);
  assert.equal(secondsToEnd(ILO, 60, { section: 2, pos: 40 }), 20);
  assert.equal(secondsToEnd(ILO, 60, { section: 2, pos: 40 }, 2), 10);
  const straight = { sections: [{ start: 0, end: 10, loop: false }, { start: 30, end: 40, loop: false }], seam: 0 };
  assert.equal(secondsToEnd(straight, 60, { section: 0, pos: 5 }), 15);
});

test("segments chain intro -> loop -> loop and flag contiguous joins", () => {
  const first = segmentFrom(ILO, 60, 0, 3);
  assert.deepEqual(first, { section: 0, from: 3, to: 10 });
  const loop1 = nextSegment(ILO, 60, first);
  assert.deepEqual(loop1, { section: 1, from: 10, to: 40 });
  assert.equal(isContiguous(first, loop1), true, "intro runs straight into the loop");
  const loop2 = nextSegment(ILO, 60, loop1);
  assert.deepEqual(loop2, { section: 1, from: 10, to: 40 });
  assert.equal(isContiguous(loop1, loop2), false, "a loop is a jump back");
  assert.equal(nextSegment(ILO, 60, { section: 2, from: 40, to: 60 }), null);
});

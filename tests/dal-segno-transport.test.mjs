import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stopped, positionAt, endsAt, rebase, nextBoundary, play, pause, seek, jumpTo, cancelJump, setRate, clampRate, runsFrom
} from "../modules/dal-segno/scripts/lib/transport.mjs";

const ILO = { sections: [
  { label: "Intro", start: 0, end: 10, loop: false },
  { label: "Loop", start: 10, end: 40, loop: true },
  { label: "Ending", start: 40, end: null, loop: false }
], seam: 0 };
const D = 60;
const LEAD = 500;

const close = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-6, `${msg ?? ""} ${actual} != ${expected}`);

test("play starts after the lead, from the top when stopped", () => {
  const t = play(stopped(ILO), ILO, D, 1000, LEAD);
  assert.equal(t.status, "playing");
  assert.equal(t.at, 1500);
  assert.deepEqual(positionAt(t, ILO, D, 1200), { section: 0, pos: 0, ended: false, waiting: true });
  assert.deepEqual(positionAt(t, ILO, D, 4500), { section: 0, pos: 3, ended: false, waiting: false });
});

test("pause and resume keep the place; a paused transport doesn't move", () => {
  let t = play(stopped(ILO), ILO, D, 0, 0);
  t = pause(t, ILO, D, 25_000);
  assert.equal(t.status, "paused");
  assert.deepEqual([t.section, t.pos], [1, 25]);
  assert.deepEqual(positionAt(t, ILO, D, 999_999).pos, 25);
  t = play(t, ILO, D, 100_000, LEAD);
  close(positionAt(t, ILO, D, 102_500).pos, 27);
});

test("the ending waits for the end of the current loop pass", () => {
  let t = play(stopped(ILO), ILO, D, 0, 0);
  // 25 s in: intro done, 15 s into the loop's first pass (pos 25); that pass ends at pos 40, 15 s later
  t = jumpTo(t, ILO, D, 25_000, LEAD, 2, "boundary");
  assert.equal(t.jump.at, 40_000);
  assert.equal(t.jump.timing, "boundary");
  close(positionAt(t, ILO, D, 39_000).pos, 39, "still looping");
  assert.deepEqual(positionAt(t, ILO, D, 41_000), { section: 2, pos: 41, ended: false, waiting: false });
  assert.equal(endsAt(t, ILO, D), 60_000);
  assert.equal(positionAt(t, ILO, D, 61_000).ended, true);
});

test("a boundary closer than the lead waits for the following pass", () => {
  let t = play(stopped(ILO), ILO, D, 0, 0);
  t = jumpTo(t, ILO, D, 39_800, LEAD, 2, "boundary");
  assert.equal(t.jump.at, 70_000, "40 s mark is too close; the next pass ends at 70 s");
});

test("jumping now happens one lead from now", () => {
  let t = play(stopped(ILO), ILO, D, 0, 0);
  t = jumpTo(t, ILO, D, 25_000, LEAD, 2, "now");
  assert.equal(t.jump.at, 25_500);
  assert.deepEqual(positionAt(t, ILO, D, 26_500), { section: 2, pos: 41, ended: false, waiting: false });
});

test("cancelJump keeps looping", () => {
  let t = play(stopped(ILO), ILO, D, 0, 0);
  t = jumpTo(t, ILO, D, 25_000, LEAD, 2);
  t = cancelJump(t, ILO, D, 30_000);
  assert.equal(t.jump, null);
  assert.deepEqual([t.at, t.section, t.pos], [30_000, 1, 30]);
  assert.equal(endsAt(t, ILO, D), null);
});

test("seek moves together on every client and lands gaps on the next section", () => {
  const gappy = { sections: [{ start: 0, end: 10, loop: false }, { start: 20, end: 30, loop: true }], seam: 0 };
  let t = play(stopped(gappy), gappy, D, 0, 0);
  t = seek(t, gappy, D, 5000, LEAD, 15);
  assert.deepEqual(t.jump, { at: 5500, section: 1, pos: 20, timing: "now" });
  close(positionAt(t, gappy, D, 5200).pos, 5.2, "old place until the jump");
  close(positionAt(t, gappy, D, 6500).pos, 21);
  const parked = seek(stopped(gappy), gappy, D, 0, LEAD, 25);
  assert.equal(parked.status, "paused");
  assert.equal(parked.pos, 25);
});

test("speed scales time and re-times a jump waiting on a boundary", () => {
  let t = play(stopped(ILO), ILO, D, 0, 0);
  t = jumpTo(t, ILO, D, 25_000, LEAD, 2);
  assert.equal(t.jump.at, 40_000);
  t = setRate(t, ILO, D, 30_000, LEAD, 2);
  // At 30 s: pos 30. Ten file seconds left in the pass at 2x is 5 s
  assert.equal(t.rate, 2);
  assert.equal(t.jump.at, 35_000);
  close(positionAt(t, ILO, D, 32_000).pos, 34);
  assert.equal(clampRate(100), 4);
  assert.equal(clampRate("x"), 1);
});

test("rebase folds a past jump into the anchor and stops after the end", () => {
  let t = play(stopped(ILO), ILO, D, 0, 0);
  t = jumpTo(t, ILO, D, 25_000, LEAD, 2);
  const mid = rebase(t, ILO, D, 50_000);
  assert.deepEqual([mid.section, mid.pos, mid.jump], [2, 50, null]);
  const done = rebase(t, ILO, D, 70_000);
  assert.equal(done.status, "stopped");
  assert.equal(pause(t, ILO, D, 70_000).status, "stopped");
});

test("nextBoundary is null for a section of unknown length", () => {
  const t = play(stopped(ILO), ILO, undefined, 0, 0);
  const inEnding = jumpTo(t, ILO, undefined, 1000, 0, 2, "now");
  assert.equal(nextBoundary(rebase(inEnding, ILO, undefined, 5000), ILO, undefined, 5000, LEAD), null);
});

test("runsFrom joins the intro and first loop pass, then repeats the loop", () => {
  const t = play(stopped(ILO), ILO, D, 0, 0);
  const runs = runsFrom(t, ILO, D, 0);
  assert.deepEqual(runs.next().value, { from: 0, start: 0, section: 0, to: 40, end: 40_000, last: false });
  assert.deepEqual(runs.next().value, { from: 10, start: 40_000, section: 1, to: 40, end: 70_000, last: false });
  assert.deepEqual(runs.next().value, { from: 10, start: 70_000, section: 1, to: 40, end: 100_000, last: false });
});

test("runsFrom carries straight on when the ending follows the loop in the file", () => {
  let t = play(stopped(ILO), ILO, D, 0, 0);
  t = jumpTo(t, ILO, D, 25_000, LEAD, 2);
  const runs = [...runsFrom(t, ILO, D, 25_000)];
  assert.deepEqual(runs, [{ from: 25, start: 25_000, section: 1, to: 60, end: 60_000, last: true }]);
});

test("runsFrom cuts at a jump elsewhere in the file and waits for a delayed start", () => {
  let t = play(stopped(ILO), ILO, D, 0, LEAD);
  const waiting = runsFrom(t, ILO, D, 100).next().value;
  assert.equal(waiting.start, 500, "starts when the lead is over");
  t = play(stopped(ILO), ILO, D, 0, 0);
  t = jumpTo(t, ILO, D, 5000, LEAD, 2, "now");
  const runs = runsFrom(t, ILO, D, 5000);
  const first = runs.next().value;
  assert.equal(first.end, 5500);
  close(first.to, 5.5);
  assert.deepEqual(runs.next().value, { from: 40, start: 5500, section: 2, to: 60, end: 25_500, last: true });
  assert.equal(runs.next().done, true);
});

test("runsFrom yields nothing when paused and an open-ended run for unknown length", () => {
  assert.equal(runsFrom(pause(play(stopped(ILO), ILO, D, 0, 0), ILO, D, 1000), ILO, D, 2000).next().done, true);
  const plain = { sections: [{ start: 0, end: null, loop: false }], seam: 0 };
  const run = runsFrom(play(stopped(plain), plain, undefined, 0, 0), plain, undefined, 0).next().value;
  assert.equal(run.end, Infinity);
});

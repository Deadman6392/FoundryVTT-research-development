import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NEUTRAL_FX, chooseVoice, fxIsNeutral, nextInOrder, normalizeDeck, normalizeFx, pitchRatio, trackArrangement, trackFromSound
} from "../modules/dal-segno/scripts/lib/deck.mjs";

const sound = (extra = {}) => ({ id: "s1", name: "Battle", path: "music/battle.ogg", repeat: false, channel: "", ...extra });
const ILO = { sections: [{ label: "Intro", start: 0, end: 10, loop: false }, { label: "Loop", start: 10, end: 40, loop: true },
  { label: "Ending", start: 40, end: null, loop: false }], seam: 0, duration: 60 };

test("normalizeDeck turns an empty setting into a parked, empty deck", () => {
  const deck = normalizeDeck({});
  assert.equal(deck.track, null);
  assert.equal(deck.transport.status, "stopped");
  assert.deepEqual(deck.fx, { ...NEUTRAL_FX });
  assert.equal(deck.volume, 0.8);
  assert.equal(deck.fade, 1);
  assert.equal(deck.autoNext, true);
  assert.equal(deck.loopQueue, false);
  assert.deepEqual(normalizeDeck(undefined).transport.status, "stopped");
});

test("normalizeDeck repairs a damaged transport instead of trusting it", () => {
  const track = trackFromSound(sound(), { id: "p1", channel: "music" }, ILO);
  const deck = normalizeDeck({ track, transport: { status: "playing", at: 5, section: 9, pos: 1, rate: 99,
    jump: { at: 9, section: -3, pos: "x", timing: "weird" } } });
  assert.equal(deck.transport.section, 2, "clamped to the last section");
  assert.equal(deck.transport.rate, 4);
  assert.deepEqual(deck.transport.jump, { at: 9, section: 0, pos: 0, timing: "boundary" });
  assert.equal(normalizeDeck({ track, transport: { status: "dancing", at: 1, pos: 1 } }).transport.status, "stopped");
  assert.equal(normalizeDeck({ track, volume: 7, fade: -1 }).volume, 1);
});

test("trackFromSound takes the sound's channel, else its playlist's, and its saved sections", () => {
  const plain = trackFromSound(sound({ repeat: true }), { id: "p1", channel: "environment" }, null);
  assert.equal(plain.channel, "environment");
  assert.equal(plain.arrangement, null);
  assert.equal(plain.repeat, true);
  assert.equal(trackArrangement(plain).sections[0].loop, true, "a repeating sound loops the whole file");
  const own = trackFromSound(sound({ channel: "interface" }), { id: "p1", channel: "music" }, null);
  assert.equal(own.channel, "interface");
  const arranged = trackFromSound(sound(), { id: "p1", channel: "music" }, ILO);
  assert.equal(arranged.duration, 60);
  assert.equal(arranged.arrangement.sections.length, 3);
  assert.equal(arranged.playlist, "p1");
  assert.equal(arranged.sound, "s1");
  const loopAll = trackFromSound(sound(), null, { sections: [{ start: 0, end: null, loop: true }], duration: 30 });
  assert.equal(loopAll.arrangement.sections[0].loop, true, "a whole-file loop is kept");
  assert.equal(trackFromSound({ ...sound(), path: "" }, null, null), null, "no file, no track");
});

test("chooseVoice decodes only short tracks whose arrangement jumps", () => {
  const arranged = trackFromSound(sound(), null, ILO);
  assert.equal(chooseVoice(arranged), "buffer");
  assert.equal(chooseVoice(arranged, { precise: false }), "stream", "this computer said no");
  assert.equal(chooseVoice({ ...arranged, duration: 3600 }), "stream", "an hour is streamed");
  assert.equal(chooseVoice({ ...arranged, duration: null }), "stream", "length unknown");
  assert.equal(chooseVoice(trackFromSound(sound(), null, null)), "stream", "plays straight through");
});

test("pitchRatio: a decoded track compensates its speed when keeping pitch; a streamed one doesn't need to", () => {
  const keep = normalizeFx({ keepPitch: true });
  assert.equal(pitchRatio(keep, 2, "buffer"), 0.5);
  assert.equal(pitchRatio(keep, 2, "stream"), 1);
  assert.equal(pitchRatio(normalizeFx({ keepPitch: false }), 2, "buffer"), 1);
  assert.equal(pitchRatio(normalizeFx({ pitch: 12 }), 1, "stream"), 2);
});

test("normalizeFx clamps every effect", () => {
  const fx = normalizeFx({ pitch: 40, bass: -99, treble: "3", muffle: 2, reverb: -1, keepPitch: false });
  assert.deepEqual(fx, { pitch: 12, keepPitch: false, bass: -12, treble: 3, muffle: 1, reverb: 0 });
  assert.equal(fxIsNeutral(normalizeFx({})), true);
  assert.equal(fxIsNeutral(fx), false);
});

test("nextInOrder walks the play order and only wraps when asked", () => {
  assert.equal(nextInOrder(["a", "b", "c"], "a"), "b");
  assert.equal(nextInOrder(["a", "b", "c"], "c"), null);
  assert.equal(nextInOrder(["a", "b", "c"], "c", true), "a");
  assert.equal(nextInOrder(["a", "b"], "zzz"), "a");
  assert.equal(nextInOrder([], "a", true), null);
});

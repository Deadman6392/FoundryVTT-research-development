/**
 * Dal Segno's windows against the Foundry mock: the HTML the deck, section editor and shrink tool render, and the
 * shrink tool's time parsing. The mock's ApplicationV2 doesn't render, so each test calls _renderHTML directly; the
 * windows were also driven in headless Chromium with real audio (see the module README).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

installFoundry({ userId: "gm1", role: 4 });
foundry.applications.api.ApplicationV2.prototype.render = function() {
  return this;
};
const appended = [];
globalThis.document = {
  head: { append: el => appended.push(el) },
  getElementById: id => appended.find(el => el.id === id) ?? null,
  createElement: () => ({ id: "", textContent: "" })
};
game.time = { serverTime: 100_000 };
game.i18n.lang = "en";
game.user = { isGM: true };

const sound = (id, name, flags = {}) => ({ id, name, path: `music/${id}.ogg`, uuid: `Playlist.pl1.PlaylistSound.${id}`, getFlag: (s, k) => flags[s]?.[k] });
const battle = { id: "pl1", name: "Battle", sounds: new Map(), playbackOrder: ["b", "a"] };
battle.sounds.set("a", sound("a", "Ambush"));
battle.sounds.set("b", sound("b", "Boss", { "dal-segno": { arrangement: { sections: [] } } }));
battle.sounds[Symbol.iterator] = function() {
  return this.values();
};
game.playlists = Object.assign(new Map([["pl1", battle]]), { contents: [battle], find: fn => [battle].find(fn) });

const logic = {
  deck: await import("../modules/dal-segno/scripts/lib/deck.mjs"),
  transport: await import("../modules/dal-segno/scripts/lib/transport.mjs"),
  arrangement: await import("../modules/dal-segno/scripts/lib/arrangement.mjs")
};
const ILO = { sections: [{ label: "Intro", start: 0, end: 10, loop: false }, { label: "Loop", start: 10, end: 40, loop: true },
  { label: "Ending", start: 40, end: null, loop: false }], seam: 0, duration: 60 };
const track = logic.deck.trackFromSound(battle.sounds.get("b"), battle, ILO);
let deck = logic.deck.normalizeDeck({ track });
deck = { ...deck, transport: logic.transport.jumpTo(logic.transport.play(deck.transport, track.arrangement, 60, 90_000, 0), track.arrangement, 60, 100_000, 500, 2) };
const api = {
  deck,
  status: { status: "playing", detail: { kind: "buffer" } },
  duration: 60,
  canControl: () => true,
  loadLogic: async () => logic
};

const { DeckApp } = await import("../modules/dal-segno/scripts/apps/deck-app.mjs");
const { EditorApp } = await import("../modules/dal-segno/scripts/apps/editor-app.mjs");
const { ShrinkApp, parseTime } = await import("../modules/dal-segno/scripts/tools/shrink-app.mjs");

test("the deck lists the playlist in play order and shows the loaded track's sections", async () => {
  DeckApp.open(api);
  const html = await new DeckApp()._renderHTML();
  assert.ok(html.indexOf("Boss") < html.indexOf("Ambush"), "play order");
  assert.match(html, /data-sound-id="b" class="dsg-current"/);
  assert.match(html, /fa-sliders/, "arranged sounds are marked");
  assert.equal((html.match(/class="dsg-chip"/g) ?? []).length, 3, "a button per section");
  assert.match(html, /DALSEGNO\.Deck\.Precise/);
  assert.match(html, /left:0%;width:16\.6/, "the intro region is a sixth of the timeline");
  assert.match(html, /data-action="cancel"/, "a waiting jump can be cancelled");
  assert.match(html, /fa-pause/, "playing shows pause");
  assert.equal(appended.filter(el => el.id === "dal-segno-style").length, 1, "styles injected once");
  await new DeckApp()._renderHTML();
  assert.equal(appended.filter(el => el.id === "dal-segno-style").length, 1);
});

test("an empty deck invites picking a track", async () => {
  api.deck = logic.deck.normalizeDeck({});
  const html = await new DeckApp()._renderHTML();
  assert.match(html, /DALSEGNO\.Deck\.Empty/);
  assert.doesNotMatch(html, /dsg-chip/);
  api.deck = deck;
});

test("the section editor lists saved sections with an open end for the last", async () => {
  const boss = { ...battle.sounds.get("b"), getFlag: () => ILO };
  const app = EditorApp.open(boss, api);
  const html = await app._renderHTML();
  assert.equal((html.match(/<tr data-action="select"/g) ?? []).length, 3);
  assert.match(html, /name="end-1" value="40\.000"/);
  assert.match(html, /name="end-2" value=""/, "the ending runs to the end of the file");
  assert.match(html, /name="loop-1" checked/);
  assert.match(html, /data-action="match"[^>]* disabled/, "matching needs the waveform");
});

test("the shrink tool parses times and explains when the browser can't shrink", async () => {
  assert.equal(parseTime("1:02:03", 0), 3723);
  assert.equal(parseTime("2:30", 0), 150);
  assert.equal(parseTime("12.5", 0), 12.5);
  assert.equal(parseTime("", 7), 7);
  assert.equal(parseTime("soon", 7), 7);
  const html = await new ShrinkApp()._renderHTML();
  assert.match(html, /DALSEGNO\.Shrink\.Unsupported/, "Node has no WebCodecs");
});

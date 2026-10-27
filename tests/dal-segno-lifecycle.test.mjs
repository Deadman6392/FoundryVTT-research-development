/**
 * Runs Dal Segno's entry point against the Foundry mock as the GM: settings and keys at init, the deck written and
 * read back through its world setting, controls, permissions, saved sections and the move to the next track when one
 * ends. The audio itself isn't run here (there is no audio in Node): the engine waits on Foundry's audio unlock, which
 * never comes. Tests run in order and share state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFoundry } from "./helpers/foundry-mock.mjs";

const MODULE = "dal-segno";
const env = installFoundry({ userId: "gm1", role: 4 });
env.modules.set(MODULE, { id: MODULE, active: true });

// What Foundry provides that this module reads, beyond the shared mock
let clockOffset = 0;
game.time = { get serverTime() { return Date.now() + clockOffset; } };
game.audio = { unlock: new Promise(() => {}) };
const keybindings = new Map();
game.keybindings = { register: (ns, action, config) => keybindings.set(`${ns}.${action}`, config) };
game.user = { id: "gm1", isGM: true, can: permission => (permission === "SETTINGS_MODIFY") && game.user.isGM };
game.users = { activeGM: { isSelf: true } };
game.world = { id: "w" };
globalThis.CONST.PLAYLIST_MODES = { DISABLED: -1, SEQUENTIAL: 0, SHUFFLE: 1, SIMULTANEOUS: 2 };
foundry.utils.fromUuid = async uuid => sounds.find(s => s.uuid === uuid) ?? null;
globalThis.ui.playlists = { rendered: false };

/** Playlists and sounds as plain objects with the members the module touches. */
function makeSound(playlist, id, name, flags = {}) {
  return {
    id, name, documentName: "PlaylistSound", uuid: `Playlist.${playlist.id}.PlaylistSound.${id}`, path: `music/${id}.ogg`,
    repeat: false, channel: "", parent: playlist, flags,
    getFlag(scope, key) {
      return this.flags[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      (this.flags[scope] ??= {})[key] = structuredClone(value);
    },
    async unsetFlag(scope, key) {
      delete this.flags[scope]?.[key];
    }
  };
}
const stopped = [];
const battle = { id: "pl1", name: "Battle", channel: "music", mode: 0, playing: false, stopAll() {
  stopped.push(this.id);
} };
const core = { id: "pl2", name: "Tavern", channel: "music", mode: 0, playing: true, stopAll() {
  stopped.push(this.id);
} };
const sounds = [makeSound(battle, "s1", "Boss"), makeSound(battle, "s2", "Victory")];
battle.sounds = new Map(sounds.map(s => [s.id, s]));
battle.playbackOrder = ["s1", "s2"];
core.sounds = new Map();
const playlistList = [battle, core];
game.playlists = Object.assign(new Map(playlistList.map(p => [p.id, p])), {
  get playing() {
    return playlistList.filter(p => p.playing);
  },
  get contents() {
    return playlistList;
  }
});

const deckChanges = [];
env.Hooks.on("dalSegno.deckChanged", deck => deckChanges.push(deck));

await import("../modules/dal-segno/scripts/main.mjs");
const api = () => game.modules.get(MODULE).api;
const deck = () => game.settings.get(MODULE, "deck");
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test("init registers the deck setting, per-computer choices, menus and unbound keys", () => {
  env.Hooks.callAll("init");
  assert.equal(env.settings.settings.get(`${MODULE}.deck`).scope, "world");
  assert.equal(env.settings.settings.get(`${MODULE}.deck`).config, false);
  assert.equal(env.settings.settings.get(`${MODULE}.precise`).scope, "client");
  assert.equal(env.settings.settings.get(`${MODULE}.lite`).scope, "client");
  assert.equal(game.settings.get(MODULE, "precise"), true, "sample-accurate loops on by default");
  assert.equal(game.settings.get(MODULE, "lite"), false);
  assert.equal(game.settings.get(MODULE, "stopCore"), true);
  assert.equal(env.settings.menus.get(`${MODULE}.deckMenu`).restricted, true);
  assert.equal(env.settings.menus.get(`${MODULE}.shrinkMenu`).restricted, true);
  assert.deepEqual([...keybindings.keys()].sort(), ["dal-segno.deck", "dal-segno.ending", "dal-segno.next", "dal-segno.toggle"]);
  assert.ok([...keybindings.values()].every(k => (k.editable.length === 0) && k.restricted), "no default keys; GM only");
  assert.equal(typeof api().load, "function");
});

test("ready with an empty deck loads nothing", async () => {
  env.Hooks.callAll("ready");
  await settle();
  assert.equal(api().deck, null);
  assert.equal(deckChanges.length, 0);
});

test("loading a sound writes one deck for everyone, starts it after the lead, and stops Foundry's music", async () => {
  const before = game.time.serverTime;
  await api().load(sounds[0]);
  await settle();
  const d = deck();
  assert.equal(d.track.sound, "s1");
  assert.equal(d.track.playlist, "pl1");
  assert.equal(d.track.src, "music/s1.ogg");
  assert.equal(d.transport.status, "playing");
  assert.ok(d.transport.at >= before + 1200, "starts after the start lead");
  assert.deepEqual(stopped, ["pl2"], "the playing core playlist on the same channel was stopped");
  assert.equal(api().deck.track.name, "Boss");
  assert.equal(deckChanges.at(-1).track.sound, "s1");
});

test("pause, play and stop move the shared transport", async () => {
  await api().pause();
  assert.equal(deck().transport.status, "paused");
  await api().play();
  assert.equal(deck().transport.status, "playing");
  await api().stop();
  assert.equal(deck().transport.status, "stopped");
});

test("two quick changes both survive: writes go one at a time", async () => {
  await Promise.all([api().setFx({ bass: 4 }), api().configure({ volume: 0.3 }), api().setRate(1.5)]);
  const d = deck();
  assert.equal(d.fx.bass, 4);
  assert.equal(d.volume, 0.3);
  assert.equal(d.transport.rate, 1.5);
  await api().resetSound();
  assert.equal(deck().fx.bass, 0);
  assert.equal(deck().transport.rate, 1);
});

test("saving sections stores one flag, and the deck picks them up from the same place", async () => {
  await api().load(sounds[0]);
  const arrangement = { sections: [{ label: "Intro", start: 0, end: 5, loop: false }, { label: "Loop", start: 5, end: 25, loop: true },
    { label: "Ending", start: 25, end: null, loop: false }], seam: 0, duration: 40 };
  await api().saveArrangement(sounds[0], arrangement);
  assert.deepEqual(sounds[0].flags[MODULE].arrangement, arrangement);
  await settle();
  const d = deck();
  assert.equal(d.track.arrangement.sections.length, 3);
  assert.equal(d.track.duration, 40);
  assert.equal(d.transport.status, "playing");
  // Going to the ending waits for the current pass, so it is a jump in the future
  await api().ending();
  assert.equal(deck().transport.jump.section, 2);
  assert.ok(deck().transport.jump.at > game.time.serverTime);
  await api().cancel();
  assert.equal(deck().transport.jump, null);
  await api().goto("loop", { now: true });
  assert.equal(deck().transport.jump.section, 1);
  assert.equal(deck().transport.jump.timing, "now");
});

test("removing sections clears the flag", async () => {
  await api().saveArrangement(sounds[0], null);
  assert.equal(sounds[0].flags[MODULE].arrangement, undefined);
});

test("a player can't press the deck's controls", async () => {
  game.user.isGM = false;
  const written = JSON.stringify(deck());
  const result = await api().pause();
  assert.equal(result, null);
  assert.equal(JSON.stringify(deck()), written, "nothing written");
  assert.equal(env.notifications.at(-1)[0], "warn");
  game.user.isGM = true;
});

test("when a track ends, the active GM loads the next one in the playlist to start right as it finishes", async () => {
  // A one-second track: the GM writes the next one shortly before the end, timed to start at the end
  sounds[0].flags[MODULE] = { arrangement: { sections: [{ start: 0, end: 1, loop: false }], seam: 0, duration: 1 } };
  await api().load(sounds[0]);
  await settle();
  const end = deck().transport.at + 1000;
  // The next track is written 1.5 s before the end (the start lead plus a margin): 0.7 s from now
  await new Promise(resolve => setTimeout(resolve, 1000));
  const d = deck();
  assert.equal(d.track.sound, "s2", "Victory follows Boss");
  assert.equal(d.transport.status, "playing");
  assert.ok(Math.abs(d.transport.at - end) < 5, "starts when the first one ends");
});

test("after the last track the deck parks itself unless the playlist repeats", async () => {
  sounds[1].flags[MODULE] = { arrangement: { sections: [{ start: 0, end: 0.5, loop: false }], seam: 0, duration: 0.5 } };
  await api().load(sounds[1]);
  await new Promise(resolve => setTimeout(resolve, 2000));
  assert.equal(deck().transport.status, "stopped");
  assert.equal(deck().track.sound, "s2");
});

/**
 * Dal Segno entry point.
 *
 * At startup this registers settings, keybindings and a few hooks, and does nothing else: no fetches, no timers, no
 * listener that runs while music plays. The deck lives in one world setting that the GM's client writes when someone
 * presses a control; every client reacts by loading the engine (the first time something plays) and playing from the
 * shared server clock. The engine, the windows and the logic they share are all fetched with import() when first
 * needed, so a client that never hears the deck never downloads them.
 */
import { ARRANGEMENT_FLAG, LEAD_MS, MODULE_ID, START_LEAD_MS, VOLUME_SETTINGS } from "./constants.mjs";

const state = {
  /** The normalized deck, once something has been loaded into it. */
  deck: null,
  /** The engine once loaded, and the promise of it while loading. */
  engine: null,
  engineLoading: null,
  /** The engine's last report, for the deck window: {status, detail}. */
  status: { status: "idle", detail: null },
  /** The active GM's timer for the end of the current track. */
  endTimer: null,
  /** Volume nodes for audio contexts that lack Foundry's own, per context and channel. */
  volumes: new Map(),
  ownContext: null,
  volumeHook: null,
  /** The last track an error was reported for, so the GM hears about it once. */
  failed: null,
  /** The chain of deck writes from this client, and the deck being written. */
  writing: Promise.resolve(),
  written: null
};

const setting = key => game.settings.get(MODULE_ID, key);

let logic = null;

/** The pure logic shared by the engine, the windows and the controls: deck, transport and arrangement. */
function loadLogic() {
  logic ??= Promise.all([import("./lib/deck.mjs"), import("./lib/transport.mjs"), import("./lib/arrangement.mjs")])
    .then(([deck, transport, arrangement]) => ({ deck, transport, arrangement }));
  return logic;
}

/* -------------------------------------------- */
/*  Sound output                                */
/* -------------------------------------------- */

/**
 * Where a channel's sound goes: Foundry's audio context for the channel and the node that applies the player's
 * volume slider for it.
 */
async function output(channel) {
  // Browsers keep audio suspended until the player clicks or types; Foundry resolves this promise when they do
  await game.audio.unlock;
  const ctx = game.audio[channel] ?? game.audio.music ?? (state.ownContext ??= new AudioContext());
  return { ctx, destination: channelInput(ctx, channel) };
}

/**
 * Foundry's audio contexts each carry a master gain node that follows the player's volume slider for that channel
 * (the "gainNode (global) volume" in the AudioHelper#getBandLevel documentation). It isn't in the type definitions,
 * so where it is missing this module follows the slider itself, through the clientSettingChanged hook.
 */
function channelInput(ctx, channel) {
  if ( ctx.gainNode instanceof AudioNode ) return ctx.gainNode;
  let byChannel = state.volumes.get(ctx);
  if ( !byChannel ) state.volumes.set(ctx, byChannel = new Map());
  if ( byChannel.has(channel) ) return byChannel.get(channel);
  const gain = ctx.createGain();
  gain.gain.value = Number(game.settings.get("core", VOLUME_SETTINGS[channel] ?? VOLUME_SETTINGS.music)) || 0;
  gain.connect(ctx.destination);
  byChannel.set(channel, gain);
  state.volumeHook ??= Hooks.on("clientSettingChanged", onVolumeSetting);
  return gain;
}

function onVolumeSetting(key, value) {
  for ( const [channel, name] of Object.entries(VOLUME_SETTINGS) ) {
    if ( key !== `core.${name}` ) continue;
    for ( const byChannel of state.volumes.values() ) {
      const gain = byChannel.get(channel);
      gain?.gain.setTargetAtTime(Number(value) || 0, gain.context.currentTime, 0.05);
    }
  }
}

/**
 * A new engine. The deck's own is made once; the section editor makes another for previews only this client hears.
 * @param {(status: string, detail: any) => void} [onStatus]
 */
async function createEngine(onStatus) {
  const { Engine } = await import("./engine/engine.mjs");
  return new Engine({
    serverNow: () => game.time.serverTime,
    output,
    // Paths are used as Foundry's own sounds use them: relative to the page, which already carries any URL prefix
    resolve: src => src,
    workletUrl: foundry.utils.getRoute(`modules/${MODULE_ID}/scripts/engine/pitch-processor.mjs`),
    prefs: () => ({ precise: setting("precise"), lite: setting("lite") }),
    onStatus
  });
}

function getEngine() {
  state.engineLoading ??= createEngine(onEngineStatus).then(engine => (state.engine = engine));
  return state.engineLoading;
}

function onEngineStatus(status, detail) {
  state.status = { status, detail };
  Hooks.callAll("dalSegno.status", status, detail);
  if ( (status === "error") && game.user.isGM && (state.failed !== state.deck?.track?.src) ) {
    state.failed = state.deck?.track?.src;
    ui.notifications.error(game.i18n.format("DALSEGNO.Notify.PlayFailed", { name: state.deck?.track?.name ?? "", error: detail ?? "" }));
  }
  // The active GM learns a plain track's length from its own engine, which is what the end of the track needs
  if ( (status === "playing") && state.deck ) scheduleEnd(state.deck);
}

/* -------------------------------------------- */
/*  The shared deck                             */
/* -------------------------------------------- */

async function onDeckChange(raw) {
  if ( !raw?.track && !state.deck ) return;
  const L = await loadLogic();
  const deck = L.deck.normalizeDeck(raw);
  state.deck = deck;
  Hooks.callAll("dalSegno.deckChanged", deck);
  scheduleEnd(deck);
  refreshSidebar();
  const engine = await getEngine();
  if ( state.deck === deck ) await engine.apply(deck);
}

/** Who may press the deck's controls: anyone allowed to change world settings (GMs and, by default, assistants). */
function canControl() {
  return Boolean(game.user?.can("SETTINGS_MODIFY"));
}

/** The track's length, from the deck or, for a track without a saved arrangement, from this client's engine. */
function durationOf(deck) {
  const voice = state.engine?.voice;
  return deck.track?.duration ?? ((voice && (voice.src === deck.track?.src)) ? voice.duration : undefined);
}

/**
 * Change the deck and write it for everyone.
 * @param {(deck: object, logic: object, now: number) => object|null} change
 */
function update(change) {
  if ( !canControl() ) {
    ui.notifications.warn(game.i18n.localize("DALSEGNO.Notify.GMOnly"));
    return Promise.resolve(null);
  }
  // One write at a time: each change starts from the deck the previous one wrote, so two quick presses can't undo
  // each other while the first is still on its way to the server
  const run = state.writing.then(async () => {
    const L = await loadLogic();
    const deck = L.deck.normalizeDeck(state.written ?? setting("deck"));
    const next = change(deck, L, game.time.serverTime);
    if ( !next ) return deck;
    state.written = next;
    try {
      await game.settings.set(MODULE_ID, "deck", next);
    } finally {
      state.written = null;
    }
    return next;
  });
  state.writing = run.catch(() => null);
  return run;
}

/** Change the transport of the loaded track. */
function move(fn) {
  return update((deck, L, now) => {
    if ( !deck.track ) return null;
    const arr = L.deck.trackArrangement(deck.track);
    return { ...deck, transport: fn(deck.transport, arr, durationOf(deck), now, L.transport) };
  });
}

/** Find a PlaylistSound (and its playlist) from a document, a UUID or an id pair. */
async function resolveSound(ref) {
  if ( !ref ) return null;
  const doc = (typeof ref === "string") ? await foundry.utils.fromUuid(ref) : ref;
  if ( doc?.documentName === "PlaylistSound" ) return { sound: doc, playlist: doc.parent };
  if ( typeof doc?.path === "string" || typeof doc?.src === "string" ) {
    return { sound: { id: null, name: doc.name ?? "", path: doc.path ?? doc.src, repeat: Boolean(doc.repeat), getFlag: () => null }, playlist: null };
  }
  return null;
}

function trackFor(L, { sound, playlist }) {
  return L.deck.trackFromSound(sound, playlist, sound.getFlag?.(MODULE_ID, ARRANGEMENT_FLAG) ?? null);
}

/** Stop Foundry's own playlists on a channel, so the deck doesn't play over them. */
function stopCorePlaylists(channel) {
  if ( !setting("stopCore") ) return;
  for ( const playlist of game.playlists.playing ) {
    if ( (playlist.channel || "music") === channel ) playlist.stopAll();
  }
}

/* -------------------------------------------- */
/*  The end of a track                          */
/* -------------------------------------------- */

function isActiveGM() {
  return Boolean(game.users.activeGM?.isSelf);
}

/**
 * One timer, on the active GM's client only, for the moment the current track ends. A track whose arrangement loops
 * never ends by itself, so it sets none.
 */
async function scheduleEnd(deck) {
  clearTimeout(state.endTimer);
  state.endTimer = null;
  if ( !deck.track || (deck.transport.status !== "playing") || !isActiveGM() ) return;
  const L = await loadLogic();
  if ( state.deck !== deck ) return;
  const end = L.transport.endsAt(deck.transport, L.deck.trackArrangement(deck.track), durationOf(deck));
  if ( end === null ) return;
  // Load the next track a little before the end, so every client has it ready when the current one finishes
  const wait = end - START_LEAD_MS - 300 - game.time.serverTime;
  clearTimeout(state.endTimer);
  state.endTimer = setTimeout(() => onTrackEnding(deck, end), Math.max(0, wait));
}

async function onTrackEnding(deck, end) {
  if ( state.deck !== deck ) return;
  const next = deck.autoNext ? nextSound(deck) : null;
  if ( !next ) {
    // Let it finish, then park the deck at the top of the track
    state.endTimer = setTimeout(() => {
      if ( state.deck === deck ) api.stop();
    }, Math.max(0, end - game.time.serverTime) + 200);
    return;
  }
  await update((current, L, now) => {
    const track = trackFor(L, next);
    const arr = L.deck.trackArrangement(track);
    const parked = L.transport.stopped(arr, now, current.transport.rate);
    return { ...current, track, transport: { ...parked, status: "playing", at: Math.max(end, now + LEAD_MS) } };
  });
}

/** The sound after the deck's current one in its playlist's play order, unless the playlist is a soundboard. */
function nextSound(deck) {
  const playlist = game.playlists.get(deck.track.playlist);
  if ( !playlist || (playlist.mode === CONST.PLAYLIST_MODES.DISABLED) ) return null;
  const order = playlist.playbackOrder ?? [];
  const i = order.indexOf(deck.track.sound);
  const id = (i + 1 < order.length) ? order[i + 1] : (deck.loopQueue ? order[0] : null);
  const sound = id ? playlist.sounds.get(id) : null;
  return sound ? { sound, playlist } : null;
}

/* -------------------------------------------- */
/*  API                                         */
/* -------------------------------------------- */

const api = {
  /** The deck as every client plays it (null until something has been loaded). */
  get deck() {
    return state.deck;
  },

  /** The engine's last report on this client: {status: "idle"|"loading"|"ready"|"playing"|"error", detail}. */
  get status() {
    return state.status;
  },

  /** The track's length in seconds, when known. */
  get duration() {
    return state.deck ? durationOf(state.deck) : undefined;
  },

  /** Where playback is now: {section, pos, ended, waiting}, or null with nothing loaded. */
  async position() {
    const deck = state.deck;
    if ( !deck?.track ) return null;
    const L = await loadLogic();
    return L.transport.positionAt(deck.transport, L.deck.trackArrangement(deck.track), durationOf(deck), game.time.serverTime);
  },

  /**
   * Load a sound into the deck.
   * @param {PlaylistSound|string|{path: string, name?: string}} ref   A sound, its UUID, or a file path
   * @param {object} [options]
   * @param {boolean} [options.play=true]   Start it (otherwise every client loads it, ready to start at once)
   */
  async load(ref, { play = true } = {}) {
    const found = await resolveSound(ref);
    if ( !found ) return null;
    const result = await update((deck, L, now) => {
      const track = trackFor(L, found);
      if ( !track ) return null;
      const arr = L.deck.trackArrangement(track);
      const parked = L.transport.stopped(arr, now, deck.transport.rate);
      const transport = play ? L.transport.play(parked, arr, track.duration ?? undefined, now, START_LEAD_MS) : { ...parked, status: "paused" };
      return { ...deck, track, transport };
    });
    if ( play && result?.track ) stopCorePlaylists(result.track.channel);
    return result;
  },

  play() {
    if ( state.deck?.track ) stopCorePlaylists(state.deck.track.channel);
    return move((t, arr, d, now, T) => T.play(t, arr, d, now, LEAD_MS));
  },
  pause: () => move((t, arr, d, now, T) => T.pause(t, arr, d, now)),
  toggle: () => ((state.deck?.transport.status === "playing") ? api.pause() : api.play()),
  stop: () => move((t, arr, d, now, T) => T.stopped(arr, now, t.rate)),

  /** Jump to a file position (seconds). */
  seek: seconds => move((t, arr, d, now, T) => T.seek(t, arr, d, now, LEAD_MS, seconds)),

  /**
   * Go to a section: its index, or its label. By default at the end of the current pass through the current
   * section, so a loop finishes its phrase; `{now: true}` goes immediately.
   */
  goto: (target, { now = false } = {}) => move((t, arr, d, n, T) => {
    const index = (typeof target === "number") ? target
      : arr.sections.findIndex(s => s.label.toLowerCase() === String(target).toLowerCase());
    if ( index < 0 ) return t;
    return T.jumpTo(t, arr, d, n, LEAD_MS, index, now ? "now" : "boundary");
  }),

  /** Move on to the section after the current one. */
  next: ({ now = false } = {}) => move((t, arr, d, n, T) => {
    const here = T.positionAt(t, arr, d, n).section;
    if ( here + 1 >= arr.sections.length ) return t;
    return T.jumpTo(t, arr, d, n, LEAD_MS, here + 1, now ? "now" : "boundary");
  }),

  /** Go to the last section, the ending. */
  ending: ({ now = false } = {}) => move((t, arr, d, n, T) => T.jumpTo(t, arr, d, n, LEAD_MS, arr.sections.length - 1, now ? "now" : "boundary")),

  /** Call off a jump that hasn't happened yet. */
  cancel: () => move((t, arr, d, now, T) => T.cancelJump(t, arr, d, now)),

  /** Playback speed, 0.25 to 4. */
  setRate: rate => move((t, arr, d, now, T) => T.setRate(t, arr, d, now, LEAD_MS, rate)),

  /** Change effects: {pitch, keepPitch, bass, treble, muffle, reverb}; see the README for ranges. */
  setFx: patch => update((deck, L) => ({ ...deck, fx: L.deck.normalizeFx({ ...deck.fx, ...patch }) })),

  /** Back to normal speed, no pitch change and no effects, in one write. */
  resetSound: () => update((deck, L, now) => {
    const transport = deck.track ? L.transport.setRate(deck.transport, L.deck.trackArrangement(deck.track), durationOf(deck), now, LEAD_MS, 1)
      : { ...deck.transport, rate: 1 };
    return { ...deck, transport, fx: L.deck.normalizeFx({}) };
  }),

  /** Deck options: {volume, fade, autoNext, loopQueue}. */
  configure: patch => update(deck => ({ ...deck, ...patch })),

  /**
   * Save a sound's arrangement ({sections, seam, duration}, or null to remove it) and, if the deck is playing that
   * sound, carry on from the same place in the new one.
   */
  async saveArrangement(sound, data) {
    if ( !canControl() ) return null;
    if ( data ) await sound.setFlag(MODULE_ID, ARRANGEMENT_FLAG, data);
    else await sound.unsetFlag(MODULE_ID, ARRANGEMENT_FLAG);
    const deck = state.deck;
    if ( !deck?.track || (deck.track.sound !== sound.id) || (deck.track.playlist !== sound.parent?.id) ) return null;
    return update((current, L, now) => {
      const before = L.transport.positionAt(current.transport, L.deck.trackArrangement(current.track), durationOf(current), now);
      const track = trackFor(L, { sound, playlist: sound.parent });
      const arr = L.deck.trackArrangement(track);
      const transport = L.transport.seek({ ...current.transport, jump: null }, arr, track.duration ?? undefined, now, LEAD_MS, before.pos);
      return { ...current, track, transport };
    });
  },

  openDeck: () => import("./apps/deck-app.mjs").then(m => m.DeckApp.open(api)),
  openEditor: ref => resolveSound(ref).then(found => found?.sound?.documentName
    ? import("./apps/editor-app.mjs").then(m => m.EditorApp.open(found.sound, api)) : null),
  openShrink: () => import("./tools/shrink-app.mjs").then(m => m.ShrinkApp.open()),

  /** For the windows: the pure logic, this client's engine, and a separate one for previews. */
  loadLogic,
  getEngine,
  createEngine,
  canControl
};

/* -------------------------------------------- */
/*  Sidebar                                     */
/* -------------------------------------------- */

function onRenderPlaylists(app, element) {
  if ( !game.user.isGM && !setting("deck")?.track ) return;
  import("./apps/sidebar.mjs").then(m => m.decorate(element instanceof HTMLElement ? element : element?.[0], api));
}

function refreshSidebar() {
  const element = ui.playlists?.element;
  if ( !ui.playlists?.rendered || !element ) return;
  import("./apps/sidebar.mjs").then(m => m.decorate(element instanceof HTMLElement ? element : element[0], api));
}

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

const { ApplicationV2 } = foundry.applications.api;

/** Settings menus need a class at registration time; these stand-ins load the real window on demand. */
class DeckLauncher extends ApplicationV2 {
  render() {
    api.openDeck();
    return this;
  }
}

class ShrinkLauncher extends ApplicationV2 {
  render() {
    api.openShrink();
    return this;
  }
}

function registerSettings() {
  game.settings.register(MODULE_ID, "deck", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: value => onDeckChange(value)
  });
  game.settings.register(MODULE_ID, "stopCore", {
    name: "DALSEGNO.Settings.StopCore.Name",
    hint: "DALSEGNO.Settings.StopCore.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, "precise", {
    name: "DALSEGNO.Settings.Precise.Name",
    hint: "DALSEGNO.Settings.Precise.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => state.deck && state.engine?.apply(state.deck)
  });
  game.settings.register(MODULE_ID, "lite", {
    name: "DALSEGNO.Settings.Lite.Name",
    hint: "DALSEGNO.Settings.Lite.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => state.deck && state.engine?.apply(state.deck)
  });
  game.settings.registerMenu(MODULE_ID, "deckMenu", {
    name: "DALSEGNO.Settings.Deck.Name",
    label: "DALSEGNO.Settings.Deck.Label",
    hint: "DALSEGNO.Settings.Deck.Hint",
    icon: "fa-solid fa-compact-disc",
    type: DeckLauncher,
    restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "shrinkMenu", {
    name: "DALSEGNO.Settings.Shrink.Name",
    label: "DALSEGNO.Settings.Shrink.Label",
    hint: "DALSEGNO.Settings.Shrink.Hint",
    icon: "fa-solid fa-file-zipper",
    type: ShrinkLauncher,
    restricted: true
  });
}

/** Unbound by default, so they never clash with another module's keys; the GM picks keys under Configure Controls. */
function registerKeybindings() {
  const bind = (action, onDown) => game.keybindings.register(MODULE_ID, action, {
    name: `DALSEGNO.Keys.${action}`,
    editable: [],
    restricted: true,
    onDown: () => {
      onDown();
      return true;
    }
  });
  bind("toggle", () => api.toggle());
  bind("next", () => api.next());
  bind("ending", () => api.ending());
  bind("deck", () => api.openDeck());
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerSettings();
  registerKeybindings();
  game.modules.get(MODULE_ID).api = api;
});

Hooks.once("ready", () => {
  // A player joining mid-song starts at the same point as everyone else
  onDeckChange(setting("deck"));
});

Hooks.on("renderPlaylistDirectory", onRenderPlaylists);

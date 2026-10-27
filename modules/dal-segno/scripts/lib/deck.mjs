/**
 * The deck: what is loaded, where it is, and how it sounds. The GM's client writes it to one world setting whenever
 * someone presses a control, and every client plays from it. Pure functions only.
 */
import { isArranged, normalizeArrangement, wholeFile } from "./arrangement.mjs";
import { clampRate, stopped } from "./transport.mjs";

export const CHANNELS = ["music", "environment", "interface"];

export const NEUTRAL_FX = Object.freeze({ pitch: 0, keepPitch: true, bass: 0, treble: 0, muffle: 0, reverb: 0 });

/** Tracks up to this long may be decoded into memory for sample-accurate loops, like Foundry's own 10-minute limit. */
export const PRECISE_MAX_SECONDS = 600;

const num = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Clamp effect settings to their ranges. */
export function normalizeFx(raw = {}) {
  return {
    pitch: num(raw.pitch, 0, -12, 12),
    keepPitch: raw.keepPitch !== false,
    bass: num(raw.bass, 0, -12, 12),
    treble: num(raw.treble, 0, -12, 12),
    muffle: num(raw.muffle, 0, 0, 1),
    reverb: num(raw.reverb, 0, 0, 1)
  };
}

export function fxIsNeutral(fx) {
  return !fx.pitch && !fx.bass && !fx.treble && !fx.muffle && !fx.reverb;
}

/**
 * The pitch ratio the pitch shifter must apply. A decoded track changes pitch with its speed, so keeping pitch means
 * shifting back by the speed; a streamed track keeps pitch in the browser itself.
 * @param {object} fx
 * @param {number} rate
 * @param {"buffer"|"stream"} kind
 */
export function pitchRatio(fx, rate, kind) {
  const shift = 2 ** (fx.pitch / 12);
  return ((kind === "buffer") && fx.keepPitch) ? shift / rate : shift;
}

/** The arrangement a track plays: its saved sections, or the whole file. */
export function trackArrangement(track) {
  return track?.arrangement ?? wholeFile(track?.repeat);
}

/**
 * Decode into memory (sample-accurate loops) or stream from the server (starts at once, little memory)? Only tracks
 * whose arrangement jumps somewhere are worth decoding, and only when they are short enough.
 * @param {object} track
 * @param {object} options
 * @param {boolean} options.precise   This computer allows decoding (off on weak machines)
 * @returns {"buffer"|"stream"}
 */
export function chooseVoice(track, { precise = true, maxSeconds = PRECISE_MAX_SECONDS } = {}) {
  if ( !precise || !track ) return "stream";
  const arr = trackArrangement(track);
  const jumps = (arr.sections.length > 1) || arr.sections.some(s => s.loop);
  const known = Number.isFinite(track.duration) && (track.duration > 0);
  return (jumps && known && (track.duration <= maxSeconds)) ? "buffer" : "stream";
}

/**
 * A clean deck from stored data.
 * @returns {{track: object|null, transport: object, fx: object, volume: number, fade: number, autoNext: boolean,
 *   loopQueue: boolean}}
 */
export function normalizeDeck(raw) {
  const track = normalizeTrack(raw?.track);
  const arr = trackArrangement(track);
  let transport = raw?.transport;
  const valid = transport && ["playing", "paused", "stopped"].includes(transport.status)
    && Number.isFinite(transport.at) && Number.isFinite(transport.pos);
  if ( !track || !valid ) transport = stopped(arr, 0, transport?.rate);
  else {
    const section = Math.min(arr.sections.length - 1, Math.max(0, Math.trunc(transport.section) || 0));
    const jump = transport.jump && Number.isFinite(transport.jump.at) ? {
      at: transport.jump.at,
      section: Math.min(arr.sections.length - 1, Math.max(0, Math.trunc(transport.jump.section) || 0)),
      pos: Number(transport.jump.pos) || 0,
      timing: (transport.jump.timing === "now") ? "now" : "boundary"
    } : null;
    transport = { status: transport.status, at: transport.at, section, pos: transport.pos, rate: clampRate(transport.rate), jump };
  }
  return {
    track,
    transport,
    fx: normalizeFx(raw?.fx),
    volume: num(raw?.volume, 0.8, 0, 1),
    fade: num(raw?.fade, 1, 0, 10),
    autoNext: raw?.autoNext !== false,
    loopQueue: Boolean(raw?.loopQueue)
  };
}

function normalizeTrack(raw) {
  if ( !raw || (typeof raw.src !== "string") || !raw.src ) return null;
  const duration = Number(raw.duration);
  const known = Number.isFinite(duration) && (duration > 0);
  return {
    playlist: raw.playlist ? String(raw.playlist) : null,
    sound: raw.sound ? String(raw.sound) : null,
    src: raw.src,
    name: String(raw.name ?? ""),
    channel: CHANNELS.includes(raw.channel) ? raw.channel : "music",
    repeat: Boolean(raw.repeat),
    duration: known ? duration : null,
    arrangement: normalizeArrangement(raw.arrangement, known ? duration : undefined)
  };
}

/**
 * Describe a playlist sound as a deck track.
 * @param {{id: string, name: string, path: string, repeat: boolean, channel?: string, flags?: object}} sound
 * @param {{id: string, channel?: string}|null} playlist
 * @param {object|null} saved   The sound's saved arrangement flag ({sections, seam, duration})
 */
export function trackFromSound(sound, playlist, saved) {
  const duration = Number(saved?.duration);
  const arrangement = normalizeArrangement(saved, Number.isFinite(duration) ? duration : undefined);
  return normalizeTrack({
    playlist: playlist?.id ?? null,
    sound: sound.id,
    src: sound.path,
    name: sound.name,
    channel: sound.channel || playlist?.channel || "music",
    repeat: sound.repeat,
    duration: Number.isFinite(duration) ? duration : null,
    arrangement: isArranged(arrangement) || arrangement?.sections.some(s => s.loop) ? arrangement : null
  });
}

/**
 * The sound to play after the current one, from a playlist's play order.
 * @param {string[]} order        Sound ids in play order (Playlist#playbackOrder)
 * @param {string} current
 * @param {boolean} wrap          Start the playlist over after the last sound
 * @returns {string|null}
 */
export function nextInOrder(order, current, wrap = false) {
  if ( !order.length ) return null;
  const i = order.indexOf(current);
  if ( i < 0 ) return order[0];
  if ( i + 1 < order.length ) return order[i + 1];
  return wrap ? order[0] : null;
}

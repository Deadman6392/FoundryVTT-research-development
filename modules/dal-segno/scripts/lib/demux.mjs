/**
 * Pull the audio track out of a media file without decoding it: MP4/M4A/MOV (including fragmented files as saved
 * from DASH streams), WebM/Matroska, Ogg, MP3 and WAV. The file is read in slices, so an hour-long video never has to
 * fit in memory; only the audio packets are read, and the browser decodes them (see tools/transcode.mjs).
 *
 * Pure functions over a Blob (a File from the user's computer, or a downloaded file); no Foundry globals.
 */
import { opusPacketSamples, readPage } from "./ogg.mjs";

const WINDOW = 1 << 20;
const GROUP = 2 << 20;
const text = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

/** Random access to a Blob. */
class Source {
  constructor(blob) {
    this.blob = blob;
    this.size = blob.size;
  }

  async read(offset, length) {
    const end = Math.min(this.size, offset + length);
    if ( end <= offset ) return new Uint8Array(0);
    return new Uint8Array(await this.blob.slice(offset, end).arrayBuffer());
  }
}

/** Front-to-back reading through a window of the file. */
class Cursor {
  constructor(source, pos = 0) {
    this.source = source;
    this.pos = pos;
    this.buf = new Uint8Array(0);
    this.bufStart = 0;
  }

  /** Make sure `n` bytes from the current position are in the window. False at the end of the file. */
  async need(n) {
    const offset = this.pos - this.bufStart;
    if ( (offset >= 0) && (this.buf.length - offset >= n) ) return true;
    if ( this.pos >= this.source.size ) return false;
    this.buf = await this.source.read(this.pos, Math.max(n, WINDOW));
    this.bufStart = this.pos;
    return this.buf.length >= n;
  }

  /** `n` bytes at the current position; call need() first. */
  peek(n) {
    const at = this.pos - this.bufStart;
    return this.buf.subarray(at, at + n);
  }

  async take(n) {
    if ( !(await this.need(n)) ) return null;
    const bytes = this.peek(n).slice();
    this.pos += n;
    return bytes;
  }

  skip(n) {
    this.pos += n;
  }
}

/**
 * @typedef {object} AudioTrack
 * @property {string} format          "mp4", "webm", "ogg", "mp3" or "wav"
 * @property {string} codecName       What to call the codec in the interface ("AAC", "Opus", ...)
 * @property {object} config          An AudioDecoderConfig
 * @property {number} sampleRate
 * @property {number} channels
 * @property {number|null} duration   Seconds, when the file says
 * @property {number} [skip]          Seconds of encoder priming at the start that players leave out
 * @property {() => AsyncGenerator<{data: Uint8Array, timestamp: number}>} packets   Timestamps in microseconds
 */

/**
 * Find a file's audio track.
 * @param {Blob} blob
 * @returns {Promise<AudioTrack>}
 * @throws {Error} with `code` "unsupported" (with `format`) when the container or codec isn't handled here
 */
export async function openMedia(blob) {
  const source = new Source(blob);
  const head = await source.read(0, 16);
  if ( (head.length >= 8) && ["ftyp", "moov", "mdat", "free", "wide", "skip"].includes(text(head, 4, 4)) ) return openMp4(source);
  if ( (head[0] === 0x1a) && (head[1] === 0x45) && (head[2] === 0xdf) && (head[3] === 0xa3) ) return openMatroska(source);
  if ( text(head, 0, 4) === "OggS" ) return openOgg(source);
  if ( (text(head, 0, 4) === "RIFF") && (text(head, 8, 4) === "WAVE") ) return openWav(source);
  if ( text(head, 0, 4) === "fLaC" ) throw unsupported("FLAC");
  if ( (text(head, 0, 3) === "ID3") || ((head[0] === 0xff) && ((head[1] & 0xe0) === 0xe0)) ) return openMp3(source);
  throw unsupported("unknown");
}

function unsupported(format, detail = "") {
  const error = new Error(`unsupported ${format}${detail ? `: ${detail}` : ""}`);
  error.code = "unsupported";
  error.format = format;
  return error;
}

/* -------------------------------------------- */
/*  MP4 / M4A / MOV                             */
/* -------------------------------------------- */

function boxHeader(bytes, at, remaining) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, Math.min(16, bytes.length - at));
  let size = view.getUint32(0);
  const type = text(bytes, at + 4, 4);
  let header = 8;
  if ( size === 1 ) {
    size = Number(view.getBigUint64(8));
    header = 16;
  }
  else if ( size === 0 ) size = remaining;
  return { size, type, header };
}

function* boxes(bytes, start, end) {
  let at = start;
  while ( at + 8 <= end ) {
    const { size, type, header } = boxHeader(bytes, at, end - at);
    if ( size < header ) return;
    yield { type, start: at, body: at + header, end: Math.min(end, at + size) };
    at += size;
  }
}

function child(bytes, box, ...path) {
  let found = box;
  for ( const type of path ) {
    found = [...boxes(bytes, found.body, found.end)].find(b => b.type === type);
    if ( !found ) return null;
  }
  return found;
}

/** The variable-length size of an MPEG-4 descriptor. */
function descriptor(bytes, at) {
  const tag = bytes[at++];
  let length = 0;
  for ( let i = 0; i < 4; i++ ) {
    const b = bytes[at++];
    length = (length << 7) | (b & 0x7f);
    if ( !(b & 0x80) ) break;
  }
  return { tag, length, body: at };
}

/** The decoder config inside an esds box: {objectType, specific}. */
function readEsds(bytes, box) {
  let at = box.body + 4;
  const es = descriptor(bytes, at);
  if ( es.tag !== 0x03 ) return null;
  at = es.body + 2;
  const flags = bytes[at++];
  if ( flags & 0x80 ) at += 2;
  if ( flags & 0x40 ) at += 1 + bytes[at];
  if ( flags & 0x20 ) at += 2;
  const config = descriptor(bytes, at);
  if ( config.tag !== 0x04 ) return null;
  const objectType = bytes[config.body];
  const specific = descriptor(bytes, config.body + 13);
  return { objectType, specific: (specific.tag === 0x05) ? bytes.slice(specific.body, specific.body + specific.length) : null };
}

/** WebCodecs' codec string for AAC from its AudioSpecificConfig: mp4a.40.<audio object type>. */
export function aacCodec(asc) {
  if ( !asc?.length ) return "mp4a.40.2";
  let aot = asc[0] >> 3;
  if ( aot === 31 ) aot = 32 + (((asc[0] & 7) << 3) | (asc[1] >> 5));
  return `mp4a.40.${aot}`;
}

/** An Opus identification header (OpusHead, little-endian) from MP4's dOps box (big-endian). */
function opusHeadFromDops(bytes, box) {
  const d = new DataView(bytes.buffer, bytes.byteOffset + box.body, box.end - box.body);
  const channels = d.getUint8(1);
  const family = d.getUint8(10);
  const mapping = (family !== 0) ? bytes.subarray(box.body + 11, box.end) : new Uint8Array(0);
  const head = new Uint8Array(19 + mapping.length);
  const h = new DataView(head.buffer);
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0);
  head[8] = 1;
  head[9] = channels;
  h.setUint16(10, d.getUint16(2), true);
  h.setUint32(12, d.getUint32(4), true);
  h.setInt16(16, d.getInt16(8), true);
  head[18] = family;
  head.set(mapping, 19);
  return head;
}

/** Codec and decoder config from an stsd sample entry. */
function mp4Codec(bytes, stsd) {
  const entry = [...boxes(bytes, stsd.body + 8, stsd.end)][0];
  if ( !entry ) throw unsupported("MP4", "no sample description");
  const d = new DataView(bytes.buffer, bytes.byteOffset + entry.body, entry.end - entry.body);
  const version = d.getUint16(8);
  let channels = d.getUint16(16);
  let sampleRate = d.getUint32(24) >>> 16;
  let childrenAt = entry.body + 28;
  if ( version === 1 ) childrenAt += 16;
  else if ( version === 2 ) {
    sampleRate = Math.round(d.getFloat64(32));
    channels = d.getUint32(40);
    childrenAt += 36;
  }
  const inner = { body: childrenAt, end: entry.end };
  switch ( entry.type ) {
    case "mp4a": {
      const esds = child(bytes, inner, "esds") ?? child(bytes, inner, "wave", "esds");
      const info = esds ? readEsds(bytes, esds) : null;
      if ( info && [0x69, 0x6b].includes(info.objectType) ) return { codecName: "MP3", config: { codec: "mp3", sampleRate, numberOfChannels: channels } };
      if ( !info?.specific ) throw unsupported("MP4", "AAC without a decoder config");
      return { codecName: "AAC", config: { codec: aacCodec(info.specific), sampleRate, numberOfChannels: channels, description: info.specific } };
    }
    case "Opus": {
      const dops = child(bytes, inner, "dOps");
      return { codecName: "Opus", config: { codec: "opus", sampleRate: 48000, numberOfChannels: channels, ...(dops ? { description: opusHeadFromDops(bytes, dops) } : {}) } };
    }
    case ".mp3": return { codecName: "MP3", config: { codec: "mp3", sampleRate, numberOfChannels: channels } };
    default: throw unsupported("MP4", entry.type);
  }
}

/** Offsets, sizes and decode times of every sample in a (non-fragmented) track's sample table. */
function sampleTable(bytes, stbl) {
  const view = box => new DataView(bytes.buffer, bytes.byteOffset + box.body, box.end - box.body);
  const stsz = child(bytes, stbl, "stsz");
  const stz2 = child(bytes, stbl, "stz2");
  const stco = child(bytes, stbl, "stco") ?? child(bytes, stbl, "co64");
  const stsc = child(bytes, stbl, "stsc");
  const stts = child(bytes, stbl, "stts");
  let count = 0;
  let sizeAt;
  if ( stsz ) {
    const v = view(stsz);
    const fixed = v.getUint32(4);
    count = v.getUint32(8);
    sizeAt = i => (fixed || v.getUint32(12 + (i * 4)));
  }
  else if ( stz2 ) {
    const v = view(stz2);
    const field = v.getUint8(7);
    count = v.getUint32(8);
    sizeAt = i => ((field === 16) ? v.getUint16(12 + (i * 2)) : (field === 8) ? v.getUint8(12 + i)
      : ((v.getUint8(12 + (i >> 1)) >> ((i & 1) ? 0 : 4)) & 0xf));
  }
  if ( !count || !stco || !stsc ) return null;
  const sizes = new Uint32Array(count);
  for ( let i = 0; i < count; i++ ) sizes[i] = sizeAt(i);
  const co = view(stco);
  const chunks = co.getUint32(4);
  const chunkOffset = (stco.type === "co64") ? i => Number(co.getBigUint64(8 + (i * 8))) : i => co.getUint32(8 + (i * 4));
  const sc = view(stsc);
  const runs = Array.from({ length: sc.getUint32(4) }, (_, i) => ({ first: sc.getUint32(8 + (i * 12)) - 1, per: sc.getUint32(12 + (i * 12)) }));
  const offsets = new Float64Array(count);
  let sample = 0;
  for ( let c = 0, r = 0; (c < chunks) && (sample < count); c++ ) {
    while ( (r + 1 < runs.length) && (runs[r + 1].first <= c) ) r++;
    let offset = chunkOffset(c);
    for ( let k = 0; (k < runs[r].per) && (sample < count); k++ ) {
      offsets[sample] = offset;
      offset += sizes[sample++];
    }
  }
  const times = new Float64Array(count);
  if ( stts ) {
    const v = view(stts);
    let t = 0;
    let i = 0;
    for ( let e = 0; e < v.getUint32(4); e++ ) {
      const n = v.getUint32(8 + (e * 8));
      const delta = v.getUint32(12 + (e * 8));
      for ( let k = 0; (k < n) && (i < count); k++ ) {
        times[i++] = t;
        t += delta;
      }
    }
  }
  return { count: sample, offsets, sizes, times };
}

/** Samples of one track in a movie fragment (moof). */
function fragmentSamples(bytes, moofStart, trackId, defaults) {
  const moof = { body: 8, end: bytes.length };
  const samples = [];
  for ( const traf of boxes(bytes, moof.body, moof.end) ) {
    if ( traf.type !== "traf" ) continue;
    const tfhd = child(bytes, traf, "tfhd");
    if ( !tfhd ) continue;
    const h = new DataView(bytes.buffer, bytes.byteOffset + tfhd.body, tfhd.end - tfhd.body);
    const flags = h.getUint32(0) & 0xffffff;
    if ( h.getUint32(4) !== trackId ) continue;
    let at = 8;
    let base = moofStart;
    if ( flags & 0x1 ) {
      base = Number(h.getBigUint64(at));
      at += 8;
    }
    if ( flags & 0x2 ) at += 4;
    let duration = defaults.duration;
    let size = defaults.size;
    if ( flags & 0x8 ) {
      duration = h.getUint32(at);
      at += 4;
    }
    if ( flags & 0x10 ) size = h.getUint32(at);
    const tfdt = child(bytes, traf, "tfdt");
    let time = 0;
    if ( tfdt ) {
      const t = new DataView(bytes.buffer, bytes.byteOffset + tfdt.body, tfdt.end - tfdt.body);
      time = (t.getUint8(0) === 1) ? Number(t.getBigUint64(4)) : t.getUint32(4);
    }
    for ( const trun of boxes(bytes, traf.body, traf.end) ) {
      if ( trun.type !== "trun" ) continue;
      const r = new DataView(bytes.buffer, bytes.byteOffset + trun.body, trun.end - trun.body);
      const rflags = r.getUint32(0) & 0xffffff;
      const count = r.getUint32(4);
      let p = 8;
      let offset = base;
      if ( rflags & 0x1 ) {
        offset = base + r.getInt32(p);
        p += 4;
      }
      if ( rflags & 0x4 ) p += 4;
      for ( let i = 0; i < count; i++ ) {
        let d = duration;
        let s = size;
        if ( rflags & 0x100 ) {
          d = r.getUint32(p);
          p += 4;
        }
        if ( rflags & 0x200 ) {
          s = r.getUint32(p);
          p += 4;
        }
        if ( rflags & 0x400 ) p += 4;
        if ( rflags & 0x800 ) p += 4;
        samples.push({ offset, size: s, time, duration: d });
        offset += s;
        time += d;
      }
    }
  }
  return samples;
}

/** Read samples, merging neighbours into one read of up to 2 MB. */
async function* readSamples(source, samples, timescale) {
  for ( let i = 0; i < samples.length; ) {
    let j = i + 1;
    let end = samples[i].offset + samples[i].size;
    while ( (j < samples.length) && (samples[j].offset === end) && (end - samples[i].offset < GROUP) ) end += samples[j++].size;
    const block = await source.read(samples[i].offset, end - samples[i].offset);
    for ( let k = i; k < j; k++ ) {
      const at = samples[k].offset - samples[i].offset;
      yield { data: block.subarray(at, at + samples[k].size), timestamp: Math.round((samples[k].time / timescale) * 1e6) };
    }
    i = j;
  }
}

async function openMp4(source) {
  // Find the movie box; it can come after the media data
  let pos = 0;
  let moov = null;
  while ( pos + 8 <= source.size ) {
    const head = await source.read(pos, 16);
    const { size, type, header } = boxHeader(head, 0, source.size - pos);
    if ( size < header ) break;
    if ( type === "moov" ) {
      moov = { start: pos, size };
      break;
    }
    pos += size;
  }
  if ( !moov ) throw unsupported("MP4", "no movie box");
  const bytes = await source.read(moov.start, moov.size);
  const root = { body: 8, end: bytes.length };
  let found = null;
  for ( const trak of boxes(bytes, root.body, root.end) ) {
    if ( trak.type !== "trak" ) continue;
    const hdlr = child(bytes, trak, "mdia", "hdlr");
    if ( !hdlr || (text(bytes, hdlr.body + 8, 4) !== "soun") ) continue;
    found = trak;
    break;
  }
  if ( !found ) throw unsupported("MP4", "no audio track");
  const tkhd = child(bytes, found, "tkhd");
  const tk = new DataView(bytes.buffer, bytes.byteOffset + tkhd.body, tkhd.end - tkhd.body);
  const trackId = tk.getUint32((tk.getUint8(0) === 1) ? 20 : 12);
  const mdhd = child(bytes, found, "mdia", "mdhd");
  const md = new DataView(bytes.buffer, bytes.byteOffset + mdhd.body, mdhd.end - mdhd.body);
  const v1 = md.getUint8(0) === 1;
  const timescale = md.getUint32(v1 ? 20 : 12);
  const mediaDuration = v1 ? Number(md.getBigUint64(24)) : md.getUint32(16);
  const stbl = child(bytes, found, "mdia", "minf", "stbl");
  const { codecName, config } = mp4Codec(bytes, child(bytes, stbl, "stsd"));
  // An edit list starting later than zero marks the encoder's priming samples (1024 for AAC) for players to skip.
  // Opus carries its own pre-skip, which the browser's decoder already applies.
  const elst = (config.codec === "opus") ? null : child(bytes, found, "edts", "elst");
  let skip = 0;
  if ( elst ) {
    const e = new DataView(bytes.buffer, bytes.byteOffset + elst.body, elst.end - elst.body);
    const mediaTime = (e.getUint8(0) === 1) ? Number(e.getBigInt64(16)) : e.getInt32(12);
    if ( mediaTime > 0 ) skip = mediaTime / timescale;
  }
  const table = sampleTable(bytes, stbl);
  const trex = [...boxes(bytes, (child(bytes, root, "mvex")?.body ?? 0), (child(bytes, root, "mvex")?.end ?? 0))]
    .find(b => (b.type === "trex") && (new DataView(bytes.buffer, bytes.byteOffset + b.body + 4, 4).getUint32(0) === trackId));
  const defaults = trex ? (() => {
    const t = new DataView(bytes.buffer, bytes.byteOffset + trex.body, trex.end - trex.body);
    return { duration: t.getUint32(12), size: t.getUint32(16) };
  })() : { duration: 0, size: 0 };
  const fragmented = !table && Boolean(trex);
  if ( !table && !fragmented ) throw unsupported("MP4", "empty sample table");
  const afterMoov = moov.start + moov.size;
  let duration = (mediaDuration && timescale) ? mediaDuration / timescale : null;
  if ( fragmented && !duration ) duration = await fragmentedDuration(source, afterMoov, trackId, defaults, timescale);

  async function* packets() {
    if ( table ) {
      const list = Array.from({ length: table.count }, (_, i) => ({ offset: table.offsets[i], size: table.sizes[i], time: table.times[i] }));
      yield* readSamples(source, list, timescale);
      return;
    }
    // Fragmented: a moof box describes the samples in the mdat that follows it
    let at = afterMoov;
    while ( at + 8 <= source.size ) {
      const head = await source.read(at, 16);
      const { size, type, header } = boxHeader(head, 0, source.size - at);
      if ( size < header ) return;
      if ( type === "moof" ) {
        const moof = await source.read(at, size);
        yield* readSamples(source, fragmentSamples(moof, at, trackId, defaults), timescale);
      }
      at += size;
    }
  }

  return { format: "mp4", codecName, config, sampleRate: config.sampleRate, channels: config.numberOfChannels, duration, skip, packets };
}

/** A fragmented file's length, from the sample durations in its fragment headers (a small read per fragment). */
async function fragmentedDuration(source, at, trackId, defaults, timescale) {
  let end = 0;
  while ( at + 8 <= source.size ) {
    const head = await source.read(at, 16);
    const { size, type, header } = boxHeader(head, 0, source.size - at);
    if ( size < header ) break;
    if ( type === "moof" ) {
      const samples = fragmentSamples(await source.read(at, size), at, trackId, defaults);
      const last = samples.at(-1);
      if ( last ) end = Math.max(end, last.time + (last.duration ?? 0));
    }
    at += size;
  }
  return end ? end / timescale : null;
}

/* -------------------------------------------- */
/*  WebM / Matroska                             */
/* -------------------------------------------- */

const EBML = {
  segment: 0x18538067, cluster: 0x1f43b675, info: 0x1549a966, tracks: 0x1654ae6b, trackEntry: 0xae,
  trackNumber: 0xd7, trackType: 0x83, codecId: 0x86, codecPrivate: 0x63a2, audio: 0xe1, samplingFrequency: 0xb5,
  channels: 0x9f, bitDepth: 0x6264, timecodeScale: 0x2ad7b1, duration: 0x4489, timecode: 0xe7, simpleBlock: 0xa3,
  blockGroup: 0xa0, block: 0xa1
};

/** An EBML variable-length integer at `at`. IDs keep their length marker; sizes don't. */
function vint(bytes, at, keepMarker = false) {
  const first = bytes[at];
  const length = vintLength(first);
  const mask = 0x100 >> length;
  let value = keepMarker ? first : (first & (mask - 1));
  let unknown = !keepMarker && (value === mask - 1);
  for ( let i = 1; i < length; i++ ) {
    value = (value * 256) + bytes[at + i];
    if ( bytes[at + i] !== 0xff ) unknown = false;
  }
  return { value, length, unknown };
}

function* elements(bytes, start, end) {
  let at = start;
  while ( at < end ) {
    const id = vint(bytes, at, true);
    const size = vint(bytes, at + id.length);
    const body = at + id.length + size.length;
    const stop = size.unknown ? end : Math.min(end, body + size.value);
    yield { id: id.value, body, end: stop };
    at = stop;
  }
}

const uint = (bytes, el) => {
  let v = 0;
  for ( let i = el.body; i < el.end; i++ ) v = (v * 256) + bytes[i];
  return v;
};

const float = (bytes, el) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset + el.body, el.end - el.body);
  return (el.end - el.body === 4) ? view.getFloat32(0) : view.getFloat64(0);
};

/** Bytes in an EBML number, from its first byte. */
function vintLength(first) {
  let length = 1;
  let mask = 0x80;
  while ( (length <= 8) && !(first & mask) ) {
    length++;
    mask >>= 1;
  }
  if ( length > 8 ) throw new Error("bad EBML number");
  return length;
}

/** Read an element header from a cursor: {id, size (null if unknown)}. */
async function elementHeader(cursor) {
  if ( !(await cursor.need(1)) ) return null;
  const idLength = vintLength(cursor.peek(1)[0]);
  if ( !(await cursor.need(idLength + 1)) ) return null;
  const sizeLength = vintLength(cursor.peek(idLength + 1)[idLength]);
  if ( !(await cursor.need(idLength + sizeLength)) ) return null;
  const bytes = cursor.peek(idLength + sizeLength);
  const id = vint(bytes, 0, true);
  const size = vint(bytes, idLength);
  cursor.skip(idLength + sizeLength);
  return { id: id.value, size: size.unknown ? null : size.value };
}

function matroskaCodec(track) {
  const id = track.codecId;
  const description = track.codecPrivate?.length ? track.codecPrivate : undefined;
  const base = { sampleRate: Math.round(track.rate), numberOfChannels: track.channels };
  if ( id === "A_OPUS" ) return { codecName: "Opus", config: { codec: "opus", ...base, sampleRate: 48000, description } };
  if ( id === "A_VORBIS" ) return { codecName: "Vorbis", config: { codec: "vorbis", ...base, description } };
  if ( id.startsWith("A_AAC") ) return { codecName: "AAC", config: { codec: aacCodec(description), ...base, description } };
  if ( id === "A_MPEG/L3" ) return { codecName: "MP3", config: { codec: "mp3", ...base } };
  if ( id === "A_FLAC" ) return { codecName: "FLAC", config: { codec: "flac", ...base, description } };
  if ( id === "A_PCM/INT/LIT" ) return { codecName: "PCM", config: { codec: `pcm-s${track.bitDepth || 16}`, ...base } };
  if ( id === "A_PCM/FLOAT/IEEE" ) return { codecName: "PCM", config: { codec: "pcm-f32", ...base } };
  throw unsupported("Matroska", id);
}

/** Split a Matroska block into its frames. */
function blockFrames(block, at) {
  const flags = block[at];
  const lacing = (flags >> 1) & 3;
  let p = at + 1;
  if ( !lacing ) return [block.subarray(p)];
  const count = block[p++] + 1;
  const sizes = [];
  if ( lacing === 1 ) {
    for ( let i = 0; i < count - 1; i++ ) {
      let size = 0;
      let b;
      do {
        b = block[p++];
        size += b;
      } while ( b === 255 );
      sizes.push(size);
    }
  }
  else if ( lacing === 3 ) {
    let n = vint(block, p);
    p += n.length;
    sizes.push(n.value);
    for ( let i = 1; i < count - 1; i++ ) {
      n = vint(block, p);
      p += n.length;
      const bias = (2 ** ((7 * n.length) - 1)) - 1;
      sizes.push(sizes[i - 1] + (n.value - bias));
    }
  }
  else {
    const each = (block.length - p) / count;
    for ( let i = 0; i < count - 1; i++ ) sizes.push(each);
  }
  const frames = [];
  for ( const size of sizes ) {
    frames.push(block.subarray(p, p + size));
    p += size;
  }
  frames.push(block.subarray(p));
  return frames;
}

async function openMatroska(source) {
  const cursor = new Cursor(source);
  const ebml = await elementHeader(cursor);
  cursor.skip(ebml.size ?? 0);
  const segment = await elementHeader(cursor);
  if ( segment?.id !== EBML.segment ) throw unsupported("Matroska", "no segment");
  let scale = 1e6;
  let duration = null;
  let track = null;
  let clusterAt = null;
  while ( clusterAt === null ) {
    const start = cursor.pos;
    const h = await elementHeader(cursor);
    if ( !h ) break;
    if ( h.id === EBML.cluster ) {
      clusterAt = start;
      break;
    }
    if ( h.size === null ) break;
    if ( (h.id === EBML.info) || (h.id === EBML.tracks) ) {
      const bytes = await cursor.take(h.size);
      for ( const el of elements(bytes, 0, bytes.length) ) {
        if ( el.id === EBML.timecodeScale ) scale = uint(bytes, el);
        else if ( el.id === EBML.duration ) duration = float(bytes, el);
        else if ( (el.id === EBML.trackEntry) && !track ) track = readTrackEntry(bytes, el);
      }
    }
    else cursor.skip(h.size);
  }
  if ( !track ) throw unsupported("Matroska", "no audio track");
  const { codecName, config } = matroskaCodec(track);

  async function* packets() {
    const c = new Cursor(source, clusterAt);
    let clusterTime = 0;
    for ( ;; ) {
      const h = await elementHeader(c);
      if ( !h ) return;
      if ( h.id === EBML.cluster ) continue;
      if ( h.size === null ) return;
      if ( h.id === EBML.timecode ) {
        const bytes = await c.take(h.size);
        clusterTime = uint(bytes, { body: 0, end: bytes.length });
      }
      else if ( (h.id === EBML.simpleBlock) || (h.id === EBML.blockGroup) ) {
        const bytes = await c.take(h.size);
        if ( !bytes ) return;
        let block = bytes;
        if ( h.id === EBML.blockGroup ) {
          const inner = [...elements(bytes, 0, bytes.length)].find(e => e.id === EBML.block);
          if ( !inner ) continue;
          block = bytes.subarray(inner.body, inner.end);
        }
        const number = vint(block, 0);
        if ( number.value !== track.number ) continue;
        const relative = new DataView(block.buffer, block.byteOffset + number.length, 2).getInt16(0);
        const base = Math.round(((clusterTime + relative) * scale) / 1000);
        const frames = blockFrames(block, number.length + 2);
        for ( const [i, data] of frames.entries() ) yield { data, timestamp: base + i };
      }
      else c.skip(h.size);
    }
  }

  return {
    format: "webm",
    codecName,
    config,
    sampleRate: config.sampleRate,
    channels: config.numberOfChannels,
    duration: duration ? (duration * scale) / 1e9 : null,
    packets
  };
}

function readTrackEntry(bytes, entry) {
  const track = { number: 0, type: 0, codecId: "", codecPrivate: null, rate: 8000, channels: 1, bitDepth: 0 };
  for ( const el of elements(bytes, entry.body, entry.end) ) {
    if ( el.id === EBML.trackNumber ) track.number = uint(bytes, el);
    else if ( el.id === EBML.trackType ) track.type = uint(bytes, el);
    else if ( el.id === EBML.codecId ) track.codecId = text(bytes, el.body, el.end - el.body).replace(/\0+$/, "");
    else if ( el.id === EBML.codecPrivate ) track.codecPrivate = bytes.slice(el.body, el.end);
    else if ( el.id === EBML.audio ) {
      for ( const a of elements(bytes, el.body, el.end) ) {
        if ( a.id === EBML.samplingFrequency ) track.rate = float(bytes, a);
        else if ( a.id === EBML.channels ) track.channels = uint(bytes, a);
        else if ( a.id === EBML.bitDepth ) track.bitDepth = uint(bytes, a);
      }
    }
  }
  return (track.type === 2) ? track : null;
}

/* -------------------------------------------- */
/*  Ogg                                         */
/* -------------------------------------------- */

/** Pages of the first logical stream, reassembled into packets with the granule of the page each one ends on. */
async function* oggPackets(source, start = 0) {
  const cursor = new Cursor(source, start);
  let serial = null;
  let partial = [];
  for ( ;; ) {
    if ( !(await cursor.need(27)) ) return;
    const count = cursor.peek(27)[26];
    if ( !(await cursor.need(27 + count)) ) return;
    const body = cursor.peek(27 + count).subarray(27).reduce((n, s) => n + s, 0);
    if ( !(await cursor.need(27 + count + body)) ) return;
    const read = readPage(cursor.peek(27 + count + body), 0);
    cursor.skip(read.next);
    const { page } = read;
    serial ??= page.serial;
    if ( page.serial !== serial ) continue;
    let at = 0;
    for ( const segment of page.segments ) {
      partial.push(page.body.subarray(at, at + segment));
      at += segment;
      if ( segment < 255 ) {
        const length = partial.reduce((n, p) => n + p.length, 0);
        const packet = new Uint8Array(length);
        let p = 0;
        for ( const piece of partial ) {
          packet.set(piece, p);
          p += piece.length;
        }
        partial = [];
        yield { packet, granule: page.granule, position: cursor.pos };
      }
    }
  }
}

/** Xiph lacing of codec headers, the form WebCodecs (and Matroska) use for Vorbis's description. */
function xiphLace(headers) {
  const sizes = [];
  for ( const h of headers.slice(0, -1) ) {
    let n = h.length;
    while ( n >= 255 ) {
      sizes.push(255);
      n -= 255;
    }
    sizes.push(n);
  }
  const out = new Uint8Array(1 + sizes.length + headers.reduce((n, h) => n + h.length, 0));
  out[0] = headers.length - 1;
  out.set(sizes, 1);
  let at = 1 + sizes.length;
  for ( const h of headers ) {
    out.set(h, at);
    at += h.length;
  }
  return out;
}

async function openOgg(source) {
  const reader = oggPackets(source);
  const first = (await reader.next()).value;
  if ( !first ) throw unsupported("Ogg", "empty");
  const id = first.packet;
  let codecName;
  let config;
  let preSkip = 0;
  let skipPackets;
  if ( text(id, 0, 8) === "OpusHead" ) {
    const view = new DataView(id.buffer, id.byteOffset, id.length);
    preSkip = view.getUint16(10, true);
    codecName = "Opus";
    config = { codec: "opus", sampleRate: 48000, numberOfChannels: id[9], description: id };
    skipPackets = 2;
  }
  else if ( (id[0] === 1) && (text(id, 1, 6) === "vorbis") ) {
    const view = new DataView(id.buffer, id.byteOffset, id.length);
    const comment = (await reader.next()).value?.packet;
    const setup = (await reader.next()).value?.packet;
    if ( !comment || !setup ) throw unsupported("Ogg", "incomplete Vorbis headers");
    codecName = "Vorbis";
    config = { codec: "vorbis", sampleRate: view.getUint32(12, true), numberOfChannels: id[11], description: xiphLace([id, comment, setup]) };
    skipPackets = 3;
  }
  else throw unsupported("Ogg", "only Opus and Vorbis are read");
  await reader.return();

  // The last page's granule position gives the length
  const tail = await source.read(Math.max(0, source.size - 65536), 65536);
  let duration = null;
  for ( let i = tail.length - 27; i >= 0; i-- ) {
    if ( (tail[i] === 0x4f) && (tail[i + 1] === 0x67) && (tail[i + 2] === 0x67) && (tail[i + 3] === 0x53) ) {
      const granule = Number(new DataView(tail.buffer, tail.byteOffset + i + 6, 8).getBigInt64(0, true));
      if ( granule > 0 ) duration = (codecName === "Opus") ? (granule - preSkip) / 48000 : granule / config.sampleRate;
      break;
    }
  }

  async function* packets() {
    let index = 0;
    let time = 0;
    let lastGranule = -1n;
    let withinPage = 0;
    for await ( const { packet, granule } of oggPackets(source) ) {
      if ( index++ < skipPackets ) continue;
      if ( codecName === "Opus" ) {
        yield { data: packet, timestamp: Math.round((time / 48000) * 1e6) };
        time += opusPacketSamples(packet);
      }
      else {
        // Vorbis packet lengths depend on the setup header's modes; the decoder works them out, so these timestamps
        // only need to rise
        if ( granule !== lastGranule ) {
          withinPage = 0;
          lastGranule = granule;
        }
        const base = (granule > 0n) ? Number(granule) / config.sampleRate : 0;
        yield { data: packet, timestamp: Math.round(base * 1e6) + withinPage++ };
      }
    }
  }

  return { format: "ogg", codecName, config, sampleRate: config.sampleRate, channels: config.numberOfChannels, duration, packets };
}

/* -------------------------------------------- */
/*  MP3                                         */
/* -------------------------------------------- */

const MP3_BITRATES = {
  "3-3": [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "3-2": [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "3-1": [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-3": [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-1": [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
};
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * Parse an MPEG audio frame header.
 * @returns {{length: number, samples: number, rate: number, channels: number, bitrate: number}|null}
 */
export function mp3Frame(b) {
  if ( (b[0] !== 0xff) || ((b[1] & 0xe0) !== 0xe0) ) return null;
  const version = (b[1] >> 3) & 3;
  const layer = (b[1] >> 1) & 3;
  const bitrateIndex = b[2] >> 4;
  const rateIndex = (b[2] >> 2) & 3;
  if ( (version === 1) || !layer || !bitrateIndex || (bitrateIndex === 15) || (rateIndex === 3) ) return null;
  const rate = MP3_RATES[version][rateIndex];
  const bitrate = MP3_BITRATES[`${(version === 3) ? 3 : 2}-${layer}`][bitrateIndex - 1] * 1000;
  const padding = (b[2] >> 1) & 1;
  const channels = ((b[3] >> 6) === 3) ? 1 : 2;
  let length;
  let samples;
  if ( layer === 3 ) {
    length = (Math.floor((12 * bitrate) / rate) + padding) * 4;
    samples = 384;
  }
  else if ( (layer === 1) && (version !== 3) ) {
    length = Math.floor((72 * bitrate) / rate) + padding;
    samples = 576;
  }
  else {
    length = Math.floor((144 * bitrate) / rate) + padding;
    samples = 1152;
  }
  return { length, samples, rate, channels, bitrate };
}

async function openMp3(source) {
  const cursor = new Cursor(source);
  await cursor.need(10);
  const tag = cursor.peek(10);
  if ( text(tag, 0, 3) === "ID3" ) {
    const size = ((tag[6] & 0x7f) << 21) | ((tag[7] & 0x7f) << 14) | ((tag[8] & 0x7f) << 7) | (tag[9] & 0x7f);
    cursor.skip(10 + size + ((tag[5] & 0x10) ? 10 : 0));
  }
  const start = await syncMp3(cursor);
  if ( start === null ) throw unsupported("MP3", "no frames");
  await cursor.need(4);
  const first = mp3Frame(cursor.peek(4));
  // A Xing/Info or VBRI frame holds no audio: it gives the frame count (so the length of a variable-rate file) and,
  // in LAME's tag, the encoder's delay, which gapless players skip along with the decoder's own 529 samples
  await cursor.need(first.length);
  const frame = cursor.peek(first.length);
  const chars = text(frame, 0, frame.length);
  let frames = null;
  let headerFrame = false;
  let delay = 0;
  const xing = Math.max(chars.indexOf("Xing"), chars.indexOf("Info"));
  if ( xing > 0 ) {
    headerFrame = true;
    const flags = frame[xing + 7];
    if ( flags & 1 ) frames = new DataView(frame.buffer, frame.byteOffset + xing + 8, 4).getUint32(0);
    const lame = xing + 8 + ((flags & 1) ? 4 : 0) + ((flags & 2) ? 4 : 0) + ((flags & 4) ? 100 : 0) + ((flags & 8) ? 4 : 0);
    if ( /^(LAME|Lavf|Lavc)/.test(text(frame, lame, 4)) && (lame + 24 <= frame.length) ) {
      delay = ((frame[lame + 21] << 4) | (frame[lame + 22] >> 4)) + 529;
    }
  }
  const vbri = chars.indexOf("VBRI");
  if ( vbri > 0 ) {
    headerFrame = true;
    frames = new DataView(frame.buffer, frame.byteOffset + vbri + 14, 4).getUint32(0);
  }
  const duration = frames ? (frames * first.samples) / first.rate : ((source.size - start) * 8) / first.bitrate;
  const audioStart = headerFrame ? start + first.length : start;

  async function* packets() {
    const c = new Cursor(source, audioStart);
    let time = 0;
    for ( ;; ) {
      if ( !(await c.need(4)) ) return;
      const header = mp3Frame(c.peek(4));
      if ( !header ) {
        if ( (await syncMp3(c)) === null ) return;
        continue;
      }
      const data = await c.take(header.length);
      if ( !data ) return;
      yield { data, timestamp: Math.round((time / header.rate) * 1e6) };
      time += header.samples;
    }
  }

  return {
    format: "mp3",
    codecName: "MP3",
    config: { codec: "mp3", sampleRate: first.rate, numberOfChannels: first.channels },
    sampleRate: first.rate,
    channels: first.channels,
    duration,
    skip: delay / first.rate,
    packets
  };
}

/** Move a cursor to the next position that holds two frame headers in a row. Null if there is none. */
async function syncMp3(cursor) {
  for ( let tries = 0; tries < (1 << 20); tries++ ) {
    if ( !(await cursor.need(4)) ) return null;
    const header = mp3Frame(cursor.peek(4));
    if ( header ) {
      const ok = (await cursor.need(header.length + 4)) ? mp3Frame(cursor.peek(header.length + 4).subarray(header.length)) : true;
      if ( ok ) return cursor.pos;
    }
    cursor.skip(1);
  }
  return null;
}

/* -------------------------------------------- */
/*  WAV                                         */
/* -------------------------------------------- */

async function openWav(source) {
  let at = 12;
  let fmt = null;
  let data = null;
  while ( at + 8 <= source.size && !data ) {
    const head = await source.read(at, 8);
    const id = text(head, 0, 4);
    const size = new DataView(head.buffer).getUint32(4, true);
    if ( id === "fmt " ) {
      const body = await source.read(at + 8, Math.min(size, 40));
      const v = new DataView(body.buffer);
      let format = v.getUint16(0, true);
      if ( (format === 0xfffe) && (size >= 40) ) format = v.getUint16(24, true);
      fmt = { format, channels: v.getUint16(2, true), rate: v.getUint32(4, true), bits: v.getUint16(14, true) };
    }
    else if ( id === "data" ) data = { start: at + 8, size: Math.min(size, source.size - at - 8) };
    at += 8 + size + (size & 1);
  }
  if ( !fmt || !data ) throw unsupported("WAV", "missing fmt or data");
  const codec = (fmt.format === 3) ? "pcm-f32" : (fmt.bits === 8) ? "pcm-u8" : `pcm-s${fmt.bits}`;
  if ( ![1, 3].includes(fmt.format) ) throw unsupported("WAV", `format ${fmt.format}`);
  const frameBytes = (fmt.bits / 8) * fmt.channels;
  const block = frameBytes * 8192;

  async function* packets() {
    for ( let offset = 0; offset < data.size; offset += block ) {
      const bytes = await source.read(data.start + offset, Math.min(block, data.size - offset));
      const whole = bytes.subarray(0, bytes.length - (bytes.length % frameBytes));
      if ( !whole.length ) return;
      yield { data: whole, timestamp: Math.round(((offset / frameBytes) / fmt.rate) * 1e6) };
    }
  }

  return {
    format: "wav",
    codecName: "PCM",
    config: { codec, sampleRate: fmt.rate, numberOfChannels: fmt.channels },
    sampleRate: fmt.rate,
    channels: fmt.channels,
    duration: data.size / frameBytes / fmt.rate,
    packets
  };
}

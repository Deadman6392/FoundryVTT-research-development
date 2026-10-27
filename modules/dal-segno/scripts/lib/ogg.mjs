/**
 * Ogg pages: reading them (to demux Ogg Opus and Ogg Vorbis files) and writing them (the shrink tool's output is
 * Opus in Ogg, which every browser Foundry supports can play and seek). Pure functions on bytes.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for ( let i = 0; i < 256; i++ ) {
    let r = i << 24;
    for ( let bit = 0; bit < 8; bit++ ) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
    table[i] = r >>> 0;
  }
  return table;
})();

/** Ogg's CRC-32 (polynomial 0x04c11db7, not reflected, initial value 0). */
export function oggCrc(bytes) {
  let crc = 0;
  for ( let i = 0; i < bytes.length; i++ ) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) & 0xff) ^ bytes[i]]) >>> 0;
  return crc >>> 0;
}

const ascii = text => Uint8Array.from(text, c => c.charCodeAt(0));

/**
 * Build one Ogg page.
 * @param {object} page
 * @param {Uint8Array[]} page.packets   Whole packets that start and end on this page
 * @param {bigint|number} page.granule  Granule position after the last packet
 * @param {number} page.serial
 * @param {number} page.sequence
 * @param {boolean} [page.bos]          First page of the stream
 * @param {boolean} [page.eos]          Last page of the stream
 * @returns {Uint8Array}
 */
export function oggPage({ packets, granule, serial, sequence, bos = false, eos = false }) {
  const lacing = [];
  for ( const packet of packets ) {
    let left = packet.length;
    while ( left >= 255 ) {
      lacing.push(255);
      left -= 255;
    }
    lacing.push(left);
  }
  if ( lacing.length > 255 ) throw new Error("too many segments for one Ogg page");
  const bodyLength = packets.reduce((n, p) => n + p.length, 0);
  const page = new Uint8Array(27 + lacing.length + bodyLength);
  const view = new DataView(page.buffer);
  page.set(ascii("OggS"), 0);
  page[4] = 0;
  page[5] = (bos ? 2 : 0) | (eos ? 4 : 0);
  view.setBigInt64(6, BigInt(granule), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let at = 27 + lacing.length;
  for ( const packet of packets ) {
    page.set(packet, at);
    at += packet.length;
  }
  view.setUint32(22, oggCrc(page), true);
  return page;
}

/** How many lacing values a packet takes on a page. */
const segmentsFor = packet => Math.floor(packet.length / 255) + 1;

/**
 * Writes an Ogg Opus stream: identification and comment headers, then audio pages of about a second each, so
 * players can seek by bisection without reading the whole file.
 */
export class OggOpusWriter {
  /**
   * @param {object} options
   * @param {number} options.channels
   * @param {number} options.inputRate   The source's sample rate (informational in Opus)
   * @param {number} options.preSkip     Samples at 48 kHz the decoder drops from the start (the encoder's delay)
   * @param {string} [options.vendor]
   * @param {string[]} [options.comments]  "KEY=value" strings
   */
  constructor({ channels, inputRate, preSkip, vendor = "Dal Segno", comments = [] }) {
    this.serial = (Math.random() * 0xffffffff) >>> 0;
    this.sequence = 0;
    this.preSkip = preSkip;
    this.pages = [];
    this.pending = [];
    this.pendingSamples = 0;
    this.granule = preSkip;
    this.samples = 0;
    const head = new Uint8Array(19);
    const hv = new DataView(head.buffer);
    head.set(ascii("OpusHead"), 0);
    head[8] = 1;
    head[9] = channels;
    hv.setUint16(10, preSkip, true);
    hv.setUint32(12, inputRate, true);
    hv.setInt16(16, 0, true);
    head[18] = 0;
    this.#emit([head], 0, { bos: true });
    const vendorBytes = new TextEncoder().encode(vendor);
    const commentBytes = comments.map(c => new TextEncoder().encode(c));
    const tags = new Uint8Array(8 + 4 + vendorBytes.length + 4 + commentBytes.reduce((n, c) => n + 4 + c.length, 0));
    const tv = new DataView(tags.buffer);
    tags.set(ascii("OpusTags"), 0);
    tv.setUint32(8, vendorBytes.length, true);
    tags.set(vendorBytes, 12);
    let at = 12 + vendorBytes.length;
    tv.setUint32(at, commentBytes.length, true);
    at += 4;
    for ( const c of commentBytes ) {
      tv.setUint32(at, c.length, true);
      tags.set(c, at + 4);
      at += 4 + c.length;
    }
    this.#emit([tags], 0);
  }

  #emit(packets, granule, flags = {}) {
    this.pages.push(oggPage({ packets, granule, serial: this.serial, sequence: this.sequence++, ...flags }));
  }

  /**
   * Add one Opus packet.
   * @param {Uint8Array} packet
   * @param {number} samples   Its length in samples at 48 kHz (960 for 20 ms)
   */
  add(packet, samples) {
    const segments = this.pending.reduce((n, p) => n + segmentsFor(p), 0);
    if ( segments + segmentsFor(packet) > 255 ) this.#flush();
    this.pending.push(packet);
    this.granule += samples;
    this.samples += samples;
    this.pendingSamples += samples;
    if ( this.pendingSamples >= 48000 ) this.#flush();
  }

  #flush(eos = false, granule = this.granule) {
    if ( !this.pending.length && !eos ) return;
    this.#emit(this.pending, granule, { eos });
    this.pending = [];
    this.pendingSamples = 0;
  }

  /**
   * Write the last page.
   * @param {number} [validSamples]   Samples at 48 kHz that are real audio; the decoder drops the encoder's padding
   *                                  after them
   * @returns {Blob}
   */
  finish(validSamples = this.samples) {
    const granule = this.preSkip + Math.min(validSamples, this.samples);
    if ( this.pending.length ) this.#flush(true, granule);
    else this.#emit([], granule, { eos: true });
    return new Blob(this.pages, { type: "audio/ogg" });
  }
}

/**
 * Read the pages of an Ogg stream from a byte window.
 * @param {Uint8Array} bytes
 * @param {number} [offset]
 * @returns {{page: {granule: bigint, serial: number, flags: number, segments: number[], body: Uint8Array}, next: number}|null}
 *   null when the window doesn't hold a whole page from `offset`
 */
export function readPage(bytes, offset = 0) {
  if ( offset + 27 > bytes.length ) return null;
  if ( (bytes[offset] !== 0x4f) || (bytes[offset + 1] !== 0x67) || (bytes[offset + 2] !== 0x67) || (bytes[offset + 3] !== 0x53) ) {
    throw new Error(`no Ogg page at byte ${offset}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 27);
  const count = bytes[offset + 26];
  if ( offset + 27 + count > bytes.length ) return null;
  const segments = Array.from(bytes.subarray(offset + 27, offset + 27 + count));
  const size = segments.reduce((n, s) => n + s, 0);
  const start = offset + 27 + count;
  if ( start + size > bytes.length ) return null;
  return {
    page: { granule: view.getBigInt64(6, true), serial: view.getUint32(14, true), flags: bytes[offset + 5], segments, body: bytes.subarray(start, start + size) },
    next: start + size
  };
}

/** Duration of an Opus packet in samples at 48 kHz, from its table-of-contents byte (RFC 6716 section 3.1). */
export function opusPacketSamples(packet) {
  if ( !packet.length ) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  let frame;
  if ( config < 12 ) frame = [480, 960, 1920, 2880][config % 4];
  else if ( config < 16 ) frame = [480, 960][config % 2];
  else frame = [120, 240, 480, 960][config % 4];
  const code = toc & 3;
  const frames = (code === 0) ? 1 : (code < 3) ? 2 : (packet[1] ?? 0) & 0x3f;
  return frame * frames;
}

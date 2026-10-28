/**
 * The shrink pipeline, run in the GM's browser: read the audio track out of a file (lib/demux.mjs), decode it with
 * WebCodecs, keep the part asked for, mix it down to mono or stereo, encode Opus, and write Ogg (lib/ogg.mjs).
 * Decoder and encoder queues are kept short, so memory stays flat however long the file is; only the compressed
 * result is held, about 0.7 MB per minute at 96 kbps.
 */
import { openMedia } from "../lib/demux.mjs";
import { OggOpusWriter } from "../lib/ogg.mjs";

/** Files the browser has to decode whole (formats read here can't be streamed) are limited to this. */
const WHOLE_FILE_LIMIT = 300 * 1024 * 1024;
const QUEUE = 16;

/** Can this browser shrink files at all? */
export function canShrink() {
  return (typeof AudioDecoder === "function") && (typeof AudioEncoder === "function");
}

/**
 * Describe a file's audio without decoding it.
 * @returns {Promise<{format: string, codecName: string, sampleRate: number, channels: number, duration: number|null,
 *   decodable: boolean, whole: boolean}>}  `whole`: it can only be decoded in one piece
 */
export async function probe(blob) {
  try {
    const media = await openMedia(blob);
    const decodable = await AudioDecoder.isConfigSupported(media.config).then(r => r.supported, () => false);
    return { ...media, decodable: decodable || (blob.size <= WHOLE_FILE_LIMIT), whole: !decodable };
  } catch(err) {
    if ( err.code !== "unsupported" ) throw err;
    return { format: err.format, codecName: err.format, sampleRate: 0, channels: 0, duration: null, decodable: blob.size <= WHOLE_FILE_LIMIT, whole: true };
  }
}

const wait = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Shrink a file's audio to Opus in Ogg.
 * @param {Blob} blob
 * @param {object} options
 * @param {1|2} options.channels
 * @param {number} options.bitrate             Bits per second
 * @param {number} [options.start=0]           Seconds to keep from
 * @param {number} [options.end=Infinity]      Seconds to keep to
 * @param {(fraction: number) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{blob: Blob, seconds: number}>}
 */
export async function shrink(blob, { channels, bitrate, start = 0, end = Infinity, onProgress = () => {}, signal } = {}) {
  let media = null;
  try {
    media = await openMedia(blob);
    if ( !(await AudioDecoder.isConfigSupported(media.config).then(r => r.supported, () => false)) ) media = null;
  } catch(err) {
    if ( err.code !== "unsupported" ) throw err;
  }
  const job = new Job({ channels, bitrate, start, end, onProgress, signal, expected: media?.duration, skip: media?.skip });
  if ( media ) await job.stream(media);
  else await job.whole(blob);
  return job.finish();
}

/** One shrink: the encoder, the Ogg writer and the running position. */
class Job {
  constructor({ channels, bitrate, start, end, onProgress, signal, expected, skip = 0 }) {
    Object.assign(this, { channels, bitrate, start, end, onProgress, signal });
    this.span = Math.max(0.001, Math.min(end, expected ?? Infinity) - start);
    // Decoded audio begins with the encoder's priming, which isn't part of the recording
    this.position = -skip;
    this.kept = 0;
    this.rate = 0;
    this.encoder = null;
    this.writer = null;
    this.error = null;
    this.done = false;
  }

  #check() {
    if ( this.error ) throw this.error;
    if ( this.signal?.aborted ) throw new DOMException("Shrinking was cancelled", "AbortError");
  }

  async #openEncoder(rate) {
    const config = { codec: "opus", sampleRate: rate, numberOfChannels: this.channels, bitrate: this.bitrate };
    const support = await AudioEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if ( !support.supported ) throw new Error(`this browser can't encode Opus from ${rate} Hz audio; try Chrome, Edge or the Foundry desktop app`);
    this.rate = rate;
    this.encoder = new AudioEncoder({
      output: (chunk, meta) => this.#onEncoded(chunk, meta),
      error: err => (this.error = err)
    });
    this.encoder.configure(config);
  }

  #onEncoded(chunk, meta) {
    if ( !this.writer ) {
      // The encoder's own identification header carries its delay, which players must skip
      const head = meta?.decoderConfig?.description;
      const bytes = head ? new Uint8Array(ArrayBuffer.isView(head) ? head.buffer.slice(head.byteOffset, head.byteOffset + head.byteLength) : head) : null;
      const isHead = bytes && (bytes.length >= 19) && (String.fromCharCode(...bytes.subarray(0, 8)) === "OpusHead");
      const preSkip = isHead ? new DataView(bytes.buffer).getUint16(10, true) : 312;
      this.writer = new OggOpusWriter({ channels: this.channels, inputRate: this.rate, preSkip });
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.writer.add(data, chunk.duration ? Math.round((chunk.duration * 48) / 1000) : 960);
  }

  /** Feed decoded audio through the trim and mixdown to the encoder. */
  async #take(planes, rate) {
    if ( !this.encoder ) await this.#openEncoder(rate);
    const frames = planes[0].length;
    const from = this.position;
    this.position += frames / rate;
    if ( this.done || (this.position <= this.start) ) return;
    const first = Math.max(0, Math.round((Math.max(0, this.start) - from) * rate));
    const last = Math.min(frames, Math.round((this.end - from) * rate));
    if ( last <= first ) {
      this.done = from >= this.end;
      return;
    }
    const n = last - first;
    const out = new Float32Array(n * this.channels);
    if ( this.channels === 1 ) {
      const scale = 1 / planes.length;
      for ( const plane of planes ) for ( let i = 0; i < n; i++ ) out[i] += plane[first + i] * scale;
    }
    else {
      out.set(planes[0].subarray(first, last), 0);
      out.set((planes[1] ?? planes[0]).subarray(first, last), n);
    }
    const data = new AudioData({
      format: "f32-planar", sampleRate: rate, numberOfFrames: n, numberOfChannels: this.channels,
      timestamp: Math.round((this.kept / rate) * 1e6), data: out
    });
    this.kept += n;
    this.encoder.encode(data);
    data.close();
    this.onProgress(Math.min(1, (this.position - this.start) / this.span));
    if ( this.position >= this.end ) this.done = true;
  }

  /** Decode packet by packet. */
  async stream(media) {
    const pending = [];
    const decoder = new AudioDecoder({
      output: audio => {
        const planes = Array.from({ length: audio.numberOfChannels }, (_, c) => {
          const plane = new Float32Array(audio.numberOfFrames);
          audio.copyTo(plane, { planeIndex: c, format: "f32-planar" });
          return plane;
        });
        pending.push({ planes, rate: audio.sampleRate });
        audio.close();
      },
      error: err => (this.error = err)
    });
    decoder.configure(media.config);
    try {
      for await ( const packet of media.packets() ) {
        this.#check();
        decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: packet.timestamp, data: packet.data }));
        while ( pending.length ) {
          const next = pending.shift();
          await this.#take(next.planes, next.rate);
        }
        if ( this.done ) break;
        while ( (decoder.decodeQueueSize > QUEUE) || ((this.encoder?.encodeQueueSize ?? 0) > QUEUE) ) {
          this.#check();
          await wait();
        }
      }
      if ( !this.done ) await decoder.flush();
      while ( pending.length && !this.done ) {
        const next = pending.shift();
        await this.#take(next.planes, next.rate);
      }
    } finally {
      if ( decoder.state !== "closed" ) decoder.close();
    }
  }

  /** Decode the whole file at once, for formats only the browser itself can read (FLAC, for one). */
  async whole(blob) {
    if ( blob.size > WHOLE_FILE_LIMIT ) throw new Error("this format can only be decoded whole, and the file is too large for that");
    const ctx = new OfflineAudioContext(1, 1, 48000);
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const planes = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const step = buffer.sampleRate;
    this.span = Math.max(0.001, Math.min(this.end, buffer.duration) - this.start);
    for ( let at = 0; (at < buffer.length) && !this.done; at += step ) {
      this.#check();
      await this.#take(planes.map(p => p.subarray(at, Math.min(buffer.length, at + step))), buffer.sampleRate);
      while ( this.encoder.encodeQueueSize > QUEUE ) await wait();
    }
  }

  async finish() {
    if ( !this.encoder ) throw new Error("no audio was found in the part of the file asked for");
    await this.encoder.flush();
    this.encoder.close();
    this.#check();
    if ( !this.writer ) throw new Error("the encoder produced nothing");
    const seconds = this.kept / this.rate;
    this.onProgress(1);
    return { blob: this.writer.finish(Math.round(seconds * 48000)), seconds };
  }
}

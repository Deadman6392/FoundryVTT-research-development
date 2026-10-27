/**
 * The shrink tool's file reading and writing: demuxers against tiny fixture files made with ffmpeg (a 0.5 s tone in
 * each container; see the codec details with `ffprobe tests/fixtures/media/*`), and the Ogg Opus writer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aacCodec, mp3Frame, openMedia } from "../modules/dal-segno/scripts/lib/demux.mjs";
import { OggOpusWriter, oggCrc, oggPage, opusPacketSamples, readPage } from "../modules/dal-segno/scripts/lib/ogg.mjs";

const fixture = name => new Blob([readFileSync(new URL(`./fixtures/media/${name}`, import.meta.url))]);

async function collect(media) {
  const packets = [];
  for await ( const p of media.packets() ) packets.push(p);
  return packets;
}

function assertRising(packets) {
  for ( let i = 1; i < packets.length; i++ ) {
    assert.ok(packets[i].timestamp > packets[i - 1].timestamp, `timestamps rise at packet ${i}`);
  }
}

test("MP4 with AAC: codec string, decoder config, priming from the edit list, every frame", async () => {
  const media = await openMedia(fixture("aac.m4a"));
  assert.equal(media.format, "mp4");
  assert.equal(media.config.codec, "mp4a.40.2");
  assert.equal(media.config.sampleRate, 44100);
  assert.equal(media.config.numberOfChannels, 2);
  assert.ok(media.config.description.length >= 2, "AudioSpecificConfig");
  assert.ok(Math.abs(media.skip - (1024 / 44100)) < 1e-6, `skip ${media.skip}`);
  assert.ok(Math.abs(media.duration - 0.546) < 0.03, `duration ${media.duration}`);
  const packets = await collect(media);
  // 0.5 s at 44.1 kHz in 1024-sample frames, plus priming
  assert.ok(packets.length >= 22 && packets.length <= 24, `${packets.length} frames`);
  assertRising(packets);
  assert.equal(packets[0].timestamp, 0);
});

test("fragmented MP4: samples come from the movie fragments, and the length is summed from them", async () => {
  const media = await openMedia(fixture("frag.m4a"));
  assert.equal(media.config.codec, "mp4a.40.2");
  assert.ok(Math.abs(media.duration - 0.52) < 0.03, `duration ${media.duration}`);
  const packets = await collect(media);
  assert.ok(packets.length >= 22, `${packets.length} frames`);
  assertRising(packets);
});

test("MP4 with Opus turns dOps into an OpusHead and leaves pre-skip to the decoder", async () => {
  const media = await openMedia(fixture("opus.mp4"));
  assert.equal(media.config.codec, "opus");
  const head = media.config.description;
  assert.equal(String.fromCharCode(...head.subarray(0, 8)), "OpusHead");
  assert.equal(head[9], 1, "mono");
  assert.equal(new DataView(head.buffer, head.byteOffset).getUint16(10, true), 312, "pre-skip, little-endian");
  assert.equal(media.skip, 0);
  assertRising(await collect(media));
});

test("WebM with Opus and Matroska with Vorbis", async () => {
  const webm = await openMedia(fixture("opus.webm"));
  assert.equal(webm.format, "webm");
  assert.equal(webm.config.codec, "opus");
  assert.ok(Math.abs(webm.duration - 0.508) < 0.01);
  const opus = await collect(webm);
  assert.equal(opus.length, 26, "20 ms packets");
  assertRising(opus);
  const mkv = await openMedia(fixture("vorbis.mkv"));
  assert.equal(mkv.config.codec, "vorbis");
  assert.equal(mkv.config.numberOfChannels, 2);
  assert.equal(mkv.config.description[0], 2, "three Xiph-laced headers");
  assert.ok((await collect(mkv)).length > 5);
});

test("Ogg Opus and Ogg Vorbis: headers become the decoder description, the length comes from the last page", async () => {
  const opus = await openMedia(fixture("opus.ogg"));
  assert.equal(opus.config.codec, "opus");
  // The last granule minus the 312-sample pre-skip: the real 0.5 s (ffprobe reports 0.5065, counting the pre-skip)
  assert.ok(Math.abs(opus.duration - 0.5) < 0.001, `duration ${opus.duration}`);
  const packets = await collect(opus);
  assert.equal(packets.length, 26);
  assert.equal(packets[1].timestamp, 20000, "timestamps from each packet's TOC");
  const vorbis = await openMedia(fixture("vorbis.ogg"));
  assert.equal(vorbis.config.codec, "vorbis");
  assert.equal(vorbis.config.sampleRate, 44100);
  const desc = vorbis.config.description;
  assert.equal(desc[0], 2);
  assertRising(await collect(vorbis));
});

test("MP3: the Info frame is skipped and LAME's delay is reported", async () => {
  const media = await openMedia(fixture("mp3.mp3"));
  assert.equal(media.format, "mp3");
  assert.equal(media.config.codec, "mp3");
  assert.equal(media.config.sampleRate, 44100);
  assert.equal(media.config.numberOfChannels, 1);
  assert.ok(Math.abs(media.skip - ((576 + 529) / 44100)) < 0.002, `skip ${media.skip}`);
  const packets = await collect(media);
  // 0.5 s of audio plus the encoder's delay and padding, in 1152-sample frames, without the Info frame
  assert.ok(packets.length >= 20 && packets.length <= 22, `${packets.length} frames`);
  assert.ok(Math.abs(media.duration - (packets.length * 1152 / 44100)) < 0.03, `duration ${media.duration}`);
});

test("mp3Frame reads MPEG-1 and MPEG-2 layer III headers", () => {
  assert.deepEqual(mp3Frame([0xff, 0xfb, 0x90, 0x64]), { length: 417, samples: 1152, rate: 44100, channels: 2, bitrate: 128000 });
  assert.equal(mp3Frame([0xff, 0xf3, 0x14, 0xc4]).samples, 576, "MPEG-2 layer III");
  assert.equal(mp3Frame([0xff, 0xfb, 0xf0, 0x00]), null, "bad bitrate");
  assert.equal(mp3Frame([0x49, 0x44, 0x33, 0x04]), null);
});

test("WAV: PCM blocks with timestamps", async () => {
  const media = await openMedia(fixture("pcm.wav"));
  assert.deepEqual(media.config, { codec: "pcm-s16", sampleRate: 8000, numberOfChannels: 1 });
  assert.equal(media.duration, 0.25);
  const packets = await collect(media);
  assert.equal(packets.reduce((n, p) => n + p.data.length, 0), 4000);
});

test("unknown and FLAC files are reported as unsupported, not misread", async () => {
  await assert.rejects(openMedia(new Blob([new Uint8Array(64)])), { code: "unsupported" });
  await assert.rejects(openMedia(new Blob([new TextEncoder().encode("fLaC\0\0\0\"")])), { code: "unsupported", format: "FLAC" });
});

test("aacCodec reads the object type, including the escape for extended types", () => {
  assert.equal(aacCodec(Uint8Array.of(0x12, 0x10)), "mp4a.40.2");
  assert.equal(aacCodec(Uint8Array.of(0x2b, 0x92)), "mp4a.40.5");
  assert.equal(aacCodec(Uint8Array.of(0xf8, 0x00)), "mp4a.40.32");
});

test("Ogg CRC matches the reference value and pages read back", () => {
  // CRC-32/MPEG-2 style without reflection or final xor (Ogg's variant) of "123456789"
  assert.equal(oggCrc(new TextEncoder().encode("123456789")), 0x89a1897f);
  const page = oggPage({ packets: [new Uint8Array(300).fill(7), Uint8Array.of(1, 2)], granule: 960, serial: 42, sequence: 3, eos: true });
  const { page: read, next } = readPage(page);
  assert.equal(next, page.length);
  assert.deepEqual(read.segments, [255, 45, 2]);
  assert.equal(read.granule, 960n);
  assert.equal(read.serial, 42);
  assert.equal(read.flags & 4, 4);
  // The stored CRC is the CRC of the page with that field zeroed
  const copy = page.slice();
  copy.fill(0, 22, 26);
  assert.equal(new DataView(page.buffer).getUint32(22, true), oggCrc(copy));
});

test("opusPacketSamples reads frame size and count from the TOC byte", () => {
  assert.equal(opusPacketSamples(Uint8Array.of(0xfc)), 960, "CELT 20 ms, one frame");
  assert.equal(opusPacketSamples(Uint8Array.of(0xfd)), 1920, "two frames");
  assert.equal(opusPacketSamples(Uint8Array.of(0x1b, 0x03)), 2880 * 3, "SILK 60 ms, three frames");
  assert.equal(opusPacketSamples(Uint8Array.of(0x0b, 0x03)), 960 * 3, "SILK 20 ms, three frames");
});

test("OggOpusWriter: header pages, second-long audio pages, and an end granule that trims padding", async () => {
  const writer = new OggOpusWriter({ channels: 2, inputRate: 44100, preSkip: 312 });
  for ( let i = 0; i < 120; i++ ) writer.add(Uint8Array.of(0xfc, i), 960);
  const blob = writer.finish(120 * 960 - 500);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pages = [];
  for ( let at = 0; at < bytes.length; ) {
    const { page, next } = readPage(bytes, at);
    pages.push(page);
    at = next;
  }
  assert.equal(String.fromCharCode(...pages[0].body.subarray(0, 8)), "OpusHead");
  assert.equal(pages[0].flags & 2, 2, "beginning of stream");
  assert.equal(String.fromCharCode(...pages[1].body.subarray(0, 8)), "OpusTags");
  assert.equal(pages.length, 5, "two headers, then 50 + 50 + 20 packets");
  assert.equal(pages[2].granule, BigInt(312 + (50 * 960)));
  assert.equal(pages.at(-1).granule, BigInt(312 + (120 * 960) - 500));
  assert.equal(pages.at(-1).flags & 4, 4, "end of stream");
});

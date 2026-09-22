// node --experimental-strip-types lib/mediaDemux.test.mts
//
// The two container readers behind local-file audio tracks, against files
// built here byte by byte: no sample media is needed to run this, and each
// case pins one piece of the format (lacing, header stripping, cues, the MP4
// sample tables) rather than whatever one real file happened to contain.
import assert from "node:assert/strict";
import test from "node:test";
import { openAudioDemuxer, type AudioPacket } from "./mediaDemux/index";
import { splitLacedFrames } from "./mediaDemux/matroska";
import { aacCodecString, buildAsc } from "./mediaDemux/codecs";

// ─── EBML writer ──────────────────────────────────────────────────────────

function idBytes(id: number): number[] {
  const out: number[] = [];
  let value = id;
  while (value > 0) {
    out.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return out;
}

function sizeBytes(size: number): number[] {
  // Always 8 bytes: simple, and legal.
  const out = [0x01];
  for (let i = 6; i >= 0; i -= 1) out.push(Math.floor(size / 2 ** (8 * i)) & 0xff);
  return out;
}

const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

function el(id: number, body: number[] | Uint8Array): number[] {
  return [...idBytes(id), ...sizeBytes(body.length), ...body];
}

function uint(id: number, value: number, bytes = 4): number[] {
  const body: number[] = [];
  for (let i = bytes - 1; i >= 0; i -= 1) body.push(Math.floor(value / 2 ** (8 * i)) & 0xff);
  return el(id, body);
}

function str(id: number, value: string): number[] {
  return el(id, [...new TextEncoder().encode(value)]);
}

function float(id: number, value: number): number[] {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value);
  return el(id, [...bytes]);
}

// A block body: track number vint, int16 timecode, flags, then the frames.
function block(track: number, timecode: number, flags: number, frames: number[]): number[] {
  const tc = timecode < 0 ? timecode + 0x10000 : timecode;
  return [0x80 | track, (tc >> 8) & 0xff, tc & 0xff, flags, ...frames];
}

const ASC = [0x11, 0x90]; // AAC LC, 48 kHz, stereo

function buildMkv(): Uint8Array<ArrayBuffer> {
  const header = el(0x1a45dfa3, [...str(0x4282, "matroska")]);
  const info = el(0x1549a966, [...uint(0x2ad7b1, 1_000_000)]);
  const tracks = el(0x1654ae6b, [
    ...el(0xae, [...uint(0xd7, 1, 1), ...uint(0x83, 1, 1), ...str(0x86, "V_VP9")]),
    ...el(0xae, [
      ...uint(0xd7, 2, 1),
      ...uint(0x83, 2, 1),
      ...str(0x86, "A_AAC"),
      ...el(0x63a2, ASC),
      ...str(0x22b59c, "por"),
      ...el(0xe1, [...float(0xb5, 48000), ...uint(0x9f, 2, 1)]),
    ]),
    ...el(0xae, [
      ...uint(0xd7, 3, 1),
      ...uint(0x83, 2, 1),
      ...str(0x86, "A_OPUS"),
      ...str(0x22b59c, "eng"),
      ...str(0x536e, "Commentary"),
      ...uint(0x88, 0, 1),
      ...uint(0x23e383, 20_000_000),
      ...el(0xe1, [...float(0xb5, 48000), ...uint(0x9f, 2, 1)]),
      // Header stripping: 0xAA put back in front of every frame.
      ...el(0x6d80, [...el(0x6240, [...el(0x5034, [...uint(0x4254, 3, 1), ...el(0x4255, [0xaa])])])]),
    ]),
  ]);
  const cluster1 = el(0x1f43b675, [
    ...uint(0xe7, 0, 1),
    ...el(0xa3, block(1, 0, 0x80, [9, 9, 9, 9])),
    ...el(0xa3, block(2, 0, 0x80, [1, 2, 3])),
    // Xiph lacing, three frames of 2, 1 and (the rest) 3 bytes.
    ...el(0xa3, block(3, 0, 0x82, [2, 2, 1, 0x10, 0x11, 0x20, 0x30, 0x31, 0x32])),
  ]);
  const cluster2 = el(0x1f43b675, [
    ...uint(0xe7, 1000, 2),
    ...el(0xa0, [...el(0xa1, block(2, 5, 0x00, [4, 5]))]),
  ]);

  // Cues before the clusters, so their positions (relative to the segment's
  // data) have to account for the Cues element itself. Its size does not
  // depend on the numbers inside, so it can be measured with zeros first.
  const cuesFor = (first: number, second: number) =>
    el(0x1c53bb6b, [
      ...el(0xbb, [...uint(0xb3, 0), ...el(0xb7, [...uint(0xf7, 1, 1), ...uint(0xf1, first)])]),
      ...el(0xbb, [...uint(0xb3, 1000), ...el(0xb7, [...uint(0xf7, 1, 1), ...uint(0xf1, second)])]),
    ]);
  const head = info.length + tracks.length + cuesFor(0, 0).length;
  const cuesShifted = cuesFor(head, head + cluster1.length);
  const segmentBody = [...info, ...tracks, ...cuesShifted, ...cluster1, ...cluster2];
  return new Uint8Array([...header, 0x18, 0x53, 0x80, 0x67, ...UNKNOWN, ...segmentBody]);
}

test("Matroska: audio tracks, languages, names, defaults", async () => {
  const demuxer = await openAudioDemuxer(new Blob([buildMkv()]), "film.mkv");
  assert.ok(demuxer);
  assert.equal(demuxer.tracks.length, 2);
  const [aac, opus] = demuxer.tracks;
  assert.deepEqual(
    { id: aac.id, index: aac.index, codec: aac.codec, language: aac.language, isDefault: aac.isDefault },
    { id: 2, index: 0, codec: "mp4a.40.2", language: "por", isDefault: true }
  );
  assert.deepEqual([...(aac.description ?? [])], ASC);
  assert.deepEqual(
    { id: opus.id, codec: opus.codec, name: opus.name, language: opus.language, isDefault: opus.isDefault },
    { id: 3, codec: "opus", name: "Commentary", language: "eng", isDefault: false }
  );
  assert.equal(opus.frameDurationUs, 20_000);
});

test("Matroska: blocks in order, video skipped, lacing and header stripping undone", async () => {
  const demuxer = await openAudioDemuxer(new Blob([buildMkv()]), "film.mkv");
  assert.ok(demuxer);
  const packets: AudioPacket[] = [];
  for (;;) {
    const batch = await demuxer.read();
    if (!batch) break;
    packets.push(...batch);
  }
  assert.deepEqual(
    packets.map((p) => [p.trackId, p.timestampUs, [...p.data]]),
    [
      [2, 0, [1, 2, 3]],
      [3, 0, [0xaa, 0x10, 0x11]],
      [3, 20_000, [0xaa, 0x20]],
      [3, 40_000, [0xaa, 0x30, 0x31, 0x32]],
      [2, 1_005_000, [4, 5]],
    ]
  );
});

test("Matroska: seeking lands on the cluster the cues point to", async () => {
  const demuxer = await openAudioDemuxer(new Blob([buildMkv()]), "film.mkv");
  assert.ok(demuxer);
  await demuxer.seek(1.2);
  const batch = await demuxer.read();
  assert.ok(batch);
  assert.deepEqual(batch.map((p) => p.timestampUs), [1_005_000]);
  await demuxer.seek(0);
  const again = await demuxer.read();
  assert.ok(again);
  assert.equal(again[0].timestampUs, 0);
});

test("EBML lacing with signed size differences", () => {
  // Three frames: 3, 1 (diff -2), then the rest (2).
  const body = new Uint8Array([2, 0x83, 0xbd, 1, 1, 1, 2, 3, 3]);
  const frames = splitLacedFrames(body, 0, 0x06);
  assert.deepEqual(frames.map((f) => [...f]), [[1, 1, 1], [2], [3, 3]]);
});

test("fixed lacing", () => {
  const body = new Uint8Array([1, 7, 7, 8, 8]);
  assert.deepEqual(splitLacedFrames(body, 0, 0x04).map((f) => [...f]), [[7, 7], [8, 8]]);
});

test("AAC codec strings and synthesized AudioSpecificConfigs", () => {
  assert.equal(aacCodecString(new Uint8Array(ASC)), "mp4a.40.2");
  assert.equal(aacCodecString(new Uint8Array([0x2b, 0x92, 0x08, 0x00])), "mp4a.40.5");
  assert.deepEqual([...(buildAsc(2, 48000, 2) ?? [])], ASC);
  assert.equal(buildAsc(2, 12345, 2), null);
});

test("not a Matroska file: null, not a throw", async () => {
  assert.equal(await openAudioDemuxer(new Blob([new Uint8Array(64)]), "junk.mkv"), null);
  assert.equal(await openAudioDemuxer(new Blob([new Uint8Array(64)]), "junk.mp4"), null);
});

// ─── MP4 ──────────────────────────────────────────────────────────────────

function box(type: string, ...parts: (number[] | Uint8Array)[]): number[] {
  const body = parts.flatMap((p) => [...p]);
  const size = body.length + 8;
  return [(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff, ...[...type].map((c) => c.charCodeAt(0)), ...body];
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function be16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function mp4Track(trackId: number, language: string, enabled: boolean, chunkOffset: number): number[] {
  const lang = [...language].reduce((acc, c) => (acc << 5) | (c.charCodeAt(0) - 0x60), 0);
  const tkhd = box("tkhd", [0, 0, 0, enabled ? 1 : 0], be32(0), be32(0), be32(trackId), new Array(68).fill(0));
  const mdhd = box("mdhd", [0, 0, 0, 0], be32(0), be32(0), be32(1000), be32(3000), be16(lang), be16(0));
  const hdlr = box("hdlr", [0, 0, 0, 0], be32(0), [..."soun"].map((c) => c.charCodeAt(0)), new Array(12).fill(0), [..."Dublagem"].map((c) => c.charCodeAt(0)), [0]);
  const esds = box(
    "esds",
    [0, 0, 0, 0],
    // ES_Descriptor (ES_ID 1, no flags) holding a DecoderConfigDescriptor
    // (13 fixed bytes: AAC, audio stream) holding the AudioSpecificConfig.
    [0x03, 0x19, 0x00, 0x01, 0x00],
    [0x04, 0x11, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0x05, 0x02, ...ASC]
  );
  const mp4a = box("mp4a", new Array(6).fill(0), be16(1), be16(0), be16(0), be32(0), be16(2), be16(16), be16(0), be16(0), be32(48000 * 65536), esds);
  const stsd = box("stsd", [0, 0, 0, 0], be32(1), mp4a);
  // Three samples, 1000 ticks each (one second at timescale 1000).
  const stts = box("stts", [0, 0, 0, 0], be32(1), be32(3), be32(1000));
  const stsc = box("stsc", [0, 0, 0, 0], be32(1), be32(1), be32(3), be32(1));
  const stsz = box("stsz", [0, 0, 0, 0], be32(0), be32(3), be32(2), be32(1), be32(3));
  const stco = box("stco", [0, 0, 0, 0], be32(1), be32(chunkOffset));
  const stbl = box("stbl", stsd, stts, stsc, stsz, stco);
  return box("trak", tkhd, box("mdia", mdhd, hdlr, box("minf", stbl)));
}

function buildMp4(): Uint8Array<ArrayBuffer> {
  const ftyp = box("ftyp", [..."isom"].map((c) => c.charCodeAt(0)), be32(0));
  const samplesA = [1, 1, 2, 3, 3, 3];
  const samplesB = [7, 7, 8, 9, 9, 9];
  const mdatStart = ftyp.length + 8;
  const mdat = box("mdat", samplesA, samplesB);
  // moov at the end, the layout that makes a naive reader walk the mdat.
  const moov = box("moov", mp4Track(1, "por", true, mdatStart), mp4Track(2, "jpn", false, mdatStart + samplesA.length));
  return new Uint8Array([...ftyp, ...mdat, ...moov]);
}

test("MP4: tracks from the moov at the end, samples by table", async () => {
  const demuxer = await openAudioDemuxer(new Blob([buildMp4()]), "film.mp4");
  assert.ok(demuxer);
  assert.deepEqual(
    demuxer.tracks.map((t) => [t.id, t.codec, t.language, t.name, t.isDefault, t.sampleRate, t.channels]),
    [
      [1, "mp4a.40.2", "por", "Dublagem", true, 48000, 2],
      [2, "mp4a.40.2", "jpn", "Dublagem", false, 48000, 2],
    ]
  );
  const packets: AudioPacket[] = [];
  for (;;) {
    const batch = await demuxer.read();
    if (!batch) break;
    packets.push(...batch);
  }
  const of = (id: number) => packets.filter((p) => p.trackId === id).map((p) => [p.timestampUs, [...p.data]]);
  assert.deepEqual(of(1), [
    [0, [1, 1]],
    [1_000_000, [2]],
    [2_000_000, [3, 3, 3]],
  ]);
  assert.deepEqual(of(2), [
    [0, [7, 7]],
    [1_000_000, [8]],
    [2_000_000, [9, 9, 9]],
  ]);
  await demuxer.seek(1.5);
  const after = await demuxer.read();
  assert.ok(after);
  assert.equal(Math.min(...after.map((p) => p.timestampUs)), 1_000_000);
});

// MP4 / MOV / M4V, audio only, from the moov's sample tables (stts, stsc,
// stsz, stco/co64) — which is where a file on disk keeps them. Fragmented
// MP4 (samples described in moof boxes instead) has empty tables here and is
// left to the <video> element, which is what reads it as before.

import type { BlobReader } from "./blobReader";
import { aacCodecString } from "./codecs";
import type { AudioDemuxer, AudioPacket, AudioTrackInfo } from "./types";

// How far ahead of the slowest track one read() goes, in microseconds.
const READ_SPAN_US = 500_000;

type Box = { type: string; start: number; end: number };

function fourcc(buf: Uint8Array, at: number): string {
  return String.fromCharCode(buf[at], buf[at + 1], buf[at + 2], buf[at + 3]);
}

function u16(buf: Uint8Array, at: number): number {
  return (buf[at] << 8) | buf[at + 1];
}

function u32(buf: Uint8Array, at: number): number {
  return ((buf[at] << 24) >>> 0) + (buf[at + 1] << 16) + (buf[at + 2] << 8) + buf[at + 3];
}

function u64(buf: Uint8Array, at: number): number {
  return u32(buf, at) * 4294967296 + u32(buf, at + 4);
}

function* boxes(buf: Uint8Array, start: number, end: number): Generator<Box> {
  let pos = start;
  while (pos + 8 <= end) {
    let size = u32(buf, pos);
    const type = fourcc(buf, pos + 4);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) return;
      size = u64(buf, pos + 8);
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header) return;
    yield { type, start: pos + header, end: Math.min(end, pos + size) };
    pos += size;
  }
}

function child(buf: Uint8Array, parent: Box, type: string): Box | null {
  for (const box of boxes(buf, parent.start, parent.end)) if (box.type === type) return box;
  return null;
}

function path(buf: Uint8Array, parent: Box, ...types: string[]): Box | null {
  let at: Box | null = parent;
  for (const type of types) {
    if (!at) return null;
    at = child(buf, at, type);
  }
  return at;
}

// ISO 639-2/T packed into 15 bits (three 5-bit letters, offset 0x60).
function packedLanguage(value: number): string | null {
  const code = String.fromCharCode(((value >> 10) & 31) + 0x60, ((value >> 5) & 31) + 0x60, (value & 31) + 0x60);
  return /^[a-z]{3}$/.test(code) && code !== "und" ? code : null;
}

// MPEG-4 descriptor length: up to four bytes of 7 bits each.
function descriptorLength(buf: Uint8Array, at: number): { length: number; size: number } {
  let length = 0;
  let size = 0;
  for (let i = 0; i < 4; i += 1) {
    const byte = buf[at + i];
    size += 1;
    length = (length << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) break;
  }
  return { length, size };
}

// esds → the object type and the AudioSpecificConfig.
function parseEsds(buf: Uint8Array, box: Box): { objectType: number; asc?: Uint8Array } {
  let pos = box.start + 4; // version + flags
  let objectType = 0;
  let asc: Uint8Array | undefined;
  while (pos < box.end) {
    const tag = buf[pos];
    const { length, size } = descriptorLength(buf, pos + 1);
    const body = pos + 1 + size;
    if (tag === 0x03) {
      // ES_Descriptor: ES_ID, flags, then optional fields, then its children.
      const flags = buf[body + 2];
      let inner = body + 3;
      if (flags & 0x80) inner += 2;
      if (flags & 0x40) inner += 1 + buf[inner];
      if (flags & 0x20) inner += 2;
      pos = inner;
      continue;
    }
    if (tag === 0x04) {
      objectType = buf[body];
      pos = body + 13;
      continue;
    }
    if (tag === 0x05) {
      asc = buf.slice(body, body + length);
      break;
    }
    pos = body + length;
  }
  return { objectType, asc };
}

type SampleTable = { offsets: Float64Array; sizes: Uint32Array; times: Float64Array };

type Mp4Track = AudioTrackInfo & { table: SampleTable; cursor: number };

function parseTrack(buf: Uint8Array, trak: Box, index: number): Mp4Track | null {
  const tkhd = child(buf, trak, "tkhd");
  const mdia = child(buf, trak, "mdia");
  const hdlr = mdia && child(buf, mdia, "hdlr");
  const mdhd = mdia && child(buf, mdia, "mdhd");
  const stbl = mdia && path(buf, mdia, "minf", "stbl");
  if (!tkhd || !mdia || !hdlr || !mdhd || !stbl) return null;
  if (fourcc(buf, hdlr.start + 8) !== "soun") return null;

  const tkhdVersion = buf[tkhd.start];
  const tkhdFlags = (buf[tkhd.start + 1] << 16) | (buf[tkhd.start + 2] << 8) | buf[tkhd.start + 3];
  const trackId = u32(buf, tkhd.start + (tkhdVersion === 1 ? 20 : 12));
  const mdhdVersion = buf[mdhd.start];
  const timescale = u32(buf, mdhd.start + (mdhdVersion === 1 ? 20 : 12));
  const language = packedLanguage(u16(buf, mdhd.start + (mdhdVersion === 1 ? 32 : 20)));
  const handlerName = new TextDecoder()
    .decode(buf.subarray(hdlr.start + 24, hdlr.end))
    .replace(/\0/g, "")
    .trim();

  // The first edit's media time is the encoder's priming, to be subtracted.
  let mediaTime = 0;
  const elst = path(buf, trak, "edts", "elst");
  if (elst && u32(buf, elst.start + 4) > 0) {
    const version = buf[elst.start];
    const value = version === 1 ? u64(buf, elst.start + 16) : u32(buf, elst.start + 12);
    if (value !== 0xffffffff && value < 2 ** 52) mediaTime = value;
  }

  const stsd = child(buf, stbl, "stsd");
  if (!stsd || timescale === 0) return null;
  const entry = boxes(buf, stsd.start + 8, stsd.end).next().value as Box | undefined;
  if (!entry) return null;
  const format = entry.type;
  // SampleEntry (8) + AudioSampleEntry (20), longer for QuickTime v1/v2.
  const soundVersion = u16(buf, entry.start + 8);
  let channels = u16(buf, entry.start + 16);
  let sampleRate = u32(buf, entry.start + 24) >>> 16;
  let childStart = entry.start + 28;
  if (soundVersion === 1) childStart += 16;
  if (soundVersion === 2) {
    childStart += 36;
    const view = new DataView(buf.buffer, buf.byteOffset + entry.start + 32, 8);
    sampleRate = Math.round(view.getFloat64(0));
    channels = u32(buf, entry.start + 40);
  }
  const entryBox: Box = { type: format, start: childStart, end: entry.end };

  let codec: string | null = null;
  let description: Uint8Array | undefined;
  const esds = child(buf, entryBox, "esds") ?? (child(buf, entryBox, "wave") ? path(buf, entryBox, "wave", "esds") : null);
  if (format === "mp4a" && esds) {
    const { objectType, asc } = parseEsds(buf, esds);
    if (objectType === 0x69 || objectType === 0x6b) codec = "mp3";
    else if (asc) {
      codec = aacCodecString(asc);
      description = asc;
    }
  } else if (format === ".mp3") {
    codec = "mp3";
  } else if (format === "Opus") {
    const dops = child(buf, entryBox, "dOps");
    if (dops) {
      // dOps is big-endian; OpusHead (what the decoder takes) little-endian.
      const d = dops.start;
      const mapping = buf.subarray(d + 11, dops.end);
      const head = new Uint8Array(19 + mapping.length);
      head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // "OpusHead"
      head[8] = 1;
      head[9] = buf[d + 1];
      head[10] = buf[d + 3];
      head[11] = buf[d + 2];
      head[12] = buf[d + 7];
      head[13] = buf[d + 6];
      head[14] = buf[d + 5];
      head[15] = buf[d + 4];
      head[16] = buf[d + 9];
      head[17] = buf[d + 8];
      head[18] = buf[d + 10];
      head.set(mapping, 19);
      codec = "opus";
      description = head;
    }
  } else if (format === "fLaC") {
    const dfla = child(buf, entryBox, "dfLa");
    if (dfla) {
      const blocks = buf.subarray(dfla.start + 4, dfla.end);
      description = new Uint8Array(4 + blocks.length);
      description.set([0x66, 0x4c, 0x61, 0x43], 0); // "fLaC"
      description.set(blocks, 4);
      codec = "flac";
    }
  } else if (format === "ac-3") codec = "ac-3";
  else if (format === "ec-3") codec = "ec-3";

  // The sample table.
  const stts = child(buf, stbl, "stts");
  const stsc = child(buf, stbl, "stsc");
  const stsz = child(buf, stbl, "stsz");
  const stco = child(buf, stbl, "stco");
  const co64 = child(buf, stbl, "co64");
  if (!stts || !stsc || !stsz || (!stco && !co64)) return null;
  const sampleCount = u32(buf, stsz.start + 8);
  const fixedSize = u32(buf, stsz.start + 4);
  if (sampleCount === 0) return null;
  const sizes = new Uint32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) sizes[i] = fixedSize || u32(buf, stsz.start + 12 + i * 4);

  const times = new Float64Array(sampleCount);
  let dts = 0;
  let sample = 0;
  const sttsCount = u32(buf, stts.start + 4);
  for (let e = 0; e < sttsCount && sample < sampleCount; e += 1) {
    const count = u32(buf, stts.start + 8 + e * 8);
    const delta = u32(buf, stts.start + 12 + e * 8);
    for (let k = 0; k < count && sample < sampleCount; k += 1) {
      times[sample] = ((dts - mediaTime) / timescale) * 1e6;
      dts += delta;
      sample += 1;
    }
  }

  const chunkOffsets: number[] = [];
  if (co64) {
    const n = u32(buf, co64.start + 4);
    for (let i = 0; i < n; i += 1) chunkOffsets.push(u64(buf, co64.start + 8 + i * 8));
  } else if (stco) {
    const n = u32(buf, stco.start + 4);
    for (let i = 0; i < n; i += 1) chunkOffsets.push(u32(buf, stco.start + 8 + i * 4));
  }
  const offsets = new Float64Array(sampleCount);
  const stscCount = u32(buf, stsc.start + 4);
  sample = 0;
  for (let e = 0; e < stscCount; e += 1) {
    const firstChunk = u32(buf, stsc.start + 8 + e * 12) - 1;
    const perChunk = u32(buf, stsc.start + 12 + e * 12);
    const nextFirst = e + 1 < stscCount ? u32(buf, stsc.start + 8 + (e + 1) * 12) - 1 : chunkOffsets.length;
    for (let c = firstChunk; c < nextFirst && sample < sampleCount; c += 1) {
      let at = chunkOffsets[c];
      for (let k = 0; k < perChunk && sample < sampleCount; k += 1) {
        offsets[sample] = at;
        at += sizes[sample];
        sample += 1;
      }
    }
  }

  return {
    id: trackId,
    index,
    codecId: format,
    codec,
    description,
    sampleRate,
    channels,
    language,
    // QuickTime writes "SoundHandler" and the like; that is not a name.
    name: handlerName && !/handler$/i.test(handlerName) ? handlerName : null,
    isDefault: (tkhdFlags & 1) === 1,
    frameDurationUs: null,
    table: { offsets, sizes, times },
    cursor: 0,
  };
}

class Mp4Demuxer implements AudioDemuxer {
  private all: Mp4Track[] = [];

  private readonly reader: BlobReader;

  constructor(reader: BlobReader) {
    this.reader = reader;
  }

  get tracks(): AudioTrackInfo[] {
    return this.all;
  }

  async open(): Promise<boolean> {
    // Walk the top-level boxes for the moov, stepping over the mdat by its
    // size — the moov is at the end of plenty of files.
    let pos = 0;
    let moov: Uint8Array | null = null;
    for (let steps = 0; steps < 1000 && pos + 8 <= this.reader.size; steps += 1) {
      const head = await this.reader.bytes(pos, 16);
      if (head.length < 8) break;
      let size = u32(head, 0);
      const type = fourcc(head, 4);
      // Not a box structure at all (a mislabelled file): give up at once.
      if (!/^[ -~]{4}$/.test(type)) return false;
      if (size === 1) size = u64(head, 8);
      else if (size === 0) size = this.reader.size - pos;
      if (size < 8) break;
      if (type === "moov") {
        if (size > 256 * 1024 * 1024) return false;
        moov = await this.reader.bytes(pos, size);
        break;
      }
      pos += size;
    }
    if (!moov) return false;
    const root: Box = { type: "moov", start: 8, end: moov.length };
    let index = 0;
    for (const box of boxes(moov, root.start, root.end)) {
      if (box.type !== "trak") continue;
      const track = parseTrack(moov, box, index);
      if (!track) continue;
      this.all.push(track);
      index += 1;
    }
    return this.all.length > 0;
  }

  async seek(seconds: number): Promise<void> {
    const target = seconds * 1e6;
    for (const track of this.all) {
      const times = track.table.times;
      let lo = 0;
      let hi = times.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (times[mid] <= target) lo = mid;
        else hi = mid - 1;
      }
      track.cursor = lo;
    }
  }

  async read(): Promise<AudioPacket[] | null> {
    const live = this.all.filter((t) => t.cursor < t.table.times.length);
    if (live.length === 0) return null;
    const horizon = Math.min(...live.map((t) => t.table.times[t.cursor])) + READ_SPAN_US;
    const out: AudioPacket[] = [];
    for (const track of live) {
      const { offsets, sizes, times } = track.table;
      while (track.cursor < times.length && times[track.cursor] < horizon) {
        // A run of samples lying back to back in the file is one read.
        let last = track.cursor;
        while (
          last + 1 < times.length &&
          times[last + 1] < horizon &&
          offsets[last + 1] === offsets[last] + sizes[last] &&
          offsets[last + 1] + sizes[last + 1] - offsets[track.cursor] < 1 << 20
        ) {
          last += 1;
        }
        const start = offsets[track.cursor];
        const bytes = await this.reader.bytes(start, offsets[last] + sizes[last] - start);
        for (let i = track.cursor; i <= last; i += 1) {
          const from = offsets[i] - start;
          out.push({ trackId: track.id, timestampUs: times[i], data: bytes.slice(from, from + sizes[i]) });
        }
        track.cursor = last + 1;
      }
    }
    out.sort((a, b) => a.timestampUs - b.timestampUs);
    return out;
  }
}

export async function openMp4(reader: BlobReader): Promise<AudioDemuxer | null> {
  const demuxer = new Mp4Demuxer(reader);
  return (await demuxer.open()) ? demuxer : null;
}

// Matroska / WebM, audio only. Enough of the format to list the audio tracks
// and walk their blocks in order: EBML headers, the segment's SeekHead, Info,
// Tracks and Cues, then Clusters with SimpleBlocks and BlockGroups, all three
// lacing schemes, and "header stripping" (the one content compression
// mkvmerge applies to audio by default in older versions).
//
// Video blocks are recognised by their track number from a few header bytes
// and skipped without being read, so walking a film costs its audio, not its
// picture — apart from the block cache pulling in neighbouring bytes.

import type { BlobReader } from "./blobReader";
import { fixedFrameSamples, matroskaAudioCodec } from "./codecs";
import type { AudioDemuxer, AudioPacket, AudioTrackInfo } from "./types";

const ID = {
  EBML: 0x1a45dfa3,
  DocType: 0x4282,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  FlagDefault: 0x88,
  DefaultDuration: 0x23e383,
  Name: 0x536e,
  Language: 0x22b59c,
  LanguageBCP47: 0x22b59d,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  OutputSamplingFrequency: 0x78b5,
  Channels: 0x9f,
  ContentEncodings: 0x6d80,
  ContentEncoding: 0x6240,
  ContentCompression: 0x5034,
  ContentCompAlgo: 0x4254,
  ContentCompSettings: 0x4255,
  ContentEncryption: 0x5035,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
} as const;

const TRACK_TYPE_AUDIO = 2;
// Packets per read(), and bytes walked per read(): enough to keep a decoder
// busy, small enough that a seek never waits long for a read to finish.
const PACKETS_PER_READ = 64;
const BYTES_PER_READ = 4 << 20;

// ─── EBML primitives ──────────────────────────────────────────────────────

function vintLength(first: number): number {
  for (let i = 0; i < 8; i += 1) if (first & (0x80 >> i)) return i + 1;
  return 0;
}

/** An element id, marker bits kept (that is how ids are written down). */
export function readId(buf: Uint8Array, pos: number): { id: number; length: number } | null {
  if (pos >= buf.length) return null;
  const length = vintLength(buf[pos]);
  if (length === 0 || length > 4 || pos + length > buf.length) return null;
  let id = 0;
  for (let i = 0; i < length; i += 1) id = id * 256 + buf[pos + i];
  return { id, length };
}

/** A size or other unsigned vint, marker bit removed; `unknown` when all ones. */
export function readVint(buf: Uint8Array, pos: number): { value: number; length: number; unknown: boolean } | null {
  if (pos >= buf.length) return null;
  const length = vintLength(buf[pos]);
  if (length === 0 || pos + length > buf.length) return null;
  const mask = 0xff >> length;
  let value = buf[pos] & mask;
  let allOnes = value === mask;
  for (let i = 1; i < length; i += 1) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

function readUint(buf: Uint8Array, start: number, end: number): number {
  let value = 0;
  for (let i = start; i < end; i += 1) value = value * 256 + buf[i];
  return value;
}

function readFloat(buf: Uint8Array, start: number, end: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset + start, end - start);
  if (end - start === 4) return view.getFloat32(0);
  if (end - start === 8) return view.getFloat64(0);
  return 0;
}

const utf8 = new TextDecoder();
function readString(buf: Uint8Array, start: number, end: number): string {
  let stop = end;
  while (stop > start && buf[stop - 1] === 0) stop -= 1;
  return utf8.decode(buf.subarray(start, stop));
}

type Child = { id: number; start: number; end: number };

function* children(buf: Uint8Array, start: number, end: number): Generator<Child> {
  let pos = start;
  while (pos < end) {
    const id = readId(buf, pos);
    if (!id) return;
    const size = readVint(buf, pos + id.length);
    if (!size) return;
    const dataStart = pos + id.length + size.length;
    const dataEnd = size.unknown ? end : Math.min(end, dataStart + size.value);
    yield { id: id.id, start: dataStart, end: dataEnd };
    pos = dataEnd;
  }
}

// ─── Lacing ───────────────────────────────────────────────────────────────

/**
 * The frames of one Block/SimpleBlock body, given where its frame data starts
 * (after track number, timecode and flags) and its flags byte.
 */
export function splitLacedFrames(body: Uint8Array, dataStart: number, flags: number): Uint8Array[] {
  const lacing = flags & 0x06;
  if (lacing === 0) return [body.subarray(dataStart)];
  if (dataStart >= body.length) return [];
  const count = body[dataStart] + 1;
  let pos = dataStart + 1;
  const sizes: number[] = [];
  if (lacing === 0x02) {
    // Xiph: each size a run of 255s plus one smaller byte.
    for (let i = 0; i < count - 1; i += 1) {
      let size = 0;
      while (pos < body.length) {
        const byte = body[pos];
        pos += 1;
        size += byte;
        if (byte !== 255) break;
      }
      sizes.push(size);
    }
  } else if (lacing === 0x06) {
    // EBML: first size as a vint, then signed differences.
    const first = readVint(body, pos);
    if (!first) return [];
    pos += first.length;
    sizes.push(first.value);
    let previous = first.value;
    for (let i = 1; i < count - 1; i += 1) {
      const diff = readVint(body, pos);
      if (!diff) return [];
      pos += diff.length;
      const bias = Math.pow(2, 7 * diff.length - 1) - 1;
      previous = previous + diff.value - bias;
      sizes.push(previous);
    }
  } else {
    // Fixed: all the same size.
    const each = Math.floor((body.length - pos) / count);
    for (let i = 0; i < count - 1; i += 1) sizes.push(each);
  }
  const frames: Uint8Array[] = [];
  for (const size of sizes) {
    if (size < 0 || pos + size > body.length) return frames;
    frames.push(body.subarray(pos, pos + size));
    pos += size;
  }
  frames.push(body.subarray(pos));
  return frames;
}

// ─── The demuxer ──────────────────────────────────────────────────────────

type Header = { id: number; dataStart: number; size: number; unknown: boolean };
type Cue = { time: number; pos: number };

class MatroskaDemuxer implements AudioDemuxer {
  tracks: AudioTrackInfo[] = [];
  private byNumber = new Map<number, AudioTrackInfo>();
  private timecodeScale = 1_000_000;
  private segmentStart = 0;
  private segmentEnd = 0;
  private firstCluster = -1;
  private cues: Cue[] = [];
  // Clusters found by hopping from one to the next, for files without Cues.
  private scanned: Cue[] = [];
  private pos = 0;
  private clusterTimecode = 0;

  private readonly reader: BlobReader;

  constructor(reader: BlobReader) {
    this.reader = reader;
  }

  private async headerAt(pos: number): Promise<Header | null> {
    const buf = await this.reader.bytes(pos, 12);
    const id = readId(buf, 0);
    if (!id) return null;
    const size = readVint(buf, id.length);
    if (!size) return null;
    return { id: id.id, dataStart: pos + id.length + size.length, size: size.value, unknown: size.unknown };
  }

  private async body(header: Header): Promise<Uint8Array> {
    return this.reader.bytes(header.dataStart, header.size);
  }

  async open(): Promise<boolean> {
    const ebml = await this.headerAt(0);
    if (!ebml || ebml.id !== ID.EBML || ebml.unknown) return false;
    const ebmlBody = await this.body(ebml);
    let docType = "matroska";
    for (const child of children(ebmlBody, 0, ebmlBody.length)) {
      if (child.id === ID.DocType) docType = readString(ebmlBody, child.start, child.end);
    }
    if (docType !== "matroska" && docType !== "webm") return false;

    const segment = await this.headerAt(ebml.dataStart + ebml.size);
    if (!segment || segment.id !== ID.Segment) return false;
    this.segmentStart = segment.dataStart;
    this.segmentEnd = segment.unknown
      ? this.reader.size
      : Math.min(this.reader.size, segment.dataStart + segment.size);

    const seekTargets = new Map<number, number>();
    let haveInfo = false;
    let haveTracks = false;
    let haveCues = false;
    let pos = this.segmentStart;
    // The level-1 elements before the first cluster. Bounded, in case a file
    // puts something unusual there.
    for (let steps = 0; steps < 256 && pos < this.segmentEnd; steps += 1) {
      const header = await this.headerAt(pos);
      if (!header) break;
      if (header.id === ID.Cluster) {
        this.firstCluster = pos;
        break;
      }
      if (header.unknown) break;
      if (header.id === ID.SeekHead) this.parseSeekHead(await this.body(header), seekTargets);
      else if (header.id === ID.Info) {
        this.parseInfo(await this.body(header));
        haveInfo = true;
      } else if (header.id === ID.Tracks) {
        this.parseTracks(await this.body(header));
        haveTracks = true;
      } else if (header.id === ID.Cues) {
        this.parseCues(await this.body(header));
        haveCues = true;
      }
      pos = header.dataStart + header.size;
    }

    // Whatever was not up front, wherever the SeekHead says it is — Cues in
    // particular are usually written at the end, after every cluster.
    const fetch = async (id: number) => {
      const at = seekTargets.get(id);
      if (at === undefined) return null;
      const header = await this.headerAt(this.segmentStart + at);
      if (!header || header.id !== id || header.unknown) return null;
      return this.body(header);
    };
    if (!haveInfo) {
      const info = await fetch(ID.Info);
      if (info) this.parseInfo(info);
    }
    if (!haveTracks) {
      const tracks = await fetch(ID.Tracks);
      if (tracks) this.parseTracks(tracks);
    }
    if (!haveCues) {
      const cues = await fetch(ID.Cues).catch(() => null);
      if (cues) this.parseCues(cues);
    }
    if (this.firstCluster < 0) return false;
    this.pos = this.firstCluster;
    return true;
  }

  private parseSeekHead(buf: Uint8Array, into: Map<number, number>) {
    for (const seek of children(buf, 0, buf.length)) {
      if (seek.id !== ID.Seek) continue;
      let target = 0;
      let position = -1;
      for (const field of children(buf, seek.start, seek.end)) {
        if (field.id === ID.SeekID) target = readUint(buf, field.start, field.end);
        else if (field.id === ID.SeekPosition) position = readUint(buf, field.start, field.end);
      }
      if (target && position >= 0 && !into.has(target)) into.set(target, position);
    }
  }

  private parseInfo(buf: Uint8Array) {
    for (const field of children(buf, 0, buf.length)) {
      if (field.id === ID.TimecodeScale) this.timecodeScale = readUint(buf, field.start, field.end) || 1_000_000;
    }
  }

  private parseTracks(buf: Uint8Array) {
    for (const entry of children(buf, 0, buf.length)) {
      if (entry.id !== ID.TrackEntry) continue;
      let number = 0;
      let type = 0;
      let codecId = "";
      let codecPrivate: Uint8Array | undefined;
      let language: string | null = null;
      let bcp47: string | null = null;
      let name: string | null = null;
      let isDefault = true;
      let defaultDurationNs = 0;
      let samplingFrequency = 8000;
      let outputFrequency = 0;
      let channels = 1;
      let headerStrip: Uint8Array | undefined;
      let unreadable = false;
      for (const field of children(buf, entry.start, entry.end)) {
        switch (field.id) {
          case ID.TrackNumber:
            number = readUint(buf, field.start, field.end);
            break;
          case ID.TrackType:
            type = readUint(buf, field.start, field.end);
            break;
          case ID.CodecID:
            codecId = readString(buf, field.start, field.end);
            break;
          case ID.CodecPrivate:
            codecPrivate = buf.slice(field.start, field.end);
            break;
          case ID.Language:
            language = readString(buf, field.start, field.end);
            break;
          case ID.LanguageBCP47:
            bcp47 = readString(buf, field.start, field.end);
            break;
          case ID.Name:
            name = readString(buf, field.start, field.end) || null;
            break;
          case ID.FlagDefault:
            isDefault = readUint(buf, field.start, field.end) !== 0;
            break;
          case ID.DefaultDuration:
            defaultDurationNs = readUint(buf, field.start, field.end);
            break;
          case ID.Audio:
            for (const audio of children(buf, field.start, field.end)) {
              if (audio.id === ID.SamplingFrequency) samplingFrequency = readFloat(buf, audio.start, audio.end);
              else if (audio.id === ID.OutputSamplingFrequency) outputFrequency = readFloat(buf, audio.start, audio.end);
              else if (audio.id === ID.Channels) channels = readUint(buf, audio.start, audio.end);
            }
            break;
          case ID.ContentEncodings:
            for (const encoding of children(buf, field.start, field.end)) {
              if (encoding.id !== ID.ContentEncoding) continue;
              for (const part of children(buf, encoding.start, encoding.end)) {
                if (part.id === ID.ContentEncryption) unreadable = true;
                if (part.id !== ID.ContentCompression) continue;
                let algorithm = 0;
                let settings: Uint8Array | undefined;
                for (const setting of children(buf, part.start, part.end)) {
                  if (setting.id === ID.ContentCompAlgo) algorithm = readUint(buf, setting.start, setting.end);
                  else if (setting.id === ID.ContentCompSettings) settings = buf.slice(setting.start, setting.end);
                }
                if (algorithm === 3 && settings) headerStrip = settings;
                else unreadable = true;
              }
            }
            break;
        }
      }
      if (type !== TRACK_TYPE_AUDIO || !number) continue;
      const sampleRate = Math.round(outputFrequency || samplingFrequency);
      const mapped = matroskaAudioCodec(codecId, codecPrivate, sampleRate, channels);
      const frameSamples = fixedFrameSamples(mapped.codec);
      const lang = bcp47 || language;
      const track: AudioTrackInfo = {
        id: number,
        index: this.tracks.length,
        codecId,
        codec: mapped.codec,
        description: mapped.description,
        sampleRate,
        channels,
        language: lang && lang !== "und" ? lang : null,
        name,
        isDefault,
        frameDurationUs: defaultDurationNs
          ? defaultDurationNs / 1000
          : frameSamples && sampleRate
            ? (frameSamples / sampleRate) * 1e6
            : null,
        headerStrip,
        unreadable,
      };
      this.tracks.push(track);
      this.byNumber.set(number, track);
    }
  }

  private parseCues(buf: Uint8Array) {
    const cues: Cue[] = [];
    for (const point of children(buf, 0, buf.length)) {
      if (point.id !== ID.CuePoint) continue;
      let time = -1;
      let position = -1;
      for (const field of children(buf, point.start, point.end)) {
        if (field.id === ID.CueTime) time = readUint(buf, field.start, field.end);
        else if (field.id === ID.CueTrackPositions && position < 0) {
          for (const inner of children(buf, field.start, field.end)) {
            if (inner.id === ID.CueClusterPosition) position = readUint(buf, inner.start, inner.end);
          }
        }
      }
      if (time >= 0 && position >= 0) cues.push({ time, pos: this.segmentStart + position });
    }
    cues.sort((a, b) => a.time - b.time);
    this.cues = cues;
  }

  async seek(seconds: number): Promise<void> {
    const target = (seconds * 1e9) / this.timecodeScale;
    let index: Cue[] = this.cues;
    if (index.length === 0) {
      await this.scanClustersUpTo(target);
      index = this.scanned;
    }
    let chosen = this.firstCluster;
    for (const cue of index) {
      if (cue.time > target) break;
      chosen = cue.pos;
    }
    this.pos = chosen;
    this.clusterTimecode = 0;
  }

  // Without Cues: hop cluster to cluster by their sizes, reading only each
  // one's header and timecode. Remembered, so a later seek continues from the
  // furthest cluster found. A cluster of unknown size cannot be hopped over,
  // which ends the scan there.
  private async scanClustersUpTo(target: number) {
    let pos = this.scanned.length > 0 ? this.scanned[this.scanned.length - 1].pos : this.firstCluster;
    if (this.scanned.length > 0 && this.scanned[this.scanned.length - 1].time > target) return;
    for (let steps = 0; steps < 50_000 && pos < this.segmentEnd; steps += 1) {
      const header = await this.headerAt(pos);
      if (!header || header.id !== ID.Cluster) return;
      if (this.scanned.length === 0 || this.scanned[this.scanned.length - 1].pos < pos) {
        const first = await this.headerAt(header.dataStart);
        if (first && first.id === ID.Timecode) {
          const value = await this.reader.bytes(first.dataStart, first.size);
          const time = readUint(value, 0, value.length);
          this.scanned.push({ time, pos });
          if (time > target) return;
        }
      }
      if (header.unknown) return;
      pos = header.dataStart + header.size;
    }
  }

  async read(): Promise<AudioPacket[] | null> {
    const out: AudioPacket[] = [];
    let walked = 0;
    while (out.length < PACKETS_PER_READ && walked < BYTES_PER_READ) {
      if (this.pos >= this.segmentEnd) break;
      const header = await this.headerAt(this.pos);
      if (!header) {
        this.pos = this.segmentEnd;
        break;
      }
      if (header.id === ID.Cluster) {
        // Into the cluster: its children follow.
        this.clusterTimecode = 0;
        this.pos = header.dataStart;
        continue;
      }
      if (header.unknown) {
        // Nothing else of unknown size can be stepped over.
        this.pos = this.segmentEnd;
        break;
      }
      const end = header.dataStart + header.size;
      if (header.id === ID.Timecode) {
        const value = await this.body(header);
        this.clusterTimecode = readUint(value, 0, value.length);
      } else if (header.id === ID.SimpleBlock) {
        walked += header.size;
        await this.readBlock(header.dataStart, header.size, out);
      } else if (header.id === ID.BlockGroup) {
        walked += header.size;
        let child = header.dataStart;
        while (child < end) {
          const inner = await this.headerAt(child);
          if (!inner || inner.unknown) break;
          if (inner.id === ID.Block) {
            await this.readBlock(inner.dataStart, inner.size, out);
            break;
          }
          child = inner.dataStart + inner.size;
        }
      }
      this.pos = end;
    }
    if (out.length === 0 && this.pos >= this.segmentEnd) return null;
    return out;
  }

  private async readBlock(start: number, size: number, out: AudioPacket[]) {
    // The track number first, from a few bytes: a video block is skipped
    // without reading the frame behind it.
    const head = await this.reader.bytes(start, Math.min(size, 12));
    const trackVint = readVint(head, 0);
    if (!trackVint) return;
    const track = this.byNumber.get(trackVint.value);
    if (!track || track.unreadable) return;
    const body = await this.reader.bytes(start, size);
    const at = trackVint.length;
    if (at + 3 > body.length) return;
    let relative = (body[at] << 8) | body[at + 1];
    if (relative >= 0x8000) relative -= 0x10000;
    const flags = body[at + 2];
    const frames = splitLacedFrames(body, at + 3, flags);
    const baseUs = ((this.clusterTimecode + relative) * this.timecodeScale) / 1000;
    const step = track.frameDurationUs ?? 0;
    frames.forEach((frame, i) => {
      let data = frame;
      if (track.headerStrip) {
        data = new Uint8Array(track.headerStrip.length + frame.length);
        data.set(track.headerStrip, 0);
        data.set(frame, track.headerStrip.length);
      } else {
        // Its own copy: the frame is a view into a cached block.
        data = frame.slice();
      }
      out.push({ trackId: track.id, timestampUs: baseUs + i * step, data });
    });
  }
}

export async function openMatroska(reader: BlobReader): Promise<AudioDemuxer | null> {
  const demuxer = new MatroskaDemuxer(reader);
  return (await demuxer.open()) ? demuxer : null;
}

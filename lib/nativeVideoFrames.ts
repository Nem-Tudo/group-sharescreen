// The byte-level half of native screen capture, with nothing platform-specific
// in it: the records golive-videocap writes (read by the desktop shell, see
// electron/nativeVideo.ts) and the H.264 details the page needs (see
// lib/nativeVideoCapture.ts). Kept apart so both sides share one definition
// and the tests can reach it without Electron or a browser.

/** Must agree with WriteFrame in electron/native/src/videocap.cpp. */
export const FRAME_HEADER_BYTES = 24;
const FRAME_MAGIC = 0x46564c47; // "GLVF", little-endian
// Far past any real frame (an IDR at 4K and 100 Mbit/s is a few megabytes).
// A length beyond it means the stream is out of step, not that a frame is big.
const MAX_FRAME_BYTES = 32 * 1024 * 1024;

export interface NativeFrameMeta {
  key: boolean;
  sequence: number;
  width: number;
  height: number;
  /** Capture time, milliseconds since the helper started. */
  timeMs: number;
}

export interface NativeFrame extends NativeFrameMeta {
  data: Uint8Array;
}

/**
 * Cuts the helper's stdout into frames. Chunks arrive however the pipe
 * splits them; `push` takes each one and returns the frames it completed.
 * Throws when the stream is not what the helper writes, which only a
 * mismatched binary can cause — the caller ends the capture.
 */
export class NativeFrameReader {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): NativeFrame[] {
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer, 0);
    joined.set(chunk, this.buffer.length);
    const frames: NativeFrame[] = [];
    let offset = 0;
    const view = new DataView(joined.buffer, joined.byteOffset, joined.byteLength);
    while (joined.length - offset >= FRAME_HEADER_BYTES) {
      if (view.getUint32(offset, true) !== FRAME_MAGIC) throw new Error("native video: bad frame header");
      const length = view.getUint32(offset + 4, true);
      if (length > MAX_FRAME_BYTES) throw new Error("native video: frame too large");
      if (joined.length - offset - FRAME_HEADER_BYTES < length) break;
      const start = offset + FRAME_HEADER_BYTES;
      frames.push({
        key: (view.getUint32(offset + 8, true) & 1) === 1,
        sequence: view.getUint32(offset + 12, true),
        width: view.getUint16(offset + 16, true),
        height: view.getUint16(offset + 18, true),
        timeMs: view.getUint32(offset + 20, true),
        // A copy, so the frame does not pin the whole joined buffer.
        data: joined.slice(start, start + length),
      });
      offset = start + length;
    }
    this.buffer = joined.slice(offset);
    return frames;
  }
}

// ---------------------------------------------------------------------------
// Annex B

interface NalUnit {
  /** Where its start code begins. */
  start: number;
  end: number;
  type: number;
}

export function splitNalUnits(data: Uint8Array): NalUnit[] {
  const units: NalUnit[] = [];
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 1) continue;
    const start = i > 0 && data[i - 1] === 0 ? i - 1 : i;
    if (units.length > 0) units[units.length - 1].end = start;
    const header = i + 3;
    units.push({ start, end: data.length, type: header < data.length ? data[header] & 0x1f : 0 });
    i = header - 1;
  }
  return units;
}

const NAL_IDR = 5;
const NAL_SPS = 7;
const NAL_PPS = 8;
const NAL_AUD = 9;

/**
 * Makes every IDR carry its SPS and PPS, remembering the last ones seen.
 *
 * A receiver cannot start decoding at an IDR whose parameter sets it has not
 * been sent, and encoders put them only on the first. The helper already does
 * this; the page does it again because the cost is nothing and a viewer who
 * joins mid-share depends on it entirely.
 */
export class ParameterSetKeeper {
  private sps: Uint8Array | null = null;
  private pps: Uint8Array | null = null;

  /** The SPS bytes after the NAL header, for codecStringFromSps. */
  get spsPayload(): Uint8Array | null {
    if (!this.sps) return null;
    // Past the start code and the one-byte NAL header.
    const offset = (this.sps[2] === 1 ? 3 : 4) + 1;
    return this.sps.subarray(offset);
  }

  process(data: Uint8Array): { data: Uint8Array; idr: boolean } {
    const units = splitNalUnits(data);
    let idr = false;
    let hasSps = false;
    let hasPps = false;
    for (const unit of units) {
      if (unit.type === NAL_IDR) idr = true;
      if (unit.type === NAL_SPS) {
        this.sps = data.slice(unit.start, unit.end);
        hasSps = true;
      }
      if (unit.type === NAL_PPS) {
        this.pps = data.slice(unit.start, unit.end);
        hasPps = true;
      }
    }
    if (!idr || (hasSps && hasPps) || !this.sps || !this.pps) return { data, idr };
    let at = 0;
    for (const unit of units) {
      if (unit.type !== NAL_AUD) break;
      at = unit.end;
    }
    const out = new Uint8Array(data.length + this.sps.length + this.pps.length);
    out.set(data.subarray(0, at), 0);
    out.set(this.sps, at);
    out.set(this.pps, at + this.sps.length);
    out.set(data.subarray(at), at + this.sps.length + this.pps.length);
    return { data: out, idr };
  }
}

/**
 * The WebCodecs codec string ("avc1.PPCCLL") for an SPS, given the bytes
 * after its NAL header: profile_idc, the constraint flags, level_idc.
 */
export function codecStringFromSps(sps: Uint8Array | null): string {
  if (!sps || sps.length < 3) return "avc1.42e01f";
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `avc1.${hex(sps[0])}${hex(sps[1])}${hex(sps[2])}`;
}

// ---------------------------------------------------------------------------
// Bitrate

/**
 * What to ask the encoder for: the share's ceiling, lowered to what the
 * weakest direct link can carry. One stream goes to everyone, so the slowest
 * connection sets the pace — the same trade Discord's single stream makes.
 * `available` holds each link's estimate in kbps (null while unknown).
 */
export function nativeTargetKbps(ceilingKbps: number, available: Array<number | null>): number {
  const MIN_KBPS = 300;
  // Headroom under the estimate for audio, retransmissions and the estimate
  // being optimistic, which it is while it probes upward.
  const HEADROOM = 0.85;
  let target = ceilingKbps;
  for (const kbps of available) {
    if (kbps === null || !Number.isFinite(kbps) || kbps <= 0) continue;
    target = Math.min(target, kbps * HEADROOM);
  }
  return Math.max(MIN_KBPS, Math.round(target));
}

/**
 * Whether a new target is worth sending to the helper, and what to remember
 * as the current rate.
 *
 * It is worth sending far less often than it is worth measuring. Changing the
 * bitrate of a live hardware encoder is not a number being written down: the
 * driver reconfigures its rate controller, most of them restart it with a
 * fresh IDR, and the call sits inside the driver while it happens. Doing that
 * on every sample — which is what an 8% threshold against a raw
 * `availableOutgoingBitrate` amounted to, since the bandwidth estimator swings
 * by more than that on most ticks as it probes — put a stall on the stream
 * every two seconds, which is exactly what it looked like.
 *
 * So: down straight away, because a link that got worse is a fact and waiting
 * costs frames; up slowly and only once in a while, because a link that looks
 * better is a guess, and a wrong guess is paid for twice (once in congestion,
 * once in the reconfigure that corrects it).
 */
export function nativeBitrateCommand(
  currentKbps: number,
  targetKbps: number,
  msSinceRaise: number
): number | null {
  const DROP_MARGIN = 0.1;
  const RISE_MARGIN = 0.2;
  const RISE_GAP_MS = 8000;
  if (currentKbps <= 0) return targetKbps;
  const change = (targetKbps - currentKbps) / currentKbps;
  if (change <= -DROP_MARGIN) return targetKbps;
  if (change >= RISE_MARGIN && msSinceRaise >= RISE_GAP_MS) return targetKbps;
  return null;
}

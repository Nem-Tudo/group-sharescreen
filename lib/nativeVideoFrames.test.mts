// node --experimental-strip-types lib/nativeVideoFrames.test.mts
//
// The records golive-videocap writes, and the H.264 fix-ups the page relies
// on. The helper cannot be run here (it needs Windows and a GPU encoder), so
// its side of the format is pinned by building records by hand, byte for
// byte as WriteFrame in electron/native/src/videocap.cpp lays them out.
import assert from "node:assert/strict";
import test from "node:test";
import {
  FRAME_HEADER_BYTES,
  NativeFrameReader,
  ParameterSetKeeper,
  codecStringFromSps,
  nativeTargetKbps,
  splitNalUnits,
} from "./nativeVideoFrames";

function record(payload: number[], opts: { key?: boolean; sequence?: number; width?: number; height?: number; timeMs?: number } = {}) {
  const bytes = new Uint8Array(FRAME_HEADER_BYTES + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46564c47, true);
  view.setUint32(4, payload.length, true);
  view.setUint32(8, opts.key ? 1 : 0, true);
  view.setUint32(12, opts.sequence ?? 0, true);
  view.setUint16(16, opts.width ?? 1920, true);
  view.setUint16(18, opts.height ?? 1080, true);
  view.setUint32(20, opts.timeMs ?? 0, true);
  bytes.set(payload, FRAME_HEADER_BYTES);
  return bytes;
}

test("the magic is the ASCII the helper writes", () => {
  const bytes = record([]);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), "GLVF");
});

test("frames split across chunks come out whole and in order", () => {
  const a = record([1, 2, 3], { key: true, sequence: 7, width: 1280, height: 720, timeMs: 99 });
  const b = record([4, 5], { sequence: 8 });
  const stream = new Uint8Array([...a, ...b]);
  const reader = new NativeFrameReader();
  const out = [];
  // One byte at a time: the worst a pipe can do.
  for (const byte of stream) out.push(...reader.push(new Uint8Array([byte])));
  assert.equal(out.length, 2);
  assert.deepEqual(
    { key: out[0].key, sequence: out[0].sequence, width: out[0].width, height: out[0].height, timeMs: out[0].timeMs },
    { key: true, sequence: 7, width: 1280, height: 720, timeMs: 99 }
  );
  assert.deepEqual([...out[0].data], [1, 2, 3]);
  assert.equal(out[1].key, false);
  assert.deepEqual([...out[1].data], [4, 5]);
});

test("several frames in one chunk", () => {
  const reader = new NativeFrameReader();
  const out = reader.push(new Uint8Array([...record([1]), ...record([2]), ...record([3]).subarray(0, 10)]));
  assert.equal(out.length, 2);
  assert.deepEqual(reader.push(record([3]).subarray(10)).map((f) => [...f.data]), [[3]]);
});

test("a stream out of step is refused rather than misread", () => {
  const reader = new NativeFrameReader();
  const bad = record([1]);
  bad[0] = 0;
  assert.throws(() => reader.push(bad));
});

const SPS = [0, 0, 0, 1, 0x67, 0x42, 0xe0, 0x1f, 0xaa];
const PPS = [0, 0, 0, 1, 0x68, 0xce, 0x38];
const AUD = [0, 0, 0, 1, 0x09, 0xf0];
const IDR = [0, 0, 1, 0x65, 0x88, 0x84];
const SLICE = [0, 0, 1, 0x41, 0x9a, 0x02];

test("NAL units are found with three- and four-byte start codes", () => {
  const data = new Uint8Array([...AUD, ...SPS, ...IDR]);
  assert.deepEqual(
    splitNalUnits(data).map((u) => u.type),
    [9, 7, 5]
  );
  const units = splitNalUnits(data);
  assert.equal(units[0].start, 0);
  assert.equal(units[1].start, AUD.length);
  assert.equal(units[2].end, data.length);
});

test("a later IDR gets the parameter sets of the first, after its delimiter", () => {
  const keeper = new ParameterSetKeeper();
  const first = keeper.process(new Uint8Array([...AUD, ...SPS, ...PPS, ...IDR]));
  assert.equal(first.idr, true);
  assert.equal(first.data.length, AUD.length + SPS.length + PPS.length + IDR.length);

  const delta = keeper.process(new Uint8Array([...AUD, ...SLICE]));
  assert.equal(delta.idr, false);
  assert.deepEqual([...delta.data], [...AUD, ...SLICE]);

  const later = keeper.process(new Uint8Array([...AUD, ...IDR]));
  assert.equal(later.idr, true);
  assert.deepEqual([...later.data], [...AUD, ...SPS, ...PPS, ...IDR]);
});

test("an IDR before any parameter sets is left alone", () => {
  const keeper = new ParameterSetKeeper();
  const out = keeper.process(new Uint8Array(IDR));
  assert.deepEqual([...out.data], IDR);
});

test("the codec string comes from the SPS", () => {
  const keeper = new ParameterSetKeeper();
  keeper.process(new Uint8Array([...SPS, ...PPS, ...IDR]));
  assert.equal(codecStringFromSps(keeper.spsPayload), "avc1.42e01f");
  assert.equal(codecStringFromSps(new Uint8Array([0x64, 0x00, 0x28])), "avc1.640028");
  assert.equal(codecStringFromSps(null), "avc1.42e01f");
});

test("the target follows the weakest known link, within bounds", () => {
  assert.equal(nativeTargetKbps(8000, []), 8000);
  assert.equal(nativeTargetKbps(8000, [null, 20000]), 8000);
  assert.equal(nativeTargetKbps(8000, [4000, 20000]), 3400);
  assert.equal(nativeTargetKbps(8000, [100]), 300);
  assert.equal(nativeTargetKbps(8000, [Number.NaN, 0]), 8000);
});

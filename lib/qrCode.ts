// A QR code encoder, small on purpose: byte mode, error correction level M,
// versions 1 to 15 — a link of up to ~410 bytes, far more than any link this
// site puts in one. Written here rather than pulled in as a package because
// it is one screen of code and one caller (the phone-camera QR, see
// components/PhoneCameraPanel).
//
// Follows ISO/IEC 18004: data codewords, Reed-Solomon over GF(256) with
// 0x11D, interleaved blocks, function patterns, and the mask with the lowest
// penalty. Returns the module grid; drawing it is the caller's.

// Per version, level M: [ecc codewords per block, blocks in group 1, data
// codewords per group-1 block, blocks in group 2] (group 2 blocks carry one
// data codeword more).
const BLOCKS_M: [number, number, number, number][] = [
  [10, 1, 16, 0],
  [16, 1, 28, 0],
  [26, 1, 44, 0],
  [18, 2, 32, 0],
  [24, 2, 43, 0],
  [16, 4, 27, 0],
  [18, 4, 31, 0],
  [22, 2, 38, 2],
  [22, 3, 36, 2],
  [26, 4, 43, 1],
  [30, 1, 50, 4],
  [22, 6, 36, 2],
  [22, 8, 37, 1],
  [24, 4, 40, 5],
  [24, 5, 41, 5],
];

const ALIGNMENT: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
];

// ── GF(256) and Reed-Solomon ───────────────────────────────────────────────

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree: number): number[] {
  // Coefficients highest power first, leading 1 implied.
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly.slice(1);
}

function rsRemainder(data: number[], generator: number[]): number[] {
  const result = new Array(generator.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < generator.length; i++) result[i] ^= mul(generator[i], factor);
  }
  return result;
}

// ── Codewords ──────────────────────────────────────────────────────────────

function dataCapacity(version: number): number {
  const [, g1, d1, g2] = BLOCKS_M[version - 1];
  return g1 * d1 + g2 * (d1 + 1);
}

function encodeCodewords(bytes: Uint8Array, version: number): number[] {
  const capacity = dataCapacity(version);
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  const [ecc, g1, d1, g2] = BLOCKS_M[version - 1];
  const generator = rsGenerator(ecc);
  const blocks: number[][] = [];
  const eccBlocks: number[][] = [];
  let offset = 0;
  for (let b = 0; b < g1 + g2; b++) {
    const size = b < g1 ? d1 : d1 + 1;
    const block = data.slice(offset, offset + size);
    offset += size;
    blocks.push(block);
    eccBlocks.push(rsRemainder(block, generator));
  }
  const out: number[] = [];
  for (let i = 0; i <= d1; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecc; i++) {
    for (const block of eccBlocks) out.push(block[i]);
  }
  return out;
}

// ── Matrix ─────────────────────────────────────────────────────────────────

/** The modules, row by row: true is dark. */
export type QrMatrix = boolean[][];

function bchFormat(mask: number): number {
  // Level M is 0b00.
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function bchVersion(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function build(version: number, codewords: number[], mask: number): QrMatrix {
  const size = version * 4 + 17;
  const grid: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const setF = (x: number, y: number, dark: boolean) => {
    grid[y][x] = dark;
    reserved[y][x] = true;
  };

  // Finders and their separators.
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        setF(x, y, d !== 2 && d !== 4);
      }
    }
  }
  // Timing.
  for (let i = 8; i < size - 8; i++) {
    setF(6, i, i % 2 === 0);
    setF(i, 6, i % 2 === 0);
  }
  // Alignment.
  const centers = ALIGNMENT[version - 1];
  for (const cy of centers) {
    for (const cx of centers) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setF(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  // Format info (both copies) and the dark module.
  const format = bchFormat(mask);
  for (let i = 0; i <= 5; i++) setF(8, i, ((format >>> i) & 1) === 1);
  setF(8, 7, ((format >>> 6) & 1) === 1);
  setF(8, 8, ((format >>> 7) & 1) === 1);
  setF(7, 8, ((format >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) setF(14 - i, 8, ((format >>> i) & 1) === 1);
  for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, ((format >>> i) & 1) === 1);
  for (let i = 8; i < 15; i++) setF(8, size - 15 + i, ((format >>> i) & 1) === 1);
  setF(8, size - 8, true);
  // Version info.
  if (version >= 7) {
    const info = bchVersion(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((info >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setF(a, b, bit);
      setF(b, a, bit);
    }
  }

  // Data, in the zigzag, masked.
  const apply = MASKS[mask];
  let bit = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y][x]) continue;
        let dark = false;
        if (bit < total) dark = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
        bit++;
        grid[y][x] = apply(x, y) ? !dark : dark;
      }
    }
  }
  return grid;
}

function penalty(grid: QrMatrix): number {
  const size = grid.length;
  let score = 0;
  const lines = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < size; i++) {
      let run = 1;
      for (let j = 1; j <= size; j++) {
        if (j < size && get(i, j) === get(i, j - 1)) {
          run++;
          continue;
        }
        if (run >= 5) score += run - 2;
        run = 1;
      }
      // Finder-like 1:1:3:1:1 with four light modules on a side.
      for (let j = 0; j + 10 < size; j++) {
        const p = [true, false, true, true, true, false, true];
        let match = true;
        for (let k = 0; k < 7; k++) if (get(i, j + k) !== p[k]) match = false;
        if (!match) continue;
        const before = j >= 4 && [1, 2, 3, 4].every((k) => !get(i, j - k));
        const after = j + 10 < size && [7, 8, 9, 10].every((k) => !get(i, j + k));
        if (before || after) score += 40;
      }
    }
  };
  lines((i, j) => grid[i][j]);
  lines((i, j) => grid[j][i]);
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y][x]) dark++;
      if (x + 1 < size && y + 1 < size) {
        const c = grid[y][x];
        if (grid[y][x + 1] === c && grid[y + 1][x] === c && grid[y + 1][x + 1] === c) score += 3;
      }
    }
  }
  score += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
  return score;
}

/** The QR code for `text`, or null when it does not fit in version 15. */
export function encodeQr(text: string): QrMatrix | null {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  // Mode (4 bits) + length + the bytes, in whole codewords.
  while (version <= BLOCKS_M.length && Math.ceil((4 + (version < 10 ? 8 : 16) + bytes.length * 8) / 8) > dataCapacity(version)) {
    version++;
  }
  if (version > BLOCKS_M.length) return null;
  const codewords = encodeCodewords(bytes, version);
  let best: QrMatrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const grid = build(version, codewords, mask);
    const score = penalty(grid);
    if (score < bestScore) {
      best = grid;
      bestScore = score;
    }
  }
  return best;
}

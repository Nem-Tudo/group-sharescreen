// node --experimental-strip-types lib/headerFit.test.mts
//
// The group bar's stepping (see headerFit.ts). What matters is that it steps
// down as soon as something overflows, comes back up only once there is truly
// room, and never flicks between two steps while the window sits still.

import assert from "node:assert/strict";
import { nextHeaderFit, type FitMemory, type HeaderFit } from "./headerFit";

const fresh: FitMemory = { full: 0, compact: 0 };

// A bar that fits stays at full size.
assert.deepEqual(nextHeaderFit(0, { width: 1600, needed: 1500 }, fresh), { fit: 0, memory: fresh });

// Overflowing at full size drops the labels, and remembers what full size needed.
let r = nextHeaderFit(0, { width: 1400, needed: 1520 }, fresh);
assert.equal(r.fit, 1);
assert.equal(r.memory.full, 1520);

// Compact now measures narrower and fits: it stays compact, since the window
// is still narrower than full size needs. This is the no-flicker case.
r = nextHeaderFit(r.fit, { width: 1400, needed: 1300 }, r.memory);
assert.equal(r.fit, 1, "sem espaço para os rótulos, continua compacto");
r = nextHeaderFit(r.fit, { width: 1400, needed: 1300 }, r.memory);
assert.equal(r.fit, 1, "e continua, sem piscar, enquanto a janela não muda");

// Widened to exactly what full size needed: back to full size.
r = nextHeaderFit(r.fit, { width: 1520, needed: 1300 }, r.memory);
assert.equal(r.fit, 0);

// Narrow enough that even compact overflows: the controls get a line of their own.
let m: FitMemory = { full: 1520, compact: 0 };
r = nextHeaderFit(1, { width: 1050, needed: 1180 }, m);
assert.equal(r.fit, 2);
assert.equal(r.memory.compact, 1180);

// On two lines it stays put until the window can hold compact on one.
r = nextHeaderFit(r.fit, { width: 1100, needed: 900 }, r.memory);
assert.equal(r.fit, 2);
r = nextHeaderFit(r.fit, { width: 1180, needed: 900 }, r.memory);
assert.equal(r.fit, 1);

// A subpixel over is not an overflow.
assert.equal(nextHeaderFit(0, { width: 1400, needed: 1400.6 }, fresh).fit, 0);

// Walking the window down and back up one pixel at a time never oscillates:
// each width gets one answer, however many times it is measured. The "needed"
// at each step is what that step's content asks for.
function neededAt(fit: HeaderFit): number {
  return fit === 0 ? 1520 : fit === 1 ? 1180 : 800;
}
let fit: HeaderFit = 0;
m = fresh;
const answers = new Map<number, HeaderFit>();
for (const width of [...Array.from({ length: 700 }, (_, i) => 1700 - i), ...Array.from({ length: 700 }, (_, i) => 1001 + i)]) {
  // Measured until it settles, as the observer would after each re-render.
  for (let i = 0; i < 4; i += 1) {
    const step = nextHeaderFit(fit, { width, needed: neededAt(fit) }, m);
    fit = step.fit;
    m = step.memory;
  }
  const settled: HeaderFit = fit;
  const again = nextHeaderFit(fit, { width, needed: neededAt(fit) }, m);
  assert.equal(again.fit, settled, `oscilou em ${width}px`);
  // And whatever it settled on actually fits, whenever anything can.
  if (width >= 800) assert.ok(neededAt(settled) <= width + 1, `em ${width}px ficou no passo ${settled}, que não cabe`);
  answers.set(width, settled);
}
assert.equal(answers.get(1600), 0);
assert.equal(answers.get(1300), 1);
assert.equal(answers.get(1100), 2);

console.log("headerFit: ok");

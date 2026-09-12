// node --experimental-strip-types lib/useWindowedList.test.mts
//
// Pins the index arithmetic behind the windowed lists. The property that
// matters most is not which rows are picked but that the spacers always add
// up: if topPad + rendered + bottomPad ever drifts from the real total, the
// scrollbar lies and the list jumps under the cursor while being scrolled.

import assert from "node:assert/strict";
import { planWindow } from "./useWindowedList";

const H = 40;

// --- the small case is left completely alone -----------------------------

// Below the threshold nothing is windowed, so a room of twelve renders
// exactly the DOM it always did.
const small = planWindow({ count: 12, rowHeight: H, scrollTop: 0, viewportHeight: 400 });
assert.equal(small.windowed, false);
assert.deepEqual([small.start, small.end], [0, 12]);
assert.deepEqual([small.topPad, small.bottomPad], [0, 0]);

// Exactly at the threshold is still the whole list.
const atThreshold = planWindow({
  count: 60,
  rowHeight: H,
  scrollTop: 0,
  viewportHeight: 400,
});
assert.equal(atThreshold.windowed, false);
assert.equal(atThreshold.end, 60);

// An empty list is not a special case anybody should have to handle.
const empty = planWindow({ count: 0, rowHeight: H, scrollTop: 0, viewportHeight: 400 });
assert.deepEqual([empty.start, empty.end, empty.topPad, empty.bottomPad], [0, 0, 0, 0]);

// --- uniform rows ---------------------------------------------------------

const COUNT = 600;
const TOTAL = COUNT * H;

function check(plan: ReturnType<typeof planWindow>, label: string) {
  assert.ok(plan.start >= 0, `${label}: start negativo`);
  assert.ok(plan.end <= COUNT, `${label}: end passou do fim`);
  assert.ok(plan.start <= plan.end, `${label}: intervalo invertido`);
  assert.ok(plan.topPad >= 0 && plan.bottomPad >= 0, `${label}: espaçador negativo`);
  const rendered = (plan.end - plan.start) * H;
  assert.equal(
    plan.topPad + rendered + plan.bottomPad,
    TOTAL,
    `${label}: os espaçadores não fecham a altura total`
  );
}

const top = planWindow({ count: COUNT, rowHeight: H, scrollTop: 0, viewportHeight: 400 });
assert.equal(top.windowed, true);
assert.equal(top.start, 0, "no topo não há nada acima para pular");
assert.equal(top.topPad, 0);
assert.ok(top.end >= 10, "a viewport de 400px cabe 10 linhas de 40px");
check(top, "topo");

// Scrolled into the middle: the window has to follow, and the spacer above
// has to match exactly the rows that were skipped.
const middle = planWindow({
  count: COUNT,
  rowHeight: H,
  scrollTop: 4000,
  viewportHeight: 400,
});
assert.equal(middle.topPad, middle.start * H, "o espaçador de cima é as linhas puladas");
assert.ok(middle.start > 0 && middle.end < COUNT);
check(middle, "meio");

// The row at the top of the viewport must actually be rendered, overscan or
// not — this is the one that shows up as a blank strip if it is wrong.
assert.ok(middle.start <= 4000 / H, "a primeira linha visível caiu fora da janela");
assert.ok(middle.end > (4000 + 400) / H, "a última linha visível caiu fora da janela");

// At the bottom there is nothing below to pad for.
const bottom = planWindow({
  count: COUNT,
  rowHeight: H,
  scrollTop: TOTAL - 400,
  viewportHeight: 400,
});
assert.equal(bottom.end, COUNT);
assert.equal(bottom.bottomPad, 0);
check(bottom, "fim");

// Scrolled past the end (a list that just shrank, or a trackpad bounce)
// must not produce a negative index or a window past the end.
const past = planWindow({
  count: COUNT,
  rowHeight: H,
  scrollTop: TOTAL + 5000,
  viewportHeight: 400,
});
check(past, "além do fim");
assert.equal(past.end, COUNT);

// A negative scrollTop is the same bounce from the other side.
const bounced = planWindow({
  count: COUNT,
  rowHeight: H,
  scrollTop: -200,
  viewportHeight: 400,
});
assert.equal(bounced.start, 0);
assert.equal(bounced.topPad, 0);
check(bounced, "quique no topo");

// Before the container has been measured it still has to render something
// usable rather than one row or all six hundred.
const unmeasured = planWindow({
  count: COUNT,
  rowHeight: H,
  scrollTop: 0,
  viewportHeight: 0,
});
assert.equal(unmeasured.windowed, true);
assert.ok(unmeasured.end > 10, "sem medida ainda deve render uma janela plausível");
assert.ok(unmeasured.end < COUNT, "e não a lista inteira");
check(unmeasured, "sem medida");

// A nonsense row height falls back to rendering everything rather than
// dividing by zero.
const broken = planWindow({ count: COUNT, rowHeight: 0, scrollTop: 0, viewportHeight: 400 });
assert.equal(broken.windowed, false);
assert.equal(broken.end, COUNT);

// --- mixed heights, as a prefix sum ---------------------------------------
//
// What the member column needs: section headers are short, member rows are
// taller, and a member standing in a voice room is taller still.

const heights: number[] = [];
for (let i = 0; i < 300; i += 1) heights.push(i % 10 === 0 ? 22 : 42);
const offsets = new Float64Array(heights.length + 1);
for (let i = 0; i < heights.length; i += 1) offsets[i + 1] = offsets[i] + heights[i];
const mixedTotal = offsets[heights.length];

function checkMixed(plan: ReturnType<typeof planWindow>, label: string) {
  const rendered = offsets[plan.end] - offsets[plan.start];
  assert.equal(
    plan.topPad + rendered + plan.bottomPad,
    mixedTotal,
    `${label}: os espaçadores não fecham a altura total`
  );
}

const mixedTop = planWindow({
  count: heights.length,
  rowHeight: offsets,
  scrollTop: 0,
  viewportHeight: 500,
});
assert.equal(mixedTop.start, 0);
assert.equal(mixedTop.topPad, 0);
checkMixed(mixedTop, "misto topo");

const mixedMiddle = planWindow({
  count: heights.length,
  rowHeight: offsets,
  scrollTop: 3000,
  viewportHeight: 500,
});
checkMixed(mixedMiddle, "misto meio");
// The binary search has to land on the row actually covering that pixel.
assert.ok(offsets[mixedMiddle.start] <= 3000, "a janela começou depois do scroll");
assert.ok(
  offsets[mixedMiddle.end] >= 3500,
  "a janela terminou antes do fim da viewport"
);

const mixedBottom = planWindow({
  count: heights.length,
  rowHeight: offsets,
  scrollTop: mixedTotal - 500,
  viewportHeight: 500,
});
assert.equal(mixedBottom.end, heights.length);
assert.equal(mixedBottom.bottomPad, 0);
checkMixed(mixedBottom, "misto fim");

// Offsets that do not match the count are a caller bug; rendering everything
// is the safe answer, not a window computed from garbage.
const mismatched = planWindow({
  count: heights.length,
  rowHeight: new Float64Array(5),
  scrollTop: 0,
  viewportHeight: 500,
});
assert.equal(mismatched.windowed, false);
assert.equal(mismatched.end, heights.length);

console.log("useWindowedList: ok");

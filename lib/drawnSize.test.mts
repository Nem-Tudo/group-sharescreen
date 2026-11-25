// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/drawnSize.test.mts
//
// Experiment sq-drawn-size (see lib/drawnSize): a tile asks for the picture it draws, not for
// the box the picture sits in.

import assert from "node:assert/strict";
import { drawnNeed, scaleForHeight, tierForRenderedSize, tierSpec, MAX_TIER_FPS } from "./videoQuality.ts";

const lines = (box: [number, number], video: [number, number], dpr: number, drawn: boolean) => {
  const size = drawn ? drawnNeed(box[0], box[1], video[0], video[1]) : { width: box[0], height: box[1] };
  return tierSpec(tierForRenderedSize(size.width, size.height, dpr, MAX_TIER_FPS)).height;
};

// A 16:9 share on a phone held upright, full screen: 390x844 CSS px at 3x. The picture is drawn
// 390x219, which 720p covers (1170x658 device pixels); the box asked for more than any tier.
assert.equal(lines([390, 844], [1920, 1080], 3, false), 2160);
assert.equal(lines([390, 844], [1920, 1080], 3, true), 720);
// The same phone turned sideways: the picture fills the height, 1170 device lines, and asks
// for the rung above it either way.
assert.equal(lines([844, 390], [1920, 1080], 3, true), 1440);
assert.equal(lines([844, 390], [1920, 1080], 3, false), 1440);
// An ultrawide screen in full screen: 3440x1440 around a 16:9 picture drawn 2560x1440.
assert.equal(lines([3440, 1440], [1920, 1080], 1, false), 2160);
assert.equal(lines([3440, 1440], [1920, 1080], 1, true), 1440);
// A 16:9 tile around a 16:9 picture: nothing changes, which is most tiles.
for (const [w, h] of [[320, 180], [640, 360], [1280, 720], [1920, 1080]]) {
  assert.equal(lines([w, h], [1920, 1080], 1, true), lines([w, h], [1920, 1080], 1, false), `${w}x${h}`);
}
// A 21:9 share in a 16:9 tile is drawn with bars above and below: fewer lines than the box.
assert.equal(lines([1600, 900], [2560, 1080], 1, false), 1080);
assert.equal(lines([1600, 900], [2560, 1080], 1, true), 720);
// And the sender, which scales by height, sends it 21:9 at those lines: 1707x720, which covers
// the 1600x675 drawn.
const scale = scaleForHeight(720, 2560, 1080);
assert.ok(Math.round(2560 / scale) >= 1600 && Math.round(1080 / scale) >= 675);
// A phone's screen shared upright, in a 16:9 tile: drawn 405x720, and asked for as such.
assert.equal(lines([1280, 720], [1080, 2400], 1, true), 720);
// Before the first frame the picture's shape is not known: the box, as before.
assert.deepEqual(drawnNeed(390, 844, 0, 0), { width: 390, height: 844 });

console.log("drawnSize ok");

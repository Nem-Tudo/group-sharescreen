// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/sendAdaptation.test.mts
//
// What a broadcaster's encoders give up when something runs short, and above all
// that everything they give up comes back.

import assert from "node:assert/strict";
import {
  encoderBusy,
  fallingBehind,
  heldCeilingKbps,
  LinkAdapter,
  machineBehind,
  MACHINE_MAX_LEVEL,
  machineCapFor,
  MachineGovernor,
  type SendObservation,
} from "./sendAdaptation.ts";

const healthy = (over: Partial<SendObservation> = {}): SendObservation => ({
  fps: 30,
  sourceFps: 30,
  targetFps: 30,
  encodeMs: 8,
  hardware: false,
  limitation: "none",
  qp: 30,
  codec: "VP8",
  targetKbps: 4000,
  availableKbps: 6000,
  height: 1080,
  ...over,
});
const starved = (over: Partial<SendObservation> = {}) =>
  healthy({ fps: 6, limitation: "bandwidth", targetKbps: 600, availableKbps: 700, ...over });
const still = (over: Partial<SendObservation> = {}) => healthy({ fps: 0.5, sourceFps: 0.5, qp: 10, ...over });

const SECOND = 1000;

/** Feeds one observation every two seconds, from `from`, for `ms`. */
function feed(
  link: LinkAdapter,
  observation: (now: number) => SendObservation,
  profile: "text" | "balanced" | "motion",
  from: number,
  ms: number,
  top = 1080
) {
  let changes = 0;
  for (let now = from; now < from + ms; now += 2 * SECOND) {
    if (link.update(observation(now), profile, top, now)) changes += 1;
  }
  return changes;
}

// --- what counts as a shortage -----------------------------------------------

assert.equal(fallingBehind(healthy(), "balanced"), false);
assert.equal(fallingBehind(healthy({ fps: 10 }), "balanced"), true);
// A still screen sends nothing because there is nothing to send.
assert.equal(fallingBehind(still(), "motion"), false);
// "text" asks for a sharp picture at whatever frame rate that leaves.
assert.equal(fallingBehind(healthy({ fps: 14 }), "text"), false);
assert.equal(fallingBehind(healthy({ fps: 10 }), "text"), true);
// Asked for 15 fps and sending 15 is not behind, whatever the capture delivers.
assert.equal(fallingBehind(healthy({ fps: 15, targetFps: 15 }), "motion"), false);
// A browser that does not report the capture's rate never reads as behind.
assert.equal(fallingBehind(healthy({ fps: 2, sourceFps: null }), "motion"), false);

// Under a CPU restriction the capture's counter falls along with what is sent.
assert.equal(machineBehind(healthy({ fps: 12, sourceFps: 12, limitation: "cpu" }), "balanced"), true);
assert.equal(machineBehind(healthy({ fps: 27, sourceFps: 27, limitation: "cpu" }), "balanced"), false);
assert.equal(machineBehind(still({ limitation: "cpu" }), "balanced"), false);
assert.equal(machineBehind(healthy({ fps: 12 }), "balanced"), false, "atrás sem encoder ocupado é o link");
assert.equal(machineBehind(healthy({ fps: 12, encodeMs: 40 }), "balanced"), true);

assert.equal(encoderBusy(healthy({ limitation: "cpu" })), true);
// 60% of a 33 ms frame.
assert.equal(encoderBusy(healthy({ encodeMs: 25 })), true);
assert.equal(encoderBusy(healthy({ encodeMs: 15 })), false);
assert.equal(encoderBusy(healthy({ encodeMs: null })), false);
// Slow frames with hardly any of them going out is a collapsed link, not a busy machine.
assert.equal(encoderBusy(healthy({ fps: 1, encodeMs: 25 })), false);
assert.equal(encoderBusy(healthy({ fps: 12, encodeMs: 40 })), true);
{
  const link = new LinkAdapter(0);
  feed(link, () => starved({ fps: 1, encodeMs: 25, qp: 42, codec: "H264", availableKbps: 800 }), "balanced", 8 * SECOND, 6 * SECOND);
  assert.equal(link.capHeight, 720);
}
// A hardware encoder's figure is the trip through the GPU, not CPU.
assert.equal(encoderBusy(healthy({ encodeMs: 40, hardware: true })), false);
assert.equal(encoderBusy(healthy({ encodeMs: 60, hardware: true })), true);
assert.equal(encoderBusy(healthy({ encodeMs: 40, hardware: true, limitation: "cpu" })), true);

// So a bad link under a hardware encoder is the link's, whatever the queue looks like.
{
  const link = new LinkAdapter(0);
  feed(link, () => starved({ encodeMs: 40, hardware: true }), "motion", 8 * SECOND, 6 * SECOND);
  assert.equal(link.capHeight, 720);
}

// --- one viewer's link -------------------------------------------------------

// The estimator ramping up in the first seconds is not a shortage.
{
  const link = new LinkAdapter(0);
  assert.equal(feed(link, () => starved(), "motion", 0, 7 * SECOND), 0);
  assert.equal(link.capHeight, null);
}

// A real shortage steps down, and takes a while to be believed: text the
// slowest, since it has promised to keep its pixels.
{
  const motion = new LinkAdapter(0);
  feed(motion, () => starved(), "motion", 8 * SECOND, 6 * SECOND);
  assert.equal(motion.capHeight, 720);
  const text = new LinkAdapter(0);
  feed(text, () => starved(), "text", 8 * SECOND, 6 * SECOND);
  assert.equal(text.capHeight, null);
  feed(text, () => starved(), "text", 14 * SECOND, 6 * SECOND);
  assert.equal(text.capHeight, 720);
}

// A still picture on its way to being sharp runs through a high QP for a moment. That
// is not a picture falling apart, and cutting it would cost all the sharpness.
{
  const link = new LinkAdapter(0);
  feed(link, () => still({ qp: 42, codec: "H264", sourceFps: 5, fps: 5, availableKbps: 400 }), "balanced", 8 * SECOND, 60 * SECOND);
  assert.equal(link.capHeight, null);
}

// A screen that stops and scrolls and stops gets its pixels back over the stops, even
// with a link no better than it was.
{
  const link = new LinkAdapter(0);
  feed(link, () => starved({ fps: 15 }), "balanced", 8 * SECOND, 8 * SECOND);
  assert.equal(link.capHeight, 720);
  let now = 16 * SECOND;
  for (; now < 80 * SECOND && link.capHeight !== null; now += 2 * SECOND) {
    const scrolling = Math.floor(now / (6 * SECOND)) % 2 === 1;
    const sample = scrolling
      ? healthy({ height: 720, availableKbps: 700, qp: 60 })
      : still({ height: 720, availableKbps: 700 });
    link.update(sample, "balanced", 1080, now);
  }
  assert.equal(link.capHeight, null);
  assert.ok(now >= 40 * SECOND, "só o tempo parado conta");
}

// A burst of scrolling that overruns the link and is over is not a shortage.
{
  const link = new LinkAdapter(0);
  for (let now = 8 * SECOND; now < 120 * SECOND; now += 2 * SECOND) {
    const inBurst = Math.floor(now / (8 * SECOND)) % 2 === 0 && now % (8 * SECOND) < 3 * SECOND;
    link.update(inBurst ? starved({ fps: 2 }) : still(), "balanced", 1080, now);
  }
  assert.equal(link.capHeight, null);
}

// Each profile has a floor it stops at, and "text" is the highest.
for (const [profile, floor] of [
  ["text", 720],
  ["balanced", 576],
  ["motion", 360],
] as const) {
  const link = new LinkAdapter(0);
  feed(link, () => starved({ height: link.capHeight ?? 1080 }), profile, 8 * SECOND, 300 * SECOND);
  assert.equal(link.capHeight, floor, profile);
}

// A short tile already below the rung is not cut any further for nothing, and a
// tile at the floor stays there.
{
  const link = new LinkAdapter(0);
  feed(link, () => starved({ height: 576 }), "balanced", 8 * SECOND, 60 * SECOND, 576);
  assert.equal(link.capHeight, null);
}

// The whole point: a shortage that ends is given back, without anyone asking,
// which is the thing WebRTC's own scaler does not do.
{
  const link = new LinkAdapter(0);
  feed(link, () => starved({ fps: 15 }), "balanced", 8 * SECOND, 8 * SECOND);
  assert.equal(link.capHeight, 720);
  // The link is back, far past where it ran short: straight to the top, and soon.
  assert.equal(feed(link, () => healthy({ height: 720, availableKbps: 6000 }), "balanced", 16 * SECOND, 10 * SECOND), 1);
  assert.equal(link.capHeight, null, "1080p volta inteiro quando o link volta");
}

// Two rungs down and the link back: one step, not two keyframes and half a minute.
{
  const link = new LinkAdapter(0);
  feed(link, () => starved({ fps: 15, height: link.capHeight ?? 1080 }), "motion", 8 * SECOND, 14 * SECOND);
  assert.equal(link.capHeight, 576);
  assert.equal(feed(link, () => healthy({ height: 576, availableKbps: 6000, qp: 60 }), "motion", 22 * SECOND, 10 * SECOND), 1);
  assert.equal(link.capHeight, null);
}

// Somewhat better is worth a rung at a time.
{
  const link = new LinkAdapter(0);
  feed(link, () => starved({ fps: 15, height: link.capHeight ?? 1080 }), "motion", 8 * SECOND, 14 * SECOND);
  assert.equal(link.capHeight, 576);
  feed(link, () => healthy({ height: 576, availableKbps: 1200, qp: 60 }), "motion", 22 * SECOND, 18 * SECOND);
  assert.equal(link.capHeight, 720);
}

// A link that has collapsed goes straight down to what it can carry, in one cut, and
// the estimate climbing back past twice the collapse is not the link being back.
{
  const collapsed = () => starved({ fps: 1, qp: 42, codec: "H264", availableKbps: 300 });
  const balanced = new LinkAdapter(0);
  assert.equal(feed(balanced, collapsed, "balanced", 8 * SECOND, 6 * SECOND), 1);
  assert.equal(balanced.capHeight, 576);
  feed(balanced, () => healthy({ height: 576, availableKbps: 700, qp: 38, codec: "H264" }), "balanced", 14 * SECOND, 120 * SECOND);
  assert.equal(balanced.capHeight, 576, "700 kbps não é o link de volta");
  const motion = new LinkAdapter(0);
  assert.equal(feed(motion, collapsed, "motion", 8 * SECOND, 6 * SECOND), 1);
  assert.equal(motion.capHeight, 432);
  // "text" has promised its pixels, however short the link.
  const text = new LinkAdapter(0);
  feed(text, collapsed, "text", 8 * SECOND, 60 * SECOND);
  assert.equal(text.capHeight, 720);
}

// A report without the estimate says nothing either way.
{
  const link = new LinkAdapter(0);
  feed(link, () => starved({ fps: 15 }), "balanced", 8 * SECOND, 8 * SECOND);
  let now = 16 * SECOND;
  for (const kbps of [6000, 0, 6000, 0, 6000, 0, 6000, 0, 6000]) {
    link.update(healthy({ height: 720, availableKbps: kbps, qp: 60 }), "balanced", 1080, now);
    now += 2 * SECOND;
  }
  assert.equal(link.capHeight, null, "a espera não recomeça a cada leitura vazia");
}

// A still screen is a free moment to try again too: nothing moving, nothing to
// lose by asking for more pixels.
{
  const link = new LinkAdapter(0);
  feed(link, () => starved({ fps: 15 }), "balanced", 8 * SECOND, 8 * SECOND);
  feed(link, () => still({ height: 720, availableKbps: 700 }), "balanced", 16 * SECOND, 40 * SECOND);
  assert.equal(link.capHeight, null);
}

// Moving, and the link no better than when it ran short: staying down is right.
{
  const link = new LinkAdapter(0);
  feed(link, () => starved({ fps: 15 }), "balanced", 8 * SECOND, 8 * SECOND);
  feed(link, () => healthy({ height: 720, availableKbps: 700, qp: 60 }), "balanced", 16 * SECOND, 120 * SECOND);
  assert.equal(link.capHeight, 720);
}

// QP says there are bits to spare: also worth a try, per codec.
{
  const link = new LinkAdapter(0);
  feed(link, () => starved({ fps: 15 }), "balanced", 8 * SECOND, 8 * SECOND);
  feed(link, () => healthy({ height: 720, availableKbps: 700, qp: 20 }), "balanced", 16 * SECOND, 40 * SECOND);
  assert.equal(link.capHeight, null);
}

// Stepping up into the same shortage backs off: the wait doubles.
{
  const link = new LinkAdapter(0);
  let now = 8 * SECOND;
  feed(link, () => starved(), "motion", now, 6 * SECOND);
  now += 6 * SECOND;
  assert.equal(link.capHeight, 720);
  // First try: 15 s of calm, seen at the next sample after.
  feed(link, () => still({ height: 720, availableKbps: 700 }), "motion", now, 18 * SECOND);
  now += 18 * SECOND;
  assert.equal(link.capHeight, null);
  // It runs short again straight away.
  feed(link, () => starved(), "motion", now, 6 * SECOND);
  now += 6 * SECOND;
  assert.equal(link.capHeight, 720);
  // Now 15 s of calm is not enough.
  feed(link, () => still({ height: 720, availableKbps: 700 }), "motion", now, 18 * SECOND);
  now += 18 * SECOND;
  assert.equal(link.capHeight, 720, "espera dobrou");
  feed(link, () => still({ height: 720, availableKbps: 700 }), "motion", now, 18 * SECOND);
  assert.equal(link.capHeight, null);
}

// An encoder that cannot keep up is the machine's problem and not this link's:
// cutting here would be cutting for the wrong reason.
{
  const link = new LinkAdapter(0);
  feed(link, () => starved({ limitation: "cpu" }), "motion", 8 * SECOND, 60 * SECOND);
  assert.equal(link.capHeight, null);
  feed(link, () => starved({ encodeMs: 80 }), "motion", 8 * SECOND, 60 * SECOND);
  assert.equal(link.capHeight, null);
}

// High QP alone only moves the profiles that do not promise their pixels.
{
  const blurry = () => healthy({ qp: 45, codec: "H264", availableKbps: 700 });
  const motion = new LinkAdapter(0);
  feed(motion, blurry, "motion", 8 * SECOND, 6 * SECOND);
  assert.equal(motion.capHeight, 720);
  const text = new LinkAdapter(0);
  feed(text, blurry, "text", 8 * SECOND, 60 * SECOND);
  assert.equal(text.capHeight, null);
  // QP scales differ per codec: 45 is nothing on VP8.
  const vp8 = new LinkAdapter(0);
  feed(vp8, () => healthy({ qp: 45, codec: "VP8" }), "motion", 8 * SECOND, 60 * SECOND);
  assert.equal(vp8.capHeight, null);
  // H264 at the end of what WebRTC lets it spend, in "balanced" too.
  const spent = new LinkAdapter(0);
  feed(spent, () => healthy({ qp: 41.5, codec: "H264", availableKbps: 1500 }), "balanced", 8 * SECOND, 8 * SECOND);
  assert.equal(spent.capHeight, 720);
  const fine = new LinkAdapter(0);
  feed(fine, () => healthy({ qp: 38, codec: "H264", availableKbps: 3000 }), "balanced", 8 * SECOND, 60 * SECOND);
  assert.equal(fine.capHeight, null);
  // And VP8 at its cap with every frame going out is still the better picture: in
  // "balanced" only lost frames count.
  const capped = new LinkAdapter(0);
  feed(capped, () => healthy({ qp: 106, codec: "VP8", availableKbps: 2800 }), "balanced", 8 * SECOND, 60 * SECOND);
  assert.equal(capped.capHeight, null);
}

// --- the machine -------------------------------------------------------------

const behind = () => healthy({ fps: 12, encodeMs: 40 });
const TOP = { height: 1080, fps: 60 };

function tickFor(governor: MachineGovernor, keys: string[], obs: () => SendObservation, from: number, ms: number) {
  let changes = 0;
  for (let now = from; now < from + ms; now += 2 * SECOND) {
    for (const key of keys) governor.observe(key, obs(), "balanced", true, TOP, now);
    if (governor.tick(null, now)) changes += 1;
  }
  return changes;
}

// Steps down while the encoders stay behind, one step that changes something at a
// time: from 1080p60, "60 fps" gives nothing up, and neither do 1440 or 1080 lines.
{
  const governor = new MachineGovernor();
  tickFor(governor, ["a", "b", "c"], behind, 0, 4 * SECOND);
  assert.equal(governor.level, 0, "ainda não");
  tickFor(governor, ["a", "b", "c"], behind, 4 * SECOND, 4 * SECOND);
  assert.deepEqual(machineCapFor(governor.level, "balanced"), { height: null, fps: 30 });
  tickFor(governor, ["a", "b", "c"], behind, 8 * SECOND, 8 * SECOND);
  assert.deepEqual(machineCapFor(governor.level, "balanced"), { height: 720, fps: 30 });
  tickFor(governor, ["a", "b", "c"], behind, 16 * SECOND, 60 * SECOND);
  assert.equal(governor.level, MACHINE_MAX_LEVEL, "para no último degrau");
}

// A 4K share has somewhere to go that is not 720p.
{
  const governor = new MachineGovernor();
  let now = 0;
  const seen = [];
  for (; now < 60 * SECOND; now += 2 * SECOND) {
    governor.observe("a", behind(), "balanced", true, { height: 2160, fps: 30 }, now);
    if (governor.tick(null, now)) seen.push(machineCapFor(governor.level, "balanced").height);
  }
  assert.deepEqual(seen.slice(0, 3), [1440, 1080, 720]);
}

// A step that would change nothing is not waited for: at 30 fps, capping the
// frame rate at 30 frees nothing. In both directions.
{
  const governor = new MachineGovernor();
  let now = 0;
  for (; now < 8 * SECOND; now += 2 * SECOND) {
    governor.observe("a", behind(), "balanced", true, { height: 1080, fps: 30 }, now);
    governor.tick(null, now);
  }
  assert.deepEqual(machineCapFor(governor.level, "balanced"), { height: 720, fps: 30 }, "direto para 720p");
  for (; now < 40 * SECOND; now += 2 * SECOND) {
    governor.observe("a", healthy(), "balanced", true, { height: 1080, fps: 30 }, now);
    governor.tick(null, now);
  }
  assert.equal(governor.level, 0, "e volta de uma vez");
}

// One slow connection out of many is not the machine.
{
  const governor = new MachineGovernor();
  let now = 0;
  for (; now < 60 * SECOND; now += 2 * SECOND) {
    governor.observe("slow", behind(), "balanced", true, TOP, now);
    for (const key of ["a", "b", "c", "d", "e"]) governor.observe(key, healthy(), "balanced", true, TOP, now);
    governor.tick(null, now);
  }
  assert.equal(governor.level, 0);
}

// Nor are encoders sharing a CPU unevenly: 29, 30 and 22 fps is 27 on average, and
// 720p for everybody would be worse for all three.
{
  const governor = new MachineGovernor();
  let now = 0;
  for (; now < 60 * SECOND; now += 2 * SECOND) {
    governor.observe("a", healthy({ fps: 29, encodeMs: 22 }), "balanced", true, TOP, now);
    governor.observe("b", healthy({ fps: 30, encodeMs: 22 }), "balanced", true, TOP, now);
    governor.observe("c", healthy({ fps: 22, encodeMs: 23 }), "balanced", true, TOP, now);
    governor.tick(null, now);
  }
  assert.equal(governor.level, 0);
}

// All of them low is the machine, in a room of any size.
{
  const governor = new MachineGovernor();
  let now = 0;
  for (; now < 8 * SECOND; now += 2 * SECOND) {
    for (const key of ["a", "b", "c", "d"]) governor.observe(key, healthy({ fps: 19, encodeMs: 40 }), "balanced", true, TOP, now);
    governor.tick(null, now);
  }
  assert.ok(governor.level > 0);
}

// A viewer on a bad link does not count against the others.
{
  const governor = new MachineGovernor();
  let now = 0;
  for (; now < 60 * SECOND; now += 2 * SECOND) {
    governor.observe("link", starved({ fps: 5 }), "balanced", true, TOP, now);
    governor.observe("a", healthy({ fps: 28, encodeMs: 22 }), "balanced", true, TOP, now);
    governor.observe("b", healthy({ fps: 21, encodeMs: 23 }), "balanced", true, TOP, now);
    governor.tick(null, now);
  }
  assert.equal(governor.level, 0, "o link de um não é a CPU de todos");
}

// It comes back by itself.
{
  const governor = new MachineGovernor();
  tickFor(governor, ["a"], behind, 0, 8 * SECOND);
  assert.ok(governor.level > 0);
  tickFor(governor, ["a"], () => healthy(), 8 * SECOND, 24 * SECOND);
  assert.equal(governor.level, 0);
}

// The operating system saying "critical" counts on its own, with software
// encoding among the reasons; "serious" holds a recovery back.
{
  const governor = new MachineGovernor();
  let now = 0;
  for (; now < 14 * SECOND; now += 2 * SECOND) {
    governor.observe("a", healthy(), "balanced", true, TOP, now);
    governor.tick("critical", now);
  }
  const held = governor.level;
  assert.ok(held > 0);
  for (; now < 60 * SECOND; now += 2 * SECOND) {
    governor.observe("a", healthy(), "balanced", true, TOP, now);
    governor.tick("serious", now);
  }
  assert.equal(governor.level, held, "serious segura a volta");
  for (; now < 90 * SECOND; now += 2 * SECOND) {
    governor.observe("a", healthy(), "balanced", true, TOP, now);
    governor.tick("nominal", now);
  }
  assert.equal(governor.level, 0);
  // Hardware encoders: the pressure is somebody else's, and cutting them would
  // free nothing.
  const hardware = new MachineGovernor();
  for (let t = 0; t < 60 * SECOND; t += 2 * SECOND) {
    hardware.observe("a", healthy(), "balanced", false, TOP, t);
    hardware.tick("critical", t);
  }
  assert.equal(hardware.level, 0);
}

// Nothing left being encoded: the next viewer starts from a clean slate.
{
  const governor = new MachineGovernor();
  tickFor(governor, ["a"], behind, 0, 8 * SECOND);
  assert.ok(governor.level > 0);
  governor.forget("a");
  assert.equal(governor.level, 0);
}

// What each level means, per profile: each keeps what it promises longest.
assert.deepEqual(machineCapFor(0, "balanced"), { height: null, fps: null });
assert.deepEqual(machineCapFor(2, "text"), { height: null, fps: 30 });
assert.deepEqual(machineCapFor(3, "text"), { height: null, fps: 20 });
assert.deepEqual(machineCapFor(3, "motion"), { height: 720, fps: null });
assert.deepEqual(machineCapFor(MACHINE_MAX_LEVEL, "motion"), { height: 360, fps: 24 });
assert.deepEqual(machineCapFor(MACHINE_MAX_LEVEL, "text"), { height: 576, fps: 15 });

// A held picture is held to the bits it can use, and a tile already smaller than
// the hold keeps what it has.
assert.equal(heldCeilingKbps(4000, { height: 720, fps: null }, 1080, 30), 2177);
assert.equal(heldCeilingKbps(4000, { height: 576, fps: null }, 1080, 30), 1558);
assert.equal(heldCeilingKbps(4000, { height: null, fps: 15 }, 1080, 30), 2828);
assert.equal(heldCeilingKbps(1500, { height: 720, fps: 30 }, 576, 30), 1500);

console.log("sendAdaptation: ok");

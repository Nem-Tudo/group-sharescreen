// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/sendAdaptation.test.mts
//
// What a broadcaster's encoders give up when something runs short, and above all
// that everything they give up comes back.

import assert from "node:assert/strict";
import {
  chooseSharp,
  encoderBusy,
  fallingBehind,
  heldCeilingKbps,
  LinkAdapter,
  machineBehind,
  MACHINE_MAX_LEVEL,
  machineCapFor,
  MachineGovernor,
  PictureWatch,
  sharpCost,
  type SendObservation,
  type SharpCandidate,
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
  sentKbps: 4000,
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

// A full hardware encoder drops frames with bits to spare, and fewer pixels do not bring them
// back. That is six streams on AMD's H264: 15 fps at QP 16, 6 Mbps out of a 12 Mbps estimate.
const encoderFull = (over: Partial<SendObservation> = {}) =>
  healthy({
    fps: 15,
    encodeMs: 38,
    hardware: true,
    qp: 16,
    codec: "H264",
    targetKbps: 6000,
    sentKbps: 6000,
    availableKbps: 12000,
    height: 1024,
    ...over,
  });
{
  const link = new LinkAdapter(0);
  feed(link, () => encoderFull(), "balanced", 8 * SECOND, 60 * SECOND, 1024);
  assert.equal(link.capHeight, null);
}
// The same frames lost with no room above what is going out are the link's.
{
  const link = new LinkAdapter(0);
  feed(link, () => encoderFull({ availableKbps: 7000 }), "balanced", 8 * SECOND, 6 * SECOND, 1024);
  assert.equal(link.capHeight, 720);
}
// And so are they with room but a high QP: the encoder is spending all it has.
{
  const link = new LinkAdapter(0);
  feed(link, () => encoderFull({ qp: 38 }), "balanced", 8 * SECOND, 6 * SECOND, 1024);
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
const TOP = { height: 1080, fps: 60, sharp: false };

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
  assert.deepEqual(machineCapFor(governor.level, "balanced"), { height: null, fps: 30, sharp: false });
  tickFor(governor, ["a", "b", "c"], behind, 8 * SECOND, 8 * SECOND);
  assert.deepEqual(machineCapFor(governor.level, "balanced"), { height: 720, fps: 30, sharp: false });
  tickFor(governor, ["a", "b", "c"], behind, 16 * SECOND, 60 * SECOND);
  assert.equal(governor.level, MACHINE_MAX_LEVEL, "para no último degrau");
}

// A 4K share has somewhere to go that is not 720p.
{
  const governor = new MachineGovernor();
  let now = 0;
  const seen = [];
  for (; now < 60 * SECOND; now += 2 * SECOND) {
    governor.observe("a", behind(), "balanced", true, { height: 2160, fps: 30, sharp: false }, now);
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
    governor.observe("a", behind(), "balanced", true, { height: 1080, fps: 30, sharp: false }, now);
    governor.tick(null, now);
  }
  assert.deepEqual(machineCapFor(governor.level, "balanced"), { height: 720, fps: 30, sharp: false }, "direto para 720p");
  for (; now < 40 * SECOND; now += 2 * SECOND) {
    governor.observe("a", healthy(), "balanced", true, { height: 1080, fps: 30, sharp: false }, now);
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

// But only so far with every frame still going out. Past that it takes frames being lost.
{
  const top = { height: 1080, fps: 30, sharp: false };
  const governor = new MachineGovernor();
  let now = 0;
  for (; now < 120 * SECOND; now += 2 * SECOND) {
    governor.observe("a", healthy(), "balanced", true, top, now);
    governor.tick("critical", now);
  }
  assert.deepEqual(machineCapFor(governor.level, "balanced"), { height: 720, fps: 30, sharp: false });
  const reached = governor.level;
  for (; now < 180 * SECOND; now += 2 * SECOND) {
    governor.observe("a", healthy({ fps: 12, encodeMs: 40 }), "balanced", true, top, now);
    governor.tick("critical", now);
  }
  assert.ok(governor.level > reached, "com quadro perdido, continua");
  // And it does not count as calm at the bottom of that reach.
  const held = new MachineGovernor();
  for (let t = 0; t < 400 * SECOND; t += 2 * SECOND) {
    held.observe("a", healthy(), "balanced", true, top, t);
    held.tick("critical", t);
  }
  assert.deepEqual(machineCapFor(held.level, "balanced"), { height: 720, fps: 30, sharp: false });
  // "text" gives up frames and the costly codec on that reach, and keeps its pixels.
  const text = new MachineGovernor();
  for (let t = 0; t < 120 * SECOND; t += 2 * SECOND) {
    text.observe("a", healthy(), "text", true, { ...top, sharp: machineCapFor(text.level, "text").sharp }, t);
    text.tick("critical", t);
  }
  assert.deepEqual(machineCapFor(text.level, "text"), { height: null, fps: 15, sharp: false });
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
assert.deepEqual(machineCapFor(0, "balanced"), { height: null, fps: null, sharp: true });
assert.deepEqual(machineCapFor(1, "balanced"), { height: null, fps: null, sharp: false });
assert.deepEqual(machineCapFor(2, "text"), { height: null, fps: 30, sharp: true });
assert.deepEqual(machineCapFor(3, "text"), { height: null, fps: 20, sharp: true });
assert.deepEqual(machineCapFor(5, "text"), { height: null, fps: 15, sharp: false });
assert.deepEqual(machineCapFor(4, "motion"), { height: 720, fps: null, sharp: false });
assert.deepEqual(machineCapFor(MACHINE_MAX_LEVEL, "motion"), { height: 360, fps: 24, sharp: false });
assert.deepEqual(machineCapFor(MACHINE_MAX_LEVEL, "text"), { height: 576, fps: 15, sharp: false });

// --- the costly codec ---------------------------------------------------------

const SHARP = { height: 1080, fps: 30, sharp: true };

function observeFor(
  governor: MachineGovernor,
  obs: () => SendObservation,
  profile: "text" | "balanced" | "motion",
  top: { height: number; fps: number; sharp: boolean },
  pressure: "nominal" | "serious" | "critical" | null,
  from: number,
  ms: number
) {
  for (let now = from; now < from + ms; now += 2 * SECOND) {
    governor.observe("a", obs(), profile, true, top, now);
    governor.tick(pressure, now);
  }
}

// It is the first thing "balanced" gives up: no pixels and no frames go with it.
{
  const governor = new MachineGovernor();
  observeFor(governor, behind, "balanced", SHARP, null, 0, 8 * SECOND);
  assert.equal(governor.level, 1);
  assert.deepEqual(machineCapFor(governor.level, "balanced"), { height: null, fps: null, sharp: false });
  // And back, without anything else having moved.
  observeFor(governor, () => healthy(), "balanced", { ...SHARP, sharp: false }, null, 8 * SECOND, 24 * SECOND);
  assert.equal(governor.level, 0);
}

// With nobody in it there is nothing to give up, and no 6 seconds to wait for that.
{
  const governor = new MachineGovernor();
  observeFor(governor, behind, "balanced", { ...SHARP, sharp: false }, null, 0, 8 * SECOND);
  assert.deepEqual(machineCapFor(governor.level, "balanced"), { height: 720, fps: 30, sharp: false });
}

// "text" asked for that picture: frames go first, then it, and only then pixels.
{
  const governor = new MachineGovernor();
  const seen: unknown[] = [];
  let now = 0;
  for (; now < 60 * SECOND; now += 2 * SECOND) {
    const top = { ...SHARP, sharp: machineCapFor(governor.level, "text").sharp };
    governor.observe("a", healthy({ fps: 5, encodeMs: 100, targetFps: machineCapFor(governor.level, "text").fps ?? 30 }), "text", true, top, now);
    if (governor.tick(null, now)) seen.push(machineCapFor(governor.level, "text"));
  }
  assert.deepEqual(seen[0], { height: null, fps: 20, sharp: true });
  assert.deepEqual(seen[1], { height: null, fps: 15, sharp: true });
  assert.deepEqual(seen[2], { height: null, fps: 15, sharp: false });
}

// The operating system saying the machine is busy is enough to give it up, whoever's
// fault that is.
{
  const governor = new MachineGovernor();
  observeFor(governor, () => healthy(), "balanced", SHARP, "serious", 0, 8 * SECOND);
  assert.equal(governor.level, 0, "ainda não");
  observeFor(governor, () => healthy(), "balanced", SHARP, "serious", 8 * SECOND, 4 * SECOND);
  assert.equal(governor.level, 1);
  // That is all it costs: the same reading takes nothing else.
  observeFor(governor, () => healthy(), "balanced", { ...SHARP, sharp: false }, "serious", 12 * SECOND, 60 * SECOND);
  assert.equal(governor.level, 1);
  // A hardware encoder or a page sitting still changes nothing about that.
  const noneOfIt = new MachineGovernor();
  observeFor(noneOfIt, () => healthy(), "balanced", { ...SHARP, sharp: false }, "serious", 0, 60 * SECOND);
  assert.equal(noneOfIt.level, 0);
  // "text" keeps it through "serious": what it asked for is not given up for a busy machine.
  const text = new MachineGovernor();
  observeFor(text, () => healthy(), "text", SHARP, "serious", 0, 60 * SECOND);
  assert.equal(text.level, 0);
}

const candidate = (key: string, over: Partial<SharpCandidate> = {}): SharpCandidate => ({
  key,
  profile: "balanced",
  height: 1080,
  fps: 30,
  holding: false,
  mayTake: true,
  availableKbps: 0,
  ...over,
});
const chosen = (candidates: SharpCandidate[], cores: number) => [...chooseSharp(candidates, cores)].sort();

// As many as the machine can afford, and "text" can afford more.
assert.deepEqual(chosen([candidate("a")], 4), [], "1,5 núcleo é demais para 4");
assert.deepEqual(chosen([candidate("a"), candidate("b")], 6), ["a"]);
assert.deepEqual(chosen([candidate("a"), candidate("b"), candidate("c")], 12), ["a", "b"]);
const asText = (key: string) => candidate(key, { profile: "text" });
assert.deepEqual(chosen([asText("a")], 4), ["a"]);
assert.deepEqual(chosen([asText("a"), asText("b"), asText("c")], 6), ["a", "b"]);
// A game goes in H264 with bits to spare, whatever the machine, and in the costly codec on
// a short link, if the machine can spare less for it than for anything else.
const asMotion = (key: string, over: Partial<SharpCandidate> = {}) => candidate(key, { profile: "motion", ...over });
assert.deepEqual(chosen([asMotion("a")], 64), [], "sem estimativa, H264");
assert.deepEqual(chosen([asMotion("a", { availableKbps: 8000 })], 64), []);
assert.deepEqual(chosen([asMotion("a", { availableKbps: 3000 })], 8), ["a"]);
assert.deepEqual(chosen([asMotion("a", { availableKbps: 3000 })], 6), [], "1,5 núcleo é demais para 6");
assert.deepEqual(chosen([asMotion("a", { availableKbps: 3000 }), asMotion("b", { availableKbps: 3000 })], 12), ["a"]);
assert.deepEqual(chosen([asMotion("a", { availableKbps: 3000, fps: 60 })], 8), [], "1080p60 custa mais");
// And it gives it back only once the link is clearly not short: no codec change for an
// estimate that moves around 4 Mbps.
assert.deepEqual(chosen([asMotion("a", { availableKbps: 4500, holding: true })], 8), ["a"]);
assert.deepEqual(chosen([asMotion("a", { availableKbps: 6500, holding: true })], 8), []);
assert.deepEqual(chosen([asMotion("a", { holding: true })], 8), [], "sem estimativa, H264");
assert.deepEqual(chosen([asMotion("a", { availableKbps: 4500 })], 8), [], "mas para entrar precisa ser curto");
// Short for the picture it is carrying: a small tile asks for little, whatever the link.
assert.deepEqual(chosen([asMotion("a", { availableKbps: 2500, height: 576 })], 8), []);
assert.deepEqual(chosen([asMotion("a", { availableKbps: 900, height: 576 })], 8), ["a"]);
assert.deepEqual(
  chosen([candidate("big", { availableKbps: 6000 }), candidate("small", { availableKbps: 3000, height: 576, fps: 15 })], 6),
  ["big"],
  "o tile pequeno não passa na frente do grande só por pedir pouco"
);

// A smaller picture costs less, and a faster one more, though neither by its full size.
assert.ok(sharpCost(576, 30) < sharpCost(720, 30));
assert.ok(sharpCost(720, 30) < sharpCost(1080, 30));
assert.ok(sharpCost(1080, 30) < sharpCost(1080, 60));
assert.ok(sharpCost(1080, 60) < sharpCost(1080, 30) * 2);
assert.deepEqual(chosen([candidate("a", { height: 576 })], 4), ["a"], "um tile pequeno cabe em 4 núcleos");
assert.deepEqual(chosen([candidate("a", { fps: 60 })], 6), [], "1080p60 não cabe em 6");

// The shortest link first, which has the most to gain, even from whoever has it.
assert.deepEqual(
  chosen([candidate("free", { availableKbps: 6000 }), candidate("short", { availableKbps: 1500 }), candidate("unknown")], 6),
  ["short"]
);
assert.deepEqual(
  chosen([candidate("free", { availableKbps: 8000, holding: true }), candidate("short", { availableKbps: 1500 })], 4),
  ["short"]
);
assert.deepEqual(
  chosen([candidate("free", { availableKbps: 8000, holding: true }), candidate("short", { availableKbps: 1500 })], 6).sort(),
  ["free", "short"],
  "e quem já tem fica, se couber"
);
// Then whoever has it: moving costs a keyframe, and nobody gains from it.
assert.deepEqual(
  chosen([candidate("a", { availableKbps: 3000 }), candidate("b", { availableKbps: 1500, holding: false }), candidate("c", { availableKbps: 2000, holding: true })], 4),
  ["c"]
);
assert.deepEqual(
  chosen([candidate("a", { availableKbps: 8000 }), candidate("b", { availableKbps: 8000, holding: true })], 6),
  ["b"]
);
// A short link gets more of the machine, since that is where the picture is lost.
const asShort = { availableKbps: 3000 };
assert.deepEqual(chosen([candidate("a", asShort)], 4), ["a"], "4 núcleos, link curto");
assert.deepEqual(chosen([candidate("a", { availableKbps: 8000 })], 4), [], "com bits de sobra, H264");
assert.deepEqual(chosen([candidate("a", asShort), candidate("b", asShort)], 8), ["a", "b"]);
assert.deepEqual(chosen([candidate("a", { availableKbps: 8000 }), candidate("b", { availableKbps: 8000 })], 8), ["a"]);
assert.deepEqual(chosen([candidate("a", asShort), candidate("b", asShort)], 6), ["a", "b"]);
assert.deepEqual(chosen([candidate("a", asShort), candidate("b", asShort)], 4), ["a"], "dois não cabem em 4");
assert.deepEqual(chosen([candidate("a", asShort), candidate("b", asShort), candidate("c", asShort)], 8), ["a", "b", "c"]);
assert.deepEqual(chosen(["a", "b", "c", "d", "e"].map((key) => candidate(key, asShort)), 12), ["a", "b", "c", "d"]);
// And keeps it until the link is clearly not one, so that it does not come and go.
assert.deepEqual(chosen([candidate("a", { availableKbps: 7000, holding: true })], 4), ["a"]);
assert.deepEqual(chosen([candidate("a", { availableKbps: 8000, holding: true })], 4), []);
assert.deepEqual(chosen([candidate("a", { availableKbps: 7000 })], 4), [], "para entrar precisa ser curto");
assert.deepEqual(chosen([candidate("a", { availableKbps: 4500 })], 4), ["a"], "e 4,5 Mbps é curto: 40 dB em H264, 45 em AV1");
// The big estimate on an uplink that leaves the others short is luck, and it keeps the codec.
const uplink = (rich: number) => [
  candidate("rico", { availableKbps: rich, holding: true }),
  candidate("b", { availableKbps: 3000, holding: true }),
  candidate("c", { availableKbps: 1400, holding: true }),
];
assert.deepEqual(chosen(uplink(8000), 8).sort(), ["b", "c", "rico"]);
assert.deepEqual(chosen(uplink(8000), 6).sort(), ["b", "c"], "dentro do que a máquina tem");
assert.deepEqual(
  chosen([candidate("a", { availableKbps: 8000, holding: true }), candidate("b", { availableKbps: 8000, holding: true }), candidate("c", { availableKbps: 8000, holding: true })], 8).length,
  1,
  "com bits para todos a parte volta a ser a menor"
);
assert.deepEqual(
  chosen([candidate("a", { availableKbps: 8000 }), candidate("b", { availableKbps: 2000, holding: true })], 4),
  ["b"],
  "e não abre a porta para quem não tem o codec"
);
// A short link that has just changed codec waits its turn, and the holder keeps it meanwhile.
assert.deepEqual(
  chosen([candidate("free", { availableKbps: 6000, holding: true }), candidate("short", { availableKbps: 1500, mayTake: false })], 6),
  ["free"]
);
// Between two with bits to spare, the bigger picture gains more.
assert.deepEqual(chosen([candidate("small", { height: 576 }), candidate("big")], 6), ["big"]);
assert.deepEqual(chosen([candidate("small", { height: 576 }), candidate("big")], 4), ["small"], "o grande não cabe em 4");
// Somebody who has just changed waits, and does not lose their turn for good.
assert.deepEqual(chosen([candidate("a", { mayTake: false }), candidate("b")], 6), ["b"]);
assert.deepEqual(chosen([candidate("a", { mayTake: false })], 6), []);
// But a holder who no longer fits lets go.
assert.deepEqual(chosen([candidate("a", { holding: true, fps: 60 })], 6), []);

// What is on the screen, by trying camera mode and comparing.
{
  const film = (over: Partial<SendObservation> = {}) =>
    healthy({ codec: "AV1", qp: 150, targetKbps: 1500, sentKbps: 1500, availableKbps: 1600, ...over });
  const run = (watch: PictureWatch, o: () => SendObservation, from: number, ms: number) => {
    let changes = 0;
    for (let now = from; now < from + ms; now += 2 * SECOND) if (watch.update(o(), now)) changes += 1;
    return changes;
  };
  // Ten seconds of it in screen mode, and then the try. The samples at 0..10 s and 12..18 s.
  const tried = (screen: Partial<SendObservation>, camera: Partial<SendObservation>) => {
    const watch = new PictureWatch();
    run(watch, () => film(screen), 0, 12 * SECOND);
    assert.equal(watch.moving, true, "tenta");
    run(watch, () => film(camera), 12 * SECOND, 8 * SECOND);
    return watch;
  };

  // Not until it has been moving for longer than anyone scrolls in one go.
  const video = new PictureWatch();
  run(video, film, 0, 10 * SECOND);
  assert.equal(video.moving, false, "ainda não");
  assert.equal(run(video, film, 10 * SECOND, 2 * SECOND), 1);
  assert.equal(video.moving, true);
  assert.equal(video.proven, false, "só tentando");

  // What came out better, as measured.
  for (const [name, screen, camera] of [
    ["vídeo a 3 Mbps", { qp: 132 }, { qp: 107 }],
    ["vídeo a 1,5 Mbps", { qp: 177 }, { qp: 152 }],
    ["vídeo com folga", { qp: 81 }, { qp: 67 }],
    ["vídeo a 800 kbps", { fps: 20, qp: 205 }, { fps: 29.7, qp: 193 }],
    ["vídeo a 500 kbps", { fps: 11, qp: 208 }, { fps: 19, qp: 205 }],
    ["ruído a 3 Mbps", { fps: 10, sourceFps: 27, qp: 207 }, { fps: 24, sourceFps: 27, qp: 195 }],
    ["código com folga", { qp: 142 }, { qp: 128 }],
    ["vídeo perdendo bits para outro espectador", { qp: 135, sentKbps: 2400 }, { qp: 129, sentKbps: 2170 }],
    ["vídeo entre vários: mesmo QP, quadros mais baratos", { qp: 128, encodeMs: 26 }, { qp: 128, encodeMs: 22 }],
    ["e também com menos bits", { qp: 109, encodeMs: 29, sentKbps: 3500 }, { qp: 127, encodeMs: 21, sentKbps: 2750 }],
  ] as [string, Partial<SendObservation>, Partial<SendObservation>][]) {
    const watch = tried(screen, camera);
    assert.equal(watch.moving, true, name);
    assert.equal(watch.proven, true, name);
  }

  // And what did not.
  for (const [name, screen, camera] of [
    ["código a 3 Mbps", { qp: 177 }, { qp: 178 }],
    ["código a 3 Mbps, quando cai", { qp: 175 }, { fps: 20, qp: 205 }],
    ["código a 1,5 Mbps", { fps: 25.5, qp: 202 }, { fps: 8.6, qp: 208 }],
    ["texto miúdo com folga", { fps: 24, qp: 197 }, { fps: 25.4, qp: 190 }],
    ["uma janela a 3 Mbps", { qp: 49 }, { qp: 48 }],
    ["menos quadros, mesmo com QP melhor", { qp: 150 }, { fps: 22, qp: 100 }],
    ["código com folga: mesmo QP, quadros mais caros", { qp: 140, encodeMs: 13 }, { qp: 139, encodeMs: 20 }],
    ["quadros mais baratos, mas QP bem pior", { qp: 128, encodeMs: 26 }, { qp: 145, encodeMs: 20 }],
    ["quadros mais baratos, mas menos deles", { qp: 128, encodeMs: 26 }, { fps: 22, qp: 128, encodeMs: 20 }],
    ["usar mais bits não dá crédito", { qp: 140, sentKbps: 1500 }, { qp: 139, sentKbps: 3000 }],
    ["sem saber o tempo de encode", { qp: 128, encodeMs: null }, { qp: 128, encodeMs: null }],
  ] as [string, Partial<SendObservation>, Partial<SendObservation>][]) {
    const watch = tried(screen, camera);
    assert.equal(watch.moving, false, name);
    assert.equal(watch.proven, false, name);
    assert.equal(run(watch, () => film(screen), 20 * SECOND, 4 * 60 * SECOND), 0, name + ": não tenta de novo tão cedo");
    assert.equal(run(watch, () => film(screen), 5 * 60 * SECOND + 20 * SECOND, 12 * SECOND), 1, name + ": mas tenta");
  }

  // Frames lost need no comparing: out before the try is over, so a dense page pays less.
  const page = new PictureWatch();
  run(page, film, 0, 12 * SECOND);
  run(page, () => film({ fps: 3, qp: 208 }), 12 * SECOND, 2 * SECOND);
  assert.equal(page.moving, true, "ainda não: a primeira amostra pode ser o quadro-chave");
  assert.equal(run(page, () => film({ fps: 3, qp: 208 }), 14 * SECOND, 2 * SECOND), 1);
  assert.equal(page.moving, false);
  // One low sample is the keyframe, and no verdict.
  const keyframe = new PictureWatch();
  run(keyframe, () => film({ fps: 14, qp: 207 }), 0, 12 * SECOND);
  run(keyframe, () => film({ fps: 5, qp: 208 }), 12 * SECOND, 2 * SECOND);
  run(keyframe, () => film({ fps: 28, qp: 195 }), 14 * SECOND, 6 * SECOND);
  assert.equal(keyframe.proven, true);

  // Video on a link this short has few frames either way, and more in camera mode.
  const thin = tried({ fps: 7, qp: 208 }, { fps: 12, qp: 207 });
  assert.equal(thin.proven, true);
  assert.equal(run(thin, () => film({ fps: 10, qp: 208 }), 20 * SECOND, 60 * SECOND), 0, "e o que importa é o que ele vinha mandando");
  assert.equal(run(thin, () => film({ fps: 3, qp: 208 }), 80 * SECOND, 6 * SECOND), 1);

  // Bits lost to another viewer in the middle of a try are no verdict: it looks again soon.
  const shared = new PictureWatch();
  run(shared, () => film({ qp: 110, sentKbps: 3500 }), 0, 12 * SECOND);
  run(shared, () => film({ qp: 164, sentKbps: 1500 }), 12 * SECOND, 8 * SECOND);
  assert.equal(shared.moving, false);
  assert.equal(run(shared, () => film({ qp: 150, sentKbps: 1500 }), 20 * SECOND, 24 * SECOND), 0, "espera um pouco");
  assert.equal(run(shared, () => film({ qp: 150, sentKbps: 1500 }), 44 * SECOND, 18 * SECOND), 1, "e olha de novo");

  // A dense page in camera mode comes in bursts, and one good sample does not clear it.
  const bursts = tried({ qp: 132 }, { qp: 107 });
  assert.equal(bursts.proven, true);
  const fpsOf = [3, 18, 3, 3];
  let at = 20 * SECOND;
  for (const fps of fpsOf) {
    bursts.update(film({ fps, qp: 208 }), at);
    at += 2 * SECOND;
  }
  assert.equal(bursts.moving, false, "6 s, com o surto no meio");
  // And two good ones do: video that wobbled and came back is still video.
  const wobble = tried({ qp: 132 }, { qp: 107 });
  for (const fps of [3, 29, 29, 3, 3]) {
    wobble.update(film({ fps, qp: 150 }), at);
    at += 2 * SECOND;
  }
  assert.equal(wobble.moving, true);
  // The keyframe of a try is one low sample, and video is back on the next.
  const low = tried({ qp: 205, fps: 20 }, { qp: 193 });
  assert.equal(low.proven, true);

  // Nor is the link falling under a mode already proven: it looks again soon, on what is left.
  const fell = tried({ qp: 132, sentKbps: 2500 }, { qp: 107, sentKbps: 2500 });
  assert.equal(fell.proven, true);
  run(fell, () => film({ fps: 3, qp: 208, sentKbps: 300 }), 20 * SECOND, 6 * SECOND);
  assert.equal(fell.moving, false);
  assert.equal(run(fell, () => film({ fps: 20, qp: 205, sentKbps: 700 }), 26 * SECOND, 24 * SECOND), 0, "espera um pouco");
  assert.equal(run(fell, () => film({ fps: 20, qp: 205, sentKbps: 700 }), 50 * SECOND, 18 * SECOND), 1, "e olha de novo");

  // One at a time: it waits for whoever is trying, and goes as soon as they are done.
  const waiting = new PictureWatch();
  for (let now = 0; now < 30 * SECOND; now += 2 * SECOND) assert.equal(waiting.update(film(), now, false), false);
  assert.equal(waiting.update(film(), 30 * SECOND, true), true);
  assert.equal(waiting.trying, true);

  // What one connection found holds for the others, with nothing to compare.
  const adopted = new PictureWatch();
  assert.equal(adopted.adopt(0), false, "nada se sabe antes da primeira amostra");
  run(adopted, film, 0, 2 * SECOND);
  assert.equal(adopted.adopt(2 * SECOND), true);
  assert.equal(adopted.moving, true);
  assert.equal(adopted.adopt(2 * SECOND), false, "já está");
  run(adopted, () => film({ qp: 160 }), 2 * SECOND, 10 * SECOND);
  assert.equal(adopted.proven, true, "mesmo com o QP pior: os bits podem ter ido para outro espectador");
  // Whether or not its own try came out that way.
  const outvoted = tried({ qp: 177 }, { qp: 178 });
  assert.equal(outvoted.moving, false);
  assert.equal(outvoted.adopt(20 * SECOND), true);
  // Frames lost on its own link still bring it back, and that holds.
  const lostHere = new PictureWatch();
  run(lostHere, film, 0, 2 * SECOND);
  lostHere.adopt(2 * SECOND);
  run(lostHere, () => film({ fps: 3, qp: 208 }), 2 * SECOND, 4 * SECOND);
  assert.equal(lostHere.moving, false);
  assert.equal(lostHere.adopt(6 * SECOND), false);
  assert.equal(lostHere.adopt(6 * SECOND + 4 * 60 * SECOND), false);
  assert.equal(lostHere.adopt(6 * SECOND + 5 * 60 * SECOND), true);
  // Not for a capture standing still here: the others will see that too in a moment.
  const still = new PictureWatch();
  still.update(film({ fps: 5, sourceFps: 5 }), 0);
  assert.equal(still.adopt(0), false);

  // The start of those ten seconds is the estimator ramping up, and proves nothing.
  const ramp = new PictureWatch();
  let sample = 0;
  run(ramp, () => film({ qp: (sample += 1) <= 2 ? 208 : 130 }), 0, 12 * SECOND);
  run(ramp, () => film({ qp: 125 }), 12 * SECOND, 8 * SECOND);
  assert.equal(ramp.moving, false, "não credita ao modo o que foi o link subindo");

  // Once proven it stays, through what a film does on the way and its bits falling.
  const kept = tried({ qp: 132 }, { qp: 107 });
  assert.equal(run(kept, () => film({ qp: 200, sentKbps: 300 }), 20 * SECOND, 60 * SECOND), 0);
  assert.equal(run(kept, () => film({ fps: 18, qp: 206 }), 80 * SECOND, 60 * SECOND), 0, "vídeo num link curto também perde quadros");
  // And stops as soon as the capture says so.
  assert.equal(run(kept, () => film({ fps: 5, sourceFps: 5, sentKbps: 50 }), 140 * SECOND, 2 * SECOND), 1);
  assert.equal(kept.moving, false);
  assert.equal(kept.proven, false);
  // From there it has to prove it all over again, and can.
  run(kept, film, 142 * SECOND, 12 * SECOND);
  assert.equal(kept.moving, true);
  run(kept, () => film({ qp: 130 }), 154 * SECOND, 8 * SECOND);
  assert.equal(kept.proven, true);
  // A page that scrolls now and then is not one, though the capture is never quite still.
  assert.equal(run(kept, () => film({ fps: 7, sourceFps: 11, qp: 188 }), 162 * SECOND, 2 * SECOND), 1);
  assert.equal(kept.moving, false);
  // Frames lost later on: back, and for a while.
  const later = tried({ qp: 132 }, { qp: 107 });
  run(later, () => film({ fps: 3, qp: 208 }), 20 * SECOND, 6 * SECOND);
  assert.equal(later.moving, false);
  assert.equal(run(later, film, 26 * SECOND, 4 * 60 * SECOND), 0);
  // The capture stopping in the middle of a try is no verdict, and costs no wait.
  const interrupted = new PictureWatch();
  run(interrupted, film, 0, 12 * SECOND);
  assert.equal(run(interrupted, () => film({ fps: 5, sourceFps: 5 }), 12 * SECOND, 2 * SECOND), 1);
  assert.equal(interrupted.moving, false);
  assert.equal(run(interrupted, film, 14 * SECOND, 12 * SECOND), 1);

  const never = (o: () => SendObservation, why: string) => {
    const watch = new PictureWatch();
    assert.equal(run(watch, o, 0, 120 * SECOND), 0, why);
  };
  never(() => film({ fps: 2.4, qp: 208 }), "texto miúdo a 500 kbps: nem um vídeo a 300 kbps perde tanto");
  never(() => film({ fps: 8, sourceFps: 8, qp: 60 }), "alguém digitando");
  never(() => film({ qp: null }), "sem QP não dá para comparar");
  never(() => film({ codec: "H264", qp: 30 }), "QP de outro codec");
  never(() => film({ sourceFps: null }), "um navegador que não informa a captura");

  // A scroll that stops starts the count again.
  const scroll = new PictureWatch();
  run(scroll, film, 0, 8 * SECOND);
  run(scroll, () => film({ fps: 5, sourceFps: 5 }), 8 * SECOND, 2 * SECOND);
  run(scroll, film, 10 * SECOND, 8 * SECOND);
  assert.equal(scroll.moving, false);
}

// In AV1 fewer pixels do not get more frames out, until the link is very short indeed.
{
  const dense = () => starved({ fps: 6, codec: "AV1", qp: 208, availableKbps: 1400 });
  const balanced = new LinkAdapter(0);
  feed(balanced, dense, "balanced", 8 * SECOND, 60 * SECOND);
  assert.equal(balanced.capHeight, null, "página densa a 1,5 Mbps mantém os pixels");
  const short = new LinkAdapter(0);
  const thin = (availableKbps: number) => () =>
    starved({ fps: 6, codec: "AV1", qp: 208, availableKbps, height: short.capHeight ?? 1080 });
  feed(short, thin(800), "balanced", 8 * SECOND, 60 * SECOND);
  assert.equal(short.capHeight, null, "800 kbps ainda mantém os pixels");
  feed(short, thin(500), "balanced", 68 * SECOND, 60 * SECOND);
  assert.equal(short.capHeight, null, "500 kbps também");
  feed(short, thin(400), "balanced", 128 * SECOND, 60 * SECOND);
  assert.equal(short.capHeight, null, "400 kbps também");
  feed(short, thin(300), "balanced", 188 * SECOND, 6 * SECOND);
  assert.equal(short.capHeight, 720, "abaixo disso, o que cabe");
  feed(short, thin(220), "balanced", 194 * SECOND, 6 * SECOND);
  assert.equal(short.capHeight, 576);
  const text = new LinkAdapter(0);
  feed(text, () => starved({ fps: 2, codec: "AV1", qp: 208, availableKbps: 300 }), "text", 8 * SECOND, 60 * SECOND);
  assert.equal(text.capHeight, null, "texto não abre mão dos pixels em AV1");
  const unknown = new LinkAdapter(0);
  feed(unknown, () => starved({ fps: 6, codec: "AV1", qp: 208, availableKbps: 0 }), "balanced", 8 * SECOND, 60 * SECOND);
  assert.equal(unknown.capHeight, null);
}

// AV1 gets by on far less, so an estimate that would be a collapse for H264 is not one.
{
  const av1 = new LinkAdapter(0);
  feed(av1, () => starved({ fps: 2, codec: "AV1", qp: 208, availableKbps: 500 }), "motion", 8 * SECOND, 6 * SECOND);
  assert.equal(av1.capHeight, 720);
  const h264 = new LinkAdapter(0);
  feed(h264, () => starved({ fps: 2, codec: "H264", qp: 42, availableKbps: 500 }), "motion", 8 * SECOND, 6 * SECOND);
  assert.ok((h264.capHeight ?? 1080) < 720);
}

// A held picture is held to the bits it can use, and a tile already smaller than
// the hold keeps what it has.
assert.equal(heldCeilingKbps(4000, { height: 720, fps: null }, 1080, 30), 2177);
assert.equal(heldCeilingKbps(4000, { height: 576, fps: null }, 1080, 30), 1558);
assert.equal(heldCeilingKbps(4000, { height: null, fps: 15 }, 1080, 30), 2828);
assert.equal(heldCeilingKbps(1500, { height: 720, fps: 30 }, 576, 30), 1500);

console.log("sendAdaptation: ok");

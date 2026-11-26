// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/adaptFix.test.mts
//
// Experiment sq-adapt-fix (see lib/adaptFix): the four repairs, each against what happens
// without it, so the control group keeps doing exactly what it did.

import assert from "node:assert/strict";
import { LinkAdapter, MachineGovernor, PictureWatch, type SendObservation } from "./sendAdaptation.ts";
import { isAdaptFix, setAdaptFix } from "./adaptFix.ts";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

const obs = (over: Partial<SendObservation> = {}): SendObservation => ({
  fps: 30,
  sourceFps: 30,
  targetFps: 30,
  encodeMs: 8,
  hardware: false,
  limitation: "none",
  qp: 34,
  codec: "H264",
  targetKbps: 2000,
  sentKbps: 2000,
  availableKbps: 2000,
  height: 1080,
  ...over,
});

assert.equal(isAdaptFix(), false, "ninguém está no experimento sem estar");

// --- a viewer back from a pause ---------------------------------------------------------

// A link that carries 720p and not 1080p: 1080 loses frames, 720 goes at 30 fps without bits
// to spare. Held at 720 before the pause, the same link after it.
function pauseAndResume(fixed: boolean) {
  setAdaptFix(fixed);
  let link = new LinkAdapter(0);
  const at = (height: number) =>
    height >= 1080
      ? obs({ fps: 9, limitation: "bandwidth", qp: 40, availableKbps: 1100, targetKbps: 1100, sentKbps: 1100 })
      : obs({ height, qp: 34, availableKbps: 1100, targetKbps: 1100, sentKbps: 1000 });
  let now = 0;
  for (; now < 30 * SECOND; now += 2 * SECOND) link.update(at(link.capHeight ?? 1080), "balanced", 1080, now);
  assert.equal(link.capHeight, 720, "segura em 720 antes da pausa");
  // Paused for a minute, and back.
  now += MINUTE;
  if (fixed) link.restart(now);
  else {
    // What setRequest does outside the experiment.
    const cap = link.capHeight;
    link = new LinkAdapter(now);
    link.capHeight = cap;
  }
  // Two minutes on the same link: how long at a height it cannot carry.
  let overMs = 0;
  for (const end = now + 2 * MINUTE; now < end; now += 2 * SECOND) {
    const height = link.capHeight ?? 1080;
    if (height > 720) overMs += 2 * SECOND;
    link.update(at(height), "balanced", 1080, now);
  }
  setAdaptFix(false);
  return overMs;
}
{
  const before = pauseAndResume(false);
  const after = pauseAndResume(true);
  assert.ok(before >= 6 * SECOND, `sem o experimento, a altura volta a 1080 cedo demais (${before} ms)`);
  assert.equal(after, 0, "com ele, o que o link ensinou fica");
}

// --- a link that keeps failing at the next height ---------------------------------------

// The stats pump's samples come about 2 s apart, never exactly: a pass reads up to twelve
// senders one after the other, and a loaded page is late. 2.0, 2.1, 2.2 s.
const step = (i: number) => 2 * SECOND + (i % 3) * 100;

// 720 has bits to spare (QP 26), 1080 loses frames: every step up fails. For two hours.
function flapping(fixed: boolean) {
  setAdaptFix(fixed);
  const link = new LinkAdapter(0);
  for (let now = 0, i = 0; now < 2 * 60 * MINUTE; now += step(i++)) {
    const high = link.capHeight === null;
    link.update(
      high ? obs({ fps: 10, limitation: "bandwidth", qp: 38 }) : obs({ height: 720, qp: 26, sentKbps: 1500 }),
      "balanced",
      1080,
      now
    );
  }
  setAdaptFix(false);
  return link.failedUps;
}
{
  const before = flapping(false);
  const after = flapping(true);
  // At the ceiling of 5 minutes, about 12 an hour, after the first doublings.
  assert.ok(after <= 30, `com o experimento, ~12 por hora no teto (${after} em 2 h)`);
  assert.ok(before >= after * 1.4, `sem ele, o teto não se mantém (${before} contra ${after} em 2 h)`);
}

// A step up that holds makes the next one come sooner, and a new shortage after a long quiet
// starts on the short wait.
{
  setAdaptFix(true);
  const link = new LinkAdapter(0);
  const short = obs({ fps: 10, limitation: "bandwidth", qp: 38 });
  const fine = obs({ height: 720, qp: 26, sentKbps: 1500 });
  let now = 0;
  const run = (o: (height: number | null) => SendObservation, ms: number) => {
    for (const end = now + ms; now < end; now += 2 * SECOND) link.update(o(link.capHeight), "balanced", 1080, now);
  };
  // Three failed tries: the wait is at 2 minutes.
  run((h) => (h === null ? short : fine), 4 * MINUTE);
  assert.ok(link.failedUps >= 3);
  // The link gets better: the next try holds, and so does the picture.
  run((h) => (h === null ? obs({ qp: 30 }) : fine), 5 * MINUTE);
  assert.equal(link.capHeight, null);
  // Ten minutes later a new shortage: down, and the next try after the short wait, not two minutes.
  run(() => obs({ qp: 30 }), 10 * MINUTE);
  run((h) => (h === null ? short : fine), 14 * SECOND);
  assert.equal(link.capHeight, 720);
  const downAt = now;
  run((h) => (h === null ? obs({ qp: 30 }) : fine), 40 * SECOND);
  assert.equal(link.capHeight, null, `de volta em ${(now - downAt) / SECOND} s`);
  setAdaptFix(false);
}

// --- the machine governor, with the costly codec overloading the machine ----------------

// AV1 makes the operating system say "serious" within seconds every time it comes back.
function av1Returns(fixed: boolean) {
  setAdaptFix(fixed);
  const governor = new MachineGovernor();
  let returns = 0;
  let level = 0;
  for (let now = 0, i = 0; now < 2 * 60 * MINUTE; now += step(i++)) {
    governor.observe("a", obs({ codec: level === 0 ? "AV1" : "H264" }), "balanced", true, { height: 1080, fps: 30, sharp: level === 0 }, now);
    governor.tick(level === 0 ? "serious" : "nominal", now);
    if (level > 0 && governor.level === 0) returns += 1;
    level = governor.level;
  }
  setAdaptFix(false);
  return returns;
}
{
  const before = av1Returns(false);
  const after = av1Returns(true);
  assert.ok(after <= 30, `com o experimento, ~12 voltas por hora no teto (${after} em 2 h)`);
  assert.ok(before >= after * 1.4, `sem ele, ${before} voltas contra ${after}`);
}

// --- leaving the costly codec on a short link -------------------------------------------

{
  setAdaptFix(true);
  // A moving picture in AV1 at 1080 on 1.5 Mbps: fine in AV1, too little for H264 at 1080.
  const link = new LinkAdapter(0);
  for (let now = 0; now < 20 * SECOND; now += 2 * SECOND) {
    link.update(obs({ codec: "AV1", qp: 150, availableKbps: 1500, sentKbps: 1300 }), "balanced", 1080, now);
  }
  assert.equal(link.capHeight, null);
  assert.equal(link.leftSharp(20 * SECOND, "balanced", 1080), true);
  assert.equal(link.capHeight, 720, "H264 começa na altura que o link carrega");
  // A page sitting still, or "text", starts where it was: no shortage to go by.
  const still = new LinkAdapter(0);
  for (let now = 0; now < 20 * SECOND; now += 2 * SECOND) {
    still.update(obs({ codec: "AV1", fps: 1, sourceFps: 1, qp: 60, availableKbps: 1500 }), "balanced", 1080, now);
  }
  assert.equal(still.leftSharp(20 * SECOND, "balanced", 1080), false);
  assert.equal(still.capHeight, null);
  const text = new LinkAdapter(0);
  for (let now = 0; now < 20 * SECOND; now += 2 * SECOND) {
    text.update(obs({ codec: "AV1", qp: 150, availableKbps: 1500 }), "text", 1080, now);
  }
  assert.equal(text.leftSharp(20 * SECOND, "text", 1080), false);
  // Nor does an estimator still ramping up, in a connection's first seconds, count as a short link.
  const early = new LinkAdapter(0);
  for (let now = 0; now < 6 * SECOND; now += 2 * SECOND) {
    early.update(obs({ codec: "AV1", qp: 150, availableKbps: 400, sentKbps: 350 }), "balanced", 1080, now);
  }
  assert.equal(early.leftSharp(6 * SECOND, "balanced", 1080), false);
  assert.equal(early.capHeight, null);
  // A link with room for H264 at the top is left alone.
  const roomy = new LinkAdapter(0);
  for (let now = 0; now < 20 * SECOND; now += 2 * SECOND) {
    roomy.update(obs({ codec: "AV1", qp: 120, availableKbps: 6000 }), "balanced", 1080, now);
  }
  assert.equal(roomy.leftSharp(20 * SECOND, "balanced", 1080), false);
  assert.equal(roomy.capHeight, null);
  setAdaptFix(false);
}

// --- camera mode, tried and worse -------------------------------------------------------

{
  const page = (over: Partial<SendObservation> = {}) =>
    obs({ codec: "AV1", qp: 202, fps: 25.5, targetKbps: 1500, sentKbps: 1500, availableKbps: 1600, ...over });
  const run = (watch: PictureWatch, o: () => SendObservation, from: number, ms: number) => {
    for (let now = from; now < from + ms; now += 2 * SECOND) watch.update(o(), now);
  };
  // Code scrolling at 1.5 Mbps: camera mode loses frames. A verdict, for five minutes.
  const worse = new PictureWatch();
  run(worse, () => page(), 0, 12 * SECOND);
  assert.equal(worse.trying, true);
  run(worse, () => page({ fps: 8.6, qp: 208 }), 12 * SECOND, 8 * SECOND);
  assert.equal(worse.moving, false);
  assert.ok(worse.verdictUntil >= 12 * SECOND + 5 * MINUTE - 2 * SECOND, "vale para os outros por 5 minutos");
  // A try that only lost its bits to another viewer says nothing about the picture.
  const starved = new PictureWatch();
  run(starved, () => page({ qp: 150 }), 0, 12 * SECOND);
  run(starved, () => page({ qp: 200, sentKbps: 700 }), 12 * SECOND, 8 * SECOND);
  assert.equal(starved.moving, false);
  assert.equal(starved.verdictUntil, 0);
}

console.log("adaptFix ok");

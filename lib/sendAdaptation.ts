// What a broadcaster's encoders do when something runs short.
//
// WebRTC's own answer is the quality scaler: it cuts resolution when QP runs
// high, and only gives it back when QP falls under a low threshold (24 for
// H264). A share starts with the bandwidth estimator at a few hundred kbps, so
// nearly every H264 share was cut in its first seconds, and at the lower
// resolution QP then sits just above the threshold no matter how many bits are
// free. In the lab, with no network limit at all, 1080p went to 270p, climbed
// to 540p and stayed there with 4 Mbps to spare, labelled "bandwidth". A tile
// hidden and shown again, or a dip in the link, cut it further. In production
// that was 25% of all sending time.
//
// So every sender runs under maintain-resolution, which keeps the scaler out,
// and this module does the job instead, with two differences that matter:
// it acts on evidence that the picture is actually suffering (frames lost
// against what the capture delivered), and everything it takes away it gives
// back on its own, trying again later if that turns out too soon.
//
// Two adapters, because the two shortages have different answers:
//
//   LinkAdapter      one per connection: not enough bits for this viewer. The
//                    other viewers are not affected.
//   MachineGovernor  one per machine: the encoders cannot keep up. Every
//                    connection shares that CPU, so every connection gives
//                    something up.
//
// And chooseSharp, which is not about a shortage yet: how many connections this
// machine can afford to send in the costly codec (see lib/videoCodecPreferences).
// PictureWatch then says which of that codec's two modes the picture wants.
//
// Pure, apart from the PressureObserver wrapper at the end, so the rules can be
// tested without a browser.

export type ShareProfile = "text" | "balanced" | "motion";

export interface SendObservation {
  /** Frames sent per second. */
  fps: number;
  /** Frames the capture delivered per second; null where the browser does not say. */
  sourceFps: number | null;
  /** The frame rate this sender was told to send at; 0 when unknown. */
  targetFps: number;
  /** Milliseconds the encoder spent per frame; null where unknown. */
  encodeMs: number | null;
  /** Whether that encoder is a hardware one; null where unknown. */
  hardware: boolean | null;
  /** qualityLimitationReason. */
  limitation: string;
  /** Average QP of what was encoded; null when nothing was. */
  qp: number | null;
  /** "VP9", "H264", …; null where unknown. QP scales differ per codec. */
  codec: string | null;
  /** What the bandwidth estimator lets this encoder spend, kbps; 0 when unknown. */
  targetKbps: number;
  /** What is actually going out, kbps. */
  sentKbps: number;
  /** The estimate for this connection's path, kbps; 0 when unknown. */
  availableKbps: number;
  /** Height being sent. */
  height: number;
}

// Below this the capture itself is barely delivering anything: a still screen
// or a slow page, not a shortage.
const MOVING_FPS = 8;

/** The frame rate this sender should be reaching; 0 when there is no telling. */
export function expectedFps(o: SendObservation): number {
  if (o.sourceFps === null) return 0;
  return o.targetFps > 0 ? Math.min(o.sourceFps, o.targetFps) : o.sourceFps;
}

// How much of the time the frame rate allows one frame may take before the encoder
// counts as busy. A software encoder's figure is CPU. A hardware encoder's is the
// whole trip through the GPU, queue included: AMD's takes 18 ms with one stream and
// 40 with six, with the CPU idle, and reading that as short of CPU would hold everybody
// down for one viewer's bad link.
const BUSY_ENCODE_SHARE = 0.6;
const BUSY_ENCODE_SHARE_HARDWARE = 1.5;
// And how much of its time an encoder has to be spending on frames at all. One frame
// a second at 20 ms each is a link that has collapsed, not a machine short of anything.
const BUSY_MIN_DUTY = 0.3;

/** The encoder cannot keep up: it says so, or each frame takes too long. */
export function encoderBusy(o: SendObservation): boolean {
  if (o.limitation === "cpu") return true;
  const expected = expectedFps(o);
  if (expected <= 0 || o.encodeMs === null) return false;
  if ((o.encodeMs * o.fps) / 1000 < BUSY_MIN_DUTY) return false;
  return o.encodeMs >= (1000 / expected) * (o.hardware === true ? BUSY_ENCODE_SHARE_HARDWARE : BUSY_ENCODE_SHARE);
}

/** How far below the capture this profile lets the frame rate fall before acting. */
const FALLING_BEHIND_SHARE: Record<ShareProfile, number> = {
  // A sharp picture at a low frame rate is what this profile asks for.
  text: 0.4,
  balanced: 0.6,
  motion: 0.75,
};

/** The capture has frames, and far fewer than that are going out. */
export function fallingBehind(o: SendObservation, profile: ShareProfile): boolean {
  const expected = expectedFps(o);
  return expected >= MOVING_FPS && o.fps < expected * FALLING_BEHIND_SHARE[profile];
}

// How far below what it could send this profile lets the frame rate fall for lack
// of CPU. Asks for more than a link can give: here what is lost to get it back is a
// little resolution, and in the lab that was a good trade (VP8 at 1080p held 18 fps
// on two cores for three viewers, with nothing to say it should do anything else).
const MACHINE_BEHIND_SHARE: Record<ShareProfile, number> = {
  text: 0.5,
  balanced: 0.75,
  motion: 0.85,
};

/**
 * How the frame rate stands against what this profile asks when CPU is what is short:
 * under 1 is behind. Null when there is nothing to compare, on a still screen or where
 * the browser does not say. Under a CPU restriction WebRTC thins the frames out before
 * they are counted as captured, so the capture appears to deliver only what goes out;
 * that case compares against the rate asked for.
 */
export function machinePace(o: SendObservation, profile: ShareProfile): number | null {
  if (o.sourceFps !== null && o.sourceFps < MOVING_FPS) return null;
  const expected = o.limitation === "cpu" && o.targetFps > 0 ? o.targetFps : expectedFps(o);
  return expected > 0 ? o.fps / (expected * MACHINE_BEHIND_SHARE[profile]) : null;
}

/** Frames are being lost for lack of CPU. */
export function machineBehind(o: SendObservation, profile: ShareProfile): boolean {
  const pace = machinePace(o, profile);
  return pace !== null && pace < 1 && encoderBusy(o);
}

// QP past which a moving picture is visibly falling apart, per codec. "text"
// has none: it asks for its resolution to be kept.
const QP_BLURRY: Record<string, Partial<Record<ShareProfile, number>>> = {
  // WebRTC holds H264 at 42 and drops frames past it, so at 41 there is nothing left
  // to spend. At 1.5 Mbps that is 1080p video at 30.7 dB and 25 fps, where 576p makes
  // 33.8 dB at 30.
  H264: { balanced: 41, motion: 38 },
  // WebRTC holds VP8 at 106 on this scale, and past that it drops frames, which
  // fallingBehind sees. Cutting "balanced" on the number alone only gave up pixels:
  // 683 lines at 30 fps where 1024 lines at 30 fps was there for the taking.
  VP8: { motion: 100 },
  VP9: { balanced: 210, motion: 170 },
  // In camera mode it holds 30 fps at 192 and 36.6 dB (800 kbps). WebRTC stops it at 208.
  AV1: { balanced: 210, motion: 200 },
};
// QP under which there are bits to spare for more pixels.
const QP_ROOMY: Record<string, number> = { H264: 28, VP8: 40, VP9: 95, AV1: 95 };

function codecKey(codec: string | null): string | null {
  return codec ? codec.toUpperCase() : null;
}

// Whether the picture is moving at all. A browser that does not report the capture's
// rate goes by what is being sent.
function isMoving(o: SendObservation): boolean {
  return (o.sourceFps === null ? o.fps : expectedFps(o)) >= MOVING_FPS;
}

// Only of a moving picture. A still one runs through the same QP for a moment on its
// way to being sharp, and cutting its resolution for that costs far more than it
// looks: text at 720p upscaled is 26 dB, where left alone it settles at 47.
function blurry(o: SendObservation, profile: ShareProfile): boolean {
  const key = codecKey(o.codec);
  const limit = key ? QP_BLURRY[key]?.[profile] : undefined;
  return limit !== undefined && o.qp !== null && o.qp >= limit && isMoving(o);
}

function roomy(o: SendObservation): boolean {
  const key = codecKey(o.codec);
  const limit = key ? QP_ROOMY[key] : undefined;
  return limit !== undefined && o.qp !== null && o.qp <= limit;
}

// Frames going missing at a low QP, with the link well above what is being sent, are no
// shortage of bits. AMD's H264 encoder can sit at 13-20 fps at QP 16, on 6 Mbps of a 12 Mbps
// estimate (see ENCODER_START_KBPS in lib/peerQualityController), and taking it down to 576
// lines left it at 13-20 fps.
const LINK_ROOM_FACTOR = 1.4;

function linkHasRoom(o: SendObservation): boolean {
  return roomy(o) && o.availableKbps >= o.sentKbps * LINK_ROOM_FACTOR;
}

// Whether fewer pixels would get more frames out. In H264 they do. AV1 holds 30 fps on so
// few bits that what it runs out of is a page too dense for any height: a white page of
// small text scrolling at 1.5 Mbps goes 5.7 fps at 1024 lines and 30.7 dB, 7.9 at 720 and
// 23.0, and code at 800 kbps goes 12.9 fps at 33.6 dB, 17 at 29.5. Video has camera mode for
// that: at 400 kbps it goes 11.5 fps at 34.9 dB in 1024 lines, level with VP9 there, against
// 19.5 at 33.3 in 720. Only around 300 kbps do the pixels have to go, since 4 fps is no
// picture at any sharpness: video goes to 21 fps at 32.1 dB in 576 lines. "text" asked for
// its pixels anyway, and "motion" for its frames.
const AV1_KEEPS_ITS_PIXELS_KBPS = 320;

function fewerPixelsWouldHelp(o: SendObservation, profile: ShareProfile): boolean {
  if (codecKey(o.codec) !== "AV1" || profile === "motion") return true;
  if (profile === "text" || o.availableKbps <= 0) return false;
  return o.availableKbps < AV1_KEEPS_ITS_PIXELS_KBPS;
}

// The heights a connection steps through, top down. 576p is where a screen
// stops being readable, so only "motion", where frame rate is the point and
// nobody is reading, goes below it.
const RUNGS = [2160, 1440, 1080, 720, 576, 432, 360];
const FLOOR: Record<ShareProfile, number> = { text: 720, balanced: 576, motion: 360 };

function nextDown(height: number, profile: ShareProfile): number | null {
  const next = RUNGS.find((rung) => rung < height);
  return next !== undefined && next >= FLOOR[profile] ? next : null;
}

function nextUp(height: number): number {
  let up = height;
  for (const rung of RUNGS) if (rung > height) up = rung;
  return up;
}

// The least a moving picture of this height holds 30 fps on, at the highest QP WebRTC
// allows. Measured on video: 2.5 Mbps at 1024 lines, 1.2 at 720, 800 kbps at 576. AV1
// does it on less than half of that: 1.2 Mbps at 1024 lines.
const LEAST_KBPS_FACTOR = 2.4;
const LEAST_KBPS_FACTOR_AV1 = 1.15;

function leastKbps(height: number, codec: string | null): number {
  return ((codecKey(codec) === "AV1" ? LEAST_KBPS_FACTOR_AV1 : LEAST_KBPS_FACTOR) * height * height) / 1000;
}

// The first seconds of a connection are the bandwidth estimator ramping up and an
// encoder finding its feet, not a shortage worth a decision that sticks.
export const SEND_GRACE_MS = 8000;
// How long the shortage has to hold. Longer than a burst of scrolling that overruns
// the link for two or three seconds and is over, which is not worth a smaller picture.
const LINK_HOLD_MS: Record<ShareProfile, number> = { text: 8000, balanced: 4000, motion: 4000 };
// How long things have to look fine before trying more pixels again, and the
// ceiling that doubles towards each time an attempt fails.
const LINK_UP_WAIT_MS = 15_000;
const LINK_UP_WAIT_MAX_MS = 5 * 60_000;
// A shortage this soon after stepping up means the step up was the mistake.
const FLAP_WINDOW_MS = 25_000;
// Free bits this far above where the shortage happened count as the link having
// changed, whatever QP says.
const LINK_RECOVERED_FACTOR = 1.4;
// And this far above, whatever ran short is simply gone. Nothing is gained by
// climbing back a rung at a time, each one a keyframe and a 15 s wait, to a picture
// the link could have carried all along.
const LINK_BACK_FACTOR = 2;
const LINK_BACK_WAIT_MS = 8000;
// An estimate under this share of what the next rung needs means the link has
// collapsed: 6 Mbps running into a sudden 900 kbps can take it down to 200. That is no
// place to go down a rung at a time, each one another 4 s at 1 or 2 fps.
const LINK_COLLAPSED_SHARE = 0.5;
// The most one sample counts for, however long since the one before.
const LINK_SAMPLE_MAX_MS = 10_000;

export class LinkAdapter {
  /** The most this connection may send, or null when nothing is short. */
  capHeight: number | null = null;
  private readonly startedAt: number;
  private lastSampleAt: number;
  private shortSince: number | null = null;
  private fineMs = 0;
  private upWaitMs = LINK_UP_WAIT_MS;
  private lastUpAt = 0;
  private lastDownAt = 0;
  private shortAtKbps = 0;

  constructor(now: number) {
    this.startedAt = now;
    this.lastSampleAt = now;
  }

  /**
   * One sample of this connection; `topHeight` is what it would be sent at with
   * nothing held back. True when capHeight changed.
   */
  update(o: SendObservation, profile: ShareProfile, topHeight: number, now: number): boolean {
    const elapsed = Math.min(now - this.lastSampleAt, LINK_SAMPLE_MAX_MS);
    this.lastSampleAt = now;
    if (now - this.startedAt < SEND_GRACE_MS) return false;
    // Not this connection's to fix: see MachineGovernor.
    const short =
      !encoderBusy(o) && !linkHasRoom(o) && (fallingBehind(o, profile) || blurry(o, profile)) && fewerPixelsWouldHelp(o, profile);
    if (short) {
      this.fineMs = 0;
      this.shortSince ??= now;
      if (now - this.lastUpAt < FLAP_WINDOW_MS && this.lastUpAt > this.lastDownAt) {
        this.upWaitMs = Math.min(this.upWaitMs * 2, LINK_UP_WAIT_MAX_MS);
        this.lastUpAt = 0;
      }
      if (now - this.shortSince < LINK_HOLD_MS[profile]) return false;
      this.shortSince = null;
      let next = nextDown(Math.min(this.capHeight ?? o.height, o.height), profile);
      if (next === null) return false;
      while (o.availableKbps > 0 && o.availableKbps < leastKbps(next, o.codec) * LINK_COLLAPSED_SHARE) {
        const lower = nextDown(next, profile);
        if (lower === null) break;
        next = lower;
      }
      this.capHeight = next;
      this.lastDownAt = now;
      // Not below what this height needs: twice a collapsed estimate says nothing about
      // the link being back.
      this.shortAtKbps = Math.max(o.targetKbps, o.availableKbps, leastKbps(next, o.codec));
      return true;
    }
    this.shortSince = null;
    if (this.capHeight === null) return false;
    // Busy encoders say nothing about the link, and the browser leaves the estimate
    // out of the odd report.
    if (encoderBusy(o) || o.availableKbps === 0) return false;
    const back = o.availableKbps >= this.shortAtKbps * LINK_BACK_FACTOR;
    const better = o.availableKbps >= this.shortAtKbps * LINK_RECOVERED_FACTOR;
    // Moving and the link no better than it was: more pixels would only bring the
    // shortage back. But that is no sign of a shortage either, so the time neither
    // counts nor starts the count again: a screen that stops and scrolls and stops
    // gets its pixels back over the stops.
    if (isMoving(o) && !roomy(o) && !better) return false;
    this.fineMs += elapsed;
    if (this.fineMs < (back ? Math.min(this.upWaitMs, LINK_BACK_WAIT_MS) : this.upWaitMs)) return false;
    this.fineMs = 0;
    this.lastUpAt = now;
    if (now - this.lastDownAt > LINK_UP_WAIT_MAX_MS) this.upWaitMs = LINK_UP_WAIT_MS;
    const up = nextUp(this.capHeight);
    // A cap at or above what would be sent anyway holds nothing back.
    this.capHeight = back || up >= topHeight ? null : up;
    return true;
  }
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

export interface MachineCap {
  height: number | null;
  fps: number | null;
  /** Whether a connection may stay in the costly codec at this level. */
  sharp: boolean;
}

// What each level gives up, per profile. Each profile keeps what it promises
// longest: "text" its pixels, "motion" its frames. The same length for all of them,
// since a level is one number for a machine that may be sending a screen and a
// camera. Most levels change nothing for a given share (a 30 fps 1080p one has
// nothing to lose to "1440 lines"), and the governor walks straight past those.
//
// The costly codec is the first thing "balanced" gives up: it frees more CPU than any
// other step, and on a link with bits to spare the picture hardly moves. "text" asked
// for that picture, and gives up frames first: a page sits still most of the time.
const MACHINE_STEPS: Record<ShareProfile, MachineCap[]> = {
  text: [
    { height: null, fps: 60, sharp: true },
    { height: null, fps: 30, sharp: true },
    { height: null, fps: 20, sharp: true },
    { height: null, fps: 15, sharp: true },
    { height: null, fps: 15, sharp: false },
    { height: 1440, fps: 15, sharp: false },
    { height: 1080, fps: 15, sharp: false },
    { height: 720, fps: 15, sharp: false },
    { height: 576, fps: 15, sharp: false },
  ],
  balanced: [
    { height: null, fps: null, sharp: false },
    { height: null, fps: 60, sharp: false },
    { height: null, fps: 30, sharp: false },
    { height: 1440, fps: 30, sharp: false },
    { height: 1080, fps: 30, sharp: false },
    { height: 720, fps: 30, sharp: false },
    { height: 720, fps: 24, sharp: false },
    { height: 576, fps: 24, sharp: false },
    { height: 576, fps: 15, sharp: false },
  ],
  motion: [
    { height: null, fps: null, sharp: false },
    { height: 1440, fps: null, sharp: false },
    { height: 1080, fps: null, sharp: false },
    { height: 720, fps: null, sharp: false },
    { height: 576, fps: null, sharp: false },
    { height: 576, fps: 30, sharp: false },
    { height: 432, fps: 30, sharp: false },
    { height: 360, fps: 30, sharp: false },
    { height: 360, fps: 24, sharp: false },
  ],
};
export const MACHINE_MAX_LEVEL = 9;

/**
 * What a ceiling is worth while the machine holds a tier down. Bits are CPU too: an
 * encoder left with the bitrate of a bigger picture spends it on QP nobody can see.
 * In the lab, VP8 at 576 lines with 1080p's 4 Mbps sat at QP 13 and 70 ms a frame on
 * a machine that was short of nothing else. Close to what the ladder itself gives
 * those heights (2.2 Mbps at 720p, 1.6 at 576p, from 4 at 1080p).
 */
export function heldCeilingKbps(
  ceilingKbps: number,
  cap: Pick<MachineCap, "height" | "fps">,
  tierHeight: number,
  tierFps: number
): number {
  const height = Math.min(1, (cap.height ?? tierHeight) / tierHeight);
  const fps = Math.min(1, (cap.fps ?? tierFps) / tierFps);
  return Math.round(ceilingKbps * height ** 1.5 * fps ** 0.5);
}

/** What machine level `level` means for a share under `profile`. */
export function machineCapFor(level: number, profile: ShareProfile): MachineCap {
  if (level <= 0) return { height: null, fps: null, sharp: true };
  const steps = MACHINE_STEPS[profile];
  return steps[Math.min(level, steps.length) - 1];
}

export type CpuPressure = "nominal" | "fair" | "serious" | "critical" | null;

// The encoders falling behind on average, for this long.
const MACHINE_HOLD_MS = 6000;
// How long to look at the result of a step before taking another.
const MACHINE_SETTLE_MS = 6000;
// The operating system saying the machine is out of CPU, with encoding in
// software among the reasons, and for this long, is enough on its own.
const MACHINE_CRITICAL_HOLD_MS = 12_000;
// But only this far, with every frame still going out: there most of what an encoder takes
// is free (.85 of a core at 1080p in H264, .39 at 720p), and what is left is not worth a
// picture nobody can fault. Every core of a machine burned, one H264 encoder went on at 30
// fps and 1024 lines, and was walked down to 576 lines at 15 fps all the same. From here on
// it takes frames actually being lost.
const MACHINE_CRITICAL_MAX_LEVEL: Record<ShareProfile, number> = { text: 5, balanced: 6, motion: 4 };
// Merely busy, whoever's fault that is, is enough to give up the costly codec. Nothing
// is being lost yet, but somebody running a game on the same machine is who "my PC
// stutters when I share" comes from, and this costs them next to nothing to fix.
const MACHINE_SERIOUS_HOLD_MS = 10_000;
const MACHINE_UP_WAIT_MS = 20_000;
const MACHINE_UP_WAIT_MAX_MS = 5 * 60_000;
// A reading older than this says nothing about now: a large room is visited in
// turns, but never this slowly.
const OBSERVATION_MAX_AGE_MS = 15_000;

/** What a connection would be sent at with nothing held back. */
export interface SendTop {
  height: number;
  fps: number;
  /** Whether it is in the costly codec. */
  sharp: boolean;
}

interface MachineReading {
  pace: number | null;
  busy: boolean;
  software: boolean;
  profile: ShareProfile;
  top: SendTop;
  at: number;
}

export class MachineGovernor {
  level = 0;
  private readings = new Map<string, MachineReading>();
  private behindSince: number | null = null;
  private criticalSince: number | null = null;
  private seriousSince: number | null = null;
  private calmSince: number | null = null;
  private lastStepAt = 0;
  private lastUpAt = 0;
  private upWaitMs = MACHINE_UP_WAIT_MS;

  /** One sample of one connection that is actually sending. */
  observe(key: string, o: SendObservation, profile: ShareProfile, software: boolean, top: SendTop, now: number) {
    this.readings.set(key, { pace: machinePace(o, profile), busy: encoderBusy(o), software, profile, top, at: now });
  }

  // Whether two levels mean anything different for what is being sent. A step that
  // frees nothing would just be 6 seconds of waiting on the way down and 20 more on
  // the way up.
  private differs(a: number, b: number): boolean {
    for (const { profile, top } of this.readings.values()) {
      const capA = machineCapFor(a, profile);
      const capB = machineCapFor(b, profile);
      if (Math.min(top.height, capA.height ?? top.height) !== Math.min(top.height, capB.height ?? top.height)) return true;
      if (Math.min(top.fps, capA.fps ?? top.fps) !== Math.min(top.fps, capB.fps ?? top.fps)) return true;
      if (top.sharp && capA.sharp !== capB.sharp) return true;
    }
    return false;
  }

  // The next level down that changes anything; null when nothing is left to give up.
  private nextLevelDown(): number | null {
    let next = this.level + 1;
    while (next < MACHINE_MAX_LEVEL && !this.differs(this.level, next)) next += 1;
    return next > MACHINE_MAX_LEVEL || !this.differs(this.level, next) ? null : next;
  }

  private withinCriticalReach(next: number): boolean {
    for (const { profile } of this.readings.values()) {
      if (next > MACHINE_CRITICAL_MAX_LEVEL[profile]) return false;
    }
    return true;
  }

  // Whether stepping there has some connection give up the costly codec.
  private givesUpSharp(next: number): boolean {
    for (const { profile, top } of this.readings.values()) {
      if (top.sharp && !machineCapFor(next, profile).sharp) return true;
    }
    return false;
  }

  forget(key: string) {
    this.readings.delete(key);
    // Nothing left being encoded: nothing to hold back for the next viewer.
    if (this.readings.size === 0) this.reset();
  }

  private reset() {
    this.level = 0;
    this.behindSince = null;
    this.criticalSince = null;
    this.seriousSince = null;
    this.calmSince = null;
  }

  /** Called once per stats pass. True when the level changed. */
  tick(pressure: CpuPressure, now: number): boolean {
    let live = 0;
    let software = 0;
    let behind = 0;
    let paced = 0;
    let paceSum = 0;
    for (const [key, reading] of this.readings) {
      if (now - reading.at > OBSERVATION_MAX_AGE_MS) {
        this.readings.delete(key);
        continue;
      }
      live += 1;
      if (reading.software) software += 1;
      if (reading.pace === null) continue;
      const late = reading.pace < 1;
      // Late with an encoder that is not busy is that viewer's link: see LinkAdapter.
      if (late && !reading.busy) continue;
      if (late) behind += 1;
      paced += 1;
      paceSum += reading.pace;
    }
    if (live === 0) {
      const changed = this.level !== 0;
      this.reset();
      return changed;
    }
    // On average and not one by one, since encoders do not share a CPU evenly. Three
    // viewers on two cores go 29, 30 and 22 fps, and cutting everybody for the third
    // gave 30 fps at 37.7 dB where 27 at 42.7 was the better picture.
    const struggling = behind > 0 && paceSum / paced < 1;
    this.behindSince = struggling ? (this.behindSince ?? now) : null;
    const next = this.nextLevelDown();
    const critical = pressure === "critical" && software > 0;
    this.criticalSince = critical && next !== null && this.withinCriticalReach(next) ? (this.criticalSince ?? now) : null;
    const serious =
      (pressure === "serious" || pressure === "critical") && next !== null && this.givesUpSharp(next);
    this.seriousSince = serious ? (this.seriousSince ?? now) : null;

    const held =
      (this.behindSince !== null && now - this.behindSince >= MACHINE_HOLD_MS) ||
      (this.criticalSince !== null && now - this.criticalSince >= MACHINE_CRITICAL_HOLD_MS) ||
      (this.seriousSince !== null && now - this.seriousSince >= MACHINE_SERIOUS_HOLD_MS);
    if (held) {
      this.calmSince = null;
      if (now - this.lastStepAt < MACHINE_SETTLE_MS) return false;
      // Nothing left to give up.
      if (next === null) return false;
      if (this.lastUpAt > 0 && now - this.lastUpAt < FLAP_WINDOW_MS) {
        this.upWaitMs = Math.min(this.upWaitMs * 2, MACHINE_UP_WAIT_MAX_MS);
      }
      this.lastUpAt = 0;
      this.level = next;
      this.lastStepAt = now;
      return true;
    }
    if (this.level === 0) return false;
    if (struggling || critical || pressure === "serious") {
      this.calmSince = null;
      return false;
    }
    this.calmSince ??= now;
    if (now - this.calmSince < this.upWaitMs) return false;
    this.calmSince = null;
    if (now - this.lastStepAt > MACHINE_UP_WAIT_MAX_MS) this.upWaitMs = MACHINE_UP_WAIT_MS;
    let up = this.level - 1;
    while (up > 0 && !this.differs(up, this.level)) up -= 1;
    // And on down through whatever means the same as where that lands.
    while (up > 0 && !this.differs(up - 1, up)) up -= 1;
    this.level = up;
    this.lastStepAt = now;
    this.lastUpAt = now;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Who gets the costly codec
// ---------------------------------------------------------------------------

/** One connection that could go out in the costly codec. */
export interface SharpCandidate {
  key: string;
  profile: ShareProfile;
  /** Height and frame rate it is being sent at. */
  height: number;
  fps: number;
  /** Whether it is in that codec now. */
  holding: boolean;
  /** Whether it may move into it now, if it is not. */
  mayTake: boolean;
  /** The estimate for its path, kbps; 0 until there is one worth believing. */
  availableKbps: number;
}

// How much of a machine the encoders of the costly codec may take, per profile. A share
// of the logical cores, which on most machines is twice the real ones, and what a
// moving picture costs. A page sitting still costs a tenth of that.
const SHARP_MACHINE_SHARE: Record<ShareProfile, number> = { text: 0.5, balanced: 0.3, motion: 0.2 };
// More of it where the picture is lost without it, which in H264 is anywhere under about 6 Mbps
// at 1080p: video at 3 Mbps is 43 dB in AV1 and 36 in H264, and at 4.5 Mbps about 45 and 40. VP9
// used to take as much for every viewer, with no limit at all. The machine governor takes it back
// from a machine that does not have it to give.
const SHARP_SHORT_LINK_MACHINE_SHARE = 0.6;
const SHARP_SHORT_LINK_SHARE = 2.1;
const SHARP_GIVES_BACK_SHARE = 2.6;

// What one encoder of it takes at 1080p30, moving, in cores of a Ryzen 5 3500, and how
// that goes with the pixels per second. Not in proportion, since libaom works harder per
// pixel on a smaller picture. Measured: .95 at 720p30, .68 at 576p30, .38 at 576p15, 1.8
// at 720p60, 2.2 at 1080p60.
const SHARP_CORES_1080P30 = 1.5;
const SHARP_COST_EXPONENT = 0.65;

/** The cores one encoder of the costly codec takes at this size and frame rate. */
export function sharpCost(height: number, fps: number): number {
  const width = (height * 16) / 9;
  return SHARP_CORES_1080P30 * ((width * height * fps) / (1920 * 1080 * 30)) ** SHARP_COST_EXPONENT;
}

// How long a connection stays out of it after moving, so that a viewer who comes and
// goes does not have the others changing codec, a keyframe each, every time.
export const SHARP_TAKE_WAIT_MS = 15_000;
// A link is short of bits for this picture in H264, and the codec is what it needs, under
// this much of what H264 holds 30 fps on: about 4 Mbps at 1080p, 1.1 at 576p. A viewer with a
// small tile sits at a low estimate whatever their link, since nothing is asking for more.
const SHORT_LINK_SHARE = 1.4;
// "motion" goes in H264 for as long as there are bits for it: a game needs that CPU. Short
// of them, H264 is where the picture is lost: video at 3 Mbps is 720 lines at 36.6 dB, in
// AV1's camera mode 1024 at 43.5. So it takes the costly codec on a short link, and gives
// it back once the link is clearly not one, at about 6 Mbps at 1080p.
const MOTION_GIVES_BACK_SHARE = 2.1;

function linkUnder(c: SharpCandidate, share: number): boolean {
  return c.availableKbps > 0 && c.availableKbps < leastKbps(c.height, "H264") * share;
}

function linkIsShort(c: SharpCandidate): boolean {
  return linkUnder(c, c.holding ? MOTION_GIVES_BACK_SHARE : SHORT_LINK_SHARE);
}

function wantsSharp(c: SharpCandidate): boolean {
  return c.profile !== "motion" || linkIsShort(c);
}

function linkIsShortForMachine(c: SharpCandidate): boolean {
  return c.profile === "balanced" && linkUnder(c, SHARP_SHORT_LINK_SHARE);
}

// Nor does a viewer give it back while another is short. On one uplink the estimators split it
// unevenly, and the big estimate is luck: 9 Mbps for three goes 8, 3 and 1.4, and whoever has the
// 8 is not on a link with bits to spare, they just have the others' bits for now.
function machineShare(c: SharpCandidate, someoneShort: boolean): number {
  if (c.profile !== "balanced") return SHARP_MACHINE_SHARE[c.profile];
  const short = c.holding ? someoneShort || linkUnder(c, SHARP_GIVES_BACK_SHARE) : linkIsShortForMachine(c);
  return short ? SHARP_SHORT_LINK_MACHINE_SHARE : SHARP_MACHINE_SHARE[c.profile];
}

/**
 * Which connections go out in the costly codec. A short link first, since that is where
 * it makes the most difference: 41 dB against 35 at 3 Mbps, and 44 against 42 with bits
 * to spare. Then whoever has it already, since moving costs a keyframe, and then the
 * biggest picture.
 */
export function chooseSharp(candidates: SharpCandidate[], cores: number): Set<string> {
  const short = (c: SharpCandidate) => linkUnder(c, SHORT_LINK_SHARE);
  const reach = (c: SharpCandidate) => c.availableKbps || Infinity;
  const queue = [...candidates].sort(
    (a, b) =>
      Number(short(b)) - Number(short(a)) ||
      Number(b.holding) - Number(a.holding) ||
      b.height - a.height ||
      reach(a) - reach(b)
  );
  const someoneShort = candidates.some(linkIsShortForMachine);
  const chosen = new Set<string>();
  let used = 0;
  for (const c of queue) {
    if ((!c.holding && !c.mayTake) || !wantsSharp(c)) continue;
    const cost = sharpCost(c.height, c.fps);
    if (used + cost > cores * machineShare(c, someoneShort)) continue;
    used += cost;
    chosen.add(c.key);
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Which mode the costly codec runs in
// ---------------------------------------------------------------------------

// Its screen mode is what keeps a page sharp, and a moving picture comes out better in its
// camera mode, for the same bits and about the same CPU: 43.5 dB against 41.3 at 3 Mbps,
// 39.7 against 37.8 at 1.5, 45.6 against 44.7 with bits to spare. On a page it goes the
// other way, and not by a little: code scrolling at 1.5 Mbps goes 9 fps at 28.9 dB in
// camera mode and 26 at 33.7 in screen mode, and a white page of small text overruns the
// link and goes 3 fps. Changing mode on a running connection costs one keyframe and no
// frozen picture.
//
// Nothing a sample says tells the two apart: video on a short link looks just like a dense
// page. So once the capture has been moving for longer than people scroll without a break,
// it tries camera mode and compares with what screen mode was getting just before, on this
// connection. Frames and QP, screen against camera:
//
//                       screen     camera
//   video at 3 Mbps     30 at 132  30 at 107   better
//   video at 800 kbps   20 at 205  30 at 193   better
//   video at 500 kbps   11 at 208  19 at 205   better
//   noise at 3 Mbps     10 at 207  24 at 195   better
//   code at 3 Mbps      30 at 177  30 at 178   level, and it wobbles down to 7 fps
//   code at 1.5 Mbps    25 at 202   9 at 208   worse
//   small text, free    24 at 197  25 at 190   worse: 31.6 dB against 29.9
//   a window at 3 Mbps  30 at 49   30 at 48    level
//
// So it stays only for clearly more frames, or as many at a clearly lower QP. A wrong guess
// costs a few seconds and two keyframes, and it does not guess again for a while.
//
// QP follows the bits, about 40 per doubling, and on an uplink shared with other viewers they
// come and go: 3.7 Mbps before a try and 2.7 during it is 18 of QP that say nothing about the
// mode. So what a try lost counts back. What it gained does not, since screen mode leaves a short
// link half used and using it is part of what camera mode does.
//
// Among viewers on one uplink the picture comes out level on the same bits, and what changes is
// the machine: video to three of them takes 2.9 cores where screen mode takes 3.7, and gets a
// couple more frames out. So a level picture on frames clearly cheaper to make is better too.
// One viewer does not get there: video costs about the same either way, and code half as much
// again.
//
// Every connection of a share carries the same capture, so they try one at a time and what one
// finds holds for the others. Viewers on one uplink trying together spoil it for each other:
// three keyframes at once, the estimates fall, and all three come out worse in camera mode.
//
// "text" tries too, since what it asked for is the sharper picture and no page gets past
// that. "motion" asked for camera mode.
const PICTURE_MIN_FPS = 12;
const PICTURE_HOLD_MS = 10_000;
// The first of those seconds are the estimator ramping up, and say nothing about the mode.
const PICTURE_BASE_FROM_MS = 4000;
// Fewer frames than this and it is no video, and the keyframes of a try cost the most. Video
// at 300 kbps gets 13% of them out, and small text at 500 kbps 8%.
const PICTURE_HOPELESS_SHARE = 0.1;
// The keyframe, and the rate control getting over it.
const PICTURE_SETTLE_MS = 3000;
const PICTURE_TRY_MS = 8000;
const PICTURE_MORE_FRAMES = 1.25;
const PICTURE_SAME_FRAMES = 0.9;
const PICTURE_QP_MARGIN = 10;
const PICTURE_QP_PER_DOUBLING = 40;
const PICTURE_CHEAPER_FRAMES = 0.9;
// Frames lost in camera mode need no comparing, against screen mode during the try and against
// the try afterwards: code at 1.5 Mbps goes from 25 fps to 3. During the try there is no reason
// to wait for it, and afterwards there is, since a link falling takes a few seconds to settle.
// Samples come 2 s apart, give or take, so a little under whole ones.
const PICTURE_LOST_SHARE = 0.45;
const PICTURE_LOST_TRYING_MS = 1500;
const PICTURE_LOST_MS = 3500;
// A dense page in camera mode comes in bursts, 3, 3, 18, 15, 3 fps, and one good sample does not
// clear it: that alone kept code scrolling at 3 fps for 14 s where it should have been 6.
const PICTURE_BACK_SAMPLES = 2;
const PICTURE_RETRY_MS = 5 * 60_000;
// A viewer sharing an uplink with others can lose bits to them in the middle of a try, and then
// QP says nothing about the mode. So a try that went badly on far fewer bits was no verdict, and
// nor is frames lost on far fewer bits by a mode already proven: that is the link falling, and
// on what is left camera mode may still be the better one.
const PICTURE_SAME_BITS = 0.7;
const PICTURE_RETRY_SOON_MS = 30_000;

export class PictureWatch {
  /** Whether camera mode is on, for good or to see how it does. */
  moving = false;
  /** Whether it was tried and came out better. */
  proven = false;
  private since: number | null = null;
  private fps = 0;
  private expected = 0;
  private qp = 0;
  private sentKbps = 0;
  private encodeMs = 0;
  private samples = 0;
  private screenFps = 0;
  private screenQp = 0;
  private screenKbps = 0;
  private screenEncodeMs = 0;
  private cameraFps = 0;
  private cameraKbps = 0;
  private triedAt = 0;
  private lostSince: number | null = null;
  private backFor = 0;
  private notBefore = 0;
  private lostUntil = 0;
  private adopted = false;
  private lastFps = 0;
  private lastExpected = 0;

  /** Whether camera mode is on only to see how it does. */
  get trying(): boolean {
    return this.moving && !this.proven;
  }

  /** One sample of a connection in the costly codec. True when `moving` changed. */
  update(o: SendObservation, now: number, mayTry = true): boolean {
    this.lastFps = o.fps;
    this.lastExpected = expectedFps(o);
    return this.moving ? this.stopped(o, now) : this.started(o, now, mayTry);
  }

  /**
   * Camera mode came out better on another connection with the same capture. True when
   * `moving` changed. Frames lost here still bring it back: that is this link, not the picture.
   */
  adopt(now: number): boolean {
    if (this.moving || now < this.lostUntil || this.lastExpected < PICTURE_MIN_FPS) return false;
    this.since = null;
    this.forget();
    this.screenFps = this.lastFps;
    this.triedAt = now;
    this.lostSince = null;
    this.adopted = true;
    this.moving = true;
    return true;
  }

  private measure(o: SendObservation) {
    this.fps += o.fps;
    this.expected += expectedFps(o);
    this.qp += o.qp ?? 0;
    this.sentKbps += o.sentKbps;
    this.encodeMs += o.encodeMs ?? 0;
    this.samples += 1;
  }

  private forget() {
    this.fps = 0;
    this.expected = 0;
    this.qp = 0;
    this.sentKbps = 0;
    this.encodeMs = 0;
    this.samples = 0;
  }

  private started(o: SendObservation, now: number, mayTry: boolean): boolean {
    if (now < this.notBefore || codecKey(o.codec) !== "AV1" || expectedFps(o) < PICTURE_MIN_FPS || o.qp === null) {
      this.since = null;
      return false;
    }
    if (this.since === null) {
      this.since = now;
      this.forget();
    }
    if (now - this.since >= PICTURE_BASE_FROM_MS) this.measure(o);
    if (now - this.since < PICTURE_HOLD_MS || !mayTry) return false;
    this.since = null;
    if (this.fps < this.expected * PICTURE_HOPELESS_SHARE) return false;
    this.screenFps = this.fps / this.samples;
    this.screenQp = this.qp / this.samples;
    this.screenKbps = this.sentKbps / this.samples;
    this.screenEncodeMs = this.encodeMs / this.samples;
    this.forget();
    this.triedAt = now;
    this.lostSince = null;
    this.adopted = false;
    this.moving = true;
    return true;
  }

  private stopped(o: SendObservation, now: number): boolean {
    const expected = expectedFps(o);
    // Less than any video delivers, over the seconds since the last sample: a page again, and
    // it should be sharp by the time anyone reads it. A page that scrolls now and then does
    // not get a sample as low as a still one, and in camera mode it falls apart: 4 fps at QP
    // 207 on a 3 Mbps link, for as long as it stayed there.
    if (expected < PICTURE_MIN_FPS) {
      this.moving = false;
      this.proven = false;
      return true;
    }
    const before = this.proven ? this.cameraFps : this.screenFps;
    const low = o.fps < before * PICTURE_LOST_SHARE;
    if (low) {
      this.lostSince ??= now;
      this.backFor = 0;
    } else if (this.lostSince !== null && ++this.backFor >= PICTURE_BACK_SAMPLES) {
      this.lostSince = null;
    }
    if (low && this.lostSince !== null && now - this.lostSince >= (this.proven ? PICTURE_LOST_MS : PICTURE_LOST_TRYING_MS)) {
      const fell = this.proven && o.sentKbps < this.cameraKbps * PICTURE_SAME_BITS;
      this.lostUntil = now + (fell ? PICTURE_RETRY_SOON_MS : PICTURE_RETRY_MS);
      return this.giveUp(now, fell ? PICTURE_RETRY_SOON_MS : PICTURE_RETRY_MS);
    }
    if (this.proven) return false;
    const age = now - this.triedAt;
    if (age >= PICTURE_SETTLE_MS && o.qp !== null) this.measure(o);
    if (age < PICTURE_TRY_MS) return false;
    if (!this.adopted && !this.cameraDidBetter()) {
      const starved = this.samples > 0 && this.sentKbps / this.samples < this.screenKbps * PICTURE_SAME_BITS;
      return this.giveUp(now, starved ? PICTURE_RETRY_SOON_MS : PICTURE_RETRY_MS);
    }
    this.cameraFps = this.samples > 0 ? this.fps / this.samples : this.screenFps;
    this.cameraKbps = this.samples > 0 ? this.sentKbps / this.samples : 0;
    this.lostSince = null;
    this.proven = true;
    return false;
  }

  private cameraDidBetter(): boolean {
    if (this.samples === 0) return false;
    const fps = this.fps / this.samples;
    if (fps >= this.screenFps * PICTURE_MORE_FRAMES) return true;
    if (fps < this.screenFps * PICTURE_SAME_FRAMES) return false;
    const bits = Math.min(1, this.sentKbps / this.samples / this.screenKbps);
    const qp = this.qp / this.samples + PICTURE_QP_PER_DOUBLING * Math.log2(bits);
    if (qp <= this.screenQp - PICTURE_QP_MARGIN) return true;
    const encodeMs = this.encodeMs / this.samples;
    return qp <= this.screenQp + PICTURE_QP_MARGIN && encodeMs > 0 && encodeMs <= this.screenEncodeMs * PICTURE_CHEAPER_FRAMES;
  }

  private giveUp(now: number, wait: number): boolean {
    this.notBefore = now + wait;
    this.moving = false;
    this.proven = false;
    return true;
  }
}

// ---------------------------------------------------------------------------
// What the operating system says about the CPU
// ---------------------------------------------------------------------------

interface PressureRecordLike {
  state: "nominal" | "fair" | "serious" | "critical";
}

let pressureState: CpuPressure = null;
let pressureObserver: { disconnect(): void } | null = null;

/** The latest Compute Pressure reading; null where the browser does not have it. */
export function cpuPressure(): CpuPressure {
  return pressureState;
}

/** Starts or stops listening. Idempotent, and a no-op where the API is missing. */
export function watchCpuPressure(on: boolean) {
  if (!on) {
    pressureObserver?.disconnect();
    pressureObserver = null;
    pressureState = null;
    return;
  }
  if (pressureObserver) return;
  const Ctor = (globalThis as unknown as { PressureObserver?: new (cb: (records: PressureRecordLike[]) => void) => {
    observe(source: string, options?: { sampleInterval?: number }): Promise<void>;
    disconnect(): void;
  } }).PressureObserver;
  if (!Ctor) return;
  try {
    const observer = new Ctor((records) => {
      const last = records[records.length - 1];
      if (last) pressureState = last.state;
    });
    pressureObserver = observer;
    void observer.observe("cpu", { sampleInterval: 2000 }).catch(() => {
      pressureObserver = null;
    });
  } catch {
    pressureObserver = null;
  }
}

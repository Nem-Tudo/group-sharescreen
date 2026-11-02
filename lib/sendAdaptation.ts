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
// 40 with six, with every frame going out and the CPU idle, and reading that as
// short of CPU would hold everybody down for one viewer's bad link.
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
  AV1: { balanced: 210, motion: 170 },
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
// allows. Measured on video: 2.5 Mbps at 1024 lines, 1.2 at 720, 800 kbps at 576.
function leastKbps(height: number): number {
  return (2.4 * height * height) / 1000;
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
    const short = !encoderBusy(o) && (fallingBehind(o, profile) || blurry(o, profile));
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
      while (o.availableKbps > 0 && o.availableKbps < leastKbps(next) * LINK_COLLAPSED_SHARE) {
        const lower = nextDown(next, profile);
        if (lower === null) break;
        next = lower;
      }
      this.capHeight = next;
      this.lastDownAt = now;
      // Not below what this height needs: twice a collapsed estimate says nothing about
      // the link being back.
      this.shortAtKbps = Math.max(o.targetKbps, o.availableKbps, leastKbps(next));
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
}

// What each level gives up, per profile. Each profile keeps what it promises
// longest: "text" its pixels, "motion" its frames. The same length for all of them,
// since a level is one number for a machine that may be sending a screen and a
// camera. Most levels change nothing for a given share (a 30 fps 1080p one has
// nothing to lose to "1440 lines"), and the governor walks straight past those.
const MACHINE_STEPS: Record<ShareProfile, MachineCap[]> = {
  text: [
    { height: null, fps: 60 },
    { height: null, fps: 30 },
    { height: null, fps: 20 },
    { height: null, fps: 15 },
    { height: 1440, fps: 15 },
    { height: 1080, fps: 15 },
    { height: 720, fps: 15 },
    { height: 576, fps: 15 },
  ],
  balanced: [
    { height: null, fps: 60 },
    { height: null, fps: 30 },
    { height: 1440, fps: 30 },
    { height: 1080, fps: 30 },
    { height: 720, fps: 30 },
    { height: 720, fps: 24 },
    { height: 576, fps: 24 },
    { height: 576, fps: 15 },
  ],
  motion: [
    { height: 1440, fps: null },
    { height: 1080, fps: null },
    { height: 720, fps: null },
    { height: 576, fps: null },
    { height: 576, fps: 30 },
    { height: 432, fps: 30 },
    { height: 360, fps: 30 },
    { height: 360, fps: 24 },
  ],
};
export const MACHINE_MAX_LEVEL = 8;

/**
 * What a ceiling is worth while the machine holds a tier down. Bits are CPU too: an
 * encoder left with the bitrate of a bigger picture spends it on QP nobody can see.
 * In the lab, VP8 at 576 lines with 1080p's 4 Mbps sat at QP 13 and 70 ms a frame on
 * a machine that was short of nothing else. Close to what the ladder itself gives
 * those heights (2.2 Mbps at 720p, 1.6 at 576p, from 4 at 1080p).
 */
export function heldCeilingKbps(ceilingKbps: number, cap: MachineCap, tierHeight: number, tierFps: number): number {
  const height = Math.min(1, (cap.height ?? tierHeight) / tierHeight);
  const fps = Math.min(1, (cap.fps ?? tierFps) / tierFps);
  return Math.round(ceilingKbps * height ** 1.5 * fps ** 0.5);
}

/** What machine level `level` means for a share under `profile`. */
export function machineCapFor(level: number, profile: ShareProfile): MachineCap {
  if (level <= 0) return { height: null, fps: null };
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
const MACHINE_UP_WAIT_MS = 20_000;
const MACHINE_UP_WAIT_MAX_MS = 5 * 60_000;
// A reading older than this says nothing about now: a large room is visited in
// turns, but never this slowly.
const OBSERVATION_MAX_AGE_MS = 15_000;

/** What a connection would be sent at with nothing held back. */
export interface SendTop {
  height: number;
  fps: number;
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
    const critical = pressure === "critical" && software > 0;
    this.criticalSince = critical ? (this.criticalSince ?? now) : null;

    const held =
      (this.behindSince !== null && now - this.behindSince >= MACHINE_HOLD_MS) ||
      (this.criticalSince !== null && now - this.criticalSince >= MACHINE_CRITICAL_HOLD_MS);
    if (held) {
      this.calmSince = null;
      if (now - this.lastStepAt < MACHINE_SETTLE_MS) return false;
      let next = this.level + 1;
      while (next < MACHINE_MAX_LEVEL && !this.differs(this.level, next)) next += 1;
      // Nothing left to give up.
      if (next > MACHINE_MAX_LEVEL || !this.differs(this.level, next)) return false;
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
    let next = this.level - 1;
    while (next > 0 && !this.differs(next, this.level)) next -= 1;
    // And on down through whatever means the same as where that lands.
    while (next > 0 && !this.differs(next - 1, next)) next -= 1;
    this.level = next;
    this.lastStepAt = now;
    this.lastUpAt = now;
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

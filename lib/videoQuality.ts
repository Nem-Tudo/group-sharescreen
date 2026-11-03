// Shared video-quality model: the single source of truth for what a given
// quality tier is and what it may spend, used by what we actually encode
// (lib/peerQualityController) and by what a viewer asks for
// (lib/qualityNegotiation).

import { isClassicSend } from "./classicSend";

export type QualityTier =
  | "2160p120"
  | "2160p60"
  | "1440p120"
  | "2160p30"
  | "1080p120"
  | "1440p60"
  | "1080p60"
  | "1440p30"
  | "1080p30"
  | "720p60"
  | "720p30"
  | "576p30"
  | "576p15";

export interface TierSpec {
  tier: QualityTier;
  width: number;
  height: number;
  frameRate: number;
  // What this tier costs *on average* for motion-heavy content (video/game).
  //
  // It is deliberately NOT what the encoder is capped at. An average makes a
  // terrible ceiling: every busy moment (a scroll, a scene cut, a camera pan)
  // wants several times the average for a fraction of a second, and clipping
  // exactly those moments is what turns a share into a smear. What the sender
  // actually gets told is encoderCeilingKbps() below.
  baseKbps: number;
}

// Ordered best-to-worst by *cost*, and both bitrate and pixels per second fall
// monotonically down the list, so a step down always frees both bandwidth and
// CPU.
//
// That is why 1440p30 sits *below* 1080p60 rather than next to 1440p60. The
// two are genuinely incomparable as quality — 2K30 is better for text, 1080p60
// better for a game — but 1440p30 is unambiguously cheaper on both axes, and
// cost is what this ladder exists to order.
//
// The top five rungs are what the paid dials (4K, 120 fps) are actually sent
// at. The ladder used to stop at 1440p60, which made those dials capture-only:
// a 4K120 share was captured at 4K120 and then scaled down and frame-dropped to
// 1440p60 for every viewer, paying the capture's full cost for none of its
// quality. Same cost ordering applies up there, with one tie: 2160p30 and
// 1080p120 are the same pixels per second, so a step between them frees
// bandwidth only. There is no 720p120 for the reason there is no 576p60 — a
// 720p rung is where medium tiles land, and a 120fps rung there would hand 120
// fps to all of them.
export const TIERS: readonly TierSpec[] = [
  { tier: "2160p120", width: 3840, height: 2160, frameRate: 120, baseKbps: 32000 },
  { tier: "2160p60", width: 3840, height: 2160, frameRate: 60, baseKbps: 18000 },
  { tier: "1440p120", width: 2560, height: 1440, frameRate: 120, baseKbps: 16000 },
  { tier: "2160p30", width: 3840, height: 2160, frameRate: 30, baseKbps: 10000 },
  { tier: "1080p120", width: 1920, height: 1080, frameRate: 120, baseKbps: 9500 },
  { tier: "1440p60", width: 2560, height: 1440, frameRate: 60, baseKbps: 9000 },
  { tier: "1080p60", width: 1920, height: 1080, frameRate: 60, baseKbps: 5000 },
  { tier: "1440p30", width: 2560, height: 1440, frameRate: 30, baseKbps: 4500 },
  { tier: "1080p30", width: 1920, height: 1080, frameRate: 30, baseKbps: 3000 },
  { tier: "720p60", width: 1280, height: 720, frameRate: 60, baseKbps: 2500 },
  { tier: "720p30", width: 1280, height: 720, frameRate: 30, baseKbps: 1500 },
  { tier: "576p30", width: 1024, height: 576, frameRate: 30, baseKbps: 1000 },
  { tier: "576p15", width: 1024, height: 576, frameRate: 15, baseKbps: 600 },
] as const;

// 576p is the floor, deliberately: below it a screen share stops being
// readable at all, and an unreadable stream is not a cheaper stream, it is a
// wasted one. So the ladder bottoms out at 1024x576 and gives up frames
// (576p15) rather than pixels once there is nowhere else to go.
//
// There is deliberately no 576p60. Every other resolution on the ladder has a
// 60fps rung, but this one is where *every* small tile lands, and
// tierForRenderedSize breaks resolution ties by preferring the higher frame
// rate — so a 60fps rung here would not serve the occasional viewer who wants
// smooth motion in a small window, it would hand 60fps to all 29 thumbnails
// in a grid at once. A broadcaster who picks 576p and 60fps gets 576p30: the
// resolution they asked for, at the only frame rate the floor offers.

const TIER_INDEX = new Map<QualityTier, number>(TIERS.map((t, i) => [t.tier, i]));

export function tierSpec(tier: QualityTier): TierSpec {
  return TIERS[TIER_INDEX.get(tier) ?? 0];
}

export function tierIndex(tier: QualityTier): number {
  return TIER_INDEX.get(tier) ?? 0;
}

export const BEST_TIER = TIERS[0].tier;
export const WORST_TIER = TIERS[TIERS.length - 1].tier;

/** The highest frame rate any rung sends — what a viewer's request allows at most. */
export const MAX_TIER_FPS = Math.max(...TIERS.map((t) => t.frameRate));

/**
 * Steps `tier` down by `steps` places among only the rungs that fit under it —
 * no wider and no faster. This is what "serve this viewer N steps worse" has
 * to mean: a plain stepDown walks the cost ladder, which can land on a wider
 * or faster rung (1080p60 → 1440p30; 2160p60 → 1440p120), and clamping that
 * back under the request afterwards is not monotonic either — 2160p60 stepped
 * once came out 1440p60, stepped twice 2160p30, which costs more. Walking the
 * filtered ladder makes every step land somewhere real and never cost more
 * than the step before.
 */
export function stepDownUnder(tier: QualityTier, steps: number): QualityTier {
  const cap = tierSpec(tier);
  const pool = TIERS.filter((t) => t.width <= cap.width && t.frameRate <= cap.frameRate);
  const start = pool.findIndex((t) => t.tier === tier);
  return pool[Math.min(Math.max(start, 0) + Math.max(steps, 0), pool.length - 1)].tier;
}

// A tile sitting exactly on a boundary (a resizing grid, a CSS transition)
// would otherwise renegotiate every few frames; qualityNegotiation's timers
// are what stop that, so that this can stay a plain answer to a plain question.

/**
 * Picks the tier for a stream rendered into `renderedWidth` x `renderedHeight`
 * CSS pixels. This is the single highest-impact optimisation in the app: in a
 * 30-person grid each tile is ~320x216, so sending 1080p wastes ~95% of the
 * encoded pixels — on the sender's CPU *and* on the sender's uplink.
 *
 * `devicePixelRatio` matters: a 320px tile on a 2x display genuinely needs
 * 640 device pixels to avoid looking soft, so ignoring DPR would make every
 * retina viewer's video visibly blurry.
 */
export function tierForRenderedSize(
  renderedWidth: number,
  renderedHeight: number,
  devicePixelRatio: number,
  maxFps = 60
): QualityTier {
  const dpr = Math.max(1, Math.min(3, devicePixelRatio || 1));
  const needW = renderedWidth * dpr;
  const needH = renderedHeight * dpr;

  // A tile that isn't laid out yet (0x0, display:none, off-screen) tells us
  // nothing; callers skip reporting instead of asking this.
  if (needW <= 0 || needH <= 0) return WORST_TIER;

  const eligible = TIERS.filter((t) => t.frameRate <= maxFps);
  const pool = eligible.length > 0 ? eligible : TIERS;

  // Smallest resolution that still covers the tile — then, among tiers
  // sharing that resolution, the *highest* frame rate.
  //
  // The tie-break matters. Walking plainly from the worst tier upwards would
  // hand a small tile the reduced-fps floor, because 15fps sorts below 30fps at identical
  // resolution. Nobody asked for choppy video by making their window small:
  // tile size is evidence about how many *pixels* are useful and says nothing
  // about frame rate. Dropping frames is a response to pressure, and pressure
  // has its own answers (see lib/sendAdaptation).
  const covering = pool.filter((t) => t.width >= needW && t.height >= needH);
  let chosen = pool[0].tier;
  if (covering.length > 0) {
    const best = covering.reduce((a, b) => {
      const areaA = a.width * a.height;
      const areaB = b.width * b.height;
      if (areaA !== areaB) return areaA < areaB ? a : b;
      return a.frameRate >= b.frameRate ? a : b;
    });
    chosen = best.tier;
  }

  return chosen;
}

/**
 * Cap a tier by the broadcaster's own ceiling (their resolution + fps dials).
 *
 * Resolution and frame rate are clamped *independently*, which a plain walk
 * down the ladder cannot do: with both 720p60 and 1080p30 on it, "the worse of
 * the two" is a meaningless question — one has more pixels, the other more
 * frames — and answering it by index picked 60fps for a broadcaster who had
 * explicitly asked for 30, or 1080p for one who had asked for 720p. Clamping
 * each axis to what the dials actually say and then taking the best tier that
 * fits under both is the only reading where the dials mean what they read.
 */
export function capTier(requested: QualityTier, ceiling: QualityTier): QualityTier {
  const want = tierSpec(requested);
  const cap = tierSpec(ceiling);
  const maxWidth = Math.min(want.width, cap.width);
  const maxFrameRate = Math.min(want.frameRate, cap.frameRate);
  // TIERS is ordered best-first, so the first tier that fits is the best one.
  const fit = TIERS.find((t) => t.width <= maxWidth && t.frameRate <= maxFrameRate);
  return (fit ?? TIERS[TIERS.length - 1]).tier;
}

// How far above a tier's average cost the encoder is allowed to spend on the
// busy moments. Without it, maxBitrate sits exactly on the average, so every
// scroll and scene change is clipped — and under "maintain-resolution" (text
// mode) that clipping comes out as dropped frames, i.e. a share that looks
// frozen rather than merely soft.
const CEILING_HEADROOM = 2;
// Outside experiment sq-new-send (see lib/classicSend).
const CLASSIC_CEILING_HEADROOM = 1.5;

// The rung the bitrate dial is scaled against: a tier costing this much gets
// the whole dial, cheaper ones a proportional share. Pinned to 1440p60, the
// old top of the ladder, rather than read off TIERS[0] — the 4K/120 rungs above
// it would otherwise shrink every ordinary tier's share to a third of what it
// was, quietly cutting a 1080p60 viewer on "extremo" from ~17.8 Mbps to 7.5.
// Rungs above it simply get the full dial.
const DIAL_REFERENCE_KBPS = 9000;

/**
 * The bitrate ceiling to hand the encoder for one viewer at `tier`.
 *
 * A ceiling, not a target: an encoder emits almost nothing for a still screen
 * regardless of what it is allowed, so setting this generously costs nothing
 * on static content and is exactly what buys a sharp picture on moving
 * content. `dialCeilingKbps` is the broadcaster's bitrate dial, and it is the
 * one hard limit here — both as a cap and, on the higher settings, as a lift:
 * someone who picked "máximo" asked for more bits than the tier's average and
 * should get them, or the setting is decoration.
 */
export function encoderCeilingKbps(tier: QualityTier, dialCeilingKbps: number): number {
  const base = tierSpec(tier).baseKbps;
  // This tier's share of a reference stream, so the dial scales down the
  // ladder instead of handing a thumbnail-sized tier a 32 Mbps allowance.
  const share = base / DIAL_REFERENCE_KBPS;
  const generous = Math.max(base * (isClassicSend() ? CLASSIC_CEILING_HEADROOM : CEILING_HEADROOM), dialCeilingKbps * share);
  return Math.round(Math.min(dialCeilingKbps, generous));
}

// How far below the asked-for height to look for a size that comes out even.
const EVEN_SEARCH_STEPS = 12;

/**
 * scaleResolutionDownBy needed to get from the capture down to `height`. WebRTC
 * expresses per-sender downscaling as a divisor, not a target size, so this is what
 * actually applies a tier to one peer.
 *
 * The picture has to come out with even sides. A hardware H264 encoder refuses
 * anything else ("Hardware encoder initialization failed"), and the connection falls
 * to software without a word: 1.88, as this used to round to, makes 1021x574 out of
 * a 1080p screen, so every small tile of every share on a machine with a GPU was
 * paying for a software encode of its own. 1.875 makes 1024x576.
 */
export function scaleForHeight(height: number, captureWidth: number, captureHeight: number): number {
  // Clamped to 1 so a capture smaller than the tier never *upscales*.
  if (!captureHeight || captureHeight <= height) return 1;
  const asked = height - (height % 2);
  for (let step = 0; step < EVEN_SEARCH_STEPS; step += 1) {
    const scale = Math.round((captureHeight / (asked - step * 2)) * 1e6) / 1e6;
    const even = (side: number) => Math.round(side / scale) % 2 === 0;
    if (even(captureWidth) && even(captureHeight)) return Math.max(1, scale);
  }
  return Math.max(1, Math.round((captureHeight / asked) * 1e6) / 1e6);
}

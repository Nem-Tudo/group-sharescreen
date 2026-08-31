// Per-peer sender quality control.
//
// Two inputs decide what one viewer receives, and keeping them separate is
// the whole point of this module:
//
//   1. the assigned tier — what this viewer actually *needs*, driven by the
//      size their tile is rendered at (see videoQuality.tierForRenderedSize)
//      and by the topology plan;
//   2. the congestion ratio — how much of that tier their link can currently
//      carry, learned from their own loss/RTT reports.
//
// The previous implementation conflated the two: every time the room's peer
// count changed, the quality effect re-applied the base bitrate to *every*
// sender and restarted each congestion monitor from scratch. A viewer on a
// bad link that had correctly settled at 800 kbps was slammed back to full
// bitrate every single time anyone joined or left, then had to spend another
// ~6 seconds per step walking back down. In a room with any churn it never
// converged at all.
//
// Here, setTier() changes (1) and deliberately leaves (2) untouched, so hard
// won knowledge about a viewer's link survives an unrelated room change.

import { mediaStats, type SenderSample } from "./mediaStats";
import {
  congestedBitrateKbps,
  encoderCeilingKbps,
  scaleFactorFor,
  tierSpec,
  type QualityTier,
} from "./videoQuality";

// What the broadcaster says they are sharing, which decides how the encoder
// spends a shortage — of bits, of CPU, or both.
//
// "balanced" is the middle rung and maps to WebRTC's own degradation
// preference of the same name: instead of protecting one axis absolutely and
// sacrificing the other, the encoder gives up a little of each. It exists
// because the two ends are both a cliff. "text" holds 1080p and lets frame
// rate collapse to single digits (a sharp slideshow); "motion" holds 60fps
// and lets the picture soften until small text is unreadable. Most real
// screen sharing — a browser, a terminal, a video playing in a tab — is
// neither, and picking either end for it is picking which way to be wrong.
export type DegradationMode = "text" | "balanced" | "motion";

// The one place the three profiles become the WebRTC setting. A record rather
// than a chain of ternaries so a fourth mode cannot be added without deciding
// what it does here.
const DEGRADATION_PREFERENCE: Record<DegradationMode, RTCDegradationPreference> = {
  // Sharpness above all: right for code and documents, and the reason a
  // 60fps share on this setting degrades into a slideshow.
  text: "maintain-resolution",
  // Give up some of each. The encoder decides the mix, continuously, from
  // what it is actually short of.
  balanced: "balanced",
  // Fluidity above all: right for a game or a film.
  motion: "maintain-framerate",
};

// Congestion thresholds.
//
// The ratio survives room churn (see setTier's comment), which makes every
// step down a lasting scar rather than a transient dip — so the evidence
// required for one is deliberately high: it takes BAD_STREAK_TO_BACKOFF
// consecutive bad samples, and no single noisy sample (one dropped ack, a
// brief wifi retransmit, a GC pause) can cut anyone's bitrate on its own.
//
// The asymmetry runs the other way from what a congestion controller usually
// wants. Backing off hard and recovering slowly is right when the cost of
// overshooting is everyone's stream stalling; here the sender is one of many
// and the browser's own bandwidth estimator is already the fast, correct
// reflex for real congestion. This layer is the slow one on top, so it now
// recovers faster than it retreats (RECOVER > 1/BACKOFF) and stops at a floor
// that is still comfortably watchable, instead of ratcheting toward the
// bottom on the strength of a bad minute.
const LOSS_BAD = 0.04;
const RTT_BAD = 0.35;
const LOSS_GOOD = 0.01;
const RTT_GOOD = 0.2;
const BACKOFF = 0.9;
const RECOVER = 1.25;
const BAD_STREAK_TO_BACKOFF = 3;
const HEALTHY_STREAK_TO_RECOVER = 2;
const MIN_RATIO = 0.45;

// Below this share of what the tier costs on average, extra spatial
// downscaling buys the encoder headroom — half resolution encoded well beats
// full resolution encoded into mush.
//
// Measured against the tier's average cost (baseKbps), not against the
// ceiling the sender was handed, and not against absolute kbps. Absolute kbps
// was wrong because a deliberately cheap low tier then looked permanently
// congested simply for having a small healthy bitrate. The ceiling is wrong
// for the mirror-image reason: it carries deliberate headroom above the
// average (see encoderCeilingKbps), so a share of *it* would read as
// congestion at bitrates that are in fact perfectly comfortable.
//
// The practical effect is that a healthy link never gets downscaled twice.
// It still engages where it should: a broadcaster who picks a bitrate far
// too low for the resolution they asked for gets a smaller, clean picture
// instead of a full-size broken one.
const SCALE_HARD = 0.35;
const SCALE_SOFT = 0.55;

export class PeerQualityController {
  private ratio = 1;
  private healthyStreak = 0;
  private badStreak = 0;
  private appliedKbps = 0;
  private appliedScale = 0;
  private disposed = false;

  constructor(
    readonly peerId: string,
    // How this sender is addressed in the shared stats pump. Not the peer id:
    // the pump is one process-wide map and there is a registry per channel, so
    // a peer receiving both a screen and a camera share would otherwise be a
    // single key written by two owners — see PeerQualityRegistry's namespace.
    private statsKey: string,
    private sender: RTCRtpSender,
    private tier: QualityTier,
    private captureHeight: number,
    // The broadcaster's bitrate dial, in kbps. A hard limit on what this
    // viewer may be given; the tier decides how much of it is actually used.
    private bitrateCeilingKbps: number,
    private degradation: DegradationMode
  ) {}

  /**
   * Assign a new tier (tile resized, topology changed, dial moved).
   * Congestion state is intentionally preserved across this call.
   */
  setTier(tier: QualityTier) {
    if (this.tier === tier) return;
    this.tier = tier;
    mediaStats.setTier(this.statsKey, tier);
    this.apply();
  }

  setCaptureHeight(height: number) {
    if (!height || this.captureHeight === height) return;
    this.captureHeight = height;
    this.apply();
  }

  setBitrateCeiling(kbps: number) {
    if (!kbps || this.bitrateCeilingKbps === kbps) return;
    this.bitrateCeilingKbps = kbps;
    this.apply();
  }

  setDegradation(mode: DegradationMode) {
    if (this.degradation === mode) return;
    this.degradation = mode;
    this.apply();
  }

  getTier(): QualityTier {
    return this.tier;
  }

  /** Feed one telemetry sample for this peer. */
  onSample(sample: SenderSample) {
    if (this.disposed) return;
    const { fractionLost, rtt } = sample;
    if (fractionLost > LOSS_BAD || rtt > RTT_BAD) {
      this.healthyStreak = 0;
      this.badStreak += 1;
      if (this.badStreak >= BAD_STREAK_TO_BACKOFF) {
        this.badStreak = 0;
        this.ratio = Math.max(MIN_RATIO, this.ratio * BACKOFF);
        this.apply();
      }
    } else if (fractionLost <= LOSS_GOOD && rtt < RTT_GOOD) {
      this.badStreak = 0;
      this.healthyStreak += 1;
      if (this.healthyStreak >= HEALTHY_STREAK_TO_RECOVER && this.ratio < 1) {
        this.ratio = Math.min(1, this.ratio * RECOVER);
        this.healthyStreak = 0;
        this.apply();
      }
    } else {
      // Neither clearly bad nor clearly good: hold, and require a fresh
      // clean run before allowing either a backoff or a recovery.
      this.healthyStreak = 0;
      this.badStreak = 0;
    }
  }

  /** Pushes the current target onto the sender, if it actually changed. */
  apply() {
    if (this.disposed) return;
    // Deliberately NOT scaled by the measured content multiplier, which is
    // what this used to do and what made quality collapse and never come
    // back. That multiplier is derived from the bitrate the encoder actually
    // produced — so feeding it back in as the encoder's own cap closed a
    // loop with only one direction of travel: any quiet stretch (reading a
    // page, a paused video) drove the measurement down, the cap followed it
    // down, and the cap then made the measurement impossible to ever exceed
    // again. A share that idled for twenty seconds was pinned near a tenth
    // of its tier's bitrate for the rest of the session.
    //
    // The multiplier is still exactly right for *planning* — how much of the
    // uplink a stream really consumes, see topologyPlanner — because there it
    // is an observation that changes nothing about what is observed. Here it
    // is a control input, and a control input must never be the thing it
    // controls.
    const tierKbps = tierSpec(this.tier).baseKbps;
    const ceilingKbps = encoderCeilingKbps(this.tier, this.bitrateCeilingKbps);
    const targetKbps = congestedBitrateKbps(ceilingKbps, this.ratio);
    const tierScale = scaleFactorFor(this.tier, this.captureHeight);
    const share = tierKbps > 0 ? targetKbps / tierKbps : 1;
    // "balanced" opts out of this extra downscale, and that opt-out is the
    // profile's whole promise: stay at the best picture the ceiling allows
    // and let the encoder find the equilibrium. Under the other two modes
    // this is a useful nudge, because the encoder is protecting one axis
    // absolutely and will not shrink the picture on its own. Under
    // "balanced" it already does exactly that, adaptively and from moment to
    // moment — so applying both means degrading twice for one shortage: the
    // app halves the picture, then the encoder degrades what is left.
    const congestionScale =
      this.degradation === "balanced" ? 1 : share <= SCALE_HARD ? 2 : share <= SCALE_SOFT ? 1.5 : 1;
    const scale = Math.round(tierScale * congestionScale * 100) / 100;

    // setParameters triggers an encoder reconfiguration; calling it with
    // values that did not change costs a keyframe and a visible hitch for
    // no benefit. In a 30-peer room this guard removes the large majority
    // of calls, since most peers are steady most of the time.
    if (
      Math.abs(targetKbps - this.appliedKbps) < Math.max(50, this.appliedKbps * 0.05) &&
      scale === this.appliedScale
    ) {
      return;
    }
    this.appliedKbps = targetKbps;
    this.appliedScale = scale;

    let params: RTCRtpSendParameters;
    try {
      params = this.sender.getParameters();
    } catch {
      return;
    }
    const encodings =
      params.encodings && params.encodings.length > 0 ? params.encodings : [{} as RTCRtpEncodingParameters];
    encodings[0].maxBitrate = targetKbps * 1000;
    encodings[0].scaleResolutionDownBy = scale;
    encodings[0].maxFramerate = tierSpec(this.tier).frameRate;
    params.encodings = encodings;
    // See DEGRADATION_PREFERENCE. Choosing wrong is not subtle: a 60fps share
    // under maintain-resolution degrades into a slideshow rather than
    // softening.
    params.degradationPreference = DEGRADATION_PREFERENCE[this.degradation];
    this.sender.setParameters(params).catch(() => {
      // Racing a renegotiation or a closing pc — the next apply() will
      // reconcile, so a failure here is not worth surfacing.
    });
  }

  dispose() {
    this.disposed = true;
  }
}

/**
 * Owns every live controller for one media channel and wires them to the
 * single shared stats pump.
 */
export class PeerQualityRegistry {
  private controllers = new Map<string, PeerQualityController>();
  private unsubscribeSender: (() => void) | null = null;
  // Seeded to the "alto" dial position, which is also useRoomMedia's default.
  // Overwritten by setBitrateCeiling as soon as a share's preset is known.
  private bitrateCeilingKbps = 4000;
  // Matches useRoomMedia's own default, for the same reason the bitrate seed
  // above does: this is only ever read in the gap before a share's preset
  // arrives, and a seed that disagreed with the default would make that gap
  // visible as a brief switch of encoder strategy.
  private degradation: DegradationMode = "balanced";
  private keyPrefix: string;

  /**
   * `namespace` separates this registry's senders from every other one's in
   * the process-wide stats pump. There is a registry per media channel (and
   * one more per relay), all of them keyed by the same peer ids, so without it
   * a peer watching someone's screen *and* camera collapsed into one shared
   * entry: the camera's registration overwrote the screen's, so the screen
   * sender was never polled at all; every sample the camera produced was fanned
   * out to the screen's controller too, which then moved the screen's bitrate on
   * the camera's loss and RTT; and closing either channel's connection
   * unregistered the other one's sender along with it.
   */
  constructor(namespace: string) {
    this.keyPrefix = `${namespace}\u0000`;
  }

  private statsKey(peerId: string): string {
    return this.keyPrefix + peerId;
  }

  start() {
    if (this.unsubscribeSender) return;
    this.unsubscribeSender = mediaStats.onSender((sample) => {
      // Every registry sees every sample, so each has to recognise its own.
      if (!sample.peerId.startsWith(this.keyPrefix)) return;
      this.controllers.get(sample.peerId.slice(this.keyPrefix.length))?.onSample(sample);
    });
  }

  add(
    peerId: string,
    pc: RTCPeerConnection,
    sender: RTCRtpSender,
    tier: QualityTier,
    captureHeight: number
  ): PeerQualityController {
    this.remove(peerId);
    const key = this.statsKey(peerId);
    const controller = new PeerQualityController(
      peerId,
      key,
      sender,
      tier,
      captureHeight,
      this.bitrateCeilingKbps,
      this.degradation
    );
    this.controllers.set(peerId, controller);
    mediaStats.register(key, pc, sender, tier);
    controller.apply();
    this.start();
    return controller;
  }

  get(peerId: string): PeerQualityController | undefined {
    return this.controllers.get(peerId);
  }

  remove(peerId: string) {
    this.controllers.get(peerId)?.dispose();
    this.controllers.delete(peerId);
    mediaStats.unregister(this.statsKey(peerId));
  }

  setDegradation(mode: DegradationMode) {
    this.degradation = mode;
    for (const c of this.controllers.values()) c.setDegradation(mode);
  }

  /** The broadcaster moved the bitrate dial mid-share. */
  setBitrateCeiling(kbps: number) {
    if (!kbps || this.bitrateCeilingKbps === kbps) return;
    this.bitrateCeilingKbps = kbps;
    for (const c of this.controllers.values()) c.setBitrateCeiling(kbps);
  }

  setCaptureHeight(height: number) {
    for (const c of this.controllers.values()) c.setCaptureHeight(height);
  }

  clear() {
    for (const peerId of [...this.controllers.keys()]) this.remove(peerId);
    this.unsubscribeSender?.();
    this.unsubscribeSender = null;
  }
}

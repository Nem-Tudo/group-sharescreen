// Per-peer sender quality control.
//
// Two inputs decide what one viewer receives, and keeping them separate is
// the whole point of this module:
//
//   1. the assigned tier — what this viewer actually *needs*, driven by the
//      size their tile is rendered at (see videoQuality.tierForRenderedSize)
//      and by the topology plan;
//   2. the congestion ratio — how much of that tier their link can currently
//      carry, learned from the encoder's own report of whether it is being
//      limited (qualityLimitationReason) corroborated by their loss and the
//      rise in their round-trip time above that path's own floor.
//
// The ordering there is load-bearing. This layer sits on top of WebRTC's
// congestion control, which is already the fast and correct reflex for real
// congestion; everything it adds is a slow second opinion. A second opinion
// that fires without evidence does not make the picture safer, it just makes
// it worse — so nothing here reduces anything unless the browser first says
// the encoder is actually being held back.
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
import { congestionStep, initialCongestionState } from "./congestionControl";
import {
  capTier,
  congestedBitrateKbps,
  encoderCeilingKbps,
  scaleFactorFor,
  tierSpec,
  type QualityTier,
} from "./videoQuality";
import { RELAY_ROUTE_CAP, RELAY_ROUTE_MAX_KBPS, watchTurnRelay } from "./turnRoute";

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

// The other half of what a profile means to the encoder, and the reason it
// lives next to DEGRADATION_PREFERENCE instead of at either call site: the
// origin sets it on its capture (see useRoomMedia's contentHintFor) and a
// relay sets it on the track it re-encodes (see RelayLink), and the two
// drifting apart means a relayed viewer is served under a profile nobody
// picked.
//
// Both quality profiles bias toward spatial detail; what separates them is
// degradationPreference, not this. "detail" rather than "motion" for balanced
// is what makes it keep the picture it advertises instead of spending the
// bits on frames.
const CONTENT_HINT: Record<DegradationMode, "text" | "detail" | "motion"> = {
  text: "text",
  balanced: "detail",
  motion: "motion",
};

export function contentHintForDegradation(mode: DegradationMode) {
  return CONTENT_HINT[mode];
}

// How long to wait before re-pushing parameters the sender refused, and how
// many times. Short, because the refusal this exists for — parameters made
// stale by a getParameters that raced ours — is gone by the next tick; and
// bounded, because a sender that refuses for a reason that is not going away
// is one whose connection is closing, and its controller is disposed moments
// later anyway.
const APPLY_RETRY_MS = 500;
const APPLY_RETRIES = 3;

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

// Every live controller, so the account's "uncapped_relay" feature (Pro Ultra)
// can lift or restore the relay cap on shares already running.
const liveControllers = new Set<PeerQualityController>();
let relayCapExempt = false;

/** Whether this account's relayed connections skip the relay cap. Set by useRoomMedia. */
export function setRelayCapExempt(exempt: boolean) {
  if (relayCapExempt === exempt) return;
  relayCapExempt = exempt;
  for (const c of liveControllers) c.refreshRouteCap();
}

export class PeerQualityController {
  private congestion = initialCongestionState();
  private appliedKbps = 0;
  private appliedScale = 0;
  // Part of the same record. Without it a change that only moves the frame
  // rate — 1080p120 to 1080p60 under a bitrate dial low enough to cap both at
  // the same kbps — matched the guard on every other number and never reached
  // the sender.
  private appliedFramerate = 0;
  // The mode those two numbers were pushed with. Null means nothing is known
  // to have reached the sender — the initial state, and what a rejected
  // setParameters restores.
  private appliedDegradation: DegradationMode | null = null;
  // Which apply() a given setParameters belongs to. Without it a call that
  // rejects late rolls back the record of a *later* one that succeeded, and
  // the controller then re-pushes parameters the sender is already carrying.
  private applySeq = 0;
  private retriesLeft = APPLY_RETRIES;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  // Whether this connection is relayed through a TURN server — by our end
  // (seen here, see PeerQualityRegistry.add) or by the viewer's (which only
  // they can see, and report). Either one caps what is encoded; see
  // lib/turnRoute.ts.
  private relayLocal = false;
  private relayRemote = false;

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
  ) {
    liveControllers.add(this);
  }

  /**
   * Assign a new tier (tile resized, topology changed, dial moved).
   * Congestion state is intentionally preserved across this call.
   */
  setTier(tier: QualityTier) {
    if (this.tier === tier) return;
    this.tier = tier;
    mediaStats.setTier(this.statsKey, this.sentTier());
    this.apply();
  }

  /**
   * Marks this connection as relayed, or no longer relayed, through
   * a TURN server on one side. See lib/turnRoute.ts.
   */
  setRelayRoute(side: "local" | "remote", via: boolean) {
    if (side === "local") {
      if (this.relayLocal === via) return;
      this.relayLocal = via;
    } else {
      if (this.relayRemote === via) return;
      this.relayRemote = via;
    }
    mediaStats.setTier(this.statsKey, this.sentTier());
    this.apply();
  }

  /** Re-applies after the relay-cap exemption changed. */
  refreshRouteCap() {
    mediaStats.setTier(this.statsKey, this.sentTier());
    this.apply();
  }

  // Whether the relay cap applies: relayed on either side, and the account
  // is not exempt (Pro Ultra).
  private routeCapped(): boolean {
    return (this.relayLocal || this.relayRemote) && !relayCapExempt;
  }

  // What is actually encoded: the assigned tier, capped while the connection
  // is relayed through TURN. Only this send path sees the cap — getTier
  // still answers the assigned tier, so the planner, the dials and everything
  // on screen carry on as if the connection were direct.
  private sentTier(): QualityTier {
    return this.routeCapped()
      ? capTier(this.tier, RELAY_ROUTE_CAP)
      : this.tier;
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
    const next = congestionStep(this.congestion, sample);
    const changed = next.ratio !== this.congestion.ratio;
    this.congestion = next;
    if (changed) this.apply();
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
    const tier = this.sentTier();
    const tierKbps = tierSpec(tier).baseKbps;
    const ceilingKbps = this.routeCapped()
      ? Math.min(encoderCeilingKbps(tier, this.bitrateCeilingKbps), RELAY_ROUTE_MAX_KBPS)
      : encoderCeilingKbps(tier, this.bitrateCeilingKbps);
    const targetKbps = congestedBitrateKbps(ceilingKbps, this.congestion.ratio);
    const tierScale = scaleFactorFor(tier, this.captureHeight);
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
    //
    // The mode has to be part of the comparison, and leaving it out was a
    // real bug rather than an omission: switching profile mid-share moves
    // neither the bitrate nor the scale in the ordinary case, so
    // setDegradation() reached this guard, matched on both numbers, and
    // returned before the degradationPreference below could be written. The
    // picker said "Vídeo / jogo" while the sender was still on
    // maintain-resolution — protect sharpness, throw frames away — which is
    // exactly the slideshow the switch was made to escape, and only
    // restarting the whole share cleared it.
    const framerate = tierSpec(tier).frameRate;
    if (
      this.appliedDegradation === this.degradation &&
      Math.abs(targetKbps - this.appliedKbps) < Math.max(50, this.appliedKbps * 0.05) &&
      scale === this.appliedScale &&
      framerate === this.appliedFramerate
    ) {
      return;
    }

    let params: RTCRtpSendParameters;
    try {
      params = this.sender.getParameters();
    } catch {
      return;
    }
    // Recorded here rather than earlier, and deliberately: everything above
    // this line can still bail out without touching the sender, and a record
    // left behind by one of those paths is a lie the guard then acts on. From
    // here the only way out is setParameters, whose own failure rolls this
    // back below. Written before that call, not after, so that several
    // apply()s in the same tick collapse into one.
    this.appliedKbps = targetKbps;
    this.appliedScale = scale;
    this.appliedFramerate = framerate;
    this.appliedDegradation = this.degradation;
    const seq = (this.applySeq += 1);
    const encodings =
      params.encodings && params.encodings.length > 0 ? params.encodings : [{} as RTCRtpEncodingParameters];
    encodings[0].maxBitrate = targetKbps * 1000;
    encodings[0].scaleResolutionDownBy = scale;
    encodings[0].maxFramerate = framerate;
    params.encodings = encodings;
    // See DEGRADATION_PREFERENCE. Choosing wrong is not subtle: a 60fps share
    // under maintain-resolution degrades into a slideshow rather than
    // softening.
    params.degradationPreference = DEGRADATION_PREFERENCE[this.degradation];
    this.sender.setParameters(params).then(
      () => {
        if (seq !== this.applySeq) return;
        this.retriesLeft = APPLY_RETRIES;
      },
      () => {
        // Superseded: a later apply() is the one whose result counts, and
        // rolling back here would erase what it wrote.
        if (this.disposed || seq !== this.applySeq) return;
        // Racing a renegotiation or a closing pc. Not worth surfacing, but it
        // does have to be undone: the record above says the sender is
        // carrying values it never took, and left standing it makes the guard
        // swallow everything that follows.
        this.appliedKbps = 0;
        this.appliedScale = 0;
        this.appliedFramerate = 0;
        this.appliedDegradation = null;
        // And undoing it is not enough on its own, which is the part that
        // bites. apply() runs when something moves — a tier, a dial, a
        // congestion ratio — and a profile switch on a settled link moves
        // none of them. So there is no "next apply() will reconcile" to rely
        // on: without a retry of our own the sender keeps the old mode for as
        // long as that link stays quiet, which from the person's side is
        // exactly the bug this whole change exists to fix, just rarer.
        if (this.retriesLeft <= 0 || this.retryTimer) return;
        this.retriesLeft -= 1;
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.apply();
        }, APPLY_RETRY_MS);
      }
    );
  }

  dispose() {
    this.disposed = true;
    liveControllers.delete(this);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}

/**
 * Owns every live controller for one media channel and wires them to the
 * single shared stats pump.
 */
export class PeerQualityRegistry {
  private controllers = new Map<string, PeerQualityController>();
  // Each controller's TURN-route watch (see lib/turnRoute.ts), stopped
  // with it.
  private routeWatches = new Map<string, () => void>();
  private unsubscribeSender: (() => void) | null = null;
  // Seeded to the "alto" dial position, which is also useRoomMedia's default.
  // Overwritten by setBitrateCeiling as soon as a share's preset is known.
  private bitrateCeilingKbps = 4000;
  // Matches useRoomMedia's own default, for the same reason the bitrate seed
  // above does: this is only ever read in the gap before a share's preset
  // arrives, and a seed that disagreed with the default would make that gap
  // visible as a brief switch of encoder strategy.
  private degradation: DegradationMode = "text";
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
    // Our own end relaying through TURN. The viewer's end is theirs to
    // see — see setRemoteRelayRoute.
    this.routeWatches.set(
      peerId,
      watchTurnRelay(pc, (via) => controller.setRelayRoute("local", via))
    );
    this.start();
    return controller;
  }

  get(peerId: string): PeerQualityController | undefined {
    return this.controllers.get(peerId);
  }

  /**
   * The viewer reported that their end of our connection to them is (or no
   * longer is) relayed through TURN — the "route" signal. Dropped when
   * there is no connection to them: the report is about one connection, and
   * a new one is checked and reported afresh.
   */
  setRemoteRelayRoute(peerId: string, via: boolean) {
    this.controllers.get(peerId)?.setRelayRoute("remote", via);
  }

  remove(peerId: string) {
    this.routeWatches.get(peerId)?.();
    this.routeWatches.delete(peerId);
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

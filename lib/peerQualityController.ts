// Per-peer sender quality control.
//
// What one viewer receives comes down to three things, kept apart on purpose:
//
//   1. the tier — what this viewer *needs*, from the size their tile is
//      rendered at (see videoQuality.tierForRenderedSize). A viewer who is not
//      looking needs nothing: their encoder stops until they come back.
//   2. their link — LinkAdapter (see lib/sendAdaptation), when there are not
//      enough bits for this one viewer.
//   3. the machine — MachineGovernor, when the encoders cannot keep up. There
//      is one CPU, so that one applies to everybody.
//
// The bitrate is not one of the things this layer turns down. WebRTC's
// congestion control is already the fast and correct reflex for real
// congestion, and it can only learn that a link has recovered by being allowed
// to use it, so maxBitrate stays at what the tier is worth. Everything here sits
// above that reflex and only ever decides what the bits it allows are spent on.

import { mediaStats, type SenderSample } from "./mediaStats";
import { capTier, encoderCeilingKbps, scaleForHeight, tierSpec, type QualityTier } from "./videoQuality";
import { RELAY_ROUTE_CAP, RELAY_ROUTE_MAX_KBPS, watchTurnRelay } from "./turnRoute";
import {
  cpuPressure,
  heldCeilingKbps,
  LinkAdapter,
  machineCapFor,
  MachineGovernor,
  SEND_GRACE_MS,
  watchCpuPressure,
  type SendObservation,
} from "./sendAdaptation";
import { isClassicSend, onClassicSendChange } from "./classicSend";
import { isHardwareImplementation } from "./connectionDiagnostics";

// What the broadcaster says they are sharing, which decides how the encoder
// spends a shortage — of bits, of CPU, or both.
//
// "balanced" is the middle rung: most real screen sharing — a browser, a
// terminal, a video playing in a tab — is neither a document nor a game, and
// picking either end for it is picking which way to be wrong.
export type DegradationMode = "text" | "balanced" | "motion";

// maintain-resolution for all three, whatever the profile. It is the one setting
// that keeps WebRTC's quality scaler out of it: under the other two it cuts
// resolution on a QP reading in the first seconds of a share, when the bandwidth
// estimator has not ramped up, and only gives it back below a QP the lower
// resolution never reaches. See lib/sendAdaptation, which does that job instead.
const SEND_PREFERENCE: RTCDegradationPreference = "maintain-resolution";

// Experiment sq-classic-send only: how it was before.
const CLASSIC_PREFERENCE: Record<DegradationMode, RTCDegradationPreference> = {
  text: "maintain-resolution",
  balanced: "balanced",
  motion: "maintain-framerate",
};

// How long to wait before re-pushing parameters the sender refused, and how
// many times. Short, because the refusal this exists for — parameters made
// stale by a getParameters that raced ours — is gone by the next tick; and
// bounded, because a sender that refuses for a reason that is not going away
// is one whose connection is closing, and its controller is disposed moments
// later anyway.
const APPLY_RETRY_MS = 500;
const APPLY_RETRIES = 3;

const liveControllers = new Set<PeerQualityController>();
let relayCapExempt = false;

/** Whether this account's relayed connections skip the relay cap. Set by useRoomMedia. */
export function setRelayCapExempt(exempt: boolean) {
  if (relayCapExempt === exempt) return;
  relayCapExempt = exempt;
  for (const c of liveControllers) c.apply();
}

// One governor for every connection of every channel: they all run on the same
// CPU, a camera next to a screen share included.
const machine = new MachineGovernor();
let machineWatching = false;

function ensureMachineWatch() {
  if (machineWatching) return;
  machineWatching = true;
  mediaStats.onCapacity(() => {
    if (machine.tick(cpuPressure(), Date.now())) for (const c of liveControllers) c.apply();
  });
  onClassicSendChange(() => {
    for (const c of liveControllers) c.apply();
  });
}

/** What a sender's controller is doing to one viewer, for the quality reports. */
export interface SenderQualityState {
  /** The tier actually sent, after any route cap. */
  tier: QualityTier;
  /** The ceiling handed to the encoder, kbps. */
  ceilingKbps: number;
  degradationPreference: RTCDegradationPreference;
  /** The height this viewer's link is holding them to; null when it is not. */
  linkCapHeight: number | null;
  /** How far the machine is holding everyone back; 0 when it is not. */
  machineLevel: number;
  /** This viewer is not looking, so nothing is being encoded for them. */
  paused: boolean;
}

// The controller behind each send pc, for lib/connectionTelemetry: the reports
// need the tier and the caps next to what the encoder did with them, or a low
// bitrate cannot be told apart between "the viewer's tile is small", "our
// adaptation cut it" and "the encoder did not use what it had".
const controllerByPc = new WeakMap<RTCPeerConnection, PeerQualityController>();

/** The quality state of the controller sending on `pc`, or null when there is none. */
export function senderQualityState(pc: RTCPeerConnection): SenderQualityState | null {
  return controllerByPc.get(pc)?.qualityState() ?? null;
}

export class PeerQualityController {
  private appliedKbps = 0;
  private appliedScale = 0;
  // Part of the same record. Without it a change that only moves the frame
  // rate — 1080p120 to 1080p60 under a bitrate dial low enough to cap both at
  // the same kbps — matched the guard on every other number and never reached
  // the sender.
  private appliedFramerate = 0;
  private appliedActive = true;
  // The mode those numbers were pushed with. Null means nothing is known to
  // have reached the sender — the initial state, and what a rejected
  // setParameters restores.
  private appliedPreference: RTCDegradationPreference | null = null;
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
  private paused = false;
  private link: LinkAdapter;
  private readonly startedAt = Date.now();
  // How this sender is addressed in the shared stats pump. Not the peer id: the
  // pump is one process-wide map and there is a registry per channel, so a peer
  // receiving both a screen and a camera share would otherwise be a single key
  // written by two owners — see PeerQualityRegistry's namespace.
  private statsKey: string;
  private sender: RTCRtpSender;
  private tier: QualityTier;
  private captureWidth: number;
  private captureHeight: number;
  // Whether those two came from the frames themselves, which outrank what the track
  // says (see SenderSample.sourceWidth).
  private captureMeasured = false;
  // The broadcaster's bitrate dial, in kbps. A hard limit on what this viewer
  // may be given; the tier decides how much of it is actually used.
  private bitrateCeilingKbps: number;
  private degradation: DegradationMode;

  constructor(
    statsKey: string,
    sender: RTCRtpSender,
    tier: QualityTier,
    captureWidth: number,
    captureHeight: number,
    bitrateCeilingKbps: number,
    degradation: DegradationMode
  ) {
    this.statsKey = statsKey;
    this.sender = sender;
    this.tier = tier;
    this.captureWidth = captureWidth;
    this.captureHeight = captureHeight;
    this.bitrateCeilingKbps = bitrateCeilingKbps;
    this.degradation = degradation;
    liveControllers.add(this);
    this.link = new LinkAdapter(Date.now());
    ensureMachineWatch();
  }

  /** See senderQualityState. */
  qualityState(): SenderQualityState {
    const tier = this.sentTier();
    return {
      tier,
      ceilingKbps: this.ceilingKbps(tier),
      degradationPreference: this.preference(),
      linkCapHeight: this.link.capHeight,
      machineLevel: machine.level,
      paused: this.paused,
    };
  }

  private preference(): RTCDegradationPreference {
    return isClassicSend() ? CLASSIC_PREFERENCE[this.degradation] : SEND_PREFERENCE;
  }

  // Not lowered for a link that is short: the estimator already holds the encoder
  // to what the link carries, and it can only learn the link recovered by being
  // allowed to use it. The machine is another matter (see heldCeilingKbps).
  private ceilingKbps(tier: QualityTier): number {
    const full = encoderCeilingKbps(tier, this.bitrateCeilingKbps);
    const spec = tierSpec(tier);
    const ceiling = isClassicSend()
      ? full
      : heldCeilingKbps(full, machineCapFor(machine.level, this.degradation), spec.height, spec.frameRate);
    return this.routeCapped() ? Math.min(ceiling, RELAY_ROUTE_MAX_KBPS) : ceiling;
  }

  /** Assign a new tier (tile resized, dial moved). */
  setTier(tier: QualityTier) {
    if (this.tier === tier) return;
    this.tier = tier;
    this.apply();
  }

  /**
   * What this viewer asked for: a tier, and whether they are looking at all
   * (see qualityNegotiation). Nothing is encoded while they are not, which is an
   * encoder less on the machine that is already the bottleneck in a mesh room.
   * One call for both, since a viewer coming back changes both at once and each
   * change to the sender is a reconfiguration.
   */
  setRequest(tier: QualityTier, paused: boolean) {
    if (this.tier === tier && this.paused === paused) return;
    this.tier = tier;
    if (this.paused !== paused) {
      this.paused = paused;
      if (paused) {
        machine.forget(this.statsKey);
      } else {
        // What the link did while nothing was going over it says nothing.
        const cap = this.link.capHeight;
        this.link = new LinkAdapter(Date.now());
        this.link.capHeight = cap;
      }
    }
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
    this.apply();
  }

  // Whether the relay cap applies: relayed on either side, and the account
  // is not exempt (Pro Ultra).
  private routeCapped(): boolean {
    return (this.relayLocal || this.relayRemote) && !relayCapExempt;
  }

  // What is actually encoded: the assigned tier, capped while the connection
  // is relayed through TURN. Only this send path sees the cap — getTier
  // still answers the assigned tier, so the dials and everything on screen
  // carry on as if the connection were direct.
  private sentTier(): QualityTier {
    return this.routeCapped() ? capTier(this.tier, RELAY_ROUTE_CAP) : this.tier;
  }

  /** What the track says it is capturing. See captureMeasured. */
  setCaptureSize(width: number, height: number) {
    if (this.captureMeasured || !width || !height) return;
    if (this.captureWidth === width && this.captureHeight === height) return;
    this.captureWidth = width;
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
    if (this.disposed || this.paused || isClassicSend()) return;
    const measuredWidth = sample.sourceWidth ?? 0;
    const measuredHeight = sample.sourceHeight ?? 0;
    if (measuredWidth > 0 && measuredHeight > 0) {
      this.captureMeasured = true;
      if (measuredWidth !== this.captureWidth || measuredHeight !== this.captureHeight) {
        this.captureWidth = measuredWidth;
        this.captureHeight = measuredHeight;
        this.apply();
      }
    }
    const tier = tierSpec(this.sentTier());
    const hardware = isHardwareImplementation(sample.encoderImplementation ?? null, sample.powerEfficient);
    const observation: SendObservation = {
      fps: sample.framesPerSecond,
      sourceFps: sample.sourceFps ?? null,
      targetFps: this.targetFps(),
      encodeMs: sample.encodeMs ?? null,
      hardware,
      limitation: sample.qualityLimitationReason,
      qp: sample.qp ?? null,
      codec: sample.codec ?? null,
      targetKbps: sample.targetKbps ?? 0,
      availableKbps: sample.availableKbps ?? 0,
      height: sample.frameHeight,
    };
    const software = hardware === false;
    const now = Date.now();
    const topHeight = Math.min(tier.height, this.captureHeight || tier.height);
    if (now - this.startedAt >= SEND_GRACE_MS) {
      machine.observe(this.statsKey, observation, this.degradation, software, { height: topHeight, fps: tier.frameRate }, now);
    }
    if (this.link.update(observation, this.degradation, topHeight, now)) this.apply();
  }

  private targetFps(): number {
    const cap = isClassicSend() ? null : machineCapFor(machine.level, this.degradation).fps;
    const fps = tierSpec(this.sentTier()).frameRate;
    return cap ? Math.min(cap, fps) : fps;
  }

  /** The height to send at, once every cap has had its say. */
  private sentHeight(): number {
    const height = tierSpec(this.sentTier()).height;
    if (isClassicSend()) return height;
    const machineHeight = machineCapFor(machine.level, this.degradation).height;
    return Math.min(height, this.link.capHeight ?? height, machineHeight ?? height);
  }

  /** Pushes the current target onto the sender, if it actually changed. */
  apply() {
    if (this.disposed) return;
    const tier = this.sentTier();
    const targetKbps = this.ceilingKbps(tier);
    const preference = this.preference();
    const scale = scaleForHeight(this.sentHeight(), this.captureWidth, this.captureHeight);
    const framerate = this.targetFps();
    const active = !this.paused || isClassicSend();

    // setParameters triggers an encoder reconfiguration; calling it with
    // values that did not change costs a keyframe and a visible hitch for
    // no benefit. In a 30-peer room this guard removes the large majority
    // of calls, since most peers are steady most of the time.
    if (
      this.appliedPreference === preference &&
      targetKbps === this.appliedKbps &&
      scale === this.appliedScale &&
      framerate === this.appliedFramerate &&
      active === this.appliedActive
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
    if (active !== this.appliedActive) mediaStats.setPaused(this.statsKey, !active);
    this.appliedKbps = targetKbps;
    this.appliedScale = scale;
    this.appliedFramerate = framerate;
    this.appliedActive = active;
    this.appliedPreference = preference;
    const seq = (this.applySeq += 1);
    const encodings =
      params.encodings && params.encodings.length > 0 ? params.encodings : [{} as RTCRtpEncodingParameters];
    encodings[0].active = active;
    encodings[0].maxBitrate = targetKbps * 1000;
    encodings[0].scaleResolutionDownBy = scale;
    encodings[0].maxFramerate = framerate;
    params.encodings = encodings;
    params.degradationPreference = preference;
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
        this.appliedActive = true;
        this.appliedPreference = null;
        // And undoing it is not enough on its own, which is the part that
        // bites. apply() runs when something moves, and on a settled link
        // nothing does. So there is no "next apply() will reconcile" to rely
        // on: without a retry of our own the sender keeps the old values for as
        // long as that link stays quiet.
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
    machine.forget(this.statsKey);
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
  private bitrateCeilingKbps = 6000;
  // Matches useRoomMedia's own default, for the same reason the bitrate seed
  // above does.
  private degradation: DegradationMode = "balanced";
  private keyPrefix: string;

  /**
   * `namespace` separates this registry's senders from every other one's in
   * the process-wide stats pump. There is a registry per media channel, all of
   * them keyed by the same peer ids, so without it a peer watching someone's
   * screen *and* camera collapsed into one shared entry: the camera's
   * registration overwrote the screen's, so the screen sender was never polled
   * at all; every sample the camera produced was fanned out to the screen's
   * controller too; and closing either channel's connection unregistered the
   * other one's sender along with it.
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
    captureWidth: number,
    captureHeight: number
  ): PeerQualityController {
    this.remove(peerId);
    const key = this.statsKey(peerId);
    const controller = new PeerQualityController(
      key,
      sender,
      tier,
      captureWidth,
      captureHeight,
      this.bitrateCeilingKbps,
      this.degradation
    );
    this.controllers.set(peerId, controller);
    controllerByPc.set(pc, controller);
    mediaStats.register(key, pc, sender);
    watchCpuPressure(true);
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
    if (liveControllers.size === 0) watchCpuPressure(false);
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

  setCaptureSize(width: number, height: number) {
    for (const c of this.controllers.values()) c.setCaptureSize(width, height);
  }

  clear() {
    for (const peerId of [...this.controllers.keys()]) this.remove(peerId);
    this.unsubscribeSender?.();
    this.unsubscribeSender = null;
  }
}

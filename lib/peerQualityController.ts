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
// And which codec it goes out in, on a share that gets to choose: the costly one for
// as many connections as the machine can afford (see chooseSharp in lib/sendAdaptation),
// changed on the running connection, with nothing renegotiated. And in which of that
// codec's modes, going by what is on the screen (see PictureWatch).
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
  chooseSharp,
  cpuPressure,
  heldCeilingKbps,
  LinkAdapter,
  machineCapFor,
  MachineGovernor,
  PictureWatch,
  SEND_GRACE_MS,
  SHARP_TAKE_WAIT_MS,
  watchCpuPressure,
  type SendObservation,
  type SharpCandidate,
} from "./sendAdaptation";
import { sendCodecFrom, sendHintFor, SHARP_CODEC } from "./videoCodecPreferences";
import { isClassicSend, onClassicSendChange } from "./classicSend";
import { isH264Send, onH264SendChange } from "./h264Send";
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

// In every browser that matters here, and not yet in TypeScript's own idea of one.
type EncodingWithCodec = RTCRtpEncodingParameters & { codec?: RTCRtpCodec };

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

// How many streams go through the graphics card's encoder at once. On a Radeon RX 560, five took
// the driver down in one run of three, and the whole machine's screen with it, where four
// never have. Past this a connection goes on a software encoder, at the price of most of a core.
const CARD_STREAMS_MAX = 4;
// Whether this machine's H264 encoder is the graphics card's; null until one has been heard from.
let cardH264: boolean | null = null;

// What an encoder on the graphics card starts on. AMD's H264 goes by the bits it is started
// with. Started on all the link has, which is what changing codec, coming back from a pause
// or getting a new height all do, it spends most of its time at 13-16 fps and QP 19, on 6 Mbps
// of a 12 Mbps estimate. Started on little, as at the beginning of a share when the estimator
// has yet to ramp up, it holds 30 fps at QP 26 on the same 6 Mbps. Lowering the bits after the
// start does not help. How soon they can come back is ENCODER_START_MS.
//
// Nor can it be switched off and on. AMD's, active again after ten seconds, sends key frame after
// key frame that the viewer's hardware decoder never takes, for as long as anyone has waited.
// So a connection nobody is looking at goes off the card altogether, and an encoder comes back
// new. Which also hands its place on the card over while it is not using it.
const ENCODER_START_KBPS = 1500;
const ENCODER_START_MS = 1500;

// Who goes out in the costly codec, over every connection on this machine, and who stays
// off the graphics card.
function planSharp() {
  const now = Date.now();
  const pressure = cpuPressure();
  const calm = machine.level === 0 && pressure !== "serious" && pressure !== "critical";
  const controllers = [...liveControllers];
  const candidates = controllers.flatMap((c) => c.sharpCandidate(now, calm));
  const cores = globalThis.navigator?.hardwareConcurrency || 4;
  const chosen = chooseSharp(candidates, cores);
  const movable = (c: PeerQualityController) => c.takesPlainCodec(chosen.has(c.key()));
  // Those with no say in it take their places first: a camera, say.
  let room = CARD_STREAMS_MAX - controllers.filter((c) => !movable(c) && c.encodingOnCard()).length;
  for (const c of controllers) {
    const plain = movable(c);
    c.setCodecChoice(chosen.has(c.key()), plain && cardH264 === true && room <= 0, now);
    if (plain) room -= 1;
  }
}

// They all carry the same capture, so one try answers for all of them.
function settlePicture() {
  const now = Date.now();
  if (![...liveControllers].some((c) => c.pictureProven())) return;
  for (const c of liveControllers) c.adoptPicture(now);
}

function ensureMachineWatch() {
  if (machineWatching) return;
  machineWatching = true;
  mediaStats.onCapacity(() => {
    const changed = machine.tick(cpuPressure(), Date.now());
    planSharp();
    settlePicture();
    if (changed) for (const c of liveControllers) c.apply();
  });
  const again = () => {
    planSharp();
    for (const c of liveControllers) c.apply();
  };
  onClassicSendChange(again);
  onH264SendChange(again);
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
  /** Whether they are getting the costly codec. */
  sharp: boolean;
  /** Whether that went to its camera mode for a moving picture. */
  movingPicture: boolean;
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
  // Which way the codec was chosen; null until that reached a sender with something
  // negotiated to choose from.
  private appliedSharp: boolean | null = null;
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
  // Whether this connection chooses its codec. If so its track is its own, so the
  // encoder's mode can go with the codec without touching anyone else's.
  private readonly choosesCodec: boolean;
  private sharp = false;
  // This viewer's answer left the costly codec out.
  private sharpRefused = false;
  // Whether its encoder was on the graphics card when last heard from.
  private onCard = false;
  // Past what the card holds: see planSharp.
  private offCard = false;
  private appliedOffCard = false;
  // Its encoder has just been started: see ENCODER_START_KBPS.
  private startingLow = false;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private codecChangedAt = 0;
  private availableKbps = 0;
  private picture = new PictureWatch();

  constructor(
    statsKey: string,
    sender: RTCRtpSender,
    tier: QualityTier,
    captureWidth: number,
    captureHeight: number,
    bitrateCeilingKbps: number,
    degradation: DegradationMode,
    choosesCodec = false
  ) {
    this.choosesCodec = choosesCodec;
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
      sharp: this.sharp,
      movingPicture: this.picture.proven,
    };
  }

  key(): string {
    return this.statsKey;
  }

  /** This connection as chooseSharp sees it; nothing when it is out of the running. */
  sharpCandidate(now: number, calm: boolean): SharpCandidate[] {
    if (!this.choosesCodec || this.sharpRefused || this.paused || isClassicSend() || isH264Send()) return [];
    if (!machineCapFor(machine.level, this.degradation).sharp) return [];
    return [
      {
        key: this.statsKey,
        profile: this.degradation,
        height: this.sentHeight(),
        fps: this.targetFps(),
        holding: this.sharp,
        mayTake: calm && now - this.codecChangedAt >= SHARP_TAKE_WAIT_MS,
        // The estimator ramping up is not a short link.
        availableKbps: now - this.startedAt >= SEND_GRACE_MS ? this.availableKbps : 0,
      },
    ];
  }

  private watchesPicture(): boolean {
    return this.sharp && !this.paused && this.degradation !== "motion";
  }

  pictureProven(): boolean {
    return this.watchesPicture() && this.picture.proven;
  }

  pictureTrying(): boolean {
    return this.watchesPicture() && this.picture.trying;
  }

  /** Camera mode came out better on another connection. */
  adoptPicture(now: number) {
    if (this.watchesPicture() && this.picture.adopt(now)) this.applyHint();
  }

  /** Encoding on the graphics card right now. */
  encodingOnCard(): boolean {
    return this.onCard && !this.paused;
  }

  /** Whether this connection would go on a plain codec, and is free to choose which. */
  takesPlainCodec(sharp: boolean): boolean {
    return this.choosesCodec && !sharp && !this.paused;
  }

  setCodecChoice(sharp: boolean, offCard: boolean, now: number) {
    // The card means nothing to a connection in the costly codec.
    const moved = this.sharp !== sharp || (!sharp && this.offCard !== offCard);
    this.offCard = offCard;
    if (!moved) return;
    this.sharp = sharp;
    // Nothing being encoded, nothing anyone could see change: no reason to make them wait.
    if (!this.paused && this.appliedSharp !== null) this.codecChangedAt = now;
    // What the link could carry in another codec says nothing about this one.
    this.link = new LinkAdapter(now);
    this.picture = new PictureWatch();
    this.apply();
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
    planSharp();
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
        // Nor does it say what is on the screen now.
        this.picture = new PictureWatch();
      }
    }
    planSharp();
    this.apply();
    this.applyHint();
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
    this.picture = new PictureWatch();
    planSharp();
    this.apply();
    this.applyHint();
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
    // The browser leaves the estimate out of the odd report, which says nothing.
    if (sample.availableKbps) this.availableKbps = sample.availableKbps;
    const tier = tierSpec(this.sentTier());
    const hardware = isHardwareImplementation(sample.encoderImplementation ?? null, sample.powerEfficient);
    // A report that does not say is no news.
    if (hardware !== null) {
      const cardBefore = cardH264;
      if (sample.codec?.toUpperCase() === "H264") cardH264 = hardware;
      if (hardware !== this.onCard || cardH264 !== cardBefore) {
        this.onCard = hardware;
        planSharp();
      }
    }
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
      sentKbps: sample.outgoingKbps,
      availableKbps: sample.availableKbps ?? 0,
      height: sample.frameHeight,
    };
    const software = hardware === false;
    const now = Date.now();
    const topHeight = Math.min(tier.height, this.captureHeight || tier.height);
    if (now - this.startedAt >= SEND_GRACE_MS) {
      machine.observe(this.statsKey, observation, this.degradation, software, { height: topHeight, fps: tier.frameRate, sharp: this.sharp }, now);
    }
    if (this.link.update(observation, this.degradation, topHeight, now)) this.apply();
    if (this.watchesPicture()) {
      const mayTry = ![...liveControllers].some((c) => c !== this && c.pictureTrying());
      if (this.picture.update(observation, now, mayTry)) this.applyHint();
    }
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

  // Whether this connection stays off the graphics card, past what it holds or while it is paused.
  private sentOffCard(): boolean {
    return this.choosesCodec && !this.sharp && (this.offCard || (this.paused && cardH264 !== false));
  }

  // Whether these settings make the browser start the encoder over, on the graphics card.
  private restartsOnCard(scale: number, active: boolean, sharp: boolean | null, offCard: boolean): boolean {
    if (!this.choosesCodec || !active || sharp || offCard || cardH264 === false) return false;
    // Nothing has reached the sender yet, so nothing is being started over.
    if (this.appliedScale === 0 || this.appliedSharp === null) return false;
    return scale !== this.appliedScale || !this.appliedActive || sharp !== this.appliedSharp || offCard !== this.appliedOffCard;
  }

  private startLow() {
    this.startingLow = true;
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      this.startingLow = false;
      this.apply();
    }, ENCODER_START_MS);
  }

  /** Pushes the current target onto the sender, if it actually changed. */
  apply() {
    if (this.disposed) return;
    const tier = this.sentTier();
    const preference = this.preference();
    const scale = scaleForHeight(this.sentHeight(), this.captureWidth, this.captureHeight);
    const framerate = this.targetFps();
    // A channel that cannot choose its codec has nowhere to go off the card to.
    const active = !this.paused || isClassicSend() || (!this.choosesCodec && this.onCard);
    const sharp = this.choosesCodec ? this.sharp : null;
    const offCard = this.sentOffCard();
    if (this.restartsOnCard(scale, active, sharp, offCard)) this.startLow();
    const ceiling = this.ceilingKbps(tier);
    const targetKbps = this.startingLow ? Math.min(ceiling, ENCODER_START_KBPS) : ceiling;

    // setParameters triggers an encoder reconfiguration; calling it with
    // values that did not change costs a keyframe and a visible hitch for
    // no benefit. In a 30-peer room this guard removes the large majority
    // of calls, since most peers are steady most of the time.
    if (
      this.appliedPreference === preference &&
      targetKbps === this.appliedKbps &&
      scale === this.appliedScale &&
      framerate === this.appliedFramerate &&
      active === this.appliedActive &&
      sharp === this.appliedSharp &&
      offCard === this.appliedOffCard
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
    this.appliedOffCard = offCard;
    const seq = (this.applySeq += 1);
    const encodings =
      params.encodings && params.encodings.length > 0 ? params.encodings : [{} as RTCRtpEncodingParameters];
    encodings[0].active = active;
    encodings[0].maxBitrate = targetKbps * 1000;
    encodings[0].scaleResolutionDownBy = scale;
    encodings[0].maxFramerate = framerate;
    this.chooseCodec(params, encodings[0]);
    params.encodings = encodings;
    params.degradationPreference = preference;
    this.sender.setParameters(params).then(
      () => {
        if (seq !== this.applySeq) return;
        this.retriesLeft = APPLY_RETRIES;
        this.checkCodecTook();
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
        this.appliedSharp = null;
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

  // The codec for this connection, as far as there is anything to choose from yet.
  // Before the answer there is not: H264 is first in the offer, and with nothing
  // negotiated nothing is encoded either, so choosing can wait for it.
  private chooseCodec(params: RTCRtpSendParameters, encoding: EncodingWithCodec) {
    if (!this.choosesCodec) return;
    const negotiated = params.codecs ?? [];
    if (this.sharp && negotiated.length > 0 && !negotiated.some((c) => c.mimeType === SHARP_CODEC)) {
      this.sharpRefused = true;
      this.sharp = false;
    }
    this.applyHint();
    this.appliedSharp = negotiated.length > 0 ? this.sharp : null;
    const codec = sendCodecFrom(negotiated, this.sharp, this.sentOffCard());
    if (codec) encoding.codec = codec;
  }

  // The encoder's mode. The track is this connection's own, and the browser takes it from
  // there: nothing else about the connection changes.
  private applyHint() {
    if (!this.choosesCodec) return;
    const track = this.sender.track;
    const hint = sendHintFor(this.sharp, this.degradation === "motion" || this.picture.moving);
    if (track && track.contentHint !== hint) track.contentHint = hint;
  }

  // A browser old enough not to know encodings[0].codec drops it without a word, and
  // the connection goes on in H264 in the wrong encoder mode.
  private checkCodecTook() {
    if (!this.sharp || this.appliedSharp !== true) return;
    if ((this.sender.getParameters().encodings?.[0] as EncodingWithCodec | undefined)?.codec) return;
    this.sharpRefused = true;
    this.setCodecChoice(false, this.offCard, Date.now());
  }

  dispose() {
    this.disposed = true;
    liveControllers.delete(this);
    machine.forget(this.statsKey);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
    // What it held goes to somebody else.
    planSharp();
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
    captureHeight: number,
    choosesCodec = false
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
      this.degradation,
      choosesCodec
    );
    this.controllers.set(peerId, controller);
    controllerByPc.set(pc, controller);
    mediaStats.register(key, pc, sender);
    watchCpuPressure(true);
    planSharp();
    controller.apply();
    // Our own end relaying through TURN. The viewer's end is theirs to
    // see — see setRemoteRelayRoute.
    const stopRoute = watchTurnRelay(pc, (via) => controller.setRelayRoute("local", via));
    // The answer is what there is to choose a codec from.
    const onNegotiated = () => {
      if (pc.signalingState === "stable") controller.apply();
    };
    pc.addEventListener("signalingstatechange", onNegotiated);
    this.routeWatches.set(peerId, () => {
      stopRoute();
      pc.removeEventListener("signalingstatechange", onNegotiated);
    });
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

// The congestion control law: what one viewer's link telemetry does to the
// share of their tier they are trusted with.
//
// Split out of peerQualityController deliberately. This handful of
// comparisons is the entire policy — it decides, for every viewer in every
// room, whether their picture is allowed to be worse than they asked for —
// and it is the one part of the quality path with no natural safety net. A
// tier that comes out too low is visible and gets reported; a ratio that
// comes out too low looks exactly like a bad network, so it can be wrong
// indefinitely without anybody being able to say so. On its own, with no
// peer connection or sender attached, it can be read, argued with and tested,
// which is what a rule of that reach deserves.

import type { SenderSample } from "./mediaStats";

// Congestion thresholds.
//
// The ratio survives room churn (see PeerQualityController.setTier, which
// deliberately leaves this state alone), which makes every step down a
// lasting scar rather than a transient dip — so the evidence
// required for one is deliberately high: a sample only counts as bad if the
// encoder itself reports being limited *and* these thresholds agree, it takes
// BAD_STREAK_TO_BACKOFF of those in a row, and no single noisy sample (one
// dropped ack, a brief wifi retransmit, a GC pause) can cut anyone's bitrate
// on its own.
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
const LOSS_GOOD = 0.01;
const BACKOFF = 0.9;
const RECOVER = 1.25;
const BAD_STREAK_TO_BACKOFF = 3;
const HEALTHY_STREAK_TO_RECOVER = 2;
const MIN_RATIO = 0.45;

// Delay thresholds, measured as a *rise above this peer's own floor* rather
// than as absolute round-trip time.
//
// This is the correction to the single most damaging line in this file. It
// used to read `rtt > 0.35`, and absolute RTT is not a congestion signal at
// all — it is mostly distance. WebRTC's own controller knows this and reacts
// to the delay *gradient*, never to a fixed threshold, for exactly this
// reason.
//
// What the old thresholds did to somebody 300ms away — an intercontinental
// viewer, a phone on a slow mobile network, or, since it adds a hop through
// a relay, absolutely everybody whenever "Impedir conexões diretas" is on —
// was permanent. Every single sample tripped the bad branch with zero packet
// loss and a perfectly healthy link, so the ratio ratcheted down to MIN_RATIO
// and stayed: recovery required `rtt < 0.2`, which that path can never
// produce. Roughly half the bitrate, for the whole session, for being far
// away. With a lower bitrate dial the resulting share also crossed SCALE_HARD
// below, so the picture was halved in resolution on top of it.
//
// Against a per-peer floor these numbers mean what they say: 150ms of
// standing queue on top of whatever this path normally costs is real
// congestion on anyone's link, and being within 50ms of the floor is clean on
// anyone's link.
const RTT_EXCESS_BAD = 0.15;
const RTT_EXCESS_GOOD = 0.05;

// How fast the observed floor is allowed to drift upwards. Without it the
// floor is a running minimum that never rises, so a path that genuinely got
// slower — a rerouted connection, a handover onto a different network —
// would read as permanently congested against a floor it can no longer
// reach. Bounded by the current sample, so it only ever creeps towards a
// delay actually being observed.
const RTT_FLOOR_CREEP = 1.02;

/**
 * Everything this layer knows about one viewer's link.
 *
 * `rttFloor` is the lowest round-trip time that peer has shown us — what
 * their path costs when nothing is queued. Every delay judgement is made
 * against it rather than against an absolute number; see RTT_EXCESS_BAD.
 */
export interface CongestionState {
  /** Share of the tier's bitrate this link is currently trusted with, 0..1. */
  ratio: number;
  healthyStreak: number;
  badStreak: number;
  /** Zero until the first usable sample. */
  rttFloor: number;
}

export function initialCongestionState(): CongestionState {
  return { ratio: 1, healthyStreak: 0, badStreak: 0, rttFloor: 0 };
}

export interface CongestionOptions {
  /**
   * Experiment "congestion-recover" (see lib/congestionRecover): count a clean
   * link as healthy even while the encoder says it is limited.
   *
   * Recovery used to demand qualityLimitationReason "none" on top of a clean
   * link. A software H264 encoder almost never reports "none" — WebRTC files
   * its QP-driven quality scaling under "bandwidth" — so once a burst of loss
   * had cut its ratio, nothing could bring it back for the rest of the
   * session. A backoff still needs "limited" (that is the evidence it acts
   * on); recovery, with this, needs only what recovery is about: no loss and
   * no standing queue. Real congestion is still WebRTC's to answer first.
   */
  recoverWhileLimited?: boolean;
}

/**
 * The control law, as one pure step: what a single telemetry sample does to a
 * viewer's congestion state. See the head of this file for why it lives on
 * its own.
 */
export function congestionStep(
  state: CongestionState,
  sample: SenderSample,
  options: CongestionOptions = {}
): CongestionState {
  const { fractionLost, rtt, qualityLimitationReason } = sample;
  const rttFloor = nextRttFloor(state.rttFloor, rtt);
  const rttExcess = rttFloor > 0 ? rtt - rttFloor : 0;

  // The browser's own verdict on whether this encoder is being held back at
  // all, and by what. It is the authoritative input and it was being thrown
  // away: the stats pump has always collected it, and nothing but the
  // aggregate CPU-pressure figure ever read it.
  //
  // Loss and delay are circumstantial. They can be raised by somebody else's
  // download on a shared link, by the other twenty connections this same
  // machine is running, or by nothing more than distance. This is the encoder
  // reporting what it actually did — so "none" means there is no shortage to
  // respond to, whatever the circumstantial numbers say, and reducing anything
  // in that state is quality given away for nothing.
  //
  // A browser that does not report the stat leaves it at "none" (see
  // mediaStats), which switches this layer off and defers entirely to the
  // browser's own adaptation. That is the right fallback rather than a gap:
  // WebRTC's congestion control is the fast, correct reflex here, and all this
  // layer ever added was a slow second opinion on top of it.
  const limited = qualityLimitationReason === "bandwidth" || qualityLimitationReason === "cpu";
  const congested = limited && (fractionLost > LOSS_BAD || rttExcess > RTT_EXCESS_BAD);
  const healthy =
    (qualityLimitationReason === "none" || options.recoverWhileLimited === true) &&
    fractionLost <= LOSS_GOOD &&
    rttExcess < RTT_EXCESS_GOOD;

  if (congested) {
    const badStreak = state.badStreak + 1;
    if (badStreak < BAD_STREAK_TO_BACKOFF) {
      return { ...state, rttFloor, healthyStreak: 0, badStreak };
    }
    return {
      rttFloor,
      healthyStreak: 0,
      badStreak: 0,
      ratio: Math.max(MIN_RATIO, state.ratio * BACKOFF),
    };
  }

  if (healthy) {
    const healthyStreak = state.healthyStreak + 1;
    if (healthyStreak < HEALTHY_STREAK_TO_RECOVER || state.ratio >= 1) {
      return { ...state, rttFloor, badStreak: 0, healthyStreak };
    }
    return {
      rttFloor,
      badStreak: 0,
      healthyStreak: 0,
      ratio: Math.min(1, state.ratio * RECOVER),
    };
  }

  // Neither clearly bad nor clearly good. Clears the bad streak, because a
  // backoff has to be built out of consecutive positive evidence — but
  // deliberately leaves the healthy streak standing, which is the change from
  // wiping both.
  //
  // Wiping both made recovery impossible in exactly the rooms that need it.
  // The stats pump round-robins, so with dozens of senders each one is visited
  // every ten seconds or more; climbing back from MIN_RATIO takes four
  // consecutive clean pairs, i.e. minutes, and a single ambiguous reading
  // anywhere in that window sent it back to the start. The asymmetry this file
  // says it wants — retreat slowly, recover faster — only holds if "no news"
  // stops counting as bad news.
  return { ...state, rttFloor, badStreak: 0 };
}

/** The delay floor after observing `rtt`. See RTT_FLOOR_CREEP. */
export function nextRttFloor(floor: number, rtt: number): number {
  if (rtt <= 0) return floor;
  if (floor === 0 || rtt < floor) return rtt;
  return Math.min(rtt, floor * RTT_FLOOR_CREEP);
}

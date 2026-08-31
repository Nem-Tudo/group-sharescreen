"use client";

// Capacity exchange and topology decision.
//
// Everything here exists to answer one question as cheaply and as honestly as
// possible: *can the broadcaster serve this room directly?* If yes — which,
// once per-viewer tiering is in play, is the common case even at 30 people —
// nothing happens at all. No relays, no extra hops, no extra latency, no
// stranger's CPU being spent. Cascading is the fallback for when the answer
// is no, not the default shape of the room.
//
// Capacity is exchanged peer to peer over the existing signalling relay (the
// server forwards a signal's `data` opaquely), so none of this needs a
// backend change.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signalingClient } from "./signalingClient";
import { encodeBudget, mediaStats, type CapacitySample } from "./mediaStats";
import {
  fitsDirectMesh,
  parentsOf,
  planTopology,
  type PlannerNode,
  type PlannerViewer,
  type TopologyPlan,
} from "./topologyPlanner";
import { encodeMpxs, type QualityTier } from "./videoQuality";

export interface PeerCapacity {
  peerId: string;
  uploadKbps: number;
  encodeMpxs: number;
  /** false for phones/tablets and anything on battery — never promoted. */
  eligibleRelay: boolean;
  /**
   * Whether the two figures above were observed or assumed — see
   * PlannerNode.measured. Absent from an older client's report, which is read
   * as "assumed", the conservative reading and the one that matches what those
   * clients are actually sending.
   */
  measured: boolean;
  firstSeenAt: number;
  updatedAt: number;
}

// Devices we refuse to promote to relay regardless of their measured numbers.
// A phone can momentarily show a fine uplink and still be the worst possible
// choice: thermal throttling, metered data, and the fact that backgrounding
// the tab suspends everything the subtree below it depends on.
type NetworkInformation = {
  effectiveType?: string;
  saveData?: boolean;
  type?: string;
};

function networkInformation(): NetworkInformation | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as unknown as { connection?: NetworkInformation }).connection;
}

function isRelayEligible(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
  const cores = navigator.hardwareConcurrency || 2;
  if (cores < 4) return false;
  // What the browser will admit about the connection itself. Absent in Safari
  // and Firefox, where the checks above stand alone — but where it does exist
  // it is the only direct evidence available about a link this device is not
  // currently pushing traffic through, and every one of these says "do not
  // hand this person someone else's stream to carry".
  const connection = networkInformation();
  if (connection) {
    if (connection.saveData === true) return false;
    if (connection.type === "cellular") return false;
    const effective = connection.effectiveType;
    if (effective === "slow-2g" || effective === "2g" || effective === "3g") return false;
  }
  const battery = (navigator as unknown as { getBattery?: unknown }).getBattery;
  // Presence of a battery API says nothing on its own; the charging check
  // happens asynchronously in useMeshCapacity and can veto later.
  void battery;
  return true;
}

const CAPACITY_BROADCAST_MS = 8000;

// Assumed uplink before any measurement exists at all. Only a placeholder for
// the first seconds of a share — but a placeholder that is too small is not
// harmless, because the plan it produces is a downgrade, and a downgraded
// room sends less, which is exactly what keeps a bandwidth estimate small.
const ASSUMED_UPLINK_KBPS = 8000;

/**
 * This device's uplink, in kbps, as honestly as it can be stated.
 *
 * ICE's estimate is a lower bound with a warm-up: the only way it learns the
 * link carries more is by the link actually carrying more. So it reads far
 * below the truth in the first seconds of a share, and stays there for as
 * long as the room is being kept deliberately cheap. Taking the larger of the
 * estimate and what we are demonstrably already pushing breaks that circle —
 * a link visibly carrying 12 Mbps right now is not a 4 Mbps link, whatever
 * the estimator has caught up to believing.
 */
function estimatedUplinkKbps(capacity: CapacitySample): number {
  const proven = capacity.usedOutgoingKbps * 1.25;
  const measured = capacity.availableOutgoingKbps;
  if (measured <= 0) return Math.max(ASSUMED_UPLINK_KBPS, proven);
  return Math.max(measured, proven);
}

// Cascading only ever pays for itself in a room big enough that the
// alternative — everyone downgraded a tier or two to fit the broadcaster's
// own link — is worse than a relay hop's cost (a full decode+re-encode,
// ~120-220ms and a generation of quality loss, see relayLink.ts). Below this
// many people in the room, a broadcaster who can't reach everyone directly
// is degraded uniformly instead (see planTopology's downgrade loop) rather
// than routed through another participant's browser. Also used to skip the
// capacity broadcast below entirely in a small room: nothing there is ever
// read once cascading itself is off, so sending it would be pure background
// signalling traffic for no reason.
const CASCADE_ROOM_SIZE_THRESHOLD = 10;

/**
 * Measures this device's own serving capacity and keeps the room informed.
 *
 * The upload figure comes from ICE's own bandwidth estimate rather than a
 * synthetic probe: it is already being computed for congestion control, it
 * reflects the actual path to actual peers, and probing separately would
 * mean deliberately congesting the very link we are trying to measure.
 */
export function useMeshCapacity() {
  const [capacity, setCapacity] = useState<CapacitySample>(() => mediaStats.getCapacity());
  const [relayEligible, setRelayEligible] = useState(() => isRelayEligible());
  const loadRef = useRef(0);

  useEffect(() => {
    const unsubscribe = mediaStats.onCapacity((sample) => {
      setCapacity(sample);
      // Feed observed CPU pressure back into the encode budget. This is the
      // only trustworthy signal available: hardwareConcurrency is a guess,
      // but "the encoder said it could not keep up" is ground truth.
      encodeBudget.observe(sample.cpuPressure, loadRef.current);
    });
    return unsubscribe;
  }, []);

  // A laptop on battery is technically capable and still a bad relay: the
  // extra encodes are a visible, unrequested drain on someone who only came
  // to watch.
  useEffect(() => {
    const nav = navigator as unknown as {
      getBattery?: () => Promise<{ charging: boolean; addEventListener: (e: string, f: () => void) => void }>;
    };
    if (!nav.getBattery) return;
    let cancelled = false;
    nav
      .getBattery()
      .then((b) => {
        const update = () => {
          if (!cancelled) setRelayEligible(isRelayEligible() && b.charging);
        };
        update();
        b.addEventListener("chargingchange", update);
      })
      .catch(() => {
        // Firefox and Safari do not expose this; the UA/core heuristics stand.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Current encode load, in Mpx/s, so the budget estimator can calibrate. */
  const reportLoad = useCallback((tiers: QualityTier[]) => {
    loadRef.current = tiers.reduce((sum, t) => sum + encodeMpxs(t), 0);
  }, []);

  // A number, not the capacity object: a fresh sample lands every couple of
  // seconds and mostly says the same thing, and `self` changing is what makes
  // the capacity broadcast below restart its interval.
  const uplinkKbps = estimatedUplinkKbps(capacity);

  // Whether the stats pump has ever produced a sample for us. It only runs
  // while we have outbound media, so this is precisely "have we ever actually
  // pushed anything and watched what happened" — which is the difference
  // between the numbers above being a measurement and being a default. See
  // PlannerNode.measured for why that difference decides whether this device
  // is safe to promote.
  const measured = capacity.sampledAt > 0;

  const self = useMemo<PlannerNode>(
    () => ({
      id: signalingClient.state.selfId ?? "self",
      uploadKbps: uplinkKbps,
      encodeMpxs: encodeBudget.get(),
      stableSeconds: 0,
      eligibleRelay: relayEligible,
      measured,
    }),
    [uplinkKbps, relayEligible, measured]
  );

  // Tell whoever is broadcasting what we could carry, so they can plan.
  //
  // Two things are deliberately narrow here. It is sent only to peers who are
  // actually sharing — they are the only ones who could ever need to plan a
  // tree — rather than to the whole room, which would be N² messages every
  // interval for information nobody else reads. And it runs whenever *someone
  // else* is sharing, not when we are: the party with something to report is
  // the potential relay, which is precisely the viewer.
  useEffect(() => {
    const broadcast = () => {
      const nonModeratorPeers = signalingClient.state.peers.filter((p) => p.role !== "moderator");
      // Below CASCADE_ROOM_SIZE_THRESHOLD, useMeshTopology never builds a
      // plan that could use this — see its own doc comment.
      if (nonModeratorPeers.length + 1 <= CASCADE_ROOM_SIZE_THRESHOLD) return;
      const broadcasters = nonModeratorPeers.filter((p) => p.sharing);
      if (broadcasters.length === 0) return;
      for (const peer of broadcasters) {
        signalingClient.sendSignal(peer.id, {
          channel: "screen",
          role: "viewer",
          kind: "capacity",
          uploadKbps: self.uploadKbps,
          encodeMpxs: self.encodeMpxs,
          eligibleRelay: self.eligibleRelay,
          measured: self.measured,
        });
      }
    };
    broadcast();
    const timer = setInterval(broadcast, CAPACITY_BROADCAST_MS);
    return () => clearInterval(timer);
  }, [self]);

  return { capacity, self, relayEligible, reportLoad };
}

export interface TopologyAdvice {
  /** True when the root can serve everyone directly — the desired state. */
  directMeshFits: boolean;
  plan: TopologyPlan | null;
  /** Human-readable reason the cascade engaged, or null when it has not. */
  reason: string | null;
}

// Re-planning is not free and, more importantly, acting on a new plan means
// tearing down and rebuilding real connections. Only re-plan when the inputs
// have actually moved, and never faster than this.
const REPLAN_COOLDOWN_MS = 6000;

// How many consecutive evaluations must agree the room does not fit before a
// cascade is actually built.
//
// The very first evaluation of a share is systematically the most pessimistic
// one it will ever make, and it used to be acted on immediately. Nobody has
// reported a tile size yet, so every viewer is budgeted at the broadcaster's
// full ceiling rather than the thumbnail they will turn out to need; the
// bandwidth estimator has not ramped, so the uplink reads at its assumed
// floor; and the content multiplier is still at its neutral 1.0. Demand is
// overstated and supply understated at the same moment, so a large room
// reliably concluded it needed a cascade, built the whole tree, and then tore
// it down again once the real numbers arrived seconds later — with a
// reconnection and a blank tile for every viewer, twice, before anyone had
// watched anything. Requiring the answer to hold still first costs a few
// seconds of a mesh that may be over-subscribed; acting on the first answer
// cost every large share a guaranteed double reshuffle.
const CASCADE_ENGAGE_STREAK = 3;

/**
 * Decides whether the current room needs a cascade, and if so, what shape.
 *
 * Deliberately returns *advice*, not side effects. Nothing here opens or
 * closes a connection: the caller applies the plan (or, in the common case,
 * discovers there is nothing to apply and carries on with plain mesh).
 */
export function useMeshTopology(
  active: boolean,
  selfRef: { current: PlannerNode },
  // Getters rather than values: these maps are mutated on the signalling hot
  // path (a capacity message every few seconds per peer, a quality request on
  // every tile resize). Feeding them through React state would re-render the
  // whole room on each one. Evaluating on a timer instead keeps the cost off
  // the render path entirely, and topology simply does not need to react
  // within a frame.
  getPeerCapacities: () => Map<string, PeerCapacity>,
  getRequestedTiers: () => Map<string, QualityTier>,
  getContentMultiplier: () => number
): TopologyAdvice {
  const [advice, setAdvice] = useState<TopologyAdvice>({
    directMeshFits: true,
    plan: null,
    reason: null,
  });

  useEffect(() => {
    // Everything, including the idle reset, runs off the render path. The
    // updater form is also load-bearing: it returns the previous object
    // unchanged when nothing meaningful moved, so a room sitting comfortably
    // in direct mesh re-renders nobody, every six seconds, forever.
    // Consecutive evaluations that said the room does not fit (see
    // CASCADE_ENGAGE_STREAK) and the shape of the last plan built (see
    // planTopology's `currentParents`). Both live for as long as this share
    // does and reset with it, which is exactly the right lifetime: a new share
    // has no history worth preserving and should not inherit another one's.
    let missStreak = 0;
    let lastParents: Map<string, string> | undefined;
    const idle = () =>
      setAdvice((prev) =>
        prev.directMeshFits && !prev.plan ? prev : { directMeshFits: true, plan: null, reason: null }
      );
    if (!active) {
      const t = setTimeout(idle, 0);
      return () => clearTimeout(t);
    }
    const evaluate = () => {
    const now = Date.now();
    const self = selfRef.current;
    const peerCapacities = getPeerCapacities();
    const requestedTiers = getRequestedTiers();
    const contentMultiplier = getContentMultiplier();

    const viewers: PlannerViewer[] = signalingClient.state.peers
      .filter((p) => p.role !== "moderator")
      .map((p) => {
        const cap = peerCapacities.get(p.id);
        return {
          id: p.id,
          uploadKbps: cap?.uploadKbps ?? 0,
          encodeMpxs: cap?.encodeMpxs ?? 0,
          stableSeconds: cap ? Math.round((now - cap.firstSeenAt) / 1000) : 0,
          // A peer we have never heard capacity from cannot be trusted to
          // relay; silence is not evidence of capability.
          eligibleRelay: cap?.eligibleRelay ?? false,
          measured: cap?.measured ?? false,
          wantTier: requestedTiers.get(p.id) ?? "720p30",
        };
      });

    if (viewers.length === 0) {
      missStreak = 0;
      setAdvice((prev) => (prev.directMeshFits && !prev.plan ? prev : { directMeshFits: true, plan: null, reason: null }));
      return;
    }

    // The cheap path, and the one that should normally win: if the root can
    // reach everyone directly there is no plan to build and nothing to change.
    if (fitsDirectMesh(self, viewers, contentMultiplier)) {
      missStreak = 0;
      setAdvice((prev) => (prev.directMeshFits && !prev.plan ? prev : { directMeshFits: true, plan: null, reason: null }));
      return;
    }

    // It does not fit — but wait for the reading to hold before acting on it.
    // See CASCADE_ENGAGE_STREAK. Once a cascade is running the streak is
    // already satisfied, so this delays engaging without ever delaying a
    // re-plan of a tree that exists.
    missStreak += 1;
    if (missStreak < CASCADE_ENGAGE_STREAK) return;

    // Below the threshold, nobody is eligible to relay — the planner falls
    // back to its uniform-downgrade path on its own (the same one it already
    // uses for peers it has no capacity report from at all), so this needs
    // no other change here.
    const roomSize = viewers.length + 1;
    const plannerViewers =
      roomSize > CASCADE_ROOM_SIZE_THRESHOLD
        ? viewers
        : viewers.map((v) => (v.eligibleRelay ? { ...v, eligibleRelay: false } : v));

    // Feeding the previous plan back in is what keeps this from redrawing the
    // tree on every pass — see planTopology's `currentParents`.
    const plan = planTopology(self, plannerViewers, contentMultiplier, lastParents);
    lastParents = parentsOf(plan);
    const reason =
      plan.depth > 1
        ? `Sua conexão não alcança ${viewers.length} pessoas sozinha — ${plan.relays.length} participante(s) estão ajudando a retransmitir.`
        : plan.globalDowngrade > 0
          ? "Qualidade reduzida para caber na sua conexão."
          : null;
      setAdvice({ directMeshFits: false, plan, reason });
    };

    // Deliberately not evaluated synchronously here. At the instant a share
    // starts no capacity reports have arrived yet, so an immediate pass would
    // plan against an empty picture and could briefly claim the room does not
    // fit. Letting the first pass land a moment later also keeps this off the
    // render path, which is what the setState-in-effect rule is protecting.
    const first = setTimeout(evaluate, 1500);
    const timer = setInterval(evaluate, REPLAN_COOLDOWN_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, selfRef, getPeerCapacities, getRequestedTiers, getContentMultiplier]);

  return advice;
}

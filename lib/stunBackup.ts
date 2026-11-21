// Experiment "stun-backup": Cloudflare's free STUN (stun.cloudflare.com:3478)
// beside Google's, as a second chance at finding our public address. The
// config itself lives in lib/iceConfig (setBackupStun); this file measures it.
//
// The expectation is that it changes nothing: any STUN server answers the same
// question with the same answer, and the pairs that fail need TURN, not
// another STUN. What it could catch is a network that blocks Google's port
// (19302) and lets the standard one (3478) through, or Google's server being
// down. So the numbers that matter are:
//
//   stunb_gather  tag `stun`: which servers gave us a public address (srflx)
//                 on a viewer connection — "cf" means only the backup did,
//                 which is the whole case for it.
//   stunb_ok / stunb_fail / stunb_late: did that connection come up within
//                 LINK_FAIL_MS, compared across the two groups.
//   stunb_route   tag `route`: what it came up over (host, srflx, relay).
//
// Viewer connections of the screen channel only: one per person whose share
// we watch, the pairs the 5.6% no-video reading was taken on.

import { trackFeatureEvent } from "./features";

export const STUN_BACKUP_FEATURE = "stun-backup";

export const STUN_BACKUP_EVENTS = {
  /** Gathering finished; tag stun = none | google | cf | both. */
  gather: "stunb_gather",
  /** Connected; value = ms after the connection was created. */
  ok: "stunb_ok",
  /** Not connected after LINK_FAIL_MS (or failed before that). */
  fail: "stunb_fail",
  /** Connected after having been counted as failed; value = ms in total. */
  late: "stunb_late",
  /** What the connection came up over; tag route = host | srflx | relay. */
  route: "stunb_route",
} as const;

const LINK_FAIL_MS = 20_000;

type StunSource = "google" | "cf" | null;

function sourceOf(url: string | null | undefined): StunSource {
  if (!url) return null;
  if (/cloudflare\.com/i.test(url)) return "cf";
  if (/google\.com/i.test(url)) return "google";
  return null;
}

function track(name: string, value?: number, tags?: Record<string, string>) {
  trackFeatureEvent(name, {
    feature: STUN_BACKUP_FEATURE,
    // A value of 0 is dropped, and "connected in 0 ms" is still an answer.
    ...(value === undefined ? {} : { value: Math.max(1, Math.round(value)) }),
    ...(tags ? { tags } : {}),
  });
}

/** What the selected candidate pair goes over, from either end's side. */
async function routeOf(pc: RTCPeerConnection): Promise<string | null> {
  try {
    const stats = await pc.getStats();
    let pairId: string | null = null;
    stats.forEach((s) => {
      if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
    });
    let pair: RTCIceCandidatePairStats | null = null;
    stats.forEach((s) => {
      if (s.type !== "candidate-pair") return;
      if (pairId ? s.id === pairId : s.state === "succeeded" && s.nominated) pair = s as RTCIceCandidatePairStats;
    });
    if (!pair) return null;
    const { localCandidateId, remoteCandidateId } = pair as RTCIceCandidatePairStats;
    const types = [stats.get(localCandidateId)?.candidateType, stats.get(remoteCandidateId)?.candidateType];
    if (types.includes("relay")) return "relay";
    if (types.includes("srflx") || types.includes("prflx")) return "srflx";
    if (types.includes("host")) return "host";
    return null;
  } catch {
    return null;
  }
}

/**
 * Measures one viewer connection for the experiment. Ends by itself: once the
 * connection is up, or closed. Cheap enough to attach to every one.
 */
export function watchStunBackup(pc: RTCPeerConnection): void {
  const startedAt = Date.now();
  const sources = new Set<Exclude<StunSource, null>>();
  let gathered = false;
  let connected = false;
  let failed = false;

  const finishGathering = () => {
    if (gathered) return;
    gathered = true;
    pc.removeEventListener("icecandidate", onCandidate);
    const stun = sources.size === 2 ? "both" : sources.has("cf") ? "cf" : sources.has("google") ? "google" : "none";
    track(STUN_BACKUP_EVENTS.gather, undefined, { stun });
  };

  const onCandidate = (e: RTCPeerConnectionIceEvent) => {
    if (!e.candidate) {
      finishGathering();
      return;
    }
    if (e.candidate.type !== "srflx") return;
    // `url` on the event is the older spelling; newer browsers also put it on the candidate.
    const url =
      (e.candidate as RTCIceCandidate & { url?: string | null }).url ??
      (e as RTCPeerConnectionIceEvent & { url?: string | null }).url;
    const source = sourceOf(url);
    if (source) sources.add(source);
  };

  const fail = () => {
    if (connected || failed) return;
    failed = true;
    track(STUN_BACKUP_EVENTS.fail);
  };

  // Gathering is left to finish on its own: a connection often comes up on a
  // host or srflx pair before the slower server has answered.
  const stop = () => {
    clearTimeout(timer);
    pc.removeEventListener("connectionstatechange", onState);
  };

  const onState = () => {
    const state = pc.connectionState;
    if (state === "connected") {
      connected = true;
      const elapsed = Date.now() - startedAt;
      track(failed ? STUN_BACKUP_EVENTS.late : STUN_BACKUP_EVENTS.ok, elapsed);
      void routeOf(pc).then((route) => {
        if (route) track(STUN_BACKUP_EVENTS.route, undefined, { route });
      });
      stop();
    } else if (state === "failed") {
      fail();
    } else if (state === "closed") {
      stop();
    }
  };

  const timer = setTimeout(() => {
    // pc.close() fires no event: a connection given up on before its answer
    // (the person left, a retry replaced it) is not a failure of the route.
    if (pc.connectionState === "closed" || pc.signalingState === "closed") {
      stop();
      return;
    }
    fail();
  }, LINK_FAIL_MS);

  pc.addEventListener("icecandidate", onCandidate);
  pc.addEventListener("connectionstatechange", onState);
}

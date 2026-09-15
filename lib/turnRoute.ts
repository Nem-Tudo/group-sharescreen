// Whether a peer connection is being relayed through a TURN server (any of
// them — Cloudflare's or our own VPS) rather than connected peer to peer.
//
// Relayed traffic costs money and relay capacity, so a video connection that
// ends up on a TURN server is served at no more than RELAY_ROUTE_CAP and
// RELAY_ROUTE_MAX_KBPS (see PeerQualityController's route cap). Only the
// *send* side is capped, and nothing says so on screen: the broadcaster's
// dials, the planner and every indicator carry on as if the connection were
// direct. Pro Ultra accounts ("uncapped_relay") are exempt.
//
// Only *this side's* relay is visible here: the browser reports whether our
// own selected candidate is a relay, and says nothing useful about the other
// end's. So each side checks its own connection, and a viewer relaying tells
// the broadcaster (the "route" signal — see useRoomMedia), which is the side
// that decides what is encoded.
//
// No timer anywhere: the check runs when the connection comes up and whenever
// the browser switches it to a different candidate pair, which is the only
// time the answer can change.

import type { QualityTier } from "./videoQuality";

/** The highest tier a relayed connection is sent at. */
export const RELAY_ROUTE_CAP: QualityTier = "1080p60";

/** The most bitrate a relayed connection is sent at, in kbps. */
export const RELAY_ROUTE_MAX_KBPS = 4000;

type StatRecord = Record<string, unknown> & { type?: string };

/**
 * Whether the selected candidate pair in `records` (a getStats report's
 * values) has our side relaying through a TURN server.
 *
 * The pair is found the same way connectionDiagnostics does it: the
 * transport's pointer first, Firefox's `selected` flag next, the nominated
 * succeeded pair last.
 */
export function relayedViaTurn(records: Iterable<StatRecord>): boolean {
  const all = [...records];
  const byId = new Map<string, StatRecord>();
  for (const rec of all) if (typeof rec.id === "string") byId.set(rec.id, rec);

  let pair: StatRecord | undefined;
  for (const rec of all) {
    if (rec.type !== "transport" || typeof rec.selectedCandidatePairId !== "string") continue;
    pair = byId.get(rec.selectedCandidatePairId);
    if (pair) break;
  }
  pair ??=
    all.find((r) => r.type === "candidate-pair" && r.selected === true) ??
    all.find((r) => r.type === "candidate-pair" && r.nominated === true && r.state === "succeeded");
  if (!pair || typeof pair.localCandidateId !== "string") return false;

  const local = byId.get(pair.localCandidateId);
  return local?.candidateType === "relay";
}

/**
 * Calls `onChange` whenever this connection starts or stops being relayed
 * through a TURN server on our side. Silent until the first time it is. Returns
 * a function that stops watching.
 *
 * Needs no cleanup when the connection is closed: it holds no timer, only
 * listeners on the connection itself, which go with it.
 */
export function watchTurnRelay(pc: RTCPeerConnection, onChange: (via: boolean) => void): () => void {
  let current = false;
  let stopped = false;
  let checking = false;
  let again = false;
  let transport: RTCIceTransport | null = null;

  const check = async () => {
    if (stopped || pc.connectionState === "closed") return;
    // One check at a time; a trigger during one runs another right after, so
    // the last pair change is always the one that is read.
    if (checking) {
      again = true;
      return;
    }
    checking = true;
    try {
      const report = await pc.getStats();
      const via = relayedViaTurn(report.values() as Iterable<StatRecord>);
      if (!stopped && via !== current) {
        current = via;
        onChange(via);
      }
    } catch {
      // A connection closing under us. Nothing to report.
    } finally {
      checking = false;
      if (again) {
        again = false;
        void check();
      }
    }
  };

  const onPairChange = () => void check();

  // The selected pair can change without the connection state moving (a
  // better pair nominated later, an ICE restart), and RTCIceTransport's event
  // is the one signal for that. Only reachable once negotiation has created
  // the transport, so it is attached on the first connect; browsers without
  // it (Firefox) fall back to the state changes alone.
  const attachTransport = () => {
    if (transport) return;
    const holder = pc.getSenders()[0] ?? pc.getReceivers()[0];
    const ice = holder?.transport?.iceTransport ?? null;
    if (!ice || typeof ice.addEventListener !== "function") return;
    transport = ice;
    transport.addEventListener("selectedcandidatepairchange", onPairChange);
  };

  const onState = () => {
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      attachTransport();
      void check();
    }
  };

  pc.addEventListener("iceconnectionstatechange", onState);
  onState();

  return () => {
    stopped = true;
    pc.removeEventListener("iceconnectionstatechange", onState);
    transport?.removeEventListener("selectedcandidatepairchange", onPairChange);
  };
}

"use client";

// Experiment "congestion-recover": whether a viewer's congestion ratio may
// climb back while the encoder still says it is limited.
//
// Why it exists: the connection-quality reports (2026-10-27) showed broadcasters
// on a software H264 encoder spending most of every share "limited by
// bandwidth" while the browser estimated twice their target as available.
// That label is WebRTC's quality scaler, not the link — but the congestion law
// (lib/congestionControl) only recovers on qualityLimitationReason "none", so
// for those encoders one bad minute lowered the ceiling for good. On, a clean
// link (no loss, no queue above the path's own floor) counts as healthy
// whatever the encoder's label. Invisible; the broadcaster is the target, and
// it is exposed while they share their screen.
//
// Module state for the same reason as lib/ownTurn: read deep in the send path
// (PeerQualityController.onSample), decided once in useRoomMedia.

export const CONGESTION_RECOVER_FEATURE = "congestion-recover";

let enabled = false;

export function setCongestionRecoverEnabled(value: boolean) {
  enabled = value;
}

export function isCongestionRecoverEnabled(): boolean {
  return enabled;
}

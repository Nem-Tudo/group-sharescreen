"use client";

// Experiment "own-turn": how our connections use the site's own TURN server
// (the VPS — not Cloudflare's, see lib/iceConfig.ts).
//
// Why it exists: the connection-quality reports say a connection relayed
// through the VPS over UDP is where streams die. A broadcaster whose end
// relays there reaches viewers at ~300 kbps and ~8 fps with a worst-interval
// loss averaging over 50%, and that has been getting worse as relayed traffic
// grew (45% → 65% loss while relayed sessions per day went 2k → 9k), which is
// what an overloaded server looks like. The same server over TCP loses almost
// nothing (4%) and delivers more (454 kbps, 13.5 fps) — UDP to it is being
// dropped somewhere, by the server's link or on the way. Two levers, and a
// variant for each and for both:
//
//   "cap"     — a connection relayed through the VPS is sent at no more than
//               OWN_TURN_LEAN_TIER / OWN_TURN_LEAN_KBPS instead of the general
//               relay cap (see lib/turnRoute.ts). Less to carry for a server
//               that is losing what it is given.
//   "tcp"     — our own relay allocations on the VPS go over TCP only. Head-of-
//               line blocking is the textbook reason not to, and the data says
//               this server is the exception.
//   "cap-tcp" — both.
//
// Only our own end can be steered: "tcp" changes the relay candidates we
// gather, and "cap" changes what we encode when either end relays through the
// VPS (the viewer's end is reported to us, see the "route" signal).

export const OWN_TURN_FEATURE = "own-turn";

export type OwnTurnVariant = "cap" | "tcp" | "cap-tcp";

/** The highest tier a connection relayed through the VPS is sent at, under "cap". */
export const OWN_TURN_LEAN_TIER = "1080p30";

/** The most bitrate a connection relayed through the VPS is sent at, under "cap", in kbps. */
export const OWN_TURN_LEAN_KBPS = 1500;

// One of each per relayed session of ours, at its end (see connectionTelemetry):
//   own_turn_session   a video connection our end relayed through the VPS
//   own_turn_fps       ...its average fps (value)
//   own_turn_kbps      ...its average kbps (value)
//   own_turn_low_fps   ...averaged under 10 fps while carrying real bitrate
//   own_turn_loss      ...lost 15% or more in its worst interval
export const OWN_TURN_EVENTS = {
  session: "own_turn_session",
  fps: "own_turn_fps",
  kbps: "own_turn_kbps",
  lowFps: "own_turn_low_fps",
  loss: "own_turn_loss",
} as const;

let variant: OwnTurnVariant | null = null;

export function setOwnTurnVariant(value: string | null) {
  variant = value === "cap" || value === "tcp" || value === "cap-tcp" ? value : null;
}

export function getOwnTurnVariant(): OwnTurnVariant | null {
  return variant;
}

/** Whether our relay allocations on the VPS should be TCP only. */
export function ownTurnTcpOnly(): boolean {
  return variant === "tcp" || variant === "cap-tcp";
}

/** Whether a connection relayed through the VPS gets the lean cap. */
export function ownTurnLeanCap(): boolean {
  return variant === "cap" || variant === "cap-tcp";
}

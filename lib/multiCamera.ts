"use client";

import { useSyncExternalStore } from "react";
import { accountTierOf, type FeatureTier } from "./entitlements";

// "Várias câmeras": more than one camera going out at the same time — other
// webcams/capture cards on this computer, other phones ("Celular como
// câmera"), or both mixed.
//
// The first one is the ordinary "camera" channel (whatever it is fed by:
// webcam, phone, effects). Every other one is a channel of its own
// ("camera3".."camera10" — "camera2" is taken by the phone's other lens, see
// useRoomMedia's dual camera): a full sibling, like the extra screens of
// "Várias telas" (lib/multiScreen.ts) — its own peer connections, its own
// tiles, its own start/stop. The server needs to know nothing about them; the
// signalling relay forwards a channel's payloads opaquely, and the person
// counts as "camera on" while any of them is.
export const MULTI_CAMERA_FEATURE = "multi-camera";

export const EXTRA_CAMERA_SLOTS = [
  "camera3",
  "camera4",
  "camera5",
  "camera6",
  "camera7",
  "camera8",
  "camera9",
  "camera10",
] as const;
export type ExtraCameraSlot = (typeof EXTRA_CAMERA_SLOTS)[number];

export function isExtraCameraSlot(value: string): value is ExtraCameraSlot {
  return (EXTRA_CAMERA_SLOTS as readonly string[]).includes(value);
}

/** The number shown on a slot's tile: the first camera is 1, "camera3" is 2. */
export function extraCameraNumber(slot: ExtraCameraSlot): number {
  return EXTRA_CAMERA_SLOTS.indexOf(slot) + 2;
}

// How many cameras (the first one included) each rung may send at once. Same
// ladder as the screens: enforced on the sending side, a viewer receives
// whatever arrives.
export const MULTI_CAMERA_LIMITS: Record<FeatureTier, number> = {
  free: 2,
  account: 2,
  premium: 2,
  premium_max: 5,
  pro_ultra: EXTRA_CAMERA_SLOTS.length + 1,
};

export function multiCameraLimit(flags: readonly string[] | undefined | null): number {
  return MULTI_CAMERA_LIMITS[accountTierOf(flags)];
}

// The next rung that raises the limit — null on the top one.
export function nextCameraUpgrade(
  flags: readonly string[] | undefined | null
): { tier: "premium_max" | "pro_ultra"; planId: string; limit: number } | null {
  const tier = accountTierOf(flags);
  if (tier === "pro_ultra") return null;
  if (tier === "premium_max") {
    return { tier: "pro_ultra", planId: "pro_ultra", limit: MULTI_CAMERA_LIMITS.pro_ultra };
  }
  return { tier: "premium_max", planId: "premium_max", limit: MULTI_CAMERA_LIMITS.premium_max };
}

// Usage stats. Every name has to be listed in the feature's "site events" in
// the admin panel to count. The switch's own on/off events live with the other
// tile experiments' (TILE_EXPERIMENT_EVENTS in lib/clipsMode).
export const MULTI_CAMERA_EVENTS = {
  add: "multi_camera_add", // value: how many cameras are going out after it
  addPhone: "multi_camera_add_phone", // ...and the one added is a phone
  pair: "multi_camera_pair", // a new phone linked from the "+" (QR)
  phoneLive: "multi_camera_phone_live", // an extra phone's video reached the room
  phoneFailed: "multi_camera_phone_fail", // ...or never did (offline, declined, timeout)
  limit: "multi_camera_limit_hit", // value: the limit that was hit
  upgradeClick: "multi_camera_upgrade_click",
  error: "multi_camera_error", // an extra webcam would not open
} as const;

// What each extra slot is fed by, set right before the slot starts (see
// useRoomMedia's useExtraCameraChannel, which reads it in its capture). A
// webcam by its deviceId, a phone by its saved id (see lib/phoneCamera).
export type ExtraCameraSource =
  | { kind: "webcam"; deviceId: string; label: string }
  | { kind: "phone"; deviceId: string; name: string };

let sources: Partial<Record<ExtraCameraSlot, ExtraCameraSource>> = {};
const listeners = new Set<() => void>();

export function setExtraCameraSource(slot: ExtraCameraSlot, source: ExtraCameraSource | null) {
  const next = { ...sources };
  if (source) next[slot] = source;
  else delete next[slot];
  sources = next;
  listeners.forEach((l) => l());
}

export function getExtraCameraSource(slot: ExtraCameraSlot): ExtraCameraSource | null {
  return sources[slot] ?? null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const EMPTY: Partial<Record<ExtraCameraSlot, ExtraCameraSource>> = {};

/** Every slot's source, for the "+" panel's list of what is going out. */
export function useExtraCameraSources(): Partial<Record<ExtraCameraSlot, ExtraCameraSource>> {
  return useSyncExternalStore(subscribe, () => sources, () => EMPTY);
}

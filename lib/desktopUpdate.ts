"use client";

import { getSignalingHttpBase } from "./roomsApi";

// Telling the server that somebody pressed "instalar" on a desktop update, so
// the admin panel can say how many took the rollout it just launched (see the
// API's desktopUpdateClickStore.ts).
//
// keepalive, and that is the whole point of this file: the press quits the app
// a moment later, and an ordinary fetch would be cancelled with the page that
// started it. Nothing is read back and nothing is awaited by the caller — a
// counter must never stand between somebody and the update they asked for.
/** minVersion blocks, recommendedVersion reminds — see components/DesktopVersionGate. */
export type DesktopVersionPolicy = { minVersion: string | null; recommendedVersion: string | null };

/**
 * The desktop-app versions the site still accepts (the API's
 * desktopMinVersionStore.ts). Both null on any failure: no answer must never
 * lock anybody out.
 */
export async function fetchDesktopVersionPolicy(): Promise<DesktopVersionPolicy> {
  const pick = (v: unknown) => (typeof v === "string" && v ? v : null);
  try {
    const res = await fetch(`${getSignalingHttpBase()}/desktop-update/min-version`, { cache: "no-store" });
    if (!res.ok) return { minVersion: null, recommendedVersion: null };
    const data = (await res.json()) as Record<string, unknown>;
    return { minVersion: pick(data.minVersion), recommendedVersion: pick(data.recommendedVersion) };
  } catch {
    return { minVersion: null, recommendedVersion: null };
  }
}

/**
 * Whether `version` is older than `min`, comparing x.y.z numerically.
 * Anything that does not parse is never "older": a version string we cannot
 * read is no reason to send somebody away.
 */
export function isVersionBelow(version: string, min: string): boolean {
  const parse = (v: string) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const a = parse(version);
  const b = parse(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

export async function reportDesktopUpdateClick(version: string | null): Promise<void> {
  try {
    await fetch(`${getSignalingHttpBase()}/desktop-update/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
      keepalive: true,
    });
  } catch {
    // Offline, or the app went down first. The install is what matters.
  }
}

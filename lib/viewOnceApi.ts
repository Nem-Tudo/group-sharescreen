"use client";

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";

// View-once files: a picture, GIF, video or song each person it reaches may
// open exactly once, in the desktop app, with capture blocked (see
// components/ViewOnceViewer.tsx).
//
// The file on the CDN is encrypted with a key only the API has (see its
// viewOnceStore.ts), so there is no link to share and nothing to play from
// the message itself. Opening it asks the API, which counts the view and
// answers with the file — once.

/** Mirrors the API's VIEW_ONCE_MAX_BYTES. */
export const VIEW_ONCE_MAX_MB = 50;

/** What can be shown once: pictures (GIFs included), videos and audio. Mirrors the API. */
export function isViewOnceFile(file: { type: string }): boolean {
  return /^(image|video|audio)\//.test(file.type);
}


export interface ViewOnceStatus {
  /** Still openable by somebody who has not opened it (it expires after 14 days). */
  available: boolean;
  /** How many people have opened it. */
  views: number;
  viewedByMe: boolean;
  /** Sent by whoever is asking. */
  mine: boolean;
}

export async function getViewOnceStatus(id: string): Promise<ViewOnceStatus | null> {
  const token = getAccountToken();
  if (!token) return null;
  try {
    const res = await fetch(`${getSignalingHttpBase()}/view-once/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as ViewOnceStatus) : null;
  } catch {
    return null;
  }
}

/** The sender turning the viewer's-name watermark on or off. Sender only, enforced by the API. */
export async function setViewOnceWatermark(id: string, watermark: boolean): Promise<boolean> {
  const token = getAccountToken();
  if (!token) return false;
  try {
    const res = await fetch(`${getSignalingHttpBase()}/view-once/${encodeURIComponent(id)}/settings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ watermark }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type ViewOnceOpenResult =
  | { ok: true; blob: Blob; watermark: boolean }
  | {
      ok: false;
      reason: "signed-out" | "app-only" | "viewed" | "expired" | "own" | "failed";
    };

/**
 * Spends this person's one look and hands back the file. Kept in memory as a
 * Blob by the caller and never written anywhere — see ViewOnceViewer.
 */
export async function openViewOnce(id: string): Promise<ViewOnceOpenResult> {
  const token = getAccountToken();
  if (!token) return { ok: false, reason: "signed-out" };
  try {
    const res = await fetch(`${getSignalingHttpBase()}/view-once/${encodeURIComponent(id)}/open`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.ok) {
      const type = res.headers.get("Content-Type") ?? "application/octet-stream";
      const bytes = await res.arrayBuffer();
      return {
        ok: true,
        blob: new Blob([bytes], { type }),
        watermark: res.headers.get("X-View-Once-Watermark") !== "0",
      };
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 401) return { ok: false, reason: "signed-out" };
    if (data?.error === "app-only") return { ok: false, reason: "app-only" };
    if (data?.error === "own") return { ok: false, reason: "own" };
    if (data?.error === "viewed") return { ok: false, reason: "viewed" };
    if (data?.error === "expired") return { ok: false, reason: "expired" };
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

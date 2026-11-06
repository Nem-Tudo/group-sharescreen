"use client";

import { useEffect, useState } from "react";
import { groupAuthToken } from "./groupsApi";
import { getSignalingHttpBase } from "./roomsApi";
import { trackFeatureEvent } from "./features";

// The still of a transmission the group's rooms list shows when you hover a
// voice room where somebody is sharing their screen — the way Discord does it.
//
// Nobody outside the call receives the video, so whoever is transmitting
// sends a small JPEG of their own screen every so often (useStreamPreviewUploader,
// run by the room) and the rooms list asks for the latest one on hover
// (useStreamPreviewImage). The API keeps it for a few minutes and only hands
// it out while its sender is still transmitting in that room (see the API's
// groupStreamPreview.ts).

/** The experiment — target "group", so the same groups both send and see. */
export const STREAM_PREVIEW_FEATURE = "group-stream-preview";

export const STREAM_PREVIEW_EVENTS = {
  /** A transmission sent its first picture (once per transmission). */
  sent: "stream_preview_sent",
  /** A hover card showed at least one picture. */
  view: "stream_preview_view",
  /** Clicked a picture to go watch. */
  click: "stream_preview_click",
} as const;

/** How often a transmission sends a new picture. */
const UPLOAD_INTERVAL_MS = 15_000;
/** The first one, soon after the transmission starts — once the capture has frames. */
const FIRST_UPLOAD_DELAY_MS = 2_000;
const PREVIEW_WIDTH = 320;
const PREVIEW_QUALITY = 0.6;

const enc = encodeURIComponent;
const previewPath = (groupId: string, channelId: string) =>
  `${getSignalingHttpBase()}/groups/${enc(groupId)}/channels/${enc(channelId)}/stream-preview`;

function authHeaders(): Record<string, string> {
  const token = groupAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** One frame of the track, scaled down to PREVIEW_WIDTH, as base64 JPEG — null when it has none yet. */
async function grabFrame(video: HTMLVideoElement): Promise<string | null> {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
  const width = Math.min(PREVIEW_WIDTH, video.videoWidth);
  const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PREVIEW_QUALITY));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * While `stream` is a screen going out in a group's voice room, sends a
 * picture of it every UPLOAD_INTERVAL_MS — and takes the last one down when it
 * stops. Does nothing outside a group, or with `enabled` off (the experiment).
 */
export function useStreamPreviewUploader(
  groupId: string | null,
  channelId: string | null,
  stream: MediaStream | null,
  enabled: boolean
): void {
  const track = stream?.getVideoTracks()[0] ?? null;
  useEffect(() => {
    if (!enabled || !groupId || !channelId || !track) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sentOnce = false;
    let uploaded = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    void video.play().catch(() => {});

    const tick = async () => {
      if (stopped) return;
      if (track.readyState === "live") {
        try {
          const image = await grabFrame(video);
          if (image && !stopped) {
            const res = await fetch(previewPath(groupId, channelId), {
              method: "POST",
              headers: { ...authHeaders(), "Content-Type": "application/json" },
              body: JSON.stringify({ image }),
            });
            if (res.ok) {
              uploaded = true;
              if (!sentOnce) {
                sentOnce = true;
                trackFeatureEvent(STREAM_PREVIEW_EVENTS.sent, { group: groupId, feature: STREAM_PREVIEW_FEATURE });
              }
            }
          }
        } catch {
          // A missed picture is just an older one on hover — try again next time.
        }
      }
      if (!stopped) timer = setTimeout(tick, uploaded ? UPLOAD_INTERVAL_MS : FIRST_UPLOAD_DELAY_MS * 2);
    };
    timer = setTimeout(tick, FIRST_UPLOAD_DELAY_MS);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      video.pause();
      video.srcObject = null;
      if (uploaded) {
        void fetch(previewPath(groupId, channelId), {
          method: "DELETE",
          headers: authHeaders(),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [enabled, groupId, channelId, track]);
}

// ─── Reading ────────────────────────────────────────────────────────────

/** A picture fetched less than this long ago is shown again rather than asked for anew. */
const CACHE_MS = 10_000;

type CacheEntry = { url: string | null; at: number; pending?: Promise<string | null> };
const cache = new Map<string, CacheEntry>();

function loadPreview(groupId: string, channelId: string, userId: string): Promise<string | null> {
  const key = `${groupId}/${channelId}/${userId}`;
  const held = cache.get(key);
  if (held?.pending) return held.pending;
  if (held && Date.now() - held.at < CACHE_MS) return Promise.resolve(held.url);
  const pending = fetch(`${previewPath(groupId, channelId)}/${enc(userId)}`, { headers: authHeaders() })
    .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
    .catch(() => null)
    .then((url) => {
      // The one it replaces may still be on screen for a moment; let the
      // browser have it back a little later rather than blank an <img>.
      const old = cache.get(key)?.url;
      if (old && old !== url) setTimeout(() => URL.revokeObjectURL(old), 30_000);
      cache.set(key, { url, at: Date.now() });
      return url;
    });
  cache.set(key, { url: held?.url ?? null, at: held?.at ?? 0, pending });
  return pending;
}

/**
 * The latest picture of somebody's transmission in a room, as an object URL —
 * undefined while loading, null when there is none (yet). Refreshed every
 * CACHE_MS while the caller stays mounted.
 */
export function useStreamPreviewImage(groupId: string, channelId: string, userId: string): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(() => {
    const held = cache.get(`${groupId}/${channelId}/${userId}`);
    return held && !held.pending && Date.now() - held.at < CACHE_MS ? held.url : undefined;
  });
  useEffect(() => {
    let alive = true;
    const load = () =>
      void loadPreview(groupId, channelId, userId).then((next) => {
        if (alive) setUrl((prev) => (next === null && prev ? prev : next));
      });
    load();
    const timer = setInterval(load, CACHE_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [groupId, channelId, userId]);
  return url;
}

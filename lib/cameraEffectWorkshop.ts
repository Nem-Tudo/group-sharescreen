"use client";

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import { trackFeatureEvent } from "./features";
import {
  CUSTOM_ANCHORS,
  importCustomCameraEffect,
  readCustomCameraEffects,
  readCustomWarp,
  setPublishedEffectId,
  stickerImage,
  type CustomAdjust,
  type CustomAnchor,
  type CustomCameraEffect,
  type CustomSticker,
} from "./cameraCustomEffects";
import { customEffectFilter } from "./cameraCustomEffectsModel";
import { decodeWarpGrid, warpBytesFromBase64, warpBytesToBase64, WARP_GRID } from "./cameraWarpBrush";

// The effects workshop (experiment "camera-effects-workshop"): effects made by
// the community, one click away. Taking one copies it into this browser, where
// "Meus efeitos" keep theirs, so it runs like one the person made. Publishing is
// the other way round: the effect, images included, goes to the API. Pro Max can
// have 4 published at once and Pro Ultra 20; the API decides, see its
// cameraEffectRoutes.ts.

export const CAMERA_WORKSHOP_FEATURE = "camera-effects-workshop";
export const CAMERA_WORKSHOP_EVENTS = {
  open: "camera_workshop_open", // abriu o workshop de efeitos (página ou popup da sala)
  use: "camera_workshop_use", // pegou um efeito
  useError: "camera_workshop_use_error", // não coube no navegador, ou não baixou
  like: "camera_workshop_like", // curtiu um efeito
  publish: "camera_workshop_publish", // publicou um efeito novo
  update: "camera_workshop_update", // atualizou um já publicado
  unpublish: "camera_workshop_unpublish", // tirou um efeito do workshop
  limit: "camera_workshop_limit", // tentou publicar acima do limite do plano
  locked: "camera_workshop_locked", // tocou em publicar sem o plano (abriu os planos)
  report: "camera_workshop_report", // denunciou um efeito
  sort: "camera_workshop_sort", // trocou a ordem (Em alta é a padrão)
};

/** How many effects each plan may have published. The API's cameraEffect.ts decides; this is for /pro. */
export const PUBLISHED_EFFECT_LIMITS = { premium_max: 4, pro_ultra: 20 } as const;

export function trackWorkshop(name: string) {
  trackFeatureEvent(name, { feature: CAMERA_WORKSHOP_FEATURE });
}

export type WorkshopEffectSort = "trending" | "popular" | "recent" | "liked";

export interface WorkshopEffect {
  id: string;
  name: string;
  description: string;
  authorId: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    flags: string[];
    bot?: boolean;
    nameColor: string | null;
  } | null;
  likes: number;
  liked: boolean;
  uses: number;
  createdAt: number;
  updatedAt: number;
}

function authHeaders(): Record<string, string> {
  const token = getAccountToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function workshopPreviewUrl(effect: Pick<WorkshopEffect, "id" | "updatedAt">): string {
  return `${getSignalingHttpBase()}/camera-effects/${encodeURIComponent(effect.id)}/preview?v=${effect.updatedAt}`;
}

export function effectLink(id: string): string {
  const path = `/effect/${encodeURIComponent(id)}`;
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

/** One effect, without its images. Null when it is not there, or could not be read. */
export async function fetchWorkshopEffectInfo(id: string, signal?: AbortSignal): Promise<WorkshopEffect | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/camera-effects/${encodeURIComponent(id)}/info`, {
      headers: authHeaders(),
      signal,
    });
    if (!res.ok) return null;
    return ((await res.json()) as { effect?: WorkshopEffect }).effect ?? null;
  } catch {
    return null;
  }
}

export type EffectReportBucket = { t: number; uses: number; likes: number; unlikes: number };
export type EffectReportRange = "24h" | "7d" | "30d";
export type EffectReport = {
  effect: { id: string; name: string; createdAt: number; updatedAt: number };
  totals: { uses: number; likes: number };
  window: { range: EffectReportRange; step: "hour" | "day"; people: number; buckets: EffectReportBucket[] };
};

export class EffectReportDeniedError extends Error {}

/** Its author's panel. Denied, not failed, for anybody else: see the page. */
export async function fetchEffectReport(id: string, range: EffectReportRange, signal?: AbortSignal): Promise<EffectReport> {
  const res = await fetch(`${getSignalingHttpBase()}/camera-effects/${encodeURIComponent(id)}/report?range=${range}`, {
    headers: authHeaders(),
    signal,
  });
  if (res.status === 401 || res.status === 403 || res.status === 404) throw new EffectReportDeniedError("denied");
  if (!res.ok) throw new Error("failed");
  return (await res.json()) as EffectReport;
}

export async function fetchWorkshopEffects(
  { sort, query = "", offset = 0, limit = 24 }: { sort: WorkshopEffectSort; query?: string; offset?: number; limit?: number },
  signal?: AbortSignal
): Promise<{ effects: WorkshopEffect[]; hasMore: boolean; ok: boolean }> {
  const params = new URLSearchParams({ sort, offset: String(offset), limit: String(limit) });
  if (query.trim()) params.set("q", query.trim());
  try {
    const res = await fetch(`${getSignalingHttpBase()}/camera-effects?${params}`, { headers: authHeaders(), signal });
    if (!res.ok) return { effects: [], hasMore: false, ok: false };
    const data = (await res.json()) as { effects?: WorkshopEffect[]; hasMore?: boolean };
    return { effects: data.effects ?? [], hasMore: Boolean(data.hasMore), ok: true };
  } catch {
    return { effects: [], hasMore: false, ok: false };
  }
}

/** What this account published, and how many its plan allows (null: no limit). */
export async function fetchMyWorkshopEffects(signal?: AbortSignal): Promise<{ effects: WorkshopEffect[]; limit: number | null } | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/camera-effects/mine`, { headers: authHeaders(), signal });
    if (!res.ok) return null;
    return (await res.json()) as { effects: WorkshopEffect[]; limit: number | null };
  } catch {
    return null;
  }
}

export async function likeWorkshopEffect(id: string, liked: boolean): Promise<{ liked: boolean; likes: number } | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/camera-effects/${encodeURIComponent(id)}/like`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ liked }),
    });
    if (!res.ok) return null;
    trackWorkshop(CAMERA_WORKSHOP_EVENTS.like);
    return (await res.json()) as { liked: boolean; likes: number };
  } catch {
    return null;
  }
}

export const EFFECT_REPORT_REASONS = ["sexual", "violence", "hate", "harassment", "copyright", "spam", "other"] as const;
export type EffectReportReason = (typeof EFFECT_REPORT_REASONS)[number];

export async function reportWorkshopEffect(id: string, reason: EffectReportReason, note: string): Promise<boolean> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/camera-effects/${encodeURIComponent(id)}/report`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ reason, note }),
    });
    if (!res.ok) return false;
    trackWorkshop(CAMERA_WORKSHOP_EVENTS.report);
    return true;
  } catch {
    return false;
  }
}

/** A sticker's images, for a moderator to see what a preview may not show (a GIF's other frames). */
export async function fetchWorkshopEffectImages(id: string): Promise<string[]> {
  const res = await fetch(`${getSignalingHttpBase()}/camera-effects/${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!res.ok) return [];
  const { effect } = (await res.json()) as { effect: { stickers: { image?: string }[] } };
  return effect.stickers.flatMap((sticker) => (sticker.image ? [sticker.image] : []));
}

/**
 * Copies an effect into this browser and says under which id. Taken again, it is
 * the copy already here. Null when it could not be downloaded, or does not fit.
 */
export async function takeWorkshopEffect(id: string): Promise<string | null> {
  const existing = readCustomCameraEffects().find((effect) => effect.sourceId === id || effect.publishedId === id);
  if (existing) return existing.id;
  try {
    const res = await fetch(`${getSignalingHttpBase()}/camera-effects/${encodeURIComponent(id)}`, { headers: authHeaders() });
    if (!res.ok) throw new Error("not found");
    const { effect } = (await res.json()) as {
      effect: WorkshopEffect & {
        adjust: CustomAdjust;
        warp: string | null;
        stickers: (Omit<CustomSticker, "id" | "imageId"> & { image?: string })[];
      };
    };
    const localId = importCustomCameraEffect({
      sourceId: effect.id,
      name: effect.name,
      description: effect.description,
      adjust: effect.adjust,
      warp: effect.warp ? warpBytesFromBase64(effect.warp) : null,
      stickers: effect.stickers,
    });
    if (!localId) throw new Error("no room");
    trackWorkshop(CAMERA_WORKSHOP_EVENTS.use);
    void fetch(`${getSignalingHttpBase()}/camera-effects/${encodeURIComponent(id)}/use`, {
      method: "POST",
      headers: authHeaders(),
    }).catch(() => {});
    return localId;
  } catch {
    trackWorkshop(CAMERA_WORKSHOP_EVENTS.useError);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The card's picture: never the author's camera, which would put their face on
// the page. The pad's guide of a face with the effect applied to it.

const PREVIEW_SIDE = 256;
// Where each anchor is on that guide, in hundredths of its side.
const ANCHOR_POINTS: Record<CustomAnchor, [number, number]> = {
  head: [50, 8],
  forehead: [50, 18],
  eyes: [50, 41],
  eyeRight: [39, 41],
  eyeLeft: [61, 41],
  nose: [50, 50],
  cheekRight: [33, 55],
  cheekLeft: [67, 55],
  mouth: [50, 62],
  chin: [50, 82],
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("unreadable"));
    image.src = src;
  });
}

function drawFaceGuide(ctx: CanvasRenderingContext2D, side: number) {
  const at = (hundredths: number) => (hundredths / 100) * side;
  ctx.fillStyle = "#3f3f46";
  ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = "#fcd9b8";
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = side / 90;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.ellipse(at(50), at(50), at(25), at(32), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#27272a";
  for (const x of [39, 61]) {
    ctx.beginPath();
    ctx.ellipse(at(x), at(41), at(3.5), at(2), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(at(50), at(42));
  ctx.lineTo(at(47.5), at(50));
  ctx.quadraticCurveTo(at(50), at(52), at(52.5), at(50));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(at(41), at(61));
  ctx.quadraticCurveTo(at(50), at(67), at(59), at(61));
  ctx.stroke();
}

// The same reading the camera does: each pixel from where the grid says.
function warpCanvas(ctx: CanvasRenderingContext2D, side: number, bytes: Uint8Array) {
  const grid = decodeWarpGrid(bytes);
  const source = ctx.getImageData(0, 0, side, side);
  const out = ctx.createImageData(side, side);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const cell = (Math.floor((y / side) * WARP_GRID) * WARP_GRID + Math.floor((x / side) * WARP_GRID)) * 2;
      const sx = Math.max(0, Math.min(side - 1, Math.round(x + grid[cell] * side)));
      const sy = Math.max(0, Math.min(side - 1, Math.round(y + grid[cell + 1] * side)));
      const from = (sy * side + sx) * 4;
      const to = (y * side + x) * 4;
      out.data.set(source.data.subarray(from, from + 4), to);
    }
  }
  ctx.putImageData(out, 0, 0);
}

async function renderEffectPreview(effect: CustomCameraEffect): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_SIDE;
  canvas.height = PREVIEW_SIDE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no canvas");
  // In the camera the colours touch the picture and not what is drawn over it.
  ctx.filter = customEffectFilter(effect.adjust);
  drawFaceGuide(ctx, PREVIEW_SIDE);
  ctx.filter = "none";
  const warp = effect.hasWarp ? readCustomWarp(effect.id) : null;
  if (warp) warpCanvas(ctx, PREVIEW_SIDE, warp);
  if (effect.adjust.vignette > 0) {
    const c = PREVIEW_SIDE / 2;
    const gradient = ctx.createRadialGradient(c, c, c * 0.55, c, c, c * Math.SQRT2);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, `rgba(0,0,0,${(effect.adjust.vignette / 100) * 0.9})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, PREVIEW_SIDE, PREVIEW_SIDE);
  }
  const faceWidth = PREVIEW_SIDE / 2;
  for (const sticker of effect.stickers) {
    const [ax, ay] = ANCHOR_POINTS[CUSTOM_ANCHORS.includes(sticker.anchor) ? sticker.anchor : "forehead"];
    const width = sticker.size * faceWidth;
    ctx.save();
    ctx.translate((ax / 100) * PREVIEW_SIDE + sticker.x * faceWidth, (ay / 100) * PREVIEW_SIDE + sticker.y * faceWidth);
    ctx.rotate((sticker.rotation * Math.PI) / 180);
    if (sticker.emoji) {
      ctx.font = `${width * 0.8}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#000";
      ctx.fillText(sticker.emoji, 0, 0);
    } else {
      const src = sticker.imageId ? stickerImage(sticker.imageId) : null;
      if (src) {
        const image = await loadImage(src);
        const height = (width * image.naturalHeight) / image.naturalWidth;
        ctx.drawImage(image, -width / 2, -height / 2, width, height);
      }
    }
    ctx.restore();
  }
  return canvas.toDataURL("image/jpeg", 0.8);
}

// ---------------------------------------------------------------------------
// Publishing

export type PublishResult =
  | { ok: true; id: string; updated: boolean }
  | { ok: false; reason: "plan" | "limit" | "banned" | "invalid" | "failed"; limit?: number; message?: string };

/** Publishes the effect, or updates what it already published. */
export async function publishWorkshopEffect(effect: CustomCameraEffect): Promise<PublishResult> {
  try {
    const warp = effect.hasWarp ? readCustomWarp(effect.id) : null;
    const body = JSON.stringify({
      name: effect.name,
      description: effect.description ?? "",
      adjust: effect.adjust,
      warp: warp ? warpBytesToBase64(warp) : null,
      preview: await renderEffectPreview(effect),
      stickers: effect.stickers.map((sticker) => ({
        anchor: sticker.anchor,
        x: sticker.x,
        y: sticker.y,
        size: sticker.size,
        rotation: sticker.rotation,
        ...(sticker.emoji ? { emoji: sticker.emoji } : {}),
        ...(sticker.imageId ? { image: stickerImage(sticker.imageId) ?? "" } : {}),
        ...(sticker.drawing ? { drawing: sticker.drawing } : {}),
      })),
    });
    const send = (method: string, path: string) =>
      fetch(`${getSignalingHttpBase()}${path}`, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body,
      });
    const published = effect.publishedId;
    let res = published ? await send("PUT", `/camera-effects/${encodeURIComponent(published)}`) : await send("POST", "/camera-effects");
    let updated = Boolean(published);
    // Taken down meanwhile (by its author on another device, or by moderation):
    // what is left is publishing it again, which counts against the limit.
    if (published && res.status === 404) {
      setPublishedEffectId(effect.id, null);
      res = await send("POST", "/camera-effects");
      updated = false;
    }
    const data = (await res.json().catch(() => ({}))) as {
      effect?: { id: string };
      reason?: "plan" | "limit" | "banned" | "invalid";
      limit?: number;
      error?: string;
    };
    if (!res.ok || !data.effect) {
      if (data.reason === "limit") trackWorkshop(CAMERA_WORKSHOP_EVENTS.limit);
      return { ok: false, reason: data.reason ?? "failed", limit: data.limit, message: data.error };
    }
    setPublishedEffectId(effect.id, data.effect.id);
    trackWorkshop(updated ? CAMERA_WORKSHOP_EVENTS.update : CAMERA_WORKSHOP_EVENTS.publish);
    return { ok: true, id: data.effect.id, updated };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Takes it out of the workshop. Whoever took it keeps their copy. */
export async function unpublishWorkshopEffect(publishedId: string): Promise<boolean> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/camera-effects/${encodeURIComponent(publishedId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok && res.status !== 404) return false;
    const local = readCustomCameraEffects().find((effect) => effect.publishedId === publishedId);
    if (local) setPublishedEffectId(local.id, null);
    trackWorkshop(CAMERA_WORKSHOP_EVENTS.unpublish);
    return true;
  } catch {
    return false;
  }
}

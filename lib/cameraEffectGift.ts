"use client";

import { useEffect, useMemo } from "react";
import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import {
  customCameraBackgroundImage,
  RECEIVED_CUSTOM_EFFECT,
  setReceivedEffectContents,
  type CameraEffectSettings,
  type ReceivedEffectContents,
} from "./cameraEffects";
import { readCustomCameraEffects, readCustomWarp, stickerImage, type CustomAdjust, type CustomAnchor } from "./cameraCustomEffects";
import { warpBytesFromBase64, warpBytesToBase64 } from "./cameraWarpBrush";
import { setReceivedStreamBackground } from "./cameraStreamBackground";
import { signalingClient, type SentCameraEffect } from "./signalingClient";
import { selectReceivedCameraEffect } from "./signalingSelectors";
import { useSignalingSelector } from "./useSignalingSelector";

// "Colocar efeito" (experiment "camera-effect-others"), what travels and what it
// becomes. The names of the ready-made effects go over the socket; what is too big
// for a frame (a made effect's images, an image as the background) is uploaded once
// as a gift for that one person, and their browser downloads it by id. Nothing of it
// is written to their storage: it lasts as long as the effect does.

export const CAMERA_OTHERS_FEATURE = "camera-effect-others";

type GiftSticker = {
  emoji?: string;
  image?: string;
  drawing?: "mirror" | "plain";
  anchor: CustomAnchor;
  x: number;
  y: number;
  size: number;
  rotation: number;
};

type GiftContents = {
  adjust?: CustomAdjust;
  warp?: string | null;
  stickers?: GiftSticker[];
  backgroundImage?: string | null;
};

function authHeaders(): Record<string, string> {
  const token = getAccountToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Uploads what `customId` and the person's own background are made of. Null if it was refused. */
export async function uploadCameraEffectGift(
  userId: string,
  customId: string | null,
  withBackground: boolean
): Promise<string | null> {
  const effect = customId ? readCustomCameraEffects().find((item) => item.id === customId) : undefined;
  const warp = effect?.hasWarp ? readCustomWarp(effect.id) : null;
  const contents: GiftContents = {
    ...(effect
      ? {
          adjust: effect.adjust,
          warp: warp ? warpBytesToBase64(warp) : null,
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
        }
      : {}),
    ...(withBackground ? { backgroundImage: customCameraBackgroundImage() } : {}),
  };
  try {
    const res = await fetch(`${getSignalingHttpBase()}/camera-effects/gifts`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ...contents }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { id?: string }).id ?? null;
  } catch {
    return null;
  }
}

async function downloadGift(id: string, signal: AbortSignal): Promise<ReceivedEffectContents | null> {
  const res = await fetch(`${getSignalingHttpBase()}/camera-effects/gifts/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
    signal,
  });
  if (!res.ok) return null;
  const { gift } = (await res.json()) as { gift: GiftContents };
  const images = new Map<string, string>();
  const stickers = (gift.stickers ?? []).map(({ image, ...sticker }, index) => {
    if (!image) return { ...sticker, id: `s${index}` };
    const imageId = `received-${id}-${index}`;
    images.set(imageId, image);
    return { ...sticker, id: `s${index}`, imageId };
  });
  return {
    adjust: gift.adjust ?? null,
    warp: gift.warp ? warpBytesFromBase64(gift.warp) : null,
    stickers,
    images,
    background: gift.backgroundImage ?? null,
  };
}

// A transmission is named by the connection behind it, and everybody calls their
// own "self" (see the room's call sources): a name has to be translated both ways.
export function streamIdForOthers(id: string): string {
  const [key, owner] = id.split(":");
  return owner === "self" ? `${key}:${signalingClient.state.selfId ?? ""}` : id;
}

function streamIdHere(id: string): string {
  const [key, owner] = id.split(":");
  return owner === signalingClient.state.selfId ? `${key}:self` : id;
}

const NO_EFFECT: SentCameraEffect | null = null;

/**
 * What somebody put on this camera, as the effects read it, or null. Also fetches
 * what it needs. `blocked`: this person refuses them, whatever is on the way.
 */
export function useReceivedCameraEffect(blocked: boolean): CameraEffectSettings | null {
  const received = useSignalingSelector(selectReceivedCameraEffect);
  const effect = blocked ? NO_EFFECT : received?.effect ?? NO_EFFECT;
  const giftId = blocked ? null : received?.giftId ?? null;
  const stream = effect?.background === "stream" ? effect.stream ?? null : null;

  useEffect(() => {
    if (!giftId) {
      setReceivedEffectContents(null);
      return;
    }
    const controller = new AbortController();
    downloadGift(giftId, controller.signal).then(
      (contents) => {
        if (!controller.signal.aborted) setReceivedEffectContents(contents);
      },
      // Not there, or no connection: the rest of the effect still goes on.
      () => {}
    );
    return () => controller.abort();
  }, [giftId]);

  useEffect(() => {
    setReceivedStreamBackground(stream ? streamIdHere(stream) : null);
  }, [stream]);

  return useMemo(() => {
    if (!effect) return null;
    return {
      face: effect.face,
      warp: effect.warp,
      color: effect.color,
      background: effect.background,
      reactions: effect.reactions,
      custom: effect.custom ? RECEIVED_CUSTOM_EFFECT : "none",
    } as CameraEffectSettings;
  }, [effect]);
}

"use client";

import { useSyncExternalStore } from "react";
import { trackFeatureEvent } from "./features";
import {
  DEFAULT_ADJUST,
  DEFAULT_WARP,
  MAX_CUSTOM_EFFECTS,
  MAX_CUSTOM_NAME,
  sanitizeCustomEffects,
  type CustomCameraEffect,
  type CustomSticker,
} from "./cameraCustomEffectsModel";

export * from "./cameraCustomEffectsModel";

// "Criar efeito" (experiment "camera-custom-effects"): effects the person builds
// out of picture adjustments and stickers (an emoji or an image of their own)
// pinned to a point of the face. This file is what is stored, per browser; the
// wiring to the worker is in lib/cameraEffects.ts (setCameraEffect("custom", id)
// picks one), the drawing in public/workers/camera-effects.js and the editor in
// components/CameraCustomEffectEditor.tsx.
//
// There is no draft: every change is stored and drawn right away, so the camera
// in the editor is the real result. Images have keys of their own, so that
// dragging a slider rewrites a little JSON and not every image with it.

export const CAMERA_CUSTOM_FEATURE = "camera-custom-effects";
export const CAMERA_CUSTOM_EVENTS = {
  create: "camera_custom_create", // criou um efeito
  pick: "camera_custom_pick", // escolheu um efeito já criado
  delete: "camera_custom_delete", // apagou um efeito
  sticker: "camera_custom_sticker", // pôs um emoji como adesivo
  image: "camera_custom_image", // pôs uma imagem própria como adesivo
  draw: "camera_custom_draw", // desenhou (uma vez por abertura da área de desenho)
  drawImage: "camera_custom_draw_image", // colou ou inseriu uma imagem na área de desenho
  warp: "camera_custom_warp", // mexeu nas distorções (uma vez por abertura do editor)
  gif: "camera_custom_gif", // pôs um GIF como adesivo
  imageError: "camera_custom_image_error", // a imagem não abriu, ou não coube no navegador
  slow: "camera_custom_slow", // value: ms por quadro com efeito criado (uma vez por sessão, acima de 30)
};

export function trackCustomEffect(name: string, value?: number) {
  trackFeatureEvent(name, {
    feature: CAMERA_CUSTOM_FEATURE,
    ...(value ? { value: Math.max(1, Math.round(value)) } : {}),
  });
}

const MAX_IMAGE_SIDE = 384;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// A GIF is kept as it came, every frame: shrinking it would mean re-encoding it.
// The browser's storage is about 5 MB in all.
const MAX_GIF_BYTES = 2 * 1024 * 1024;

const EFFECTS_KEY = "sharescreen:cameraCustomEffects";
const IMAGE_KEY_PREFIX = "sharescreen:cameraCustomImage:";

// ---------------------------------------------------------------------------
// The store

const listeners = new Set<() => void>();
const NO_EFFECTS: CustomCameraEffect[] = [];
let cached: CustomCameraEffect[] | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeCustomCameraEffects(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readCustomCameraEffects(): CustomCameraEffect[] {
  if (cached) return cached;
  try {
    cached = sanitizeCustomEffects(JSON.parse(window.localStorage.getItem(EFFECTS_KEY) ?? "[]"));
  } catch {
    cached = [];
  }
  return cached;
}

function write(next: CustomCameraEffect[]) {
  cached = next;
  try {
    window.localStorage.setItem(EFFECTS_KEY, JSON.stringify(next));
  } catch {
    // Storage refused: it keeps working until the page reloads.
  }
  emit();
}

export function useCustomCameraEffects(): CustomCameraEffect[] {
  return useSyncExternalStore(
    (listener) => {
      const unsubscribe = subscribeCustomCameraEffects(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== EFFECTS_KEY) return;
        cached = null;
        emit();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        unsubscribe();
        window.removeEventListener("storage", onStorage);
      };
    },
    readCustomCameraEffects,
    () => NO_EFFECTS
  );
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** A new effect that changes nothing yet, or null at the limit. */
export function createCustomCameraEffect(name: string): CustomCameraEffect | null {
  const effects = readCustomCameraEffects();
  if (effects.length >= MAX_CUSTOM_EFFECTS) return null;
  const effect: CustomCameraEffect = {
    id: newId(),
    name: name.slice(0, MAX_CUSTOM_NAME),
    adjust: { ...DEFAULT_ADJUST },
    warp: { ...DEFAULT_WARP },
    stickers: [],
  };
  write([...effects, effect]);
  trackCustomEffect(CAMERA_CUSTOM_EVENTS.create);
  return effect;
}

export function updateCustomCameraEffect(id: string, change: (effect: CustomCameraEffect) => CustomCameraEffect) {
  write(readCustomCameraEffects().map((effect) => (effect.id === id ? change(effect) : effect)));
}

function removeImages(stickers: CustomSticker[]) {
  for (const sticker of stickers) {
    if (!sticker.imageId) continue;
    try {
      window.localStorage.removeItem(IMAGE_KEY_PREFIX + sticker.imageId);
    } catch {
      // Nothing to do about it.
    }
  }
}

export function deleteCustomCameraEffect(id: string) {
  const effects = readCustomCameraEffects();
  const effect = effects.find((item) => item.id === id);
  if (!effect) return;
  removeImages(effect.stickers);
  write(effects.filter((item) => item.id !== id));
  trackCustomEffect(CAMERA_CUSTOM_EVENTS.delete);
}

function withSticker(effectId: string, sticker: CustomSticker) {
  updateCustomCameraEffect(effectId, (effect) => ({ ...effect, stickers: [...effect.stickers, sticker] }));
}

function newSticker(): Omit<CustomSticker, "emoji" | "imageId"> {
  return { id: newId(), anchor: "forehead", x: 0, y: 0, size: 0.6, rotation: 0 };
}

/** Puts an emoji on the effect, and says which sticker it became. */
export function addEmojiSticker(effectId: string, emoji: string): string {
  const sticker = { ...newSticker(), emoji };
  withSticker(effectId, sticker);
  trackCustomEffect(CAMERA_CUSTOM_EVENTS.sticker);
  return sticker.id;
}

/**
 * Puts an image on the effect, shrunk to fit MAX_IMAGE_SIDE and with its
 * transparency kept. Throws, with nothing changed, for a file that is not a
 * readable image or does not fit in this browser's storage.
 */
export async function addImageSticker(effectId: string, file: File): Promise<string> {
  try {
    if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES) throw new Error("not an image");
    if (file.type === "image/gif") {
      if (file.size > MAX_GIF_BYTES) throw new Error("too big");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("unreadable"));
        reader.readAsDataURL(file);
      });
      const imageId = newId();
      window.localStorage.setItem(IMAGE_KEY_PREFIX + imageId, dataUrl);
      const sticker = { ...newSticker(), imageId };
      withSticker(effectId, sticker);
      trackCustomEffect(CAMERA_CUSTOM_EVENTS.gif);
      return sticker.id;
    }
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const imageId = newId();
    window.localStorage.setItem(IMAGE_KEY_PREFIX + imageId, canvas.toDataURL("image/png"));
    const sticker = { ...newSticker(), imageId };
    withSticker(effectId, sticker);
    trackCustomEffect(CAMERA_CUSTOM_EVENTS.image);
    return sticker.id;
  } catch (err) {
    trackCustomEffect(CAMERA_CUSTOM_EVENTS.imageError);
    throw err;
  }
}

/**
 * Stores a drawing as a sticker covering the face, two face widths across and
 * centred on the nose (the pad's square), or as the new picture of `stickerId`.
 * Under a new image id, since the worker keeps images by id. Throws, with
 * nothing changed, when it does not fit in this browser's storage.
 */
export function saveDrawingSticker(
  effectId: string,
  stickerId: string | null,
  dataUrl: string,
  drawing: "mirror" | "plain"
): string {
  const imageId = newId();
  window.localStorage.setItem(IMAGE_KEY_PREFIX + imageId, dataUrl);
  const existing = readCustomCameraEffects()
    .find((effect) => effect.id === effectId)
    ?.stickers.find((sticker) => sticker.id === stickerId);
  if (existing) {
    removeImages([existing]);
    updateCustomSticker(effectId, existing.id, { imageId, drawing });
    return existing.id;
  }
  const sticker = { ...newSticker(), imageId, drawing, anchor: "nose" as const, size: 2 };
  withSticker(effectId, sticker);
  return sticker.id;
}

export function updateCustomSticker(effectId: string, stickerId: string, change: Partial<CustomSticker>) {
  updateCustomCameraEffect(effectId, (effect) => ({
    ...effect,
    stickers: effect.stickers.map((sticker) => (sticker.id === stickerId ? { ...sticker, ...change } : sticker)),
  }));
}

export function removeCustomSticker(effectId: string, stickerId: string) {
  const sticker = readCustomCameraEffects()
    .find((effect) => effect.id === effectId)
    ?.stickers.find((item) => item.id === stickerId);
  if (sticker) removeImages([sticker]);
  updateCustomCameraEffect(effectId, (effect) => ({
    ...effect,
    stickers: effect.stickers.filter((item) => item.id !== stickerId),
  }));
}

/** A stored image, as a data URL, or null. */
export function stickerImage(imageId: string): string | null {
  try {
    return window.localStorage.getItem(IMAGE_KEY_PREFIX + imageId);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Which effect the editor is open on, and the camera it shows. The panel only
// says which; CameraCustomEffectHost, in the room, opens the popup. A popup's
// data is fixed when it opens, so the camera, whose track the effects swap,
// reaches it through here.

let editingId: string | null = null;
const editingListeners = new Set<() => void>();

export function openCustomEffectEditor(id: string | null) {
  editingId = id;
  editingListeners.forEach((listener) => listener());
}

export type CustomEffectPreview = { track: MediaStreamTrack | null; fallbackMirrored: boolean };
const NO_PREVIEW: CustomEffectPreview = { track: null, fallbackMirrored: false };
let preview = NO_PREVIEW;

export function publishCustomEffectPreview(track: MediaStreamTrack | null, fallbackMirrored: boolean) {
  preview = { track, fallbackMirrored };
  editingListeners.forEach((listener) => listener());
}

export function useCustomEffectPreview(): CustomEffectPreview {
  return useSyncExternalStore(
    (listener) => {
      editingListeners.add(listener);
      return () => {
        editingListeners.delete(listener);
      };
    },
    () => preview,
    () => NO_PREVIEW
  );
}

export function useCustomEffectEditing(): string | null {
  return useSyncExternalStore(
    (listener) => {
      editingListeners.add(listener);
      return () => {
        editingListeners.delete(listener);
      };
    },
    () => editingId,
    () => null
  );
}

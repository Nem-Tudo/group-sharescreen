// What an effect of "Criar efeito" is made of, and how what was stored is made
// safe to use: see lib/cameraCustomEffects.ts, which keeps them.

// Named from the person's own side, as in a mirror, which is how they see
// themselves in the editor. The worker knows these same names.
export const CUSTOM_ANCHORS = [
  "head",
  "forehead",
  "eyes",
  "eyeRight",
  "eyeLeft",
  "nose",
  "cheekRight",
  "cheekLeft",
  "mouth",
  "chin",
] as const;
export type CustomAnchor = (typeof CUSTOM_ANCHORS)[number];

export interface CustomSticker {
  id: string;
  // One or the other: an emoji, or the key of a stored image (see stickerImage).
  emoji?: string;
  imageId?: string;
  // Set on an image drawn in the editor: how it was stored (see CameraDrawingPad).
  drawing?: "mirror" | "plain";
  anchor: CustomAnchor;
  // Moved from the anchor, in face widths: + is right and down, as seen in the mirror.
  x: number;
  y: number;
  // How wide, in face widths.
  size: number;
  // Degrees, clockwise as seen in the mirror.
  rotation: number;
}

export interface CustomAdjust {
  brightness: number; // %, 100 = untouched
  contrast: number; // %, 100 = untouched
  saturation: number; // %, 100 = untouched
  hue: number; // degrees
  vignette: number; // %, 0 = none
}

export interface CustomCameraEffect {
  id: string;
  name: string;
  adjust: CustomAdjust;
  stickers: CustomSticker[];
}

export const DEFAULT_ADJUST: CustomAdjust = { brightness: 100, contrast: 100, saturation: 100, hue: 0, vignette: 0 };

export const ADJUST_RANGES: Record<keyof CustomAdjust, { min: number; max: number }> = {
  brightness: { min: 40, max: 180 },
  contrast: { min: 40, max: 180 },
  saturation: { min: 0, max: 250 },
  hue: { min: -180, max: 180 },
  vignette: { min: 0, max: 100 },
};

export const STICKER_RANGES = {
  x: { min: -1.5, max: 1.5 },
  y: { min: -1.5, max: 1.5 },
  size: { min: 0.1, max: 3 },
  rotation: { min: -180, max: 180 },
};

export const MAX_CUSTOM_EFFECTS = 12;
export const MAX_CUSTOM_STICKERS = 8;
export const MAX_CUSTOM_NAME = 24;

function clamp(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(range.max, Math.max(range.min, n));
}

function sanitizeSticker(raw: unknown): CustomSticker | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<CustomSticker>;
  const emoji = typeof s.emoji === "string" && s.emoji ? s.emoji.slice(0, 16) : undefined;
  const imageId = typeof s.imageId === "string" && s.imageId ? s.imageId : undefined;
  if (typeof s.id !== "string" || !s.id || (!emoji && !imageId)) return null;
  return {
    id: s.id,
    ...(imageId ? { imageId } : { emoji }),
    ...(imageId && (s.drawing === "mirror" || s.drawing === "plain") ? { drawing: s.drawing } : {}),
    anchor: CUSTOM_ANCHORS.includes(s.anchor as CustomAnchor) ? (s.anchor as CustomAnchor) : "forehead",
    x: clamp(s.x, STICKER_RANGES.x, 0),
    y: clamp(s.y, STICKER_RANGES.y, 0),
    size: clamp(s.size, STICKER_RANGES.size, 0.6),
    rotation: clamp(s.rotation, STICKER_RANGES.rotation, 0),
  };
}

/** What was stored, made safe to use: anything broken is dropped or put back in range. */
export function sanitizeCustomEffects(raw: unknown): CustomCameraEffect[] {
  if (!Array.isArray(raw)) return [];
  const effects: CustomCameraEffect[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Partial<CustomCameraEffect>;
    if (typeof e.id !== "string" || !e.id || e.id === "none") continue;
    const adjust = (e.adjust ?? {}) as Partial<CustomAdjust>;
    effects.push({
      id: e.id,
      name: typeof e.name === "string" ? e.name.slice(0, MAX_CUSTOM_NAME) : "",
      adjust: {
        brightness: clamp(adjust.brightness, ADJUST_RANGES.brightness, DEFAULT_ADJUST.brightness),
        contrast: clamp(adjust.contrast, ADJUST_RANGES.contrast, DEFAULT_ADJUST.contrast),
        saturation: clamp(adjust.saturation, ADJUST_RANGES.saturation, DEFAULT_ADJUST.saturation),
        hue: clamp(adjust.hue, ADJUST_RANGES.hue, DEFAULT_ADJUST.hue),
        vignette: clamp(adjust.vignette, ADJUST_RANGES.vignette, DEFAULT_ADJUST.vignette),
      },
      stickers: (Array.isArray(e.stickers) ? e.stickers : [])
        .map(sanitizeSticker)
        .filter((sticker): sticker is CustomSticker => sticker !== null)
        .slice(0, MAX_CUSTOM_STICKERS),
    });
    if (effects.length >= MAX_CUSTOM_EFFECTS) break;
  }
  return effects;
}

/** The adjustments as a canvas filter; "none" when they leave the picture as it is. */
export function customEffectFilter(adjust: CustomAdjust): string {
  const parts: string[] = [];
  if (adjust.brightness !== 100) parts.push(`brightness(${adjust.brightness / 100})`);
  if (adjust.contrast !== 100) parts.push(`contrast(${adjust.contrast / 100})`);
  if (adjust.saturation !== 100) parts.push(`saturate(${adjust.saturation / 100})`);
  if (adjust.hue !== 0) parts.push(`hue-rotate(${adjust.hue}deg)`);
  return parts.length > 0 ? parts.join(" ") : "none";
}

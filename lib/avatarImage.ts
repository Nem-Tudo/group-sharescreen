"use client";
import { translate } from "@/lib/i18n";

// Everything here is about preparing an avatar / profile picture to send to the API,
// which in turn uploads it to the CDN.
//
// Kept separate from chatImage.ts so profile picture logic is isolated from chat attachments.

export const AVATAR_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export const AVATAR_IMAGE_ACCEPT = AVATAR_IMAGE_MIME_TYPES.join(",");

export const AVATAR_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const MAX_AVATAR_DIMENSION = 512;

export type PreparedAvatarImage = {
  // A `data:<mime>;base64,...` URL — what the API's route takes.
  dataUrl: string;
  // Bytes the API will see, so the caller can refuse an oversized one with a
  // real number instead of guessing from the base64 length.
  byteLength: number;
  mimeType: string;
};

export function isSupportedAvatarImage(file: File): boolean {
  return (AVATAR_IMAGE_MIME_TYPES as readonly string[]).includes(file.type);
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(translate("common.couldNotReadTheFile")));
    reader.readAsDataURL(file);
  });
}

// The decoded size of a base64 data URL, without decoding it: every 4
// characters are 3 bytes, minus one per "=" of padding.
function dataUrlByteLength(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

let webpSupport: boolean | null = null;
function supportsWebpEncoding(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    webpSupport = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(translate("common.couldNotOpenTheImage")));
    img.src = src;
  });
}

/**
 * Prepares an avatar picture: crops to square and resizes to up to 512x512,
 * preserving GIFs for animated avatars.
 */
export async function prepareAvatarImage(file: File): Promise<PreparedAvatarImage> {
  const original = await readAsDataUrl(file);
  const originalBytes = dataUrlByteLength(original);

  if (file.type === "image/gif") {
    return { dataUrl: original, byteLength: originalBytes, mimeType: file.type };
  }

  try {
    const img = await loadImage(original);
    const size = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - size) / 2;
    const sy = (img.naturalHeight - size) / 2;
    const destSize = Math.min(MAX_AVATAR_DIMENSION, size);

    const canvas = document.createElement("canvas");
    canvas.width = destSize;
    canvas.height = destSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(translate("common.canvasUnavailable"));
    ctx.drawImage(img, sx, sy, size, size, 0, 0, destSize, destSize);

    const mimeType = supportsWebpEncoding() ? "image/webp" : "image/jpeg";
    // At 512×512 the difference between this and 0.88 is a few KB, and it's
    // the difference people notice on the enlarged profile card.
    const encoded = canvas.toDataURL(mimeType, 0.92);
    const encodedBytes = dataUrlByteLength(encoded);
    if (encoded.startsWith(`data:${mimeType}`) && encodedBytes < originalBytes) {
      return { dataUrl: encoded, byteLength: encodedBytes, mimeType };
    }
  } catch {
    // Fallback if canvas draw fails
  }

  return { dataUrl: original, byteLength: originalBytes, mimeType: file.type };
}


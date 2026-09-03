"use client";

import { getSignalingHttpBase } from "./roomsApi";
import type { ChatReplyTo } from "./signalingClient";

// Everything here is about getting a picture *to our API*. The upload to the
// CDN happens there and only there (see the API's server/uploadToCDN.ts):
// the CDN's address and its write token never reach a browser, so this file
// has no idea either exists. It hands the API the bytes and the API hands
// back a chat message the whole room sees.

// Mirrors the API's CHAT_IMAGE_MIME_TYPES. Checked here purely so an
// unsupported file is refused instantly, in the picker, instead of after a
// multi-megabyte round trip; the server does not trust this.
export const CHAT_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export const CHAT_IMAGE_ACCEPT = CHAT_IMAGE_MIME_TYPES.join(",");

// Mirrors the API's CHAT_IMAGE_MAX_BYTES. Applies to what actually gets
// sent, which for everything but a GIF is the re-encoded version below —
// so a 12 MB phone photo is fine, it just doesn't travel at 12 MB.
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// Mirrors the API's CHAT_IMAGE_MAX_PER_MESSAGE and CHAT_IMAGE_TOTAL_MAX_BYTES.
// An attachment tray, not an album — and the total is lower than three times
// the per-image cap because one enormous GIF is a real thing somebody sends
// while three at once is not.
export const CHAT_IMAGE_MAX_PER_MESSAGE = 3;
export const CHAT_IMAGE_TOTAL_MAX_BYTES = 8 * 1024 * 1024;

// A chat log renders these at a couple of hundred pixels tall and a click
// opens the original in a tab, so a long edge past this is spent entirely on
// bytes nobody sees. Wide enough that the opened original is still worth
// opening — a screenshot stays readable at 1600.
const MAX_DIMENSION = 1600;
const ENCODE_QUALITY = 0.82;

export type PreparedChatImage = {
  // A `data:<mime>;base64,...` URL — what the API's route takes.
  dataUrl: string;
  // Bytes the API will see, so the caller can refuse an oversized one with a
  // real number instead of guessing from the base64 length.
  byteLength: number;
  mimeType: string;
};

export function isSupportedChatImage(file: File): boolean {
  return (CHAT_IMAGE_MIME_TYPES as readonly string[]).includes(file.type);
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler o arquivo."));
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
    img.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
    img.src = src;
  });
}

/**
 * Turns a picked file into what actually gets sent.
 *
 * Animated GIFs pass through untouched — a canvas only ever sees their first
 * frame, so re-encoding one would silently turn an animation into a still.
 * Everything else is drawn onto a canvas at up to MAX_DIMENSION and
 * re-encoded, which is what keeps a 12 MB phone photo from travelling as
 * 12 MB. If that re-encode somehow comes out bigger than the original (a
 * small, already-optimised image), the original wins.
 */
export async function prepareChatImage(file: File): Promise<PreparedChatImage> {
  const original = await readAsDataUrl(file);
  const originalBytes = dataUrlByteLength(original);

  if (file.type === "image/gif") {
    return { dataUrl: original, byteLength: originalBytes, mimeType: file.type };
  }

  try {
    const img = await loadImage(original);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas indisponível");
    ctx.drawImage(img, 0, 0, width, height);

    // WebP keeps transparency and is markedly smaller than JPEG at the same
    // quality; JPEG is the fallback for a browser that can't encode it, and
    // flattening a transparent PNG onto white there is better than sending
    // the original at full size.
    const mimeType = supportsWebpEncoding() ? "image/webp" : "image/jpeg";
    const encoded = canvas.toDataURL(mimeType, ENCODE_QUALITY);
    const encodedBytes = dataUrlByteLength(encoded);
    if (encoded.startsWith(`data:${mimeType}`) && encodedBytes < originalBytes) {
      return { dataUrl: encoded, byteLength: encodedBytes, mimeType };
    }
  } catch {
    // A format the browser can decode but not draw, a tainted canvas, a
    // memory ceiling on a huge image — none of it is worth failing the send
    // over while the original is still perfectly sendable.
  }

  return { dataUrl: original, byteLength: originalBytes, mimeType: file.type };
}

export type SendChatImagesResult = { ok: true; urls: string[] } | { ok: false; error: string };

/**
 * Posts one message — its pictures, and whatever was typed alongside them —
 * into a room's chat.
 *
 * The whole thing travels as a single request on purpose: a caption and its
 * picture are one thing somebody said, and sending the text over the socket
 * separately would let the two land either side of somebody else's line.
 *
 * `clientId` is this connection's own id (SignalingState.selfId) — the API
 * needs it to know which participant is speaking, and pairs it with the
 * account token so nobody can post under a connection id they merely saw in
 * the peer list.
 */
export async function sendChatImages(params: {
  handle: string;
  clientId: string;
  token: string;
  text: string;
  images: string[];
  replyTo?: ChatReplyTo | null;
  signal?: AbortSignal;
}): Promise<SendChatImagesResult> {
  const { handle, clientId, token, text, images, replyTo, signal } = params;
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/rooms/${encodeURIComponent(handle)}/chat/images`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clientId, text, images, replyTo: replyTo ?? undefined }),
        signal,
      }
    );
    const data = (await res.json().catch(() => null)) as
      | { urls?: string[]; error?: string }
      | null;
    if (!res.ok || !data?.urls) {
      return { ok: false, error: data?.error ?? "Não foi possível enviar a imagem." };
    }
    return { ok: true, urls: data.urls };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return { ok: false, error: "Envio cancelado." };
    }
    return { ok: false, error: "Não foi possível enviar a imagem." };
  }
}

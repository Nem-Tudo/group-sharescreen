"use client";
import { translate } from "@/lib/i18n";

// A stable-ish identifier for *this browser on this device*, derived from
// traits it already exposes to every page. Sent with "register" (see
// signalingClient.ts) so moderation can ban a persistent troublemaker on
// something that survives what the other handles don't: a new guest
// identity, a fresh account, a reconnect from a different IP.
//
// What this is not:
//
//   - not a secret, and not proof of anything. It's computed by the client,
//     so a modified one can withhold or forge it. The server treats it as an
//     extra moderation handle, never as an identity to trust.
//   - not stored anywhere. Deliberately: writing it to localStorage would
//     turn it into an ordinary cookie that clearing site data resets, which
//     is exactly the evasion it exists to survive.
//   - not unique. Two identical phones on the same OS build will collide,
//     which is why a ban on it always comes with a reason an admin can
//     review, and why nothing else in the app keys off it.
//
// Only traits that stay put across reloads and window resizes go in:
// devicePixelRatio (changes with browser zoom) and window dimensions are
// left out on purpose — a fingerprint that shifts when someone hits Ctrl+ is
// worse than useless for banning.

// Canvas and WebGL rendering differ measurably between GPU/driver/OS
// combinations, which is what carries most of the entropy here — the
// navigator fields alone are shared by millions of identical installs.
function canvasSignal(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-2d";
    ctx.textBaseline = "top";
    ctx.font = "16px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(10, 5, 80, 30);
    ctx.fillStyle = "#069";
    ctx.fillText(translate("fingerprint.goliveFp"), 12, 12);
    ctx.strokeStyle = "rgba(0, 120, 200, 0.7)";
    ctx.arc(60, 30, 22, 0, Math.PI * 1.7);
    ctx.stroke();
    return canvas.toDataURL();
  } catch {
    // Some privacy modes/extensions throw rather than returning noise.
    return "no-canvas";
  }
}

function webglSignal(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "no-webgl";
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return `${vendor}~${renderer}`;
  } catch {
    return "no-webgl";
  }
}

function collectSignals(): string {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return [
    nav.userAgent,
    nav.language,
    (nav.languages ?? []).join(","),
    nav.hardwareConcurrency ?? "",
    nav.deviceMemory ?? "",
    nav.maxTouchPoints ?? "",
    screen.width,
    screen.height,
    screen.colorDepth,
    // The IANA zone, not the offset: an offset moves with daylight saving.
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    canvasSignal(),
    webglSignal(),
  ].join("|");
}

// FNV-1a, run four times and concatenated into 32 hex characters. A single
// 32-bit hash would collide often enough to matter for something a ban keys
// on; four rounds give it 128 bits without pulling in a hash library — and
// unlike crypto.subtle.digest this is synchronous, so the value is always
// ready at the moment "register" is sent instead of arriving a tick late on
// the very first connection.
//
// Each round gets both a different offset basis *and* a different salt
// prefixed to the input. The offsets alone wouldn't be enough: FNV's mixing
// step is the same in every round, so two inputs that collide under one
// offset would land suspiciously close under the others — salting the data
// makes the rounds actually diverge.
const FNV_OFFSETS = [0x811c9dc5, 0x01000193, 0x9dc5811c, 0xc59d1c81];

function fnv1a(text: string, offset: number): string {
  let hash = offset >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // hash * 16777619, in 32-bit arithmetic that stays exact in a double.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

let cached: string | null = null;

// Synchronous and memoised: the canvas/WebGL work costs a few milliseconds,
// and the answer can't change within a page's lifetime.
export function getBrowserFingerprint(): string | null {
  if (typeof window === "undefined") return null;
  if (cached) return cached;
  try {
    const signals = collectSignals();
    cached = FNV_OFFSETS.map((offset, round) => fnv1a(`${round}:${signals}`, offset)).join("");
    return cached;
  } catch {
    // Never let fingerprinting break registering — no fingerprint just means
    // this connection can't be banned on one.
    return null;
  }
}

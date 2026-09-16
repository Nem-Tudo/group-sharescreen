"use client";

import { GIFEncoder, applyPalette, quantize } from "gifenc";

// Cropping a GIF without flattening it into a still picture.
//
// The cropper used to send GIFs through untouched, because drawing one on a
// canvas keeps a single frame and throws the animation away — which is the
// whole reason somebody uploads a GIF. So it is taken apart instead: every
// frame is decoded, cropped and scaled exactly like a still would be, and the
// frames are encoded back into a GIF. The animation, its timing and its loop
// survive; the framing is the one the person chose.
//
// Decoding leans on WebCodecs' ImageDecoder, which hands over frames already
// composed against the ones before them — so the disposal and partial-frame
// rules of the GIF format never have to be reimplemented here. Everything
// that runs GoLive's desktop shell has it, and so does every Chromium
// browser; where it is missing (older Safari, mainly) canCropAnimatedGif()
// says so and the caller keeps the old send-it-as-it-is behaviour.
//
// Encoding is gifenc, which quantizes each frame to its own 256-colour
// palette. A per-frame palette costs a little time and buys a lot of quality
// on the photographic GIFs people actually use as avatars.

/** Above this the encode is slow and the file is huge; frames beyond it are dropped evenly. */
const MAX_FRAMES = 150;

/** A GIF the API would refuse is worse than a slightly softer one, so size wins. */
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

/**
 * Below this a frame delay is treated as "as fast as possible", which is what
 * browsers do with the 0 and 10ms delays that old GIFs are full of — encoding
 * them literally makes a GIF that runs visibly faster than the original.
 */
const MIN_DELAY_MS = 20;
const DEFAULT_DELAY_MS = 100;

export function canCropAnimatedGif(): boolean {
  return typeof window !== "undefined" && typeof window.ImageDecoder !== "undefined";
}

export type GifCropRect = {
  /** The crop, in the source GIF's own pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** The size to write out. Never larger than the crop — nothing is upscaled. */
  outWidth: number;
  outHeight: number;
};

type DecodedFrame = { data: Uint8ClampedArray; delay: number };

/**
 * Decodes `blob`, cropping and scaling each frame to `outWidth`x`outHeight`.
 *
 * Frames come back as raw RGBA at the output size, which is the form the
 * encoder wants and is small enough to keep all of them in memory: at the
 * sizes an avatar or banner uses, 150 of them is a few dozen megabytes held
 * for a second or two.
 */
async function decodeFrames(blob: Blob, rect: GifCropRect): Promise<DecodedFrame[]> {
  const decoder = new window.ImageDecoder({
    data: await blob.arrayBuffer(),
    type: "image/gif",
    // Frames composed against their predecessors, which is what makes the
    // GIF disposal rules somebody else's problem.
    preferAnimation: true,
  });
  const canvas = document.createElement("canvas");
  canvas.width = rect.outWidth;
  canvas.height = rect.outHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas unavailable");
  ctx.imageSmoothingQuality = "high";

  try {
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    const total = track?.frameCount ?? 1;
    // Evenly spread rather than truncated: a long GIF should still play
    // through to its end, just at a coarser step.
    const step = Math.max(1, Math.ceil(total / MAX_FRAMES));
    const frames: DecodedFrame[] = [];
    for (let i = 0; i < total; i += step) {
      const { image } = await decoder.decode({ frameIndex: i });
      // Dropping a frame hands its time to the one that is kept, so a
      // thinned-out GIF still lasts about as long as the original. The
      // skipped frames' own durations are never decoded — that would cost
      // exactly the decode the step is there to avoid — so this assumes they
      // match the frame that was kept, which for a GIF's near-uniform frame
      // timings is the difference of a few milliseconds.
      const delay = (((image.duration ?? 0) / 1000) || DEFAULT_DELAY_MS) * Math.min(step, total - i);
      ctx.clearRect(0, 0, rect.outWidth, rect.outHeight);
      ctx.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.outWidth, rect.outHeight);
      image.close();
      frames.push({
        data: ctx.getImageData(0, 0, rect.outWidth, rect.outHeight).data,
        delay: Math.max(MIN_DELAY_MS, Math.round(delay) || DEFAULT_DELAY_MS),
      });
    }
    return frames;
  } finally {
    decoder.close();
  }
}

/** Encodes already-cropped RGBA frames, optionally keeping only every `step`-th one. */
function encodeFrames(
  frames: DecodedFrame[],
  width: number,
  height: number,
  { step, maxColors }: { step: number; maxColors: number }
): Uint8Array {
  const gif = GIFEncoder();
  for (let i = 0; i < frames.length; i += step) {
    // The dropped frames' time is added to the one that survives, so thinning
    // the GIF changes how smooth it is and not how fast it plays.
    let delay = 0;
    for (let j = i; j < Math.min(frames.length, i + step); j += 1) delay += frames[j].delay;
    const { data } = frames[i];
    // rgba4444 with a one-bit alpha: GIF has no partial transparency, and a
    // cropped GIF sticker with a see-through background must not come out on
    // a black square.
    const palette = quantize(data, maxColors, { format: "rgba4444", oneBitAlpha: true });
    const index = applyPalette(data, palette, "rgba4444");
    const transparentIndex = palette.findIndex((color) => color[3] === 0);
    gif.writeFrame(index, width, height, {
      palette,
      delay,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      // Clear back to transparent between frames when there is transparency:
      // every frame written here is already a complete picture, so letting
      // the previous one show through a see-through pixel would smear it.
      dispose: transparentIndex >= 0 ? 2 : -1,
    });
  }
  gif.finish();
  return gif.bytes();
}

function toDataUrl(bytes: Uint8Array): string {
  let binary = "";
  // In chunks because String.fromCharCode(...bytes) on a multi-megabyte array
  // overflows the argument stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:image/gif;base64,${btoa(binary)}`;
}

/**
 * Crops an animated GIF to `rect` and returns it as a data URL, still animated.
 *
 * If the result would be bigger than the API accepts it is encoded again with
 * fewer colours, then with fewer frames, rather than failing: a GIF that is a
 * bit coarser is what the person wanted, and an error is not.
 *
 * Throws if the GIF cannot be decoded at all, which the caller should treat
 * as "keep the original", not as a lost upload.
 */
export async function cropAnimatedGif(src: string, rect: GifCropRect): Promise<string> {
  const blob = await (await fetch(src)).blob();
  const frames = await decodeFrames(blob, rect);
  if (frames.length === 0) throw new Error("no frames");

  // Tried in order, each one giving up a little more: colours first, because
  // 128 colours on a small avatar is nearly invisible, and only then the
  // smoothness of the animation.
  const attempts = [
    { step: 1, maxColors: 256 },
    { step: 1, maxColors: 128 },
    { step: 2, maxColors: 128 },
    { step: 3, maxColors: 64 },
  ];
  let bytes = encodeFrames(frames, rect.outWidth, rect.outHeight, attempts[0]);
  for (const attempt of attempts.slice(1)) {
    if (bytes.length <= MAX_OUTPUT_BYTES) break;
    bytes = encodeFrames(frames, rect.outWidth, rect.outHeight, attempt);
  }
  return toDataUrl(bytes);
}

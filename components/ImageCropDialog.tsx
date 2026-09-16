"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { MdZoomIn, MdZoomOut } from "react-icons/md";
import { useI18n } from "@/lib/useI18n";
import { canCropAnimatedGif, cropAnimatedGif } from "@/lib/gifCrop";

// Reposition and resize a picture before it is sent as an avatar or a banner.
//
// The image always covers the frame — it can be dragged and zoomed, never
// moved so far that an empty edge shows — so whatever the frame shows is
// exactly what gets saved. The frame has the shape the picture will be drawn
// in: a square for the avatar, a wide strip for the banner (the same
// proportion as the profile card's banner, give or take the phone layout).
//
// Portalled to the body rather than drawn in place: it is opened from inside
// the profile card, which is overflow-hidden and itself sits in a popup.

const MAX_ZOOM = 4;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

export type ImageCropKind = "avatar" | "banner";

// gifOutWidth is smaller than outWidth on purpose. A GIF is a couple of
// hundred frames of indexed colour, so its size grows with the frame area far
// faster than a still's does, and it is shown at the same handful of hundred
// pixels either way — at the still's size a normal avatar GIF would come out
// several megabytes and be squeezed back down by the encoder's own fallbacks,
// which costs quality that nobody can see the benefit of.
const SHAPES: Record<
  ImageCropKind,
  { aspect: number; outWidth: number; gifOutWidth: number; frameWidth: number }
> = {
  avatar: { aspect: 1, outWidth: 512, gifOutWidth: 256, frameWidth: 320 },
  banner: { aspect: 3, outWidth: 1500, gifOutWidth: 720, frameWidth: 600 },
};

type View = { zoom: number; x: number; y: number };

function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function encode(canvas: HTMLCanvasElement): string {
  const webp = canvas.toDataURL("image/webp", 0.92);
  const mime = webp.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
  let quality = 0.92;
  let out = mime === "image/webp" ? webp : canvas.toDataURL(mime, quality);
  // A banner of a very noisy photo can come out large; step the quality down
  // rather than have the API refuse the save.
  while (dataUrlBytes(out) > MAX_OUTPUT_BYTES && quality > 0.5) {
    quality -= 0.1;
    out = canvas.toDataURL(mime, quality);
  }
  return out;
}

export function ImageCropDialog({
  src,
  kind,
  mimeType,
  onCancel,
  onConfirm,
}: {
  /** An object URL (or data URL) of the picked file. */
  src: string;
  kind: ImageCropKind;
  /** The picked file's type. An animated GIF is cropped frame by frame. */
  mimeType?: string;
  onCancel: () => void;
  /** The cropped picture, as the data URL the profile save sends. */
  onConfirm: (dataUrl: string) => void;
}) {
  const { t } = useI18n();
  const shape = SHAPES[kind];
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  // An animated crop takes a moment (decode + re-encode of every frame), so
  // the button says so and stops being pressed twice.
  const [working, setWorking] = useState(false);
  const isGif = mimeType === "image/gif" && canCropAnimatedGif();
  const [frameWidth, setFrameWidth] = useState(() => Math.min(shape.frameWidth, window.innerWidth - 64));
  // Null until the picture is first moved: until then it is simply centred.
  const [stored, setView] = useState<View | null>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; from: View } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // A native listener, stopped before it reaches the document: ntpopups (and
  // the profile's own pickers) close on a mousedown outside themselves, and
  // this overlay is outside them in the DOM — every drag here would otherwise
  // close the profile being edited underneath.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    function onMouseDown(e: MouseEvent) {
      e.stopPropagation();
      if (e.target === overlay) onCancel();
    }
    overlay.addEventListener("mousedown", onMouseDown);
    return () => overlay.removeEventListener("mousedown", onMouseDown);
  }, [onCancel]);

  const frameHeight = frameWidth / shape.aspect;

  useEffect(() => {
    const fit = () => setFrameWidth(Math.min(shape.frameWidth, window.innerWidth - 64));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [shape.frameWidth]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setImage(img);
    img.onerror = () => setFailed(true);
    img.src = src;
  }, [src]);

  useEffect(() => {
    // On the window, in the capture phase, and stopped there: the profile this
    // opens from is an ntpopups popup that closes on Escape too, and one press
    // should back out of the cropper only.
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancel();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  // The scale at which the image just covers the frame; zoom multiplies it.
  const baseScale = image ? Math.max(frameWidth / image.naturalWidth, frameHeight / image.naturalHeight) : 1;

  /** Keeps the image covering the frame. x/y are the image's top-left, in frame pixels. */
  const clamp = useCallback(
    (next: View): View => {
      if (!image) return next;
      const zoom = Math.min(MAX_ZOOM, Math.max(1, next.zoom));
      const scale = baseScale * zoom;
      const w = image.naturalWidth * scale;
      const h = image.naturalHeight * scale;
      return {
        zoom,
        x: Math.min(0, Math.max(frameWidth - w, next.x)),
        y: Math.min(0, Math.max(frameHeight - h, next.y)),
      };
    },
    [image, baseScale, frameWidth, frameHeight]
  );

  // Clamped on every render rather than when stored, so a frame that shrinks
  // with the window can never leave an empty edge showing.
  const view: View = image
    ? clamp(
        stored ?? {
          zoom: 1,
          x: (frameWidth - image.naturalWidth * baseScale) / 2,
          y: (frameHeight - image.naturalHeight * baseScale) / 2,
        }
      )
    : { zoom: 1, x: 0, y: 0 };

  /** Zooms keeping the frame's centre on the same point of the picture. */
  function zoomTo(zoom: number) {
    const from = baseScale * view.zoom;
    const to = baseScale * Math.min(MAX_ZOOM, Math.max(1, zoom));
    const cx = (frameWidth / 2 - view.x) / from;
    const cy = (frameHeight / 2 - view.y) / from;
    setView(clamp({ zoom, x: frameWidth / 2 - cx * to, y: frameHeight / 2 - cy * to }));
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, from: view };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setView(clamp({ ...d.from, x: d.from.x + e.clientX - d.startX, y: d.from.y + e.clientY - d.startY }));
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) drag.current = null;
  }

  async function confirm() {
    if (!image || working) return;
    const scale = baseScale * view.zoom;
    const sx = -view.x / scale;
    const sy = -view.y / scale;
    const sw = frameWidth / scale;
    const sh = frameHeight / scale;
    // Never upscaled past the pixels the crop actually has.
    const outW = Math.max(1, Math.round(Math.min(isGif ? shape.gifOutWidth : shape.outWidth, sw)));
    const outH = Math.max(1, Math.round(outW / shape.aspect));
    if (isGif) {
      setWorking(true);
      try {
        onConfirm(await cropAnimatedGif(src, { sx, sy, sw, sh, outWidth: outW, outHeight: outH }));
        return;
      } catch {
        // Decoding failed — better a still picture of the crop the person
        // chose than an error and no avatar at all, so fall through to the
        // canvas path below, which draws whatever frame the <img> is on.
      } finally {
        setWorking(false);
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setFailed(true);
      return;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, outW, outH);
    onConfirm(encode(canvas));
  }

  const scale = baseScale * view.zoom;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4"
      ref={overlayRef}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("imageCrop.title")}
        className="flex max-w-full flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
      >
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">{t("imageCrop.title")}</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("imageCrop.hint")}</p>
        </div>

        <div
          className={`relative touch-none select-none overflow-hidden bg-zinc-100 dark:bg-zinc-900 ${
            image ? "cursor-grab active:cursor-grabbing" : ""
          } ${kind === "avatar" ? "rounded-2xl" : "rounded-lg"}`}
          style={{ width: frameWidth, height: frameHeight }}
          onPointerDown={image ? onPointerDown : undefined}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => {
            if (image) zoomTo(view.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
          }}
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left"
              style={{
                width: image.naturalWidth,
                height: image.naturalHeight,
                transform: `translate(${view.x}px, ${view.y}px) scale(${scale})`,
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-zinc-500">
              {failed ? t("common.couldNotOpenTheImage") : t("common.loading")}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
          <MdZoomOut className="h-5 w-5 shrink-0" aria-hidden />
          <span className="sr-only">{t("imageCrop.zoom")}</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            disabled={!image}
            onChange={(e) => zoomTo(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer accent-emerald-600"
          />
          <MdZoomIn className="h-5 w-5 shrink-0" aria-hidden />
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!image || working}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {working ? t("imageCrop.applying") : t("imageCrop.apply")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

"use client";

import useNtPopups from "ntpopups";
import { useEffect, useRef, useState } from "react";
import { MdAdd, MdCreate, MdDelete, MdUpload } from "react-icons/md";
import { CameraDrawingPad } from "@/components/CameraDrawingPad";
import { setCameraEffect, useCameraEffectSettings } from "@/lib/cameraEffects";
import {
  addEmojiSticker,
  addImageSticker,
  ADJUST_RANGES,
  CUSTOM_ANCHORS,
  DEFAULT_ADJUST,
  deleteCustomCameraEffect,
  MAX_CUSTOM_NAME,
  MAX_CUSTOM_STICKERS,
  openCustomEffectEditor,
  publishCustomEffectPreview,
  removeCustomSticker,
  STICKER_RANGES,
  stickerImage,
  updateCustomCameraEffect,
  updateCustomSticker,
  useCustomCameraEffects,
  useCustomEffectEditing,
  useCustomEffectPreview,
  type CustomAdjust,
  type CustomAnchor,
  type CustomSticker,
} from "@/lib/cameraCustomEffects";
import { useT } from "@/lib/useI18n";

// The editor of "Criar efeito" (see lib/cameraCustomEffects): the camera as it
// goes out on top, the effect's stickers and adjustments under it. Every change
// is stored and drawn as it is made, so there is nothing to save or to lose.

const EMOJIS = ["😎", "😂", "🥰", "🤩", "👑", "🎩", "🧢", "🕶️", "❤️", "🔥", "⭐", "✨", "🌈", "🦋", "🌸", "🍕", "🐶", "🐱", "🦄", "👽", "💀", "🤖", "👻", "🎉"];

const ANCHOR_LABELS: Record<CustomAnchor, string> = {
  head: "watch.watchRoom.cameraCustomAnchorHead",
  forehead: "watch.watchRoom.cameraCustomAnchorForehead",
  eyes: "watch.watchRoom.cameraCustomAnchorEyes",
  eyeRight: "watch.watchRoom.cameraCustomAnchorEyeRight",
  eyeLeft: "watch.watchRoom.cameraCustomAnchorEyeLeft",
  nose: "watch.watchRoom.cameraCustomAnchorNose",
  cheekRight: "watch.watchRoom.cameraCustomAnchorCheekRight",
  cheekLeft: "watch.watchRoom.cameraCustomAnchorCheekLeft",
  mouth: "watch.watchRoom.cameraCustomAnchorMouth",
  chin: "watch.watchRoom.cameraCustomAnchorChin",
};

const ADJUST_LABELS: Record<keyof CustomAdjust, string> = {
  brightness: "watch.watchRoom.cameraCustomBrightness",
  contrast: "watch.watchRoom.cameraCustomContrast",
  saturation: "watch.watchRoom.cameraCustomSaturation",
  hue: "watch.watchRoom.cameraCustomHue",
  vignette: "watch.watchRoom.cameraCustomVignette",
};

const CHIP = "rounded-md px-2 py-1 text-xs font-medium transition";
const CHIP_ON = "bg-emerald-600 text-white";
const CHIP_OFF =
  "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700";

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
      <span className="w-24 shrink-0 truncate">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-emerald-600"
      />
    </label>
  );
}

function StickerThumb({ sticker }: { sticker: CustomSticker }) {
  if (sticker.emoji) return <span className="text-lg leading-none">{sticker.emoji}</span>;
  const image = sticker.imageId ? stickerImage(sticker.imageId) : null;
  // eslint-disable-next-line @next/next/no-img-element -- a data URL from this browser
  return image ? <img src={image} alt="" className="h-5 w-5 object-contain" /> : null;
}

// In the room: opens the editor when the panel asks for it, and keeps it told
// which camera to show.
export function CameraCustomEffectHost({
  stream,
  fallbackMirrored,
}: {
  // The camera going out (effects included), for the preview.
  stream: MediaStream | null;
  fallbackMirrored: boolean;
}) {
  const { openPopup } = useNtPopups();
  const editingId = useCustomEffectEditing();
  const track = stream?.getVideoTracks()[0] ?? null;
  useEffect(() => {
    publishCustomEffectPreview(track, fallbackMirrored);
  }, [track, fallbackMirrored]);
  useEffect(() => {
    if (!editingId) return;
    void openPopup("camera_custom_effect", {
      maxWidth: "min(34rem, calc(100vw - 2rem))",
      width: "min(34rem, calc(100vw - 2rem))",
      maxHeight: "90dvh",
      // A slider or a stroke let go past the edge must not close it.
      closeOnClickOutside: false,
      onClose: () => openCustomEffectEditor(null),
      data: { effectId: editingId },
    });
  }, [editingId, openPopup]);
  return null;
}

// The popup, registered as "camera_custom_effect" in NtPopups.tsx.
export function CameraCustomEffectEditor({
  closePopup,
  popupstyles,
  data: { effectId: editingId },
}: {
  closePopup: (hasAction?: boolean) => void;
  popupstyles: Record<string, string>;
  data: { effectId: string };
}) {
  const t = useT();
  const { track, fallbackMirrored } = useCustomEffectPreview();
  const effects = useCustomCameraEffects();
  const settings = useCameraEffectSettings();
  const effect = effects.find((item) => item.id === editingId) ?? null;
  const [selectedSticker, setSelectedSticker] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // The drawing pad: which sticker it continues (null: a new drawing), if open.
  const [drawing, setDrawing] = useState<{ stickerId: string | null } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  // As in CameraEffectsSheet: the effects swap the track inside the same
  // stream, which a <video> holding the stream does not always pick up.
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
  }, [track, effect?.id]);

  if (!effect) return null;

  const facing = track?.getSettings().facingMode;
  const mirrored = facing ? facing === "user" : fallbackMirrored;
  const sticker = effect.stickers.find((item) => item.id === selectedSticker) ?? null;
  const full = effect.stickers.length >= MAX_CUSTOM_STICKERS;

  const setAdjust = (key: keyof CustomAdjust, value: number) =>
    updateCustomCameraEffect(effect.id, (current) => ({ ...current, adjust: { ...current.adjust, [key]: value } }));

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setImageFailed(false);
    try {
      setSelectedSticker(await addImageSticker(effect.id, file));
    } catch {
      setImageFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (settings.custom === effect.id) setCameraEffect("custom", "none");
    deleteCustomCameraEffect(effect.id);
    closePopup(true);
  };

  const adjusted = (Object.keys(DEFAULT_ADJUST) as (keyof CustomAdjust)[]).some(
    (key) => effect.adjust[key] !== DEFAULT_ADJUST[key]
  );

  return (
    <>
      <div className={popupstyles.header}>
        <span>{t("watch.watchRoom.cameraCustomEdit")}</span>
      </div>
      <div className={`${popupstyles.body} flex flex-col gap-3`}>
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            className={`h-[24dvh] w-full object-cover ${mirrored ? "-scale-x-100" : ""}`}
          />
          {!track && (
            <span className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs font-medium text-white">
              {t("watch.watchRoom.cameraCustomNoCamera")}
            </span>
          )}
        </div>

        <input
          type="text"
          value={effect.name}
          maxLength={MAX_CUSTOM_NAME}
          aria-label={t("watch.watchRoom.cameraCustomName")}
          placeholder={t("watch.watchRoom.cameraCustomName")}
          onChange={(e) => {
            const name = e.target.value;
            updateCustomCameraEffect(effect.id, (current) => ({ ...current, name }));
          }}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
        />

        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{t("watch.watchRoom.cameraCustomStickers")}</h3>
          {effect.stickers.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {effect.stickers.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.id === sticker?.id}
                  aria-label={t(ANCHOR_LABELS[item.anchor])}
                  onClick={() => {
                    setDrawing(null);
                    setSelectedSticker(item.id === sticker?.id ? null : item.id);
                  }}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.id === sticker?.id ? "ring-2 ring-emerald-500" : ""} bg-zinc-100 dark:bg-zinc-800`}
                >
                  <StickerThumb sticker={item} />
                </button>
              ))}
            </div>
          )}

          {drawing && (
            <CameraDrawingPad
              // A different drawing starts over; the one being drawn keeps its strokes.
              key={drawing.stickerId ?? "new"}
              effectId={effect.id}
              sticker={effect.stickers.find((item) => item.id === drawing.stickerId) ?? null}
              onSticker={setSelectedSticker}
              onClose={() => setDrawing(null)}
            />
          )}

          {sticker && !drawing && (
            <div className="flex flex-col gap-1.5 rounded-xl bg-zinc-50 p-2 dark:bg-zinc-900">
              <div className="flex flex-wrap gap-1">
                {CUSTOM_ANCHORS.map((anchor) => (
                  <button
                    key={anchor}
                    type="button"
                    aria-pressed={sticker.anchor === anchor}
                    onClick={() => updateCustomSticker(effect.id, sticker.id, { anchor })}
                    className={`${CHIP} ${sticker.anchor === anchor ? CHIP_ON : CHIP_OFF}`}
                  >
                    {t(ANCHOR_LABELS[anchor])}
                  </button>
                ))}
              </div>
              {sticker.drawing && (
                <button
                  type="button"
                  onClick={() => setDrawing({ stickerId: sticker.id })}
                  className={`${CHIP} ${CHIP_OFF} inline-flex items-center gap-1 self-start`}
                >
                  <MdCreate className="h-3.5 w-3.5" />
                  {t("watch.watchRoom.cameraCustomDrawEdit")}
                </button>
              )}
              <Slider
                label={t("watch.watchRoom.cameraCustomSize")}
                value={sticker.size}
                {...STICKER_RANGES.size}
                step={0.05}
                onChange={(size) => updateCustomSticker(effect.id, sticker.id, { size })}
              />
              <Slider
                label={t("watch.watchRoom.cameraCustomMoveX")}
                value={sticker.x}
                {...STICKER_RANGES.x}
                step={0.02}
                onChange={(x) => updateCustomSticker(effect.id, sticker.id, { x })}
              />
              <Slider
                label={t("watch.watchRoom.cameraCustomMoveY")}
                value={sticker.y}
                {...STICKER_RANGES.y}
                step={0.02}
                onChange={(y) => updateCustomSticker(effect.id, sticker.id, { y })}
              />
              <Slider
                label={t("watch.watchRoom.cameraCustomRotate")}
                value={sticker.rotation}
                {...STICKER_RANGES.rotation}
                onChange={(rotation) => updateCustomSticker(effect.id, sticker.id, { rotation })}
              />
              <button
                type="button"
                onClick={() => {
                  removeCustomSticker(effect.id, sticker.id);
                  setSelectedSticker(null);
                }}
                className="inline-flex items-center gap-1 self-start text-xs font-medium text-red-600 dark:text-red-400"
              >
                <MdDelete className="h-3.5 w-3.5" />
                {t("watch.watchRoom.cameraCustomRemoveSticker")}
              </button>
            </div>
          )}

          {full ? (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {t("watch.watchRoom.cameraCustomStickerLimit", { count: MAX_CUSTOM_STICKERS })}
            </span>
          ) : drawing ? null : (
            <>
              <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                <MdAdd className="h-3.5 w-3.5" />
                {t("watch.watchRoom.cameraCustomAddSticker")}
              </span>
              <div className="grid grid-cols-8 gap-1">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setSelectedSticker(addEmojiSticker(effect.id, emoji))}
                    className="flex h-8 items-center justify-center rounded-lg text-lg leading-none hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <input
                ref={input}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setDrawing({ stickerId: null })}
                  className={`${CHIP} ${CHIP_OFF} inline-flex items-center gap-1`}
                >
                  <MdCreate className="h-3.5 w-3.5" />
                  {t("watch.watchRoom.cameraCustomDraw")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                  className={`${CHIP} ${CHIP_OFF} inline-flex items-center gap-1 disabled:opacity-50`}
                >
                  <MdUpload className="h-3.5 w-3.5" />
                  {busy ? t("watch.watchRoom.cameraEffectsLoading") : t("watch.watchRoom.cameraCustomUpload")}
                </button>
              </div>
              {imageFailed && (
                <span className="text-[11px] text-red-600 dark:text-red-400">{t("watch.watchRoom.cameraCustomImageError")}</span>
              )}
            </>
          )}
        </section>

        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{t("watch.watchRoom.cameraCustomAdjust")}</h3>
            {adjusted && (
              <button
                type="button"
                onClick={() => updateCustomCameraEffect(effect.id, (current) => ({ ...current, adjust: { ...DEFAULT_ADJUST } }))}
                className="text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                {t("watch.watchRoom.cameraCustomReset")}
              </button>
            )}
          </div>
          {(Object.keys(ADJUST_LABELS) as (keyof CustomAdjust)[]).map((key) => (
            <Slider
              key={key}
              label={t(ADJUST_LABELS[key])}
              value={effect.adjust[key]}
              {...ADJUST_RANGES[key]}
              onChange={(value) => setAdjust(key, value)}
            />
          ))}
        </section>

        <button
          type="button"
          onClick={remove}
          className="inline-flex items-center gap-1 self-start text-xs font-medium text-red-600 dark:text-red-400"
        >
          <MdDelete className="h-4 w-4" />
          {t("watch.watchRoom.cameraCustomDelete")}
        </button>
      </div>
      <div className={popupstyles.footer}>
        <button type="button" className={popupstyles.baseButton} base-button-style="0" onClick={() => closePopup(true)}>
          {t("watch.watchRoom.cameraCustomDone")}
        </button>
      </div>
    </>
  );
}

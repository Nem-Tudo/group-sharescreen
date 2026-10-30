"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MdAutoAwesome, MdBlock } from "react-icons/md";
import { MobileSheet } from "@/components/MobileSheet";
import { NewBadge, markFeatureUsed } from "@/components/NewBadge";
import { CAMERA_EFFECT_LABELS, CustomBackgroundChips, StreamBackgroundPicker } from "@/components/CameraEffectsPanel";
import {
  CAMERA_BACKGROUNDS,
  CAMERA_COLORS,
  CAMERA_EFFECTS_3D_FEATURE,
  CAMERA_EFFECTS_FEATURE,
  CAMERA_FACES,
  CAMERA_FACES_3D,
  CAMERA_REACTIONS,
  CAMERA_WARP_FEATURE,
  CAMERA_WARPS,
  setCameraEffect,
  useCameraEffectSettings,
  useCameraEffectsStatus,
  type CameraEffectSettings,
} from "@/lib/cameraEffects";
import { setTileExperimentMode } from "@/lib/clipsMode";
import { useFeature } from "@/lib/features";
import { useT } from "@/lib/useI18n";

// "Efeitos de câmera" on a phone's bottom bar: a sheet with the camera as it
// goes out on top and big tiles under it, one category at a time. The camera's
// panel (CameraEffectsPanel) has the same choices as small chips behind a
// switch, which is fine with a mouse and fiddly with a thumb — and from there
// the only way to see the result was to close it and look for your own tile.
// Picking a tile turns the switch on, as on the computer's own button.

type Tab = keyof CameraEffectSettings;

// What each tile shows: an emoji for the faces, a swatch for the rest.
const FACE_ICONS: Record<CameraEffectSettings["face"], string> = {
  none: "",
  dog: "🐶",
  cat: "🐱",
  bunny: "🐰",
  bear: "🐻",
  pig: "🐷",
  glasses: "😎",
  hearts: "😍",
  pirate: "🏴‍☠️",
  mustache: "🥸",
  clown: "🤡",
  crown: "👑",
  devil: "😈",
  angel: "😇",
  party: "🥳",
  glasses3d: "🕶️",
  tophat3d: "🎩",
  viking3d: "🪖",
};

const WARP_ICONS: Record<CameraEffectSettings["warp"], string> = {
  none: "",
  sad: "😢",
  angry: "😠",
  happy: "😁",
  surprised: "😲",
  fat: "🍔",
  thin: "🥢",
  bigeyes: "👀",
  bighead: "🎈",
};

const BACKGROUND_SWATCHES: Record<CameraEffectSettings["background"], string> = {
  none: "",
  custom: "",
  stream: "",
  blur: "bg-gradient-to-br from-zinc-300 via-zinc-400 to-zinc-500 blur-[2px]",
  sunset: "bg-gradient-to-b from-orange-400 via-pink-500 to-purple-700",
  beach: "bg-gradient-to-b from-sky-400 via-cyan-300 to-amber-200",
  space: "bg-gradient-to-br from-indigo-950 via-purple-900 to-black",
  office: "bg-gradient-to-b from-stone-200 via-stone-300 to-amber-800",
  aurora: "bg-gradient-to-br from-emerald-400 via-teal-700 to-indigo-950",
  studio: "bg-gradient-to-b from-zinc-600 via-zinc-800 to-black",
};

const COLOR_FILTERS: Record<CameraEffectSettings["color"], string> = {
  none: "",
  mono: "grayscale",
  sepia: "sepia",
  vivid: "saturate-200",
};

const RAINBOW = "bg-gradient-to-br from-rose-400 via-amber-300 to-sky-500";

function Tile({
  selected,
  label,
  onClick,
  children,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex h-[4.75rem] min-w-0 flex-col items-center justify-center gap-1 rounded-xl border p-1 transition active:scale-95 ${
        selected
          ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500 dark:bg-emerald-950/50"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg text-2xl leading-none">
        {children}
      </span>
      <span className="w-full truncate text-center text-[10px] font-medium leading-tight text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
    </button>
  );
}

const NONE_ICON = <MdBlock className="h-6 w-6 text-zinc-400" />;

export function CameraEffectsSheet({
  open,
  onClose,
  on,
  stream,
  fallbackMirrored,
}: {
  open: boolean;
  onClose: () => void;
  on: boolean;
  // The camera going out (effects included), for the preview.
  stream: MediaStream | null;
  // Whether to mirror the preview when the track does not say which way it
  // faces (see the own camera tile in WatchRoom, which decides it the same way).
  fallbackMirrored: boolean;
}) {
  const t = useT();
  const settings = useCameraEffectSettings();
  const status = useCameraEffectsStatus();
  // Exposure for "camera-effects-3d", as in the panel: the sheet is only
  // mounted while open.
  const has3d = useFeature(CAMERA_EFFECTS_3D_FEATURE, { track: true }).enabled;
  // And for "camera-warp".
  const hasWarp = useFeature(CAMERA_WARP_FEATURE, { track: true }).enabled;
  const [tab, setTab] = useState<Tab>("face");
  const video = useRef<HTMLVideoElement>(null);

  // Turning the effects on swaps the track inside the same stream, which a
  // <video> holding the stream does not always pick up: it is given the
  // current track on its own, again whenever that changes.
  const track = stream?.getVideoTracks()[0] ?? null;
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
  }, [track]);
  const facing = track?.getSettings().facingMode;
  const mirrored = facing ? facing === "user" : fallbackMirrored;

  const pick = <K extends Tab>(key: K, value: CameraEffectSettings[K]) => {
    setCameraEffect(key, value);
    if (value === "none") return;
    markFeatureUsed(CAMERA_EFFECTS_FEATURE);
    if (!on) setTileExperimentMode("cameraEffects", true);
  };
  const turnOn = on ? undefined : () => setTileExperimentMode("cameraEffects", true);
  const label = <K extends Tab>(key: K, value: CameraEffectSettings[K]) =>
    t((CAMERA_EFFECT_LABELS[key] as Record<string, string>)[value]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "face", label: t("watch.watchRoom.cameraEffectFace") },
    ...(hasWarp ? [{ key: "warp" as const, label: t("watch.watchRoom.cameraEffectWarp") }] : []),
    { key: "background", label: t("watch.watchRoom.cameraEffectBackground") },
    { key: "color", label: t("watch.watchRoom.cameraEffectColor") },
    ...(has3d ? [{ key: "reactions" as const, label: t("watch.watchRoom.cameraEffectReactions") }] : []),
  ];

  return (
    <MobileSheet
      open={open}
      onClose={onClose}
      maxHeight="80dvh"
      title={
        <span className="inline-flex items-center gap-1.5">
          <MdAutoAwesome className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          {t("watch.watchRoom.cameraEffects")}
          <NewBadge id={CAMERA_EFFECTS_FEATURE} />
        </span>
      }
      headerRight={
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t("watch.watchRoom.cameraEffects")}
          onClick={() => setTileExperimentMode("cameraEffects", !on)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`}
          />
        </button>
      }
    >
      <div className="flex flex-col gap-3 pb-1">
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            className={`h-[26dvh] w-full object-cover ${mirrored ? "-scale-x-100" : ""}`}
          />
          {(status.loading || status.failed || !on) && (
            <span
              className={`absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-medium text-white backdrop-blur ${
                status.failed && on ? "bg-red-600/85" : "bg-black/60"
              }`}
            >
              {!on
                ? t("watch.watchRoom.cameraEffectsSheetOff")
                : status.failed
                  ? t("watch.watchRoom.cameraEffectsFailed")
                  : t("watch.watchRoom.cameraEffectsLoading")}
            </span>
          )}
        </div>

        <div role="tablist" className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`relative flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                tab === item.key
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              {item.label}
              {/* Something is picked in this category. */}
              {settings[item.key] !== "none" && (
                <span className="absolute top-1 right-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
              )}
            </button>
          ))}
        </div>

        <div className={`flex flex-col gap-2 ${on ? "" : "opacity-70"}`}>
          {tab === "face" && (
            <div className="grid grid-cols-4 gap-2">
              {(has3d ? [...CAMERA_FACES, ...CAMERA_FACES_3D] : CAMERA_FACES).map((face) => (
                <Tile key={face} selected={settings.face === face} label={label("face", face)} onClick={() => pick("face", face)}>
                  {face === "none" ? NONE_ICON : FACE_ICONS[face]}
                </Tile>
              ))}
            </div>
          )}

          {tab === "warp" && hasWarp && (
            <div className="grid grid-cols-4 gap-2">
              {CAMERA_WARPS.map((warp) => (
                <Tile key={warp} selected={settings.warp === warp} label={label("warp", warp)} onClick={() => pick("warp", warp)}>
                  {warp === "none" ? NONE_ICON : WARP_ICONS[warp]}
                </Tile>
              ))}
            </div>
          )}

          {tab === "background" && (
            <>
              <div className="grid grid-cols-4 gap-2">
                {CAMERA_BACKGROUNDS.map((background) => (
                  <Tile
                    key={background}
                    selected={settings.background === background}
                    label={label("background", background)}
                    onClick={() => pick("background", background)}
                  >
                    {background === "none" ? NONE_ICON : <span className={`h-full w-full ${BACKGROUND_SWATCHES[background]}`} />}
                  </Tile>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                <CustomBackgroundChips selected={settings.background === "custom"} turnOn={turnOn} />
              </div>
              <StreamBackgroundPicker selected={settings.background === "stream"} turnOn={turnOn} />
            </>
          )}

          {tab === "color" && (
            <div className="grid grid-cols-4 gap-2">
              {CAMERA_COLORS.map((color) => (
                <Tile key={color} selected={settings.color === color} label={label("color", color)} onClick={() => pick("color", color)}>
                  {color === "none" ? NONE_ICON : <span className={`h-full w-full ${RAINBOW} ${COLOR_FILTERS[color]}`} />}
                </Tile>
              ))}
            </div>
          )}

          {tab === "reactions" && has3d && (
            <>
              <div className="grid grid-cols-4 gap-2">
                {CAMERA_REACTIONS.map((reactions) => (
                  <Tile
                    key={reactions}
                    selected={settings.reactions === reactions}
                    label={label("reactions", reactions)}
                    onClick={() => pick("reactions", reactions)}
                  >
                    {reactions === "none" ? NONE_ICON : "🎉"}
                  </Tile>
                ))}
              </div>
              <span className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                {t("watch.watchRoom.cameraEffectReactionsHint")}
              </span>
            </>
          )}
        </div>
      </div>
    </MobileSheet>
  );
}

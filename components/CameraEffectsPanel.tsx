"use client";

import { useRef, useState, type ReactNode } from "react";
import { MdAutoAwesome, MdLock, MdUpload } from "react-icons/md";
import { MenuToggleRow } from "@/components/MenuToggleRow";
import { NewBadge, markFeatureUsed } from "@/components/NewBadge";
import {
  CAMERA_BACKGROUNDS,
  CAMERA_COLORS,
  CAMERA_EFFECTS_3D_FEATURE,
  CAMERA_EFFECTS_FEATURE,
  CAMERA_FACES,
  CAMERA_FACES_3D,
  CAMERA_REACTIONS,
  CUSTOM_BACKGROUND_TIER,
  canUseCustomBackground,
  setCameraEffect,
  setCustomCameraBackground,
  useCameraEffectSettings,
  useCameraEffectsStatus,
  useCustomCameraBackground,
  type CameraEffectSettings,
} from "@/lib/cameraEffects";
import { setTileExperimentMode, trackTileExperiment, TILE_EXPERIMENT_EVENTS } from "@/lib/clipsMode";
import { useAuth } from "@/lib/AuthContext";
import { TIER_NAMES } from "@/lib/entitlements";
import { openProModal } from "@/lib/proModal";
import { useFeature } from "@/lib/features";
import { useT } from "@/lib/useI18n";

// "Efeitos de câmera": the switch and what to draw. On a computer it is the
// panel of its own button beside the camera's (`standalone`), where the
// choices are always shown and picking one turns the switch on. On a phone,
// where that button does not fit, it sits in the camera's panel (the arrow
// beside the camera button) and the choices only show behind the switch.
// Either way the switch is what costs nothing when off.

const LABELS: { [K in keyof CameraEffectSettings]: Record<CameraEffectSettings[K], string> } = {
  background: {
    none: "watch.watchRoom.cameraEffectNone",
    blur: "watch.watchRoom.cameraEffectBlur",
    sunset: "watch.watchRoom.cameraEffectSunset",
    beach: "watch.watchRoom.cameraEffectBeach",
    space: "watch.watchRoom.cameraEffectSpace",
    office: "watch.watchRoom.cameraEffectOffice",
    aurora: "watch.watchRoom.cameraEffectAurora",
    studio: "watch.watchRoom.cameraEffectStudio",
    custom: "watch.watchRoom.cameraEffectCustomBg",
  },
  color: {
    none: "watch.watchRoom.cameraEffectNone",
    mono: "watch.watchRoom.cameraEffectMono",
    sepia: "watch.watchRoom.cameraEffectSepia",
    vivid: "watch.watchRoom.cameraEffectVivid",
  },
  face: {
    none: "watch.watchRoom.cameraEffectNone",
    dog: "watch.watchRoom.cameraEffectDog",
    cat: "watch.watchRoom.cameraEffectCat",
    glasses: "watch.watchRoom.cameraEffectGlasses",
    clown: "watch.watchRoom.cameraEffectClown",
    crown: "watch.watchRoom.cameraEffectCrown",
    bunny: "watch.watchRoom.cameraEffectBunny",
    bear: "watch.watchRoom.cameraEffectBear",
    pig: "watch.watchRoom.cameraEffectPig",
    mustache: "watch.watchRoom.cameraEffectMustache",
    hearts: "watch.watchRoom.cameraEffectHearts",
    devil: "watch.watchRoom.cameraEffectDevil",
    angel: "watch.watchRoom.cameraEffectAngel",
    pirate: "watch.watchRoom.cameraEffectPirate",
    party: "watch.watchRoom.cameraEffectParty",
    glasses3d: "watch.watchRoom.cameraEffectGlasses3d",
    tophat3d: "watch.watchRoom.cameraEffectTopHat3d",
    viking3d: "watch.watchRoom.cameraEffectViking3d",
  },
  reactions: {
    none: "watch.watchRoom.cameraEffectReactionsOff",
    on: "watch.watchRoom.cameraEffectReactionsOn",
  },
};

const CHIP = "rounded-md px-2 py-1 text-xs font-medium transition";
const CHIP_ON = "bg-emerald-600 text-white";
const CHIP_OFF =
  "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700";

function EffectGroup<K extends keyof CameraEffectSettings>({
  name,
  title,
  options,
  value,
  turnOn,
  children,
}: {
  name: K;
  title: string;
  options: CameraEffectSettings[K][];
  value: CameraEffectSettings[K];
  // Set when picking an effect should also turn the switch on.
  turnOn?: () => void;
  // More chips after the plain choices (the custom background's).
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{title}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => {
              setCameraEffect(name, option);
              if (option !== "none") {
                markFeatureUsed(CAMERA_EFFECTS_FEATURE);
                turnOn?.();
              }
            }}
            className={`${CHIP} ${value === option ? CHIP_ON : CHIP_OFF}`}
          >
            {t((LABELS[name] as Record<string, string>)[option])}
          </button>
        ))}
        {children}
      </div>
    </div>
  );
}

// "Seu fundo": an image of the person's own, Pro Max and up. Below the plan it
// is still shown, locked, and opens the plans. With the plan and no image yet
// it asks for one; with one, it picks it, and a second chip swaps the image.
function CustomBackgroundChips({ selected, turnOn }: { selected: boolean; turnOn?: () => void }) {
  const t = useT();
  const { account } = useAuth();
  const allowed = canUseCustomBackground(account?.flags);
  const image = useCustomCameraBackground();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!allowed) {
    return (
      <button
        type="button"
        onClick={() => {
          trackTileExperiment(TILE_EXPERIMENT_EVENTS.cameraEffects.bgLocked);
          openProModal(CUSTOM_BACKGROUND_TIER);
        }}
        title={t("watch.watchRoom.cameraEffectCustomBgLocked", { plan: TIER_NAMES[CUSTOM_BACKGROUND_TIER] })}
        className={`${CHIP} ${CHIP_OFF} inline-flex items-center gap-1`}
      >
        <MdLock className="h-3 w-3 text-amber-500" />
        {t("watch.watchRoom.cameraEffectCustomBg")}
        <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
          {TIER_NAMES[CUSTOM_BACKGROUND_TIER]}
        </span>
      </button>
    );
  }

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFailed(false);
    try {
      await setCustomCameraBackground(file);
      markFeatureUsed(CAMERA_EFFECTS_FEATURE);
      turnOn?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
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
      {image && (
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => {
            setCameraEffect("background", "custom");
            markFeatureUsed(CAMERA_EFFECTS_FEATURE);
            turnOn?.();
          }}
          className={`${CHIP} ${selected ? CHIP_ON : CHIP_OFF} inline-flex items-center gap-1.5`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from this browser */}
          <img src={image} alt="" className="h-4 w-6 rounded-sm object-cover" />
          {t("watch.watchRoom.cameraEffectCustomBg")}
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={`${CHIP} ${CHIP_OFF} inline-flex items-center gap-1 disabled:opacity-50`}
      >
        <MdUpload className="h-3.5 w-3.5" />
        {busy
          ? t("watch.watchRoom.cameraEffectsLoading")
          : image
            ? t("watch.watchRoom.cameraEffectChangeBg")
            : t("watch.watchRoom.cameraEffectUploadBg")}
      </button>
      {failed && (
        <span className="w-full text-[11px] text-red-600 dark:text-red-400">
          {t("watch.watchRoom.cameraEffectBgError")}
        </span>
      )}
    </>
  );
}

export function CameraEffectsPanel({ on, standalone = false }: { on: boolean; standalone?: boolean }) {
  const t = useT();
  const settings = useCameraEffectSettings();
  const status = useCameraEffectsStatus();
  // Experiment "camera-effects-3d": the 3D faces after the others, and the
  // reactions. An exposure is this panel being shown to someone in it.
  const has3d = useFeature(CAMERA_EFFECTS_3D_FEATURE, { track: true }).enabled;
  const turnOn = standalone && !on ? () => setTileExperimentMode("cameraEffects", true) : undefined;
  return (
    <div className="flex flex-col">
      <MenuToggleRow
        label={t("watch.watchRoom.cameraEffects")}
        badge={<NewBadge id={CAMERA_EFFECTS_FEATURE} />}
        active={on}
        onToggle={() => setTileExperimentMode("cameraEffects", !on)}
        hint={t("watch.watchRoom.cameraEffectsHint")}
        activeIcon={<MdAutoAwesome className="h-4 w-4" />}
        inactiveIcon={<MdAutoAwesome className="h-4 w-4 opacity-50" />}
      />
      {(on || standalone) && (
        // Dimmed while the switch is off: what is highlighted is what will be
        // drawn once it is on, not what the room sees now.
        <div className={`flex flex-col gap-2 px-2 pb-2 ${on ? "" : "opacity-60"}`}>
          <EffectGroup
            name="face"
            title={t("watch.watchRoom.cameraEffectFace")}
            options={has3d ? [...CAMERA_FACES, ...CAMERA_FACES_3D] : CAMERA_FACES}
            value={settings.face}
            turnOn={turnOn}
          />
          {has3d && (
            <div className="flex flex-col gap-1">
              <EffectGroup
                name="reactions"
                title={t("watch.watchRoom.cameraEffectReactions")}
                options={CAMERA_REACTIONS}
                value={settings.reactions}
                turnOn={turnOn}
              />
              <span className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                {t("watch.watchRoom.cameraEffectReactionsHint")}
              </span>
            </div>
          )}
          <EffectGroup
            name="background"
            title={t("watch.watchRoom.cameraEffectBackground")}
            options={CAMERA_BACKGROUNDS}
            value={settings.background}
            turnOn={turnOn}
          >
            <CustomBackgroundChips selected={settings.background === "custom"} turnOn={turnOn} />
          </EffectGroup>
          <EffectGroup
            name="color"
            title={t("watch.watchRoom.cameraEffectColor")}
            options={CAMERA_COLORS}
            value={settings.color}
            turnOn={turnOn}
          />
          {status.failed ? (
            <span className="text-xs text-red-600 dark:text-red-400">
              {t("watch.watchRoom.cameraEffectsFailed")}
            </span>
          ) : status.loading ? (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("watch.watchRoom.cameraEffectsLoading")}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

"use client";

import { MdAutoAwesome } from "react-icons/md";
import { MenuToggleRow } from "@/components/MenuToggleRow";
import { NewBadge, markFeatureUsed } from "@/components/NewBadge";
import {
  CAMERA_BACKGROUNDS,
  CAMERA_COLORS,
  CAMERA_EFFECTS_FEATURE,
  CAMERA_FACES,
  setCameraEffect,
  useCameraEffectSettings,
  useCameraEffectsStatus,
  type CameraEffectSettings,
} from "@/lib/cameraEffects";
import { setTileExperimentMode } from "@/lib/clipsMode";
import { useT } from "@/lib/useI18n";

// "Efeitos de câmera" in the camera's panel (the arrow beside the camera
// button): the switch, and once it is on, what to draw. The switch is what
// costs nothing when off; the choices only show behind it.

const LABELS: { [K in keyof CameraEffectSettings]: Record<CameraEffectSettings[K], string> } = {
  background: {
    none: "watch.watchRoom.cameraEffectNone",
    blur: "watch.watchRoom.cameraEffectBlur",
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
  },
};

function EffectGroup<K extends keyof CameraEffectSettings>({
  name,
  title,
  options,
  value,
}: {
  name: K;
  title: string;
  options: CameraEffectSettings[K][];
  value: CameraEffectSettings[K];
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
              if (option !== "none") markFeatureUsed(CAMERA_EFFECTS_FEATURE);
            }}
            className={`rounded-md px-2 py-1 text-xs font-medium transition ${
              value === option
                ? "bg-emerald-600 text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            {t((LABELS[name] as Record<string, string>)[option])}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CameraEffectsPanel({ on }: { on: boolean }) {
  const t = useT();
  const settings = useCameraEffectSettings();
  const status = useCameraEffectsStatus();
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
      {on && (
        <div className="flex flex-col gap-2 px-2 pb-2">
          <EffectGroup
            name="face"
            title={t("watch.watchRoom.cameraEffectFace")}
            options={CAMERA_FACES}
            value={settings.face}
          />
          <EffectGroup
            name="background"
            title={t("watch.watchRoom.cameraEffectBackground")}
            options={CAMERA_BACKGROUNDS}
            value={settings.background}
          />
          <EffectGroup
            name="color"
            title={t("watch.watchRoom.cameraEffectColor")}
            options={CAMERA_COLORS}
            value={settings.color}
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

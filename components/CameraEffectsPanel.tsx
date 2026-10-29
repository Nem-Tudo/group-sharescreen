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
  turnOn,
}: {
  name: K;
  title: string;
  options: CameraEffectSettings[K][];
  value: CameraEffectSettings[K];
  // Set when picking an effect should also turn the switch on.
  turnOn?: () => void;
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

export function CameraEffectsPanel({ on, standalone = false }: { on: boolean; standalone?: boolean }) {
  const t = useT();
  const settings = useCameraEffectSettings();
  const status = useCameraEffectsStatus();
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
            options={CAMERA_FACES}
            value={settings.face}
            turnOn={turnOn}
          />
          <EffectGroup
            name="background"
            title={t("watch.watchRoom.cameraEffectBackground")}
            options={CAMERA_BACKGROUNDS}
            value={settings.background}
            turnOn={turnOn}
          />
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

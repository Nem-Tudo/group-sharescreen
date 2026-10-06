"use client";

import { MdGraphicEq } from "react-icons/md";
import {
  setSoundboardGlobalVolume,
  useSoundboardSnapshot,
} from "@/lib/soundboard";
import { useT } from "@/lib/useI18n";

export function SoundboardVolumeRow() {
  const t = useT();
  const soundboard = useSoundboardSnapshot();
  if (!soundboard.active) return null;

  return (
    <div className="-mx-1 mt-1 border-t border-zinc-200 px-3 pb-2 pt-2.5 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          <MdGraphicEq className="h-3.5 w-3.5 shrink-0" />
          {t("soundboard.effectsVolume")}
        </span>
        <span className="text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
          {Math.round(soundboard.globalVolume * 100)}%
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={soundboard.globalVolume}
        onChange={(event) => setSoundboardGlobalVolume(Number(event.target.value))}
        onDoubleClick={() => setSoundboardGlobalVolume(1)}
        aria-label={t("soundboard.effectsVolume")}
        className="mt-2 h-1.5 w-full cursor-pointer accent-emerald-600"
      />
      <p className="mt-1.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-500">
        {t("soundboard.doubleClickReset")}
      </p>
    </div>
  );
}

"use client";

import { MdCheck, MdGraphicEq } from "react-icons/md";
import { VolumeSlider } from "@/components/VolumeSlider";
import {
  setSoundboardPeerVolume,
  toggleSoundboardPeerMute,
  useSoundboardSnapshot,
} from "@/lib/soundboard";
import { useT } from "@/lib/useI18n";

const menuItem =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900";

export function SoundboardPeerVolumeControl({
  userId,
  name,
}: {
  userId: string;
  name: string;
}) {
  const t = useT();
  const soundboard = useSoundboardSnapshot();
  const hasRemoteSoundboard = soundboard.remoteCatalogs.some((catalog) => catalog.userId === userId);
  if (!soundboard.active || !userId || soundboard.selfUserId === userId || !hasRemoteSoundboard) return null;

  const volume = soundboard.peerVolumes[userId] ?? 1;
  const muted = soundboard.peerMuted[userId] === true;

  return (
    <>
      <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
      <p className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <MdGraphicEq className="h-3.5 w-3.5" />
        {t("soundboard.peerEffectsVolume")}
      </p>
      <div className="px-2 py-1">
        <VolumeSlider
          value={volume}
          label={t("soundboard.nameEffectsVolume", { name })}
          onChange={(next) => setSoundboardPeerVolume(userId, next)}
          muted={muted}
          onToggleMute={() => toggleSoundboardPeerMute(userId)}
          max={1}
          className="w-full text-zinc-500 dark:text-zinc-400"
        />
      </div>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={muted}
        onClick={() => toggleSoundboardPeerMute(userId)}
        className={menuItem}
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            muted
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-zinc-300 dark:border-zinc-600"
          }`}
        >
          {muted && <MdCheck className="h-3 w-3" />}
        </span>
        {t("soundboard.muteEffects")}
      </button>
    </>
  );
}

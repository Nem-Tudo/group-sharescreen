"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { FaYoutube } from "react-icons/fa";
import { MdMusicNote, MdFolderOpen } from "react-icons/md";
import { parseMusicUrl } from "@/lib/musicSource";
import { BetaMark } from "./BetaMark";
import { LocalMediaPicker } from "./LocalMediaPicker";
import type { LocalMediaSlot } from "@/lib/localMediaSource";

export type AddMusicSourcePopupData = {
  onSubmit: (url: string, controlMode: "owner" | "anyone") => void;
  // Music off this person's own disk. A separate callback because it is a
  // separate mechanism underneath: a YouTube link becomes the room's music
  // record (everyone embeds it, one timestamp keeps them together), while
  // files nobody else has are played here and broadcast — see
  // lib/localMediaSource.ts.
  onLocalFiles: (slot: LocalMediaSlot) => void;
  // The slot those files go into, or null when all of them are busy — see
  // nextFreeLocalMediaSlot.
  localFilesSlot: LocalMediaSlot | null;
  // See AddVideoSourceModal's prop of the same name.
  hasAccount: boolean;
  // See LocalMediaPicker's prop of the same name.
  localFilesBlockedReason?: string | null;
  // True when the room already has music. Setting replaces it — there is only
  // one soundtrack — and that is worth saying before the click rather than
  // after, since the person replacing it is rarely the person who put it on.
  replacing?: boolean;
};

// The popup behind "Colocar música" (see WatchRoom.tsx) — an ntpopups popup
// type, registered as "add_music_source" in NtPopups.tsx.
//
// Two origins, and they are genuinely different things rather than two spellings
// of one: a YouTube link becomes a shared record everyone plays from, while
// files off this disk are played here and broadcast. The choice comes first and
// the rest of the form follows it, same shape as the video picker's platform
// row. No Spotify or Deezer — see lib/musicSource.ts for why their embeds
// can't carry a room.
export function AddMusicSourceModal({
  closePopup,
  data: { onSubmit, onLocalFiles, localFilesSlot, localFilesBlockedReason, hasAccount, replacing = false },
}: {
  closePopup: (hasAction?: boolean) => void;
  data: AddMusicSourcePopupData;
}) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<"youtube" | "local">("youtube");
  const local = origin === "local";
  // Who drives the room's soundtrack. Its restricted mode is the room's
  // management rather than one person — an admin who did not choose the
  // playlist can still skip a track — which is why the labels below say that
  // instead of borrowing a video source's "só eu".
  const [controlMode, setControlMode] = useState<"owner" | "anyone">("owner");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const raw = link.trim();
    if (!raw) return;
    // Only to catch an obvious paste mistake without a round trip — the
    // server parses it again, and its answer is what everyone plays.
    if (!parseMusicUrl(raw)) {
      setError("Cole um link de vídeo ou playlist do YouTube.");
      return;
    }
    onSubmit(raw, controlMode);
    closePopup(true);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-4 bg-white p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <MdMusicNote className="h-4 w-4 shrink-0 text-emerald-600" />
          <BetaMark /> {replacing ? "Trocar a música da sala" : "Colocar música na sala"}
        </p>
        <button
          type="button"
          onClick={() => closePopup(false)}
          aria-label="Fechar"
          className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
        >
          ×
        </button>
      </div>

      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        A música toca para todo mundo na sala, numa barrinha acima do vídeo, e só o dono e os
        administradores controlam.
        {replacing && !local && (
          <>
            {" "}
            <span className="font-medium text-amber-600 dark:text-amber-500">
              Isso substitui a música que está tocando agora.
            </span>
          </>
        )}
      </p>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">De onde</p>
        <div className="grid grid-cols-2 gap-2">
          <OriginButton
            selected={!local}
            onClick={() => {
              setOrigin("youtube");
              setError(null);
            }}
            icon={<FaYoutube className="h-4 w-4 shrink-0" />}
            label="YouTube"
            activeClassName="border-red-600 bg-red-600/10 text-red-600 dark:text-red-500"
          />
          <OriginButton
            selected={local}
            onClick={() => {
              setOrigin("local");
              setError(null);
            }}
            icon={<MdFolderOpen className="h-4 w-4 shrink-0" />}
            label="Do computador"
            activeClassName="border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400"
          />
        </div>
      </div>

      {!local && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Quem pode controlar</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="music-control-mode"
              checked={controlMode === "owner"}
              onChange={() => setControlMode("owner")}
            />
            Só o dono e os administradores
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="music-control-mode"
              checked={controlMode === "anyone"}
              onChange={() => setControlMode("anyone")}
            />
            Todos podem controlar
          </label>
        </div>
      )}

      {local ? (
        <LocalMediaPicker
          mode="music"
          blockedReason={localFilesBlockedReason}
          slot={localFilesSlot}
          hasAccount={hasAccount}
          onReady={(slot) => {
            onLocalFiles(slot);
            closePopup(true);
          }}
        />
      ) : (
        <>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Cole um vídeo ou, melhor ainda, uma playlist: aí a sala ganha uma fila em vez de uma
          faixa só.
        </p>
        <input
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setError(null);
          }}
          autoFocus
          placeholder="https://youtube.com/playlist?list=..."
          aria-label="Link da música"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      <button
        type="submit"
        disabled={!link.trim()}
        className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {replacing ? "Trocar música" : "Colocar música"}
      </button>
        </>
      )}
    </form>
  );
}

function OriginButton({
  selected,
  onClick,
  icon,
  label,
  activeClassName,
}: {
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  activeClassName: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition ${
        selected
          ? activeClassName
          : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

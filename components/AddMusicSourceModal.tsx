"use client";

import { useState, type FormEvent } from "react";
import { FaYoutube } from "react-icons/fa";
import { MdMusicNote } from "react-icons/md";
import { parseMusicUrl } from "@/lib/musicSource";
import { BetaMark } from "./BetaMark";

export type AddMusicSourcePopupData = {
  onSubmit: (url: string) => void;
  // True when the room already has music. Setting replaces it — there is only
  // one soundtrack — and that is worth saying before the click rather than
  // after, since the person replacing it is rarely the person who put it on.
  replacing?: boolean;
};

// The popup behind "Colocar música" (see WatchRoom.tsx) — an ntpopups popup
// type, registered as "add_music_source" in NtPopups.tsx.
//
// One platform, so no platform picker: YouTube is the only embed that gives a
// room both full transport control and a position to synchronize on. See
// lib/musicSource.ts for why Spotify and Deezer don't currently qualify.
export function AddMusicSourceModal({
  closePopup,
  data: { onSubmit, replacing = false },
}: {
  closePopup: (hasAction?: boolean) => void;
  data: AddMusicSourcePopupData;
}) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    onSubmit(raw);
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
        A música toca para todo mundo na sala, no mesmo ponto, numa barrinha acima do vídeo — e só
        o dono e os administradores controlam. Cole um vídeo do YouTube ou, melhor ainda, uma
        playlist: aí a sala ganha uma fila em vez de uma faixa só.
        {replacing && (
          <>
            {" "}
            <span className="font-medium text-amber-600 dark:text-amber-500">
              Isso substitui a música que está tocando agora.
            </span>
          </>
        )}
      </p>

      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          <FaYoutube className="h-3.5 w-3.5 shrink-0 text-red-600" />
          Link do YouTube
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
    </form>
  );
}

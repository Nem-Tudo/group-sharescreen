"use client";

import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { MdClose, MdShuffle, MdPlayArrow, MdVolumeUp } from "react-icons/md";
import { useT } from "@/lib/useI18n";
import { useYouTubeTitles, youtubeThumbnail } from "@/lib/youtubeTitles";
import { playbackOrder } from "@/lib/musicShuffle";

// A aba da playlist, na direita da tela.
//
// Por que uma gaveta e não uma lista dentro da barra: a barra é uma faixa de
// uma linha em cima de tudo que a sala está olhando, e uma playlist tem
// dezenas de itens. Empurrar a lista para fora, por cima da lateral, é o único
// jeito de mostrá-la sem tirar espaço das pessoas e das telas.
//
// Ela é puramente uma *vista* do player: os itens vêm de getPlaylist() e o que
// um clique faz é o mesmo que o botão de próxima faz — escolher um índice, que
// viaja para a sala pelo caminho de sempre (ver MusicBar).

export function MusicQueuePanel({
  open,
  onClose,
  videoIds,
  currentIndex,
  currentVideoId,
  order,
  shuffle,
  canShuffle,
  onToggleShuffle,
  canControl,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** Os ids da playlist carregada, na ordem original do YouTube. */
  videoIds: string[];
  /** O índice tocando agora, na ordem original. -1 antes de carregar. */
  currentIndex: number;
  currentVideoId: string | null;
  /** A permutação da ordem aleatória (ver lib/musicShuffle). */
  order: number[];
  shuffle: boolean;
  canShuffle: boolean;
  onToggleShuffle: () => void;
  canControl: boolean;
  onPick: (index: number) => void;
}) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const titles = useYouTubeTitles(open ? videoIds : []);

  // A lista na ordem em que vai tocar: com o modo aleatório ligado, mostrar a
  // ordem original seria mentira — a pessoa quer saber qual é a próxima.
  const rows = useMemo(
    () => playbackOrder(order, videoIds.length, shuffle),
    [order, videoIds.length, shuffle]
  );

  // Abrir a aba no meio de uma playlist longa e cair no item 1 não ajuda
  // ninguém: ela rola até o que está tocando.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector('[data-current="true"]');
    node?.scrollIntoView({ block: "center" });
  }, [open, currentIndex, shuffle]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Fora do celular a gaveta convive com a sala (dá para continuar vendo
          quem está falando), então o véu só existe onde ela cobre tudo. */}
      {open && (
        <div
          className="fixed inset-0 z-[70] bg-black/40 sm:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-[71] flex h-full w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-200 sm:w-80 dark:border-slate-700 dark:bg-slate-900 ${
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        }`}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t("musicBar.queueTitle")}
            <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
              {videoIds.length > 0 ? t("musicBar.queueCount", { count: videoIds.length }) : ""}
            </span>
          </h2>
          {canShuffle && (
            <button
              type="button"
              onClick={onToggleShuffle}
              disabled={!canControl}
              aria-pressed={shuffle}
              title={shuffle ? t("musicBar.shuffleOn") : t("musicBar.shuffleOff")}
              className={`flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                shuffle
                  ? "bg-sky-600 text-white hover:bg-sky-700"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              <MdShuffle className="h-4 w-4" />
              {t("musicBar.shuffle")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </header>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {videoIds.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              {t("musicBar.queueLoading")}
            </p>
          ) : (
            rows.map((index, position) => {
              const videoId = videoIds[index];
              const info = titles.get(videoId);
              // O índice do player é a verdade quando ele já carregou; antes
              // disso, o id do vídeo que está tocando ainda identifica a linha.
              const isCurrent =
                index === currentIndex || (currentIndex < 0 && videoId === currentVideoId);
              return (
                <button
                  key={`${videoId}:${index}`}
                  type="button"
                  data-current={isCurrent ? "true" : undefined}
                  disabled={!canControl}
                  onClick={() => onPick(index)}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left transition disabled:cursor-default ${
                    isCurrent
                      ? "bg-sky-50 dark:bg-sky-950/40"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  <span className="w-5 shrink-0 text-center font-mono text-[11px] tabular-nums text-slate-400">
                    {isCurrent ? (
                      <MdVolumeUp className="mx-auto h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                    ) : (
                      position + 1
                    )}
                  </span>
                  <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={youtubeThumbnail(videoId)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    {canControl && !isCurrent && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition hover:bg-black/40 hover:opacity-100">
                        <MdPlayArrow className="h-5 w-5" />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-xs font-medium ${
                        isCurrent
                          ? "text-sky-700 dark:text-sky-300"
                          : "text-slate-800 dark:text-slate-100"
                      }`}
                    >
                      {info?.title ?? t("musicBar.queueTrackNumber", { number: index + 1 })}
                    </span>
                    {info?.author && (
                      <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {info.author}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {!canControl && videoIds.length > 0 && (
          <p className="shrink-0 border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {t("musicBar.queueReadOnly")}
          </p>
        )}
      </aside>
    </>,
    document.body
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MdClose,
  MdShuffle,
  MdPlayArrow,
  MdVolumeUp,
  MdDragIndicator,
  MdDelete,
  MdAdd,
} from "react-icons/md";
import { useT } from "@/lib/useI18n";
import { useYouTubeTitles, youtubeThumbnail } from "@/lib/youtubeTitles";
import { signalingClient } from "@/lib/signalingClient";
import { musicPlayOrder, parseMusicUrl, type MusicSource, type MusicTrack } from "@/lib/musicSource";
import { importSpotifyPlaylist, looksLikeSpotifyUrl } from "@/lib/musicImportApi";
import { TILE_EXPERIMENT_EVENTS, trackTileExperiment } from "@/lib/clipsMode";
import { markFeatureUsed } from "@/components/NewBadge";

// A fila da sala, na direita da tela.
//
// Por que uma gaveta e não uma lista dentro da barra: a barra é uma faixa de
// uma linha em cima de tudo que a sala está olhando, e uma fila tem dezenas de
// itens. Empurrar a lista para fora, por cima da lateral, é o único jeito de
// mostrá-la sem tirar espaço das pessoas e das telas.
//
// Ela é uma vista da fila do servidor, e nada aqui decide nada: clicar,
// arrastar e remover mandam mensagens, e o que aparece é o que voltou. As
// permissões desenhadas aqui são as mesmas que o servidor enforça (ver
// canControlMusic/canAddMusic) — esta é a cópia bonita da regra, não a regra.

export function MusicQueuePanel({
  open,
  onClose,
  music,
  currentVideoId,
  canControl,
  canAdd,
  selfUserId,
  onToggleShuffle,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  music: MusicSource;
  /** O vídeo que o player desta pessoa tem no ar, antes da fila existir. */
  currentVideoId: string | null;
  canControl: boolean;
  canAdd: boolean;
  selfUserId: string | null;
  onToggleShuffle: () => void;
  onPick: (trackId: string) => void;
}) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // O id sendo arrastado, e sobre qual linha ele está agora. Guardado aqui em
  // vez de no dataTransfer porque o Firefox só entrega o dataTransfer no drop.
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const tracks = useMemo(() => musicPlayOrder(music), [music]);
  const currentTrackId = (music.queue ?? [])[music.queueIndex ?? 0]?.id ?? null;
  const titles = useYouTubeTitles(open ? tracks.map((track) => track.videoId) : []);

  // Abrir a aba no meio de uma fila longa e cair no item 1 não ajuda ninguém:
  // ela rola até o que está tocando.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector('[data-current="true"]');
    node?.scrollIntoView({ block: "center" });
  }, [open, currentTrackId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // O aviso ("importando…", "3 músicas não foram achadas") some sozinho; é
  // recado, não estado.
  useEffect(() => {
    if (!notice || busy) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice, busy]);

  async function submitAdd(event: React.FormEvent) {
    event.preventDefault();
    const url = adding.trim();
    if (!url || busy) return;

    // Spotify: o servidor lê a lista de faixas e acha cada música no YouTube
    // (ver lib/musicImportApi). Demora segundos, então a caixa fica ocupada e
    // diz o que está fazendo.
    if (looksLikeSpotifyUrl(url)) {
      setBusy(true);
      setNotice(t("musicBar.importing"));
      const result = await importSpotifyPlaylist(url);
      setBusy(false);
      if ("error" in result) {
        setNotice(t(`musicBar.importError.${result.error}`));
        return;
      }
      signalingClient.addMusicToQueue({ tracks: result.tracks });
      trackTileExperiment(TILE_EXPERIMENT_EVENTS.musicQueue.spotify, result.tracks.length);
      markFeatureUsed("room-music-queue");
      setAdding("");
      setNotice(
        result.missing.length > 0
          ? t("musicBar.importedWithMissing", {
              count: result.tracks.length,
              missing: result.missing.length,
            })
          : t("musicBar.imported", { count: result.tracks.length })
      );
      return;
    }

    if (!parseMusicUrl(url)) {
      setNotice(t("musicBar.addInvalid"));
      return;
    }
    signalingClient.addMusicToQueue({ url });
    trackTileExperiment(TILE_EXPERIMENT_EVENTS.musicQueue.add);
    markFeatureUsed("room-music-queue");
    setAdding("");
  }

  function drop(targetId: string) {
    const from = dragging;
    setDragging(null);
    setDragOver(null);
    if (!from || from === targetId) return;
    const to = tracks.findIndex((track) => track.id === targetId);
    if (to < 0) return;
    signalingClient.moveMusicInQueue(from, to);
    trackTileExperiment(TILE_EXPERIMENT_EVENTS.musicQueue.move);
  }

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
              {tracks.length > 0 ? t("musicBar.queueCount", { count: tracks.length }) : ""}
            </span>
          </h2>
          <button
            type="button"
            onClick={onToggleShuffle}
            disabled={!canControl || tracks.length < 2}
            aria-pressed={music.shuffle ?? false}
            title={music.shuffle ? t("musicBar.shuffleOn") : t("musicBar.shuffleOff")}
            className={`flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              music.shuffle
                ? "bg-sky-600 text-white hover:bg-sky-700"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <MdShuffle className="h-4 w-4" />
            {t("musicBar.shuffle")}
          </button>
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
          {tracks.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              {music.playlistId ? t("musicBar.queueLoading") : t("musicBar.queueEmpty")}
            </p>
          ) : (
            tracks.map((track, position) => (
              <QueueRow
                key={track.id}
                track={track}
                position={position}
                // Antes da fila existir (um vídeo só), o que identifica a linha
                // tocando é o vídeo que o player tem no ar.
                current={
                  track.id === currentTrackId ||
                  (currentTrackId === null && track.videoId === currentVideoId)
                }
                title={titles.get(track.videoId)?.title}
                author={titles.get(track.videoId)?.author}
                canControl={canControl}
                canDrag={canAdd}
                canRemove={canControl || track.addedById === selfUserId}
                dragging={dragging === track.id}
                dragOver={dragOver === track.id}
                onPick={() => onPick(track.id)}
                onRemove={() => {
                  signalingClient.removeMusicFromQueue(track.id);
                  trackTileExperiment(TILE_EXPERIMENT_EVENTS.musicQueue.remove);
                }}
                onDragStart={() => setDragging(track.id)}
                onDragEnter={() => setDragOver(track.id)}
                onDragEnd={() => {
                  setDragging(null);
                  setDragOver(null);
                }}
                onDrop={() => drop(track.id)}
                t={t}
              />
            ))
          )}
        </div>

        {notice && (
          <p className="shrink-0 border-t border-slate-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-800 dark:border-slate-700 dark:bg-sky-950/40 dark:text-sky-200">
            {notice}
          </p>
        )}

        {canAdd ? (
          <form
            onSubmit={submitAdd}
            className="flex shrink-0 items-center gap-2 border-t border-slate-200 p-2 dark:border-slate-700"
          >
            <input
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              disabled={busy}
              placeholder={t("musicBar.addPlaceholder")}
              aria-label={t("musicBar.addPlaceholder")}
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={busy || !adding.trim()}
              aria-label={t("musicBar.addToQueue")}
              className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-sky-600 px-2 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <MdAdd className="h-4 w-4" />
              {t("musicBar.addToQueue")}
            </button>
          </form>
        ) : (
          <p className="shrink-0 border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {t("musicBar.queueReadOnly")}
          </p>
        )}
      </aside>
    </>,
    document.body
  );
}

function QueueRow({
  track,
  position,
  current,
  title,
  author,
  canControl,
  canDrag,
  canRemove,
  dragging,
  dragOver,
  onPick,
  onRemove,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
  t,
}: {
  track: MusicTrack;
  position: number;
  current: boolean;
  title?: string;
  author?: string;
  canControl: boolean;
  canDrag: boolean;
  canRemove: boolean;
  dragging: boolean;
  dragOver: boolean;
  onPick: () => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div
      data-current={current ? "true" : undefined}
      draggable={canDrag}
      onDragStart={(event) => {
        // Sem isto o Firefox não começa o arrasto; o conteúdo em si não é
        // lido por ninguém (ver `dragging` no painel).
        event.dataTransfer.setData("text/plain", track.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(event) => {
        if (!canDrag) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={onDragEnter}
      onDragEnd={onDragEnd}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className={`group flex items-center gap-2 px-2 py-1.5 transition ${
        current
          ? "bg-sky-50 dark:bg-sky-950/40"
          : dragOver
            ? "bg-sky-100 dark:bg-sky-900/40"
            : "hover:bg-slate-100 dark:hover:bg-slate-800"
      } ${dragging ? "opacity-40" : ""}`}
    >
      {canDrag ? (
        <span
          aria-hidden="true"
          className="shrink-0 cursor-grab text-slate-300 active:cursor-grabbing dark:text-slate-600"
        >
          <MdDragIndicator className="h-4 w-4" />
        </span>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <span className="w-5 shrink-0 text-center font-mono text-[11px] tabular-nums text-slate-400">
        {current ? (
          <MdVolumeUp className="mx-auto h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
        ) : (
          position + 1
        )}
      </span>
      <button
        type="button"
        disabled={!canControl}
        onClick={onPick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
      >
        <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={youtubeThumbnail(track.videoId)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
          {canControl && !current && (
            <span className="absolute inset-0 flex items-center justify-center text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
              <MdPlayArrow className="h-5 w-5" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-xs font-medium ${
              current ? "text-sky-700 dark:text-sky-300" : "text-slate-800 dark:text-slate-100"
            }`}
          >
            {/* O título do próprio registro (o que a importação do Spotify
                sabia) vem antes do que o oEmbed devolve: ele é o nome da
                música, e o do vídeo costuma ter "official video" junto. */}
            {track.title ?? title ?? t("musicBar.queueTrackNumber", { number: position + 1 })}
          </span>
          <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
            {track.addedByName
              ? t("musicBar.addedBy", { name: track.addedByName })
              : (author ?? "")}
          </span>
        </span>
      </button>
      {canRemove && !current && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("musicBar.removeFromQueue")}
          className="shrink-0 rounded p-1 text-slate-400 opacity-0 transition hover:bg-slate-200 hover:text-red-600 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-slate-700"
        >
          <MdDelete className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

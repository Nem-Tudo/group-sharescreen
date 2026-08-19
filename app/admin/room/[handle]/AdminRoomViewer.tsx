"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAdminToken, adminLogout } from "@/lib/adminApi";
import { useAdminRoomViewer } from "@/lib/useAdminRoomViewer";
import { isPrivateRoomHandle } from "@/lib/roomsApi";
import { VideoTile, StoppedPeerTile, ResumingPeerTile } from "@/components/VideoTile";
import { RemoteAudio } from "@/components/RemoteAudio";
import { ParticipantRow } from "@/components/ParticipantRow";
import { ChatPanel } from "@/components/ChatPanel";
import { ViewerVolumeControl } from "@/components/ViewerVolumeControl";

export function AdminRoomViewer({ handle }: { handle: string }) {
  const router = useRouter();
  const token = useAdminToken();
  const [mutedPeerIds, setMutedPeerIds] = useState<Set<string>>(new Set());
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});

  const {
    status,
    error,
    peers,
    chatMessages,
    selfId,
    screenStreams,
    micStreams,
    stoppedScreenPeers,
    resumingScreenPeers,
    stopWatchingScreenPeer,
    resumeWatchingScreenPeer,
  } = useAdminRoomViewer(handle, token);

  useEffect(() => {
    if (status !== "unauthorized") return;
    adminLogout();
    router.replace("/admin");
  }, [status, router]);

  function togglePeerMute(peerId: string) {
    setMutedPeerIds((prev) => {
      const next = new Set(prev);
      if (next.has(peerId)) next.delete(peerId);
      else next.add(peerId);
      return next;
    });
  }

  function setPeerVolume(peerId: string, volume: number) {
    setPeerVolumes((prev) => ({ ...prev, [peerId]: volume }));
  }

  if (!token) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Você precisa entrar como moderador primeiro.
        </p>
        <Link href="/admin" className="text-sm font-medium underline underline-offset-4">
          Ir para a moderação
        </Link>
      </div>
    );
  }

  const screenEntries = Object.entries(screenStreams);
  // Mirrors WatchRoom's placeholder handling: a peer the moderator stopped
  // watching (or is waiting to resume) has no entry in screenStreams (the
  // connection is closed to save resources) but still gets a tile slot.
  const stoppedEntries = peers.filter(
    (p) => stoppedScreenPeers.has(p.id) && !(p.id in screenStreams)
  );
  const resumingEntries = peers.filter(
    (p) => resumingScreenPeers.has(p.id) && !(p.id in screenStreams)
  );
  const isSingleTile = screenEntries.length + stoppedEntries.length + resumingEntries.length === 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{handle}</h1>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium text-white ${
              isPrivateRoomHandle(handle) ? "bg-red-600" : "bg-emerald-600"
            }`}
          >
            {isPrivateRoomHandle(handle) ? "Sala privada" : "Sala pública"}
          </span>
          <span className="rounded-full bg-amber-500/90 px-2.5 py-1 text-xs font-medium text-white">
            Modo moderação — invisível para os participantes
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {screenEntries.map(([peerId, stream]) => (
            <ViewerVolumeControl
              key={`${peerId}:${stream.id}`}
              stream={stream}
              label={peers.find((peer) => peer.id === peerId)?.name ?? "Alguém"}
              showLabel={screenEntries.length > 1}
            />
          ))}
          <Link
            href="/admin"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Parar de visualizar
          </Link>
        </div>
      </header>

      {status === "closed" && (
        <p className="bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          Conexão de moderação encerrada.
        </p>
      )}
      {error && (
        <p className="bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}

      {Object.entries(micStreams).map(([peerId, stream]) => (
        <RemoteAudio
          key={peerId}
          stream={stream}
          muted={mutedPeerIds.has(peerId)}
          volume={peerVolumes[peerId] ?? 1}
        />
      ))}

      <div className="flex min-h-0 flex-1 flex-col gap-6 p-4 lg:flex-row">
        <main className="min-h-0 flex-1 overflow-y-auto">
          {screenEntries.length === 0 && stoppedEntries.length === 0 && resumingEntries.length === 0 ? (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 text-center dark:border-zinc-800">
              <p className="text-zinc-600 dark:text-zinc-400">
                Ninguém está compartilhando tela nesta sala no momento.
              </p>
            </div>
          ) : (
            <div
              className={
                isSingleTile
                  ? // No min-height floor: on a short viewport that floor
                    // could force this taller than what main actually has,
                    // which is what pushed the tile past the bottom of the
                    // screen and forced a scroll.
                    "h-full"
                  : "grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-3"
              }
            >
              {screenEntries.map(([peerId, stream]) => {
                const peerName = peers.find((p) => p.id === peerId)?.name ?? "Alguém";
                return (
                  <VideoTile
                    key={peerId}
                    stream={stream}
                    label={peerName}
                    badge="ao vivo"
                    muted
                    viewerAudioControls
                    fill={isSingleTile}
                    onStopWatching={() => stopWatchingScreenPeer(peerId)}
                  />
                );
              })}
              {stoppedEntries.map((peer) => (
                <StoppedPeerTile
                  key={peer.id}
                  label={peer.name}
                  fill={isSingleTile}
                  onResume={() => resumeWatchingScreenPeer(peer.id)}
                />
              ))}
              {resumingEntries.map((peer) => (
                <ResumingPeerTile key={peer.id} fill={isSingleTile} />
              ))}
            </div>
          )}
        </main>

        <aside className="w-full shrink-0 lg:w-64">
          {(status === "connecting" || status === "closed") && (
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              Conectando...
            </p>
          )}
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Participantes
          </h2>
          <ul className="flex flex-col gap-1.5">
            {peers.map((p) => (
              <ParticipantRow
                key={p.id}
                name={p.name}
                micOn={p.mic}
                sharing={p.sharing}
                micStream={micStreams[p.id]}
                muted={mutedPeerIds.has(p.id)}
                onToggleMute={() => togglePeerMute(p.id)}
                volume={peerVolumes[p.id] ?? 1}
                onVolumeChange={(volume) => setPeerVolume(p.id, volume)}
              />
            ))}
            {peers.length === 0 && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Ninguém na sala.</p>
            )}
          </ul>

          <ChatPanel messages={chatMessages} selfId={selfId} />
        </aside>
      </div>
    </div>
  );
}

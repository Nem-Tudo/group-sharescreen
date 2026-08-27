"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAdminToken, adminLogout } from "@/lib/adminApi";
import { useAdminRoomViewer } from "@/lib/useAdminRoomViewer";
import { isPrivateRoomHandle } from "@/lib/roomsApi";
import {
  getStoredPeerVolumes,
  setStoredPeerVolume,
  getStoredTransmissionVolumes,
  setStoredTransmissionVolume,
} from "@/lib/mediaPreferences";
import { VideoTile, StoppedPeerTile, ResumingPeerTile } from "@/components/VideoTile";
import { VideoSourceTile } from "@/components/VideoSourceTile";
import { videoSourceVolumeKey } from "@/lib/videoSource";
import { adminSignalingClient } from "@/lib/adminClient";
import { RemoteAudio } from "@/components/RemoteAudio";
import { ParticipantRow } from "@/components/ParticipantRow";
import { ChatPanel } from "@/components/ChatPanel";
import { DisplayUserName } from "@/components/DisplayUserName";
import { MdHome } from "react-icons/md";

// The moderation socket's clock, for the embedded video sources below.
// Arrow-wrapped rather than passed as a bare method reference, which would
// arrive with no `this` and throw on its own field.
const adminServerNow = () => adminSignalingClient.serverNow();

export function AdminRoomViewer({ handle }: { handle: string }) {
  const router = useRouter();
  const token = useAdminToken();
  const [mutedPeerIds, setMutedPeerIds] = useState<Set<string>>(new Set());
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>(() => getStoredPeerVolumes());
  const [transmissionVolumes, setTransmissionVolumes] = useState<Record<string, number>>(() =>
    getStoredTransmissionVolumes()
  );
  // Mirrors WatchRoom's double-click-to-focus — a moderator watching a busy
  // room benefits from the same "zoom in on one stream" escape hatch a
  // regular participant gets.
  const [focusedPeerId, setFocusedPeerId] = useState<string | null>(null);
  // Video sources this moderator stepped out of, exactly like WatchRoom's
  // state of the same name: purely local, the room never hears about it, and
  // the tile is replaced by the same "you left this" placeholder a stopped
  // transmission gets so there's a way back in. Worth having here because a
  // moderator looking into a busy room may want the embedded video out of
  // the way to see the actual transmissions.
  const [leftVideoSourceIds, setLeftVideoSourceIds] = useState<Set<string>>(new Set());

  const {
    status,
    error,
    peers,
    chatMessages,
    videoSources,
    selfId,
    screenStreams,
    cameraStreams,
    micStreams,
    stoppedScreenPeers,
    resumingScreenPeers,
    stopWatchingScreenPeer,
    resumeWatchingScreenPeer,
    stoppedCameraPeers,
    resumingCameraPeers,
    stopWatchingCameraPeer,
    resumeWatchingCameraPeer,
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

  // Keyed by the peer's stable userId (falling back to their connection id)
  // — same persistence scheme as WatchRoom, so a moderator's volume dials
  // for a given person survive a reload too.
  function setPeerVolume(volumeKey: string, volume: number) {
    setPeerVolumes((prev) => ({ ...prev, [volumeKey]: volume }));
    setStoredPeerVolume(volumeKey, volume);
  }

  function setTransmissionVolume(volumeKey: string, volume: number) {
    setTransmissionVolumes((prev) => ({ ...prev, [volumeKey]: volume }));
    setStoredTransmissionVolume(volumeKey, volume);
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

  // Mirrors WatchRoom's helper of the same name: a room video source belongs
  // to whoever added it (by stable userId), and that person is also the only
  // one who can play/pause it.
  function peerSharesVideo(userId: string | null | undefined): boolean {
    if (!userId) return false;
    return videoSources.some((v) => v.addedById === userId);
  }

  const screenEntries = Object.entries(screenStreams);
  const cameraEntries = Object.entries(cameraStreams);
  const focusedScreenEntries = focusedPeerId
    ? screenEntries.filter(([peerId]) => peerId === focusedPeerId)
    : screenEntries;
  const focusedCameraEntries = focusedPeerId
    ? cameraEntries.filter(([peerId]) => peerId === focusedPeerId)
    : cameraEntries;
  const hasMultipleShares =
    screenEntries.length + cameraEntries.length + videoSources.length > 1;
  // Mirrors WatchRoom's placeholder handling: a peer the moderator stopped
  // watching (or is waiting to resume) has no entry in screenStreams/
  // cameraStreams (the connection is closed to save resources) but still
  // gets a tile slot.
  const stoppedScreenEntries = peers.filter(
    (p) => stoppedScreenPeers.has(p.id) && !(p.id in screenStreams)
  );
  const resumingScreenEntries = peers.filter(
    (p) => resumingScreenPeers.has(p.id) && !(p.id in screenStreams)
  );
  const stoppedCameraEntries = peers.filter(
    (p) => stoppedCameraPeers.has(p.id) && !(p.id in cameraStreams)
  );
  const resumingCameraEntries = peers.filter(
    (p) => resumingCameraPeers.has(p.id) && !(p.id in cameraStreams)
  );
  // Room video sources are tiles here in the same sense they are in
  // WatchRoom: they take a grid slot and count toward "is there anything on
  // screen", the only difference being that nobody is transmitting them.
  // Hidden entirely while focused on one peer's stream, for the same reason
  // the other peers' tiles are.
  const watchedVideoSources = videoSources.filter((v) => !leftVideoSourceIds.has(v.id));
  const visibleVideoSources = focusedPeerId ? [] : watchedVideoSources;
  const leftVideoSources = focusedPeerId
    ? []
    : videoSources.filter((v) => leftVideoSourceIds.has(v.id));
  const nothingToShow =
    screenEntries.length === 0 &&
    cameraEntries.length === 0 &&
    videoSources.length === 0 &&
    stoppedScreenEntries.length === 0 &&
    resumingScreenEntries.length === 0 &&
    stoppedCameraEntries.length === 0 &&
    resumingCameraEntries.length === 0;
  const tileCount =
    focusedScreenEntries.length +
    focusedCameraEntries.length +
    visibleVideoSources.length +
    leftVideoSources.length +
    stoppedScreenEntries.length +
    resumingScreenEntries.length +
    stoppedCameraEntries.length +
    resumingCameraEntries.length;
  const isSingleTile = tileCount === 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            <MdHome />
          </Link>
          <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{handle}</h1>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium text-white ${
              isPrivateRoomHandle(handle) ? "bg-red-600" : "bg-emerald-600"
            }`}
          >
            {isPrivateRoomHandle(handle) ? "Sala privada" : "Sala pública"}
          </span>
          <span className="rounded-full bg-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {peers.length} {peers.length === 1 ? "pessoa" : "pessoas"}
          </span>
          <span className="rounded-full bg-amber-500/90 px-2.5 py-1 text-xs font-medium text-white">
            Modo moderação — invisível para os participantes
          </span>
        </div>
        <Link
          href="/admin"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Parar de visualizar
        </Link>
      </header>

      {(status === "connecting" || status === "closed") && (
        <p className="flex items-center gap-1.5 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          {status === "closed" ? "Conexão perdida — reconectando..." : "Conectando..."}
        </p>
      )}
      {error && (
        <p className="bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}

      {Object.entries(micStreams).map(([peerId, stream]) => {
        const volumeKey = peers.find((p) => p.id === peerId)?.userId ?? peerId;
        return (
          <RemoteAudio
            key={peerId}
            stream={stream}
            muted={mutedPeerIds.has(peerId)}
            volume={peerVolumes[volumeKey] ?? 1}
          />
        );
      })}

      <div className="flex min-h-0 flex-1 flex-col gap-6 p-4 lg:flex-row">
        <main className="min-h-0 flex-1 overflow-y-auto">
          {nothingToShow ? (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 text-center dark:border-zinc-800">
              <p className="text-zinc-600 dark:text-zinc-400">
                Ninguém está transmitindo nesta sala no momento.
              </p>
            </div>
          ) : (
            <>
              {focusedPeerId && hasMultipleShares && (
                <button
                  type="button"
                  onClick={() => setFocusedPeerId(null)}
                  className="mb-3 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  Voltar para todas as transmissões
                </button>
              )}
              <div
                className={
                  isSingleTile
                    ? "h-full"
                    : "grid grid-cols-1 gap-5 sm:grid-cols-2 2xl:grid-cols-3"
                }
              >
                {focusedScreenEntries.map(([peerId, stream]) => {
                  const peer = peers.find((p) => p.id === peerId);
                  const volumeKey = peer?.userId ?? peerId;
                  return (
                    <VideoTile
                      key={`screen-${peerId}`}
                      stream={stream}
                      label={<DisplayUserName name={peer?.name ?? "Alguém"} isGuest={peer?.isGuest} />}
                      accessibleLabel={peer?.name ?? "Alguém"}
                      badge="ao vivo · tela"
                      muted
                      volume={transmissionVolumes[volumeKey] ?? 1}
                      onVolumeChange={(volume) => setTransmissionVolume(volumeKey, volume)}
                      fill={isSingleTile}
                      onStopWatching={() => stopWatchingScreenPeer(peerId)}
                      onDoubleClick={() => setFocusedPeerId(peerId)}
                    />
                  );
                })}
                {focusedCameraEntries.map(([peerId, stream]) => {
                  const peer = peers.find((p) => p.id === peerId);
                  const volumeKey = peer?.userId ?? peerId;
                  return (
                    <VideoTile
                      key={`camera-${peerId}`}
                      stream={stream}
                      label={<DisplayUserName name={peer?.name ?? "Alguém"} isGuest={peer?.isGuest} />}
                      accessibleLabel={peer?.name ?? "Alguém"}
                      badge="ao vivo · câmera"
                      muted
                      volume={transmissionVolumes[volumeKey] ?? 1}
                      onVolumeChange={(volume) => setTransmissionVolume(volumeKey, volume)}
                      fill={isSingleTile}
                      onStopWatching={() => stopWatchingCameraPeer(peerId)}
                      onDoubleClick={() => setFocusedPeerId(peerId)}
                    />
                  );
                })}
                {/* The room's embedded videos (YouTube/Twitch). A moderator
                    gets the same tile a participant does, but strictly
                    read-only: canControl and isOwner are both false, so the
                    player carries no controls, the transparent shield sits
                    over it, and neither the × nor any state push can be
                    reached. That keeps the mode's promise intact — watching
                    one of these is entirely client-side (nothing is sent, the
                    server is never told), so it stays invisible to the room
                    exactly like watching a transmission does.

                    The clock has to come from this connection: the tile
                    defaults to signalingClient's, which on the moderation
                    page belongs to a socket that never joined this room. */}
                {visibleVideoSources.map((videoSource) => {
                  // Keyed on the platform id (or playlist id), not the source
                  // id, for the same reason WatchRoom does it — a source id is
                  // minted fresh every time someone adds the video, so a dial
                  // keyed on it would never actually persist.
                  const volumeKey = videoSourceVolumeKey(videoSource);
                  return (
                    <VideoSourceTile
                      key={`video-source-${videoSource.id}`}
                      source={videoSource}
                      canControl={false}
                      isOwner={false}
                      serverNow={adminServerNow}
                      volume={transmissionVolumes[volumeKey] ?? 1}
                      onVolumeChange={(volume) => setTransmissionVolume(volumeKey, volume)}
                      label={`${videoSource.addedByName} adicionou`}
                      fill={isSingleTile}
                      // Unreachable with isOwner false — the × that would
                      // call it is never rendered.
                      onRemove={() => {}}
                      onLeave={() =>
                        setLeftVideoSourceIds((prev) => new Set(prev).add(videoSource.id))
                      }
                      // Same: canControl false short-circuits every push
                      // before it reaches this.
                      onStateChange={() => {}}
                    />
                  );
                })}
                {leftVideoSources.map((videoSource) => (
                  <StoppedPeerTile
                    key={`left-video-source-${videoSource.id}`}
                    label={`vídeo de ${videoSource.addedByName}`}
                    fill={isSingleTile}
                    onResume={() =>
                      setLeftVideoSourceIds((prev) => {
                        const next = new Set(prev);
                        next.delete(videoSource.id);
                        return next;
                      })
                    }
                  />
                ))}
                {stoppedScreenEntries.map((peer) => (
                  <StoppedPeerTile
                    key={`stopped-screen-${peer.id}`}
                    label={<DisplayUserName name={peer.name} isGuest={peer.isGuest} />}
                    fill={isSingleTile}
                    onResume={() => resumeWatchingScreenPeer(peer.id)}
                  />
                ))}
                {resumingScreenEntries.map((peer) => (
                  <ResumingPeerTile key={`resuming-screen-${peer.id}`} fill={isSingleTile} />
                ))}
                {stoppedCameraEntries.map((peer) => (
                  <StoppedPeerTile
                    key={`stopped-camera-${peer.id}`}
                    label={<DisplayUserName name={peer.name} isGuest={peer.isGuest} />}
                    fill={isSingleTile}
                    onResume={() => resumeWatchingCameraPeer(peer.id)}
                  />
                ))}
                {resumingCameraEntries.map((peer) => (
                  <ResumingPeerTile key={`resuming-camera-${peer.id}`} fill={isSingleTile} />
                ))}
              </div>
            </>
          )}
        </main>

        <aside className="flex w-full max-h-[50vh] shrink-0 flex-col overflow-y-auto lg:h-full lg:max-h-none lg:w-64">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Participantes
          </h2>
          <ul className="flex flex-col gap-1.5">
            {peers.map((p) => {
              const volumeKey = p.userId ?? p.id;
              return (
                <ParticipantRow
                  key={p.id}
                  name={p.name}
                  isGuest={p.isGuest}
                  micOn={p.mic}
                  sharing={p.sharing}
                  screen={p.screen}
                  camera={p.camera}
                  sharingVideo={peerSharesVideo(p.userId)}
                  micStream={micStreams[p.id]}
                  muted={mutedPeerIds.has(p.id)}
                  onToggleMute={() => togglePeerMute(p.id)}
                  volume={peerVolumes[volumeKey] ?? 1}
                  onVolumeChange={(volume) => setPeerVolume(volumeKey, volume)}
                />
              );
            })}
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

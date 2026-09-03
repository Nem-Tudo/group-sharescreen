"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSignaling } from "@/lib/useSignaling";
import { useRoomMedia } from "@/lib/useRoomMedia";
import { signalingClient } from "@/lib/signalingClient";
import { copyText } from "@/lib/clipboard";
import { createObsSecurityToken } from "@/lib/obsToken";
import {
  ScreenIcon,
  CameraIcon,
  VideoSourceIcon,
  ObsSourceIcon,
  CheckIcon,
  ArrowLeftIcon,
} from "@/components/icons";
import { MdContentCopy, MdOpenInNew } from "react-icons/md";

type StreamEntry = {
  id: string;
  kind: "screen" | "camera" | "file" | "video-source";
  title: string;
  badge: string;
  obsPath: string;
};

export function ObsRoomDashboard({ handle }: { handle: string }) {
  const state = useSignaling();
  const {
    remoteStreams,
    remoteCameraStreams,
    fileChannels,
  } = useRoomMedia(handle);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const defaultObsName = useMemo(
    () => `OBS-Painel-${Math.floor(100 + Math.random() * 900)}`,
    []
  );

  // 1. Ensure the WebSocket connection is open
  useEffect(() => {
    signalingClient.connect();
  }, []);

  // 2. Ensure an identity is registered
  useEffect(() => {
    if (!state.name) {
      signalingClient.register(defaultObsName);
    }
  }, [state.name, defaultObsName]);

  // 3. Join the room once state.name is ready (with OBS source flag to bypass limits)
  useEffect(() => {
    if (!state.name) return;
    signalingClient.joinRoom(handle, true);

    return () => {
      signalingClient.leaveRoom();
    };
  }, [handle, state.name]);

  // 4. Auto-confirm device conflict if streamer/viewer is in another tab
  useEffect(() => {
    if (state.deviceConflict) {
      signalingClient.confirmDeviceJoin();
    }
  }, [state.deviceConflict]);

  // Aggregate all active media streams in the room
  const activeStreams = useMemo<StreamEntry[]>(() => {
    const list: StreamEntry[] = [];
    const origin = typeof window !== "undefined" ? window.location.origin : "";

    // 1. Screens
    for (const [peerId] of Object.entries(remoteStreams)) {
      const peer = state.peers.find((p) => p.id === peerId);
      const identifier = peer?.userId ?? peerId;
      list.push({
        id: `screen:${identifier}`,
        kind: "screen",
        title: peer?.name ?? "Alguém",
        badge: "Tela",
        obsPath: `${origin}/obs/${encodeURIComponent(handle)}/${encodeURIComponent(identifier)}/screen`,
      });
    }

    // 2. Cameras
    for (const [peerId] of Object.entries(remoteCameraStreams)) {
      const peer = state.peers.find((p) => p.id === peerId);
      const identifier = peer?.userId ?? peerId;
      list.push({
        id: `camera:${identifier}`,
        kind: "camera",
        title: peer?.name ?? "Alguém",
        badge: "Câmera",
        obsPath: `${origin}/obs/${encodeURIComponent(handle)}/${encodeURIComponent(identifier)}/camera`,
      });
    }

    // 3. Local media files
    for (const [slot, channel] of Object.entries(fileChannels)) {
      for (const [peerId] of Object.entries(channel.remoteStreams)) {
        const peer = state.peers.find((p) => p.id === peerId);
        const identifier = peer?.userId ?? peerId;
        const shared = peer?.files?.find((f) => f.channel === slot);
        list.push({
          id: `file:${slot}:${identifier}`,
          kind: "file",
          title: shared?.name ?? peer?.name ?? "Arquivo",
          badge: `Arquivo (${slot})`,
          obsPath: `${origin}/obs/${encodeURIComponent(handle)}/file:${encodeURIComponent(slot)}:${encodeURIComponent(identifier)}`,
        });
      }
    }

    // 4. Video sources (YouTube / Twitch / Kick)
    for (const vs of state.videoSources ?? []) {
      list.push({
        id: `video-source:${vs.id}`,
        kind: "video-source",
        title: `${vs.addedByName} (${vs.kind.toUpperCase()})`,
        badge: vs.kind,
        obsPath: `${origin}/obs/${encodeURIComponent(handle)}/video-source:${encodeURIComponent(vs.id)}`,
      });
    }

    return list;
  }, [remoteStreams, remoteCameraStreams, fileChannels, state.peers, state.videoSources, handle]);

  const isRoomManager = Boolean(
    state.selfUserId &&
      (state.roomOwnerId === state.selfUserId ||
        state.roomAdmins?.some((a) => a.id === state.selfUserId))
  );

  async function handleCopy(entry: StreamEntry) {
    if (!state.selfUserId || !state.account || !isRoomManager) {
      alert("Apenas administradores da sala com conta podem gerar o link de transmissão.");
      return;
    }
    const token = await createObsSecurityToken(
      handle,
      entry.id,
      state.selfUserId,
      state.account.username || state.name || "Administrador"
    );
    const finalUrl = `${entry.obsPath}?token=${encodeURIComponent(token)}`;
    await copyText(finalUrl);
    setCopiedId(entry.id);
    setTimeout(() => {
      setCopiedId((current) => (current === entry.id ? null : current));
    }, 2000);
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/watch/${encodeURIComponent(handle)}`}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 transition hover:bg-white/20"
              title="Voltar para a sala"
            >
              <ArrowLeftIcon className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-xl font-bold">
                <ObsSourceIcon className="h-6 w-6 text-emerald-400" />
                Fontes OBS da Sala
              </h1>
              <p className="text-sm text-zinc-400">
                Sala: <span className="font-semibold text-zinc-200">{handle}</span>
              </p>
            </div>
          </div>

          <Link
            href={`/watch/${encodeURIComponent(handle)}`}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium transition hover:bg-white/20"
          >
            Ir para a sala
          </Link>
        </div>

        {/* Tutorial Card */}
        <div className="mb-8 rounded-2xl border border-white/10 bg-zinc-900/80 p-5 backdrop-blur-sm">
          <h2 className="mb-3 font-semibold text-zinc-100">
            Como adicionar uma transmissão individual no OBS:
          </h2>
          <ol className="space-y-2 text-sm text-zinc-300">
            <li className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
                1
              </span>
              <span>
                No OBS Studio, vá em <strong>Fontes (Sources)</strong> &rarr; clique em{" "}
                <strong>+</strong> &rarr; <strong>Navegador (Browser)</strong>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
                2
              </span>
              <span>
                Copie o link da transmissão desejada abaixo e cole no campo <strong>URL</strong>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
                3
              </span>
              <span>
                Ajuste a <strong>Largura</strong> e <strong>Altura</strong> (ex: 1920x1080) e confirme.
              </span>
            </li>
          </ol>
        </div>

        {/* Stream List */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Transmissões ativas ({activeStreams.length})
          </h2>

          {activeStreams.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-zinc-900/50 py-12 text-center text-zinc-400">
              <ObsSourceIcon className="mx-auto mb-3 h-10 w-10 opacity-40" />
              <p className="font-medium text-zinc-300">
                Nenhuma transmissão ativa nesta sala no momento.
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Assim que alguém compartilhar tela, câmera ou arquivo, o link aparecerá aqui automaticamente.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {activeStreams.map((entry) => {
                const isCopied = copiedId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className="flex flex-col gap-3 rounded-xl border border-white/10 bg-zinc-900/90 p-4 transition hover:border-white/20 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-zinc-200">
                        {entry.kind === "screen" && <ScreenIcon className="h-5 w-5" />}
                        {entry.kind === "camera" && <CameraIcon className="h-5 w-5" />}
                        {entry.kind === "file" && <VideoSourceIcon className="h-5 w-5" />}
                        {entry.kind === "video-source" && <VideoSourceIcon className="h-5 w-5" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-zinc-100">{entry.title}</span>
                          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 uppercase">
                            {entry.badge}
                          </span>
                        </div>
                        <p className="mt-0.5 max-w-xs truncate text-xs text-zinc-500 sm:max-w-md">
                          {entry.obsPath}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCopy(entry)}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          isCopied
                            ? "bg-emerald-600 text-white"
                            : "bg-white/10 text-zinc-200 hover:bg-white/20"
                        }`}
                      >
                        {isCopied ? (
                          <>
                            <CheckIcon className="h-4 w-4" />
                            Copiado!
                          </>
                        ) : (
                          <>
                            <MdContentCopy className="h-4 w-4" />
                            Copiar link OBS
                          </>
                        )}
                      </button>

                      <a
                        href={entry.obsPath}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
                        title="Abrir prévia em nova aba"
                      >
                        <MdOpenInNew className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


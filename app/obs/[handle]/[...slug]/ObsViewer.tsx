"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useSignaling } from "@/lib/useSignaling";
import { useRoomMedia } from "@/lib/useRoomMedia";
import { signalingClient } from "@/lib/signalingClient";
import { VideoSourceTile } from "@/components/VideoSourceTile";
import { ObsSourceIcon } from "@/components/icons";
import { verifyObsSecurityToken, type ObsTokenPayload } from "@/lib/obsToken";
import { isBroadcastSoftware } from "@/lib/browserEnv";

export function normalizeSlugToTile(slug: string[]): {
  kind: "screen" | "camera" | "file" | "video-source";
  ownerId: string;
} | null {
  if (!slug || slug.length === 0) return null;

  if (slug.length === 1) {
    const raw = decodeURIComponent(slug[0]);
    if (raw.startsWith("screen:")) return { kind: "screen", ownerId: raw.slice(7) };
    if (raw.startsWith("camera:")) return { kind: "camera", ownerId: raw.slice(7) };
    if (raw.startsWith("file:")) return { kind: "file", ownerId: raw.slice(5) };
    if (raw.startsWith("video-source:")) return { kind: "video-source", ownerId: raw.slice(13) };
    return { kind: "screen", ownerId: raw };
  }

  if (slug.length === 2) {
    const [first, second] = slug.map(decodeURIComponent);
    if (second === "screen" || second === "camera") {
      return { kind: second, ownerId: first };
    }
    if (first === "screen" || first === "camera") {
      return { kind: first, ownerId: second };
    }
    if (first === "video-source") {
      return { kind: "video-source", ownerId: second };
    }
    if (second.startsWith("file")) {
      return { kind: "file", ownerId: `${second}:${first}` };
    }
    return { kind: "screen", ownerId: first };
  }

  if (slug.length >= 3) {
    const [a, b, c] = slug.map(decodeURIComponent);
    if (a === "file") {
      return { kind: "file", ownerId: `${b}:${c}` };
    }
    if (b === "file") {
      return { kind: "file", ownerId: `${c}:${a}` };
    }
  }

  return null;
}

export function ObsViewer({
  handle,
  slug,
}: {
  handle: string;
  slug: string[];
}) {
  const [mounted, setMounted] = useState(false);
  const [isBroadcast, setIsBroadcast] = useState(false);
  const [showTutorial, setShowTutorial] = useState(true);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (isBroadcastSoftware()) {
      setIsBroadcast(true);
      setShowTutorial(false);
      return;
    }
    const handleObsInit = () => {
      setIsBroadcast(true);
      setShowTutorial(false);
    };
    window.addEventListener("obsStudioInit", handleObsInit);
    return () => window.removeEventListener("obsStudioInit", handleObsInit);
  }, []);

  const state = useSignaling();
  const {
    remoteStreams,
    remoteCameraStreams,
    fileChannels,
  } = useRoomMedia(handle);

  const videoRef = useRef<HTMLVideoElement>(null);
  const parsed = useMemo(() => normalizeSlugToTile(slug), [slug]);

  const token = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("token");
  }, []);

  const [tokenStatus, setTokenStatus] = useState<{
    checking: boolean;
    valid: boolean;
    payload?: ObsTokenPayload;
    error?: string;
  }>({
    checking: true,
    valid: false,
  });

  useEffect(() => {
    if (!token) {
      setTokenStatus({ checking: false, valid: false, error: "Token não fornecido." });
      return;
    }
    let cancelled = false;
    void verifyObsSecurityToken(token, handle).then((res) => {
      if (cancelled) return;
      setTokenStatus({
        checking: false,
        valid: res.valid,
        payload: res.payload,
        error: res.error,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [token, handle]);

  const defaultObsName = useMemo(
    () => `Stream-${Math.floor(100 + Math.random() * 900)}`,
    []
  );

  // 1. Ensure the WebSocket connection is open (only with valid token)
  useEffect(() => {
    if (!tokenStatus.valid) return;
    signalingClient.connect();
  }, [tokenStatus.valid]);

  // 2. Ensure an identity is registered (unique guest name if none exists)
  useEffect(() => {
    if (!tokenStatus.valid) return;
    if (!state.name) {
      signalingClient.register(defaultObsName);
    }
  }, [tokenStatus.valid, state.name, defaultObsName]);

  // 3. Join the room once state.name is ready (with OBS source flag, signed token and target identifier)
  useEffect(() => {
    if (!state.name || !tokenStatus.valid) return;
    const obsTarget = parsed ? `${parsed.kind}:${parsed.ownerId}` : null;
    signalingClient.joinRoom(handle, true, token, obsTarget);

    return () => {
      signalingClient.leaveRoom();
    };
  }, [handle, state.name, tokenStatus.valid, token, parsed]);

  const [retryCount, setRetryCount] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Reset retry count once room is joined
  useEffect(() => {
    if (state.room) {
      setRetryCount(0);
      setCountdown(null);
    }
  }, [state.room]);

  const handleManualRetry = useCallback(() => {
    setCountdown(null);
    const obsTarget = parsed ? `${parsed.kind}:${parsed.ownerId}` : null;
    signalingClient.joinRoom(handle, true, token, obsTarget);
  }, [handle, token, parsed]);

  // 4. Notify all peers in the room that this specific media is actively streaming (every 12s)
  useEffect(() => {
    if (!tokenStatus.valid || !parsed || !state.room) return;
    const target = `${parsed.kind}:${parsed.ownerId}`;
    const broadcastActive = () => {
      for (const peer of state.peers) {
        if (peer.id !== state.selfId) {
          signalingClient.sendSignal(peer.id, {
            type: "obs-stream-active",
            target,
          });
        }
      }
    };
    broadcastActive();
    const interval = setInterval(broadcastActive, 12000);
    return () => clearInterval(interval);
  }, [tokenStatus.valid, parsed, state.room, state.peers, state.selfId]);

  // 4. Auto-confirm device conflict if streamer or viewer is in multiple tabs with the same account
  useEffect(() => {
    if (!state.deviceConflict) return;
    signalingClient.confirmDeviceJoin();
  }, [state.deviceConflict]);

  // 5. Intelligent backoff retry when joinError occurs (prevents spam and rate limits)
  useEffect(() => {
    if (!tokenStatus.valid || !state.name || !state.joinError || state.room) {
      setCountdown(null);
      return;
    }

    // Delay: starts at 8s, increases with retryCount, or 15s if rate-limited
    const delaySeconds =
      state.joinErrorKind === "rate-limited"
        ? Math.min(30, 15 + retryCount * 5)
        : Math.min(20, 8 + retryCount * 3);

    setCountdown(delaySeconds);

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          setRetryCount((c) => c + 1);
          const obsTarget = parsed ? `${parsed.kind}:${parsed.ownerId}` : null;
          signalingClient.joinRoom(handle, true, token, obsTarget);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [tokenStatus.valid, state.name, state.joinError, state.joinErrorKind, state.room, handle, token, parsed, retryCount]);

  // Check if the author who minted this token is currently in the room
  const authorId = tokenStatus.payload?.authorId;
  const authorName = tokenStatus.payload?.authorName;
  const isAuthorPresent = useMemo(() => {
    if (!authorId) return false;
    return state.peers.some((p) => p.userId === authorId || p.id === authorId);
  }, [authorId, state.peers]);

  // Resolve the active stream from the target peer
  const stream = useMemo<MediaStream | null>(() => {
    if (!parsed) return null;

    const targetPeer = state.peers.find(
      (p) => p.id === parsed.ownerId || (p.userId && p.userId === parsed.ownerId)
    );
    const resolvedPeerId = targetPeer ? targetPeer.id : parsed.ownerId;

    if (parsed.kind === "screen") {
      return remoteStreams[resolvedPeerId] ?? null;
    }
    if (parsed.kind === "camera") {
      return remoteCameraStreams[resolvedPeerId] ?? null;
    }
    if (parsed.kind === "file") {
      const fileSep = parsed.ownerId.indexOf(":");
      if (fileSep < 0) return null;
      const slot = parsed.ownerId.slice(0, fileSep);
      const fileOwner = parsed.ownerId.slice(fileSep + 1);
      const peer = state.peers.find(
        (p) => p.id === fileOwner || (p.userId && p.userId === fileOwner)
      );
      const targetFilePeerId = peer ? peer.id : fileOwner;
      const channel = fileChannels[slot as keyof typeof fileChannels];
      return channel?.remoteStreams?.[targetFilePeerId] ?? null;
    }
    return null;
  }, [parsed, state.peers, remoteStreams, remoteCameraStreams, fileChannels]);

  // Connect the stream to the video tag
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!stream) {
      video.srcObject = null;
      return;
    }
    video.srcObject = stream;
    video.play()
      .then(() => {
        setAutoplayBlocked(false);
      })
      .catch((err) => {
        console.warn("Autoplay awaiting user gesture or blocked:", err);
        setAutoplayBlocked(true);
      });
  }, [stream]);

  const handleUnblockAutoplay = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.play()
        .then(() => {
          setAutoplayBlocked(false);
        })
        .catch((err) => {
          console.warn("Manual play failed:", err);
        });
    }
  }, []);

  const renderBrowserHeader = () => {
    if (isBroadcast) return null;
    return (
      <header className="fixed top-3 left-3 right-3 z-40 flex items-center justify-between pointer-events-none">
        <Link
          href="/"
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-zinc-900/85 px-3.5 py-1.5 text-xs font-semibold text-zinc-100 backdrop-blur-md border border-zinc-700/60 shadow-lg hover:bg-zinc-800 hover:text-white transition active:scale-95"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          Ir para a tela de início
        </Link>

        <button
          type="button"
          onClick={() => setShowTutorial(true)}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-zinc-900/85 px-3.5 py-1.5 text-xs font-medium text-zinc-200 backdrop-blur-md border border-zinc-700/60 shadow-lg hover:bg-zinc-800 hover:text-white transition active:scale-95"
        >
          <ObsSourceIcon className="h-3.5 w-3.5 text-purple-400" />
          Como usar da forma certa
        </button>
      </header>
    );
  };

  const renderTutorialModal = () => {
    if (isBroadcast || !showTutorial) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-200">
        <div className="relative w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900/95 p-6 shadow-2xl backdrop-blur-lg sm:p-7 text-white flex flex-col">
          <button
            type="button"
            onClick={() => {
              setShowTutorial(false);
              handleUnblockAutoplay();
            }}
            aria-label="Fechar tutorial"
            className="absolute top-4 right-4 rounded-full p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 shadow-inner">
              <ObsSourceIcon className="h-6 w-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-[11px] font-medium text-purple-300">
                Guia de Transmissão
              </div>
              <h2 className="text-lg font-bold text-white tracking-tight sm:text-xl">
                Como usar da forma certa
              </h2>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
            Este link foi gerado para transmitir vídeo e áudio em tempo real com alta definição e sem atraso.
          </p>

          <div className="mt-4 space-y-3 text-left">
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3.5 text-xs">
              <p className="font-semibold text-zinc-200 mb-2 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-600/30 text-purple-300 text-[11px] font-bold">1</span>
                Em softwares de transmissão (OBS Studio, Streamlabs, vMix):
              </p>
              <ol className="list-decimal list-inside space-y-1.5 text-zinc-400 pl-1">
                <li>No seu programa, clique em <strong className="text-zinc-200">+</strong> na lista de <em>Fontes</em> (Sources).</li>
                <li>Selecione <strong className="text-zinc-200">Navegador (Browser Source)</strong>.</li>
                <li>Cole a URL completa deste link no campo <strong className="text-zinc-200">URL</strong>.</li>
                <li>Defina a resolução recomendada (<strong className="text-zinc-200">1920x1080</strong>) e clique em OK.</li>
              </ol>
            </div>

            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3.5 text-xs">
              <p className="font-semibold text-zinc-200 mb-1.5 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600/30 text-emerald-300 text-[11px] font-bold">2</span>
                Assistindo diretamente pelo navegador:
              </p>
              <p className="text-zinc-400 leading-relaxed">
                Você pode acompanhar a transmissão aqui nesta página. Caso o áudio inicial não toque sozinho devido às regras do navegador, clique na tela para liberar a reprodução com som.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col-reverse sm:flex-row items-center gap-2.5">
            <Link
              href="/"
              className="flex w-full sm:w-auto flex-1 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs sm:text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 active:scale-[0.98]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Ir para a tela de início
            </Link>
            <button
              type="button"
              onClick={() => {
                setShowTutorial(false);
                handleUnblockAutoplay();
              }}
              className="flex w-full sm:w-auto flex-1 items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white transition hover:bg-purple-500 active:scale-[0.98]"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Assistir transmissão
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Handle video-source tiles (YouTube/Twitch/Kick iframe)
  if (parsed?.kind === "video-source") {
    const videoSource = state.videoSources?.find(
      (s: { id: string }) => s.id === parsed.ownerId
    );
    if (!videoSource) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-transparent font-sans text-sm text-zinc-400">
          {renderBrowserHeader()}
          {renderTutorialModal()}
          Aguardando vídeo...
        </div>
      );
    }

    return (
      <div className="h-screen w-screen overflow-hidden bg-transparent">
        {renderBrowserHeader()}
        {renderTutorialModal()}
        <VideoSourceTile
          source={videoSource}
          canControl={false}
          isOwner={false}
          onStateChange={() => {}}
          onRemove={() => {}}
          onLeave={() => {}}
          label=""
          fill
          className="!rounded-none !border-0"
        />
      </div>
    );
  }

  // Check token status
  if (mounted && tokenStatus.checking) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-transparent font-sans text-xs text-zinc-400">
        Verificando credenciais de acesso...
      </div>
    );
  }

  // Require a valid security token
  if (mounted && !tokenStatus.valid) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-zinc-950 p-6 text-center text-white">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-base font-bold text-white">
          {!token ? "Token de Segurança Necessário" : "Token Inválido ou Expirado"}
        </h2>
        <p className="max-w-sm text-xs leading-relaxed text-zinc-400">
          {tokenStatus.error ??
            "Este link de transmissão requer um token de acesso válido gerado na sala. Acesse a sala no GoLive e clique no ícone de transmissão na mídia para copiar um link seguro."}
        </p>
        <Link
          href="/"
          className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-xs font-semibold text-zinc-950 transition hover:bg-zinc-200 active:scale-95"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          Ir para a tela de início
        </Link>
      </div>
    );
  }

  // Display join errors if any (e.g. streamer mode disabled, invalid token, full room, banned, etc.)
  if (state.joinError) {
    const isStreamerModeDisabled =
      state.joinErrorKind === "streamer-mode-disabled" ||
      state.joinError.includes("Modo Streamer");

    if (isStreamerModeDisabled) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-zinc-950 p-6 text-center text-white">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-purple-500/30 bg-purple-500/10 text-purple-400">
            <ObsSourceIcon className="h-6 w-6" />
          </div>
          <h2 className="text-base font-bold text-white">Modo Streamer Desativado</h2>
          <p className="max-w-sm text-xs leading-relaxed text-zinc-400">
            A imagem desta transmissão está pausada porque o administrador não ativou o Modo Streamer na sala. A transmissão iniciará automaticamente assim que o Modo Streamer for ativado.
          </p>
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-500" />
              </span>
              {countdown !== null
                ? `Próxima tentativa em ${countdown}s...`
                : "Aguardando ativação pelo administrador..."}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={handleManualRetry}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white active:scale-95 transition-all"
              >
                Tentar agora
              </button>
              <Link
                href="/"
                className="rounded-lg bg-zinc-800 px-3.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white active:scale-95 transition-all"
              >
                Ir para a tela de início
              </Link>
            </div>
          </div>
        </div>
      );
    }

    const isRateLimited = state.joinErrorKind === "rate-limited";

    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-zinc-950 p-6 text-center text-white">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-base font-bold text-white">
          {isRateLimited ? "Muitas Tentativas" : "Acesso Não Autorizado"}
        </h2>
        <p className="max-w-sm text-xs leading-relaxed text-zinc-400">
          {state.joinError}
        </p>
        <div className="flex flex-col items-center gap-2">
          {countdown !== null && (
            <p className="text-[11px] text-zinc-500">
              Reconectando automaticamente em {countdown}s...
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleManualRetry}
              className="rounded-lg bg-zinc-800 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 active:scale-95"
            >
              Tentar agora
            </button>
            <Link
              href="/"
              className="rounded-lg border border-zinc-700 bg-transparent px-4 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition active:scale-95"
            >
              Ir para a tela de início
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!state.room) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-2 bg-transparent font-sans text-sm text-zinc-400">
        {renderBrowserHeader()}
        {renderTutorialModal()}
        <p>Conectando à sala...</p>
        {state.deviceConflict && (
          <p className="text-xs text-amber-300">Confirmando conexão de dispositivo...</p>
        )}
      </div>
    );
  }

  if (mounted && !isAuthorPresent) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-zinc-950 p-6 text-center text-white">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-base font-bold text-white">Aguardando Administrador</h2>
        <p className="max-w-sm text-xs leading-relaxed text-zinc-400">
          O administrador {authorName ? `(${authorName})` : ""} que gerou este link não está conectado na chamada. A transmissão continuará automaticamente assim que ele entrar na sala.
        </p>
        <div className="mt-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-zinc-200 active:scale-95"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Ir para a tela de início
          </Link>
        </div>
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-2 bg-transparent font-sans text-sm text-zinc-400">
        {renderBrowserHeader()}
        {renderTutorialModal()}
        <p>Aguardando transmissão...</p>
        <span className="text-xs text-zinc-500">
          {parsed?.ownerId} ({parsed?.kind ?? "mídia"})
        </span>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 h-screen w-screen overflow-hidden bg-transparent">
      {renderBrowserHeader()}
      {renderTutorialModal()}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="h-full w-full object-contain bg-transparent"
      />
      {autoplayBlocked && !showTutorial && (
        <button
          type="button"
          onClick={handleUnblockAutoplay}
          className="absolute inset-0 z-30 flex cursor-pointer flex-col items-center justify-center bg-black/60 backdrop-blur-sm transition-all hover:bg-black/50"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 text-white shadow-lg backdrop-blur-md transition hover:scale-105 active:scale-95">
            <svg className="h-8 w-8 translate-x-0.5 fill-current" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <p className="mt-3 text-sm font-medium text-white shadow-sm">
            Clique para reproduzir áudio e vídeo
          </p>
        </button>
      )}
    </div>
  );
}

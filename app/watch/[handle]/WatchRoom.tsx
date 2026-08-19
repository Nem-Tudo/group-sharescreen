"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signalingClient } from "@/lib/signalingClient";
import { useSignaling, useHasStoredName } from "@/lib/useSignaling";
import { useAuth } from "@/lib/AuthContext";
import {
  useRoomMedia,
  useScreenShareMode,
  SHARE_RESOLUTION_OPTIONS,
  SHARE_FPS_OPTIONS,
  SHARE_BITRATE_OPTIONS,
} from "@/lib/useRoomMedia";
import { useIsolatedWindowAudioSupport } from "@/lib/screenAudioCapture";
import { trackEvent } from "@/lib/analytics";
import {
  authenticatePrivateRoom,
  clearStoredRoomAccess,
  createPrivateRoom,
  fetchRoomAccessInfo,
  isPrivateRoomHandle,
  RoomsApiError,
  storeRoomAccessGrant,
  toRoomHandle,
  useStoredRoomAccessToken,
} from "@/lib/roomsApi";
import { VideoTile, StoppedPeerTile, ResumingPeerTile } from "@/components/VideoTile";
import { RemoteAudio } from "@/components/RemoteAudio";
import { ParticipantRow } from "@/components/ParticipantRow";
import { ChatPanel } from "@/components/ChatPanel";
import { WebRtcDiagnosticsPanel } from "@/components/WebRtcDiagnosticsPanel";
import {
  MicIcon,
  MicOffIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  NoiseSuppressionIcon,
  NoiseSuppressionOffIcon,
  LinkIcon,
  CheckIcon,
} from "@/components/icons";

// Mirrors server/signaling.ts's HANDLE_RE — must match exactly, or a name
// this lets through but the server rejects lands the user in a dead room
// (join fails server-side, but the client's already navigated to it).
const HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const SHARE_AUDIO_MODE_LABELS = {
  window: "Áudio isolado da janela",
  system: "Todo o áudio do computador",
  none: "Sem áudio",
} as const;

export function WatchRoom({ handle }: { handle: string }) {
  const router = useRouter();
  const state = useSignaling();
  const hasStoredName = useHasStoredName();
  const { loading: resolvingAccount } = useAuth();
  const validHandle = HANDLE_RE.test(handle);
  const screenShareMode = useScreenShareMode();
  const isolatedWindowAudioSupported = useIsolatedWindowAudioSupport();
  const privateRoom = isPrivateRoomHandle(handle);

  const {
    isSharing,
    startShare,
    stopShare,
    localStream,
    remoteStreams,
    stoppedPeers,
    resumingPeers,
    stopWatchingPeer,
    resumeWatchingPeer,
    shareError,
    shareSource,
    isCameraSharing,
    startCameraShare,
    stopCameraShare,
    localCameraStream,
    remoteCameraStreams,
    cameraShareError,
    shareResolution,
    setShareResolution,
    shareFps,
    setShareFps,
    shareBitrate,
    setShareBitrate,
    smartQualityEnabled,
    setSmartQualityEnabled,
    shareAudioMode,
    setShareAudioMode,
    shareAudioStatus,
    isMicOn,
    toggleMic,
    micError,
    localMicStream,
    remoteMicStreams,
    noiseSuppressionOn,
    noiseSuppressionAvailable,
    toggleNoiseSuppression,
  } = useRoomMedia(handle);

  const [switching, setSwitching] = useState(false);
  const [switchInput, setSwitchInput] = useState("");
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchIsPrivate, setSwitchIsPrivate] = useState(false);
  const [switchPassword, setSwitchPassword] = useState("");
  const [showSwitchPassword, setShowSwitchPassword] = useState(false);
  const [switchingRoom, setSwitchingRoom] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [micsMuted, setMicsMuted] = useState(false);
  const [mutedPeerIds, setMutedPeerIds] = useState<Set<string>>(new Set());
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});
  const [transmissionVolumes, setTransmissionVolumes] = useState<Record<string, number>>({});
  const [renaming, setRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [qualityOpen, setQualityOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [focusedPeerId, setFocusedPeerId] = useState<string | null>(null);
  const roomAccessToken = useStoredRoomAccessToken(handle);
  const [roomInfoResult, setRoomInfoResult] = useState<{ handle: string; exists: boolean } | null>(null);
  const [roomPassword, setRoomPassword] = useState("");
  const [roomPasswordError, setRoomPasswordError] = useState<string | null>(null);
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [changingEntryName, setChangingEntryName] = useState(false);
  const previousNameRef = useRef(state.name);
  const roomExists = roomInfoResult?.handle === handle ? roomInfoResult.exists : null;

  useEffect(() => {
    if (!privateRoom || roomAccessToken || !state.name) return;
    const controller = new AbortController();
    fetchRoomAccessInfo(handle, controller.signal)
      .then((info) =>
        setRoomInfoResult({
          handle,
          exists: info.exists && info.private && info.requiresPassword,
        })
      )
      .catch(() => {});
    return () => controller.abort();
  }, [handle, privateRoom, roomAccessToken, state.name]);

  // Same hydration-flash guard as page.tsx: useAccountToken()/
  // useHasStoredName() briefly report empty/false on the very first client
  // paint before correcting to the real localStorage-backed value, which
  // would otherwise flash the "choose a name" form for a logged-in account.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Closes the rename popover once the name actually changes — covers both
  // success (server confirmed the new name) and a plain reconnect, without
  // needing to guess at exact timing.
  useEffect(() => {
    if (renaming && state.name !== previousNameRef.current) {
      setRenaming(false);
      setRenameInput("");
    }
    if (changingEntryName && state.name !== previousNameRef.current) {
      setChangingEntryName(false);
      setNameInput("");
    }
    previousNameRef.current = state.name;
  }, [state.name, renaming, changingEntryName]);

  function toggleMicsMuted() {
    const next = !micsMuted;
    setMicsMuted(next);
    trackEvent(next ? "mics_muted" : "mics_unmuted");
  }

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

  function setTransmissionVolume(peerId: string, volume: number) {
    setTransmissionVolumes((prev) => ({ ...prev, [peerId]: volume }));
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      trackEvent("room_link_copied");
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable — nothing sensible to do
      // beyond leaving the button unconfirmed.
    }
  }

  // A stored guest name, or an account token still being resolved (see
  // AuthContext's registration effect — it's what turns that resolved
  // account into a signalingClient.register() call, including on a direct
  // link straight into a room like this one), means the client is still
  // (re)connecting/registering — show a loading state instead of asking
  // again. Excludes "banned": that connection attempt already resolved
  // (rejected), so it's not actually still restoring and would otherwise
  // get stuck on this loading state forever instead of showing the ban
  // screen below.
  const restoring =
    !mounted ||
    (!state.name &&
      (resolvingAccount || (hasStoredName && !state.nameError)) &&
      state.status !== "banned");

  useEffect(() => {
    if (!validHandle || !state.name || (privateRoom && !roomAccessToken)) return;
    signalingClient.joinRoom(handle, roomAccessToken ?? undefined);
    return () => {
      signalingClient.leaveRoom();
    };
  }, [validHandle, state.name, handle, privateRoom, roomAccessToken]);

  useEffect(() => {
    if (!privateRoom || !state.roomJoinError) return;
    clearStoredRoomAccess(handle);
  }, [handle, privateRoom, state.roomJoinError]);

  function handleNameSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === state.name) return;
    signalingClient.register(trimmed);
  }

  async function handleRoomPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    const password = roomPassword.trim();
    if (!password) return;
    setVerifyingPassword(true);
    setRoomPasswordError(null);
    try {
      const grant = await authenticatePrivateRoom(handle, password);
      storeRoomAccessGrant(handle, grant);
      setRoomPassword("");
    } catch (error) {
      if (error instanceof RoomsApiError && error.code === "incorrect-password") {
        setRoomPasswordError("Senha incorreta. Tente novamente.");
      } else if (error instanceof RoomsApiError && error.code === "too-many-attempts") {
        setRoomPasswordError("Muitas tentativas. Aguarde um minuto e tente novamente.");
      } else if (error instanceof RoomsApiError && error.code === "room-must-be-recreated") {
        setRoomPasswordError("Esta sala privada precisa ser recriada com uma senha.");
      } else if (error instanceof RoomsApiError && error.code === "room-not-found") {
        setRoomPasswordError("Esta sala privada não existe mais.");
      } else {
        setRoomPasswordError("Não foi possível verificar a senha. Tente novamente.");
      }
    } finally {
      setVerifyingPassword(false);
    }
  }

  function handleRenameSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = renameInput.trim();
    if (!trimmed || trimmed === state.name) return;
    trackEvent("name_change");
    signalingClient.register(trimmed);
  }

  async function handleSwitchSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = switchInput.trim();
    const fullHandle = toRoomHandle(trimmed, switchIsPrivate);
    if (!HANDLE_RE.test(fullHandle)) {
      setSwitchError("Use de 1 a 32 letras, números, - e _.");
      return;
    }
    const nextHandle = fullHandle;
    if (!switchIsPrivate) {
      setSwitching(false);
      setSwitchInput("");
      setSwitchError(null);
      trackEvent("room_switch");
      router.push(`/watch/${nextHandle}`);
      return;
    }
    const password = switchPassword.trim();
    if (password.length < 4) {
      setSwitchError("A senha deve ter pelo menos 4 caracteres.");
      return;
    }
    if (password.length > 128) {
      setSwitchError("A senha deve ter no máximo 128 caracteres.");
      return;
    }
    setSwitchingRoom(true);
    setSwitchError(null);
    try {
      let grant;
      try {
        grant = await createPrivateRoom(nextHandle, password);
      } catch (error) {
        if (!(error instanceof RoomsApiError) || error.code !== "room-exists") throw error;
        grant = await authenticatePrivateRoom(nextHandle, password);
      }
      storeRoomAccessGrant(nextHandle, grant);
      setSwitching(false);
      setSwitchInput("");
      setSwitchPassword("");
      setShowSwitchPassword(false);
      trackEvent("room_switch");
      router.push(`/watch/${nextHandle}`);
    } catch (error) {
      if (error instanceof RoomsApiError && error.code === "incorrect-password") {
        setSwitchError("Senha incorreta para a sala existente.");
      } else {
        setSwitchError("Não foi possível abrir a sala privada.");
      }
    } finally {
      setSwitchingRoom(false);
    }
  }

  if (!validHandle) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Essa sala não é válida.
        </p>
        <Link href="/" className="text-sm font-medium underline underline-offset-4">
          Voltar para o início
        </Link>
      </div>
    );
  }

  if (restoring) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-zinc-600 dark:text-zinc-400">Reconectando...</p>
      </div>
    );
  }

  // Another connection under the same identity (a second tab, or another
  // device/reload that briefly overlapped this one) just took over — see
  // signalingClient's SUPERSEDED_CLOSE_CODE handling. This tab deliberately
  // stopped trying to reconnect instead of fighting the other one for the
  // identity forever, so tell the user what happened instead of it just
  // looking frozen.
  if (state.status === "superseded") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Essa sessão foi aberta em outra aba ou dispositivo.
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Só é possível ficar conectado com o mesmo nome em um lugar por vez.
        </p>
        <button
          type="button"
          onClick={() => state.name && signalingClient.register(state.name)}
          className="rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Usar esta aba
        </button>
      </div>
    );
  }

  // The server rejected every future connection attempt from this IP — see
  // server/signaling.ts's BANNED_CLOSE_CODE. Unlike "superseded" above,
  // there's no action the user can take from here.
  if (state.status === "banned") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Você foi banido deste site.
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Se você acredita que isso é um engano, abra um ticket em <a
            href="https://discord.gg/nemtudo"
            target="_blank"
            className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-500 dark:hover:text-blue-400"
          >discord.gg/nemtudo</a>
        </p>
      </div>
    );
  }

  if (!state.name || changingEntryName) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {changingEntryName ? "Alterar nome" : `Entrar na sala ${handle}`}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {changingEntryName
              ? "Escolha o nome que será mostrado aos participantes."
              : "Escolha um nome para entrar nesta sala."}
          </p>
          <form onSubmit={handleNameSubmit} className="mt-8 flex flex-col gap-3">
            <label htmlFor="name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Seu nome
            </label>
            <input
              id="name"
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={24}
              placeholder="Ex: Maria"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            {state.nameError && <p className="text-sm text-red-500">{state.nameError}</p>}
            <button
              type="submit"
              disabled={!nameInput.trim()}
              className="mt-2 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Confirmar nome
            </button>
          </form>
        </main>
      </div>
    );
  }

  if (privateRoom && !roomAccessToken) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
            Sala privada
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Esta sala é protegida por senha
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Digite a senha definida pelo criador para entrar como {state.name}.
          </p>

          {roomExists === false ? (
            <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
              Esta sala privada não existe mais.
            </p>
          ) : (
            <form onSubmit={handleRoomPasswordSubmit} className="mt-8 flex flex-col gap-3">
              <label htmlFor="private-room-password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Senha
              </label>
              <input
                id="private-room-password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={roomPassword}
                onChange={(event) => setRoomPassword(event.target.value)}
                minLength={4}
                maxLength={128}
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
              {(roomPasswordError || state.roomJoinError) && (
                <p className="text-sm text-red-500">
                  {roomPasswordError ??
                    (state.roomJoinError === "room-not-found"
                      ? "Esta sala privada não existe mais."
                      : state.roomJoinError === "room-must-be-recreated"
                        ? "Esta sala privada precisa ser recriada com uma senha."
                        : "Sua autorização expirou. Digite a senha novamente.")}
                </p>
              )}
              <button
                type="submit"
                disabled={!roomPassword.trim() || verifyingPassword}
                className="mt-2 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {verifyingPassword ? "Verificando..." : "Entrar na sala"}
              </button>
            </form>
          )}

          {state.account ? (
            <Link
              href="/"
              className="mt-4 inline-block text-sm font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              ← Voltar ao início
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => {
                setNameInput(state.name ?? "");
                setChangingEntryName(true);
                setRoomPasswordError(null);
              }}
              className="mt-4 text-sm font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              ← Alterar nome
            </button>
          )}
        </main>
      </div>
    );
  }

  if (privateRoom && state.room !== handle) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-16 text-sm text-zinc-500 dark:text-zinc-400">
        Entrando na sala privada...
      </div>
    );
  }

  // Moderator "ghost" peers (see server/signaling.ts's admin-join) ride the
  // same peer list so their WebRTC connections get set up transparently,
  // but must never show up to real participants — filtered out here rather
  // than never added, so this is the one place that has to remember it.
  const visiblePeers = state.peers.filter((p) => p.role !== "moderator");
  const peerCount = visiblePeers.length + (state.name ? 1 : 0);
  // Screen and camera are independent broadcast channels (see
  // useRoomMedia's useBroadcastChannel) — a peer sharing both gets one tile
  // for each, never one tile with the other crammed into a corner.
  const remoteScreenEntries = Object.entries(remoteStreams);
  const remoteCameraEntries = Object.entries(remoteCameraStreams);
  const focusedPeerVisible = !focusedPeerId || focusedPeerId === "self";
  const focusedScreenEntries = focusedPeerId
    ? focusedPeerId === "self"
      ? []
      : remoteScreenEntries.filter(([peerId]) => peerId === focusedPeerId)
    : remoteScreenEntries;
  const focusedCameraEntries = focusedPeerId
    ? focusedPeerId === "self"
      ? []
      : remoteCameraEntries.filter(([peerId]) => peerId === focusedPeerId)
    : remoteCameraEntries;
  const localTileCount = (isSharing && localStream ? 1 : 0) + (localCameraStream ? 1 : 0);
  const hasMultipleShares =
    remoteScreenEntries.length + remoteCameraEntries.length + localTileCount > 1;
  // A peer we deliberately stopped watching has no entry in remoteStreams
  // (the underlying connection is closed to save resources — see
  // stopWatchingPeer), but still gets a tile slot showing a "you left this
  // transmission" placeholder instead of just vanishing from the grid.
  const stoppedEntries = visiblePeers.filter((p) => stoppedPeers.has(p.id) && !(p.id in remoteStreams));
  // Same idea while a resume is in flight — no stream yet, but not "stopped"
  // anymore either, so it still needs its own tile slot (see ResumingPeerTile).
  const resumingEntries = visiblePeers.filter(
    (p) => resumingPeers.has(p.id) && !(p.id in remoteStreams)
  );
  const nothingToShow =
    remoteScreenEntries.length === 0 &&
    remoteCameraEntries.length === 0 &&
    stoppedEntries.length === 0 &&
    resumingEntries.length === 0 &&
    !isSharing;
  const tileCount =
    focusedScreenEntries.length +
    focusedCameraEntries.length +
    stoppedEntries.length +
    resumingEntries.length +
    (focusedPeerVisible ? localTileCount : 0);
  const isSingleTile = tileCount === 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="relative flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{handle}</h1>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium text-white ${isPrivateRoomHandle(handle) ? "bg-red-600" : "bg-emerald-600"
              }`}
          >
            {isPrivateRoomHandle(handle) ? "Sala privada" : "Sala pública"}
          </span>
          <span className="rounded-full bg-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {peerCount} {peerCount === 1 ? "pessoa" : "pessoas"}
          </span>
          <a
            href="https://discord.gg/nemtudo"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-500 dark:hover:text-red-400"
          >
            Reportar bug
          </a>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyLink}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${linkCopied
              ? "border-emerald-600 text-emerald-600 dark:border-emerald-500 dark:text-emerald-500"
              : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
          >
            {linkCopied ? (
              <CheckIcon className="h-4 w-4" />
            ) : (
              <LinkIcon className="h-4 w-4" />
            )}
            {linkCopied ? "Link copiado!" : "Compartilhar sala"}
          </button>

          <button
            type="button"
            onClick={() => {
              setSwitching(false);
              setQualityOpen(false);
              setRenaming((r) => {
                if (!r) setRenameInput(state.name ?? "");
                return !r;
              });
            }}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Mudar nome
          </button>

          <button
            type="button"
            onClick={() => {
              setRenaming(false);
              setQualityOpen(false);
              setSwitching((s) => !s);
            }}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Trocar de sala
          </button>

          <button
            type="button"
            onClick={toggleMic}
            title={isMicOn ? "Desativar microfone" : "Ativar microfone"}
            aria-label={isMicOn ? "Desativar microfone" : "Ativar microfone"}
            className={`rounded-lg p-2 text-white transition ${isMicOn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
              }`}
          >
            {isMicOn ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5" />}
          </button>

          <button
            type="button"
            onClick={toggleNoiseSuppression}
            disabled={isMicOn && !noiseSuppressionAvailable}
            title={
              isMicOn && !noiseSuppressionAvailable
                ? "Supressão de ruído indisponível neste navegador"
                : noiseSuppressionOn
                  ? "Desativar supressão de ruído"
                  : "Ativar supressão de ruído"
            }
            aria-label={
              noiseSuppressionOn ? "Desativar supressão de ruído" : "Ativar supressão de ruído"
            }
            className={`rounded-lg p-2 text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${noiseSuppressionOn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-zinc-500 hover:bg-zinc-600"
              }`}
          >
            {noiseSuppressionOn ? (
              <NoiseSuppressionIcon className="h-5 w-5" />
            ) : (
              <NoiseSuppressionOffIcon className="h-5 w-5" />
            )}
          </button>

          <button
            type="button"
            onClick={toggleMicsMuted}
            title={micsMuted ? "Reativar microfones" : "Silenciar microfones"}
            aria-label={micsMuted ? "Reativar microfones" : "Silenciar microfones"}
            className={`rounded-lg p-2 text-white transition ${micsMuted ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
              }`}
          >
            {micsMuted ? (
              <HeadphonesOffIcon className="h-5 w-5" />
            ) : (
              <HeadphonesIcon className="h-5 w-5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setRenaming(false);
              setSwitching(false);
              setQualityOpen((q) => !q);
            }}
            title="Qualidade da transmissão — reduza se a sala estiver travando"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Qualidade: {shareResolution} · {shareFps}fps
          </button>

          {isSharing ? (
            <div className="flex items-center gap-2 border-l border-zinc-300 pl-3 dark:border-zinc-700">
              {localStream && (
                <button
                  type="button"
                  onClick={stopShare}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
                >
                  Parar tela
                </button>
              )}
              {localCameraStream && (
                <button
                  type="button"
                  onClick={stopCameraShare}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
                >
                  Parar câmera
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 border-l border-zinc-300 pl-3 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => startShare("display")}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                Compartilhar tela
              </button>
              <button
                type="button"
                onClick={() => startCameraShare()}
                disabled={screenShareMode === "unsupported"}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Compartilhar câmera
              </button>
            </div>
          )}
          {isSharing && (!localStream || !localCameraStream) && (
            <button
              type="button"
              onClick={localStream ? () => startCameraShare() : () => startShare("display")}
              disabled={!localStream && screenShareMode === "unsupported"}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {localStream ? "Compartilhar câmera" : "Compartilhar tela"}
            </button>
          )}
        </div>

        {renaming && (
          <form
            onSubmit={handleRenameSubmit}
            className="absolute inset-x-4 top-full z-20 mt-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 sm:inset-x-auto sm:right-4 sm:w-72"
          >
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Novo nome
            </label>
            <input
              autoFocus
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              maxLength={24}
              placeholder="Ex: Maria"
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            {state.nameError && <p className="mt-1 text-xs text-red-500">{state.nameError}</p>}
            <button
              type="submit"
              disabled={!renameInput.trim() || renameInput.trim() === state.name}
              className="mt-2 w-full rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Salvar nome
            </button>
          </form>
        )}

        {switching && (
          <form
            onSubmit={handleSwitchSubmit}
            className="absolute inset-x-4 top-full z-20 mt-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 sm:inset-x-auto sm:right-4 sm:w-72"
          >
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Nova sala
            </label>
            <input
              autoFocus
              value={switchInput}
              onChange={(e) => setSwitchInput(e.target.value)}
              placeholder="Ex: reuniao-time"
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={switchIsPrivate}
                onChange={(e) => {
                  setSwitchIsPrivate(e.target.checked);
                  setSwitchError(null);
                  if (!e.target.checked) {
                    setSwitchPassword("");
                    setShowSwitchPassword(false);
                  }
                }}
                className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
              />
              Sala privada
            </label>
            {switchIsPrivate && (
              <div className="mt-2 flex flex-col gap-2">
                <label htmlFor="switch-room-password" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Senha da sala
                </label>
                <input
                  id="switch-room-password"
                  type={showSwitchPassword ? "text" : "password"}
                  value={switchPassword}
                  onChange={(event) => setSwitchPassword(event.target.value)}
                  minLength={4}
                  maxLength={128}
                  autoComplete="new-password"
                  className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
                <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={showSwitchPassword}
                    onChange={(event) => setShowSwitchPassword(event.target.checked)}
                  />
                  Mostrar senha
                </label>
              </div>
            )}
            {switchError && <p className="mt-1 text-xs text-red-500">{switchError}</p>}
            <button
              type="submit"
              disabled={
                !switchInput.trim() ||
                switchingRoom ||
                (switchIsPrivate && !switchPassword.trim())
              }
              className="mt-2 w-full rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {switchingRoom ? "Verificando..." : "Ir para a sala"}
            </button>
            <Link
              href="/rooms"
              className="mt-2 block text-center text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Ver salas públicas ativas
            </Link>
          </form>
        )}

        {qualityOpen && (
          <div className="absolute inset-x-4 top-full z-20 mt-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 sm:inset-x-auto sm:right-4 sm:w-72">
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Qualidade da transmissão — reduza se a sala estiver travando
              </p>
              <button
                type="button"
                onClick={() => setQualityOpen(false)}
                aria-label="Fechar"
                title="Fechar"
                className="shrink-0 text-lg leading-none text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                ×
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex items-start gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={smartQualityEnabled}
                  onChange={(e) => setSmartQualityEnabled(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
                />
                <span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    Ativar controle inteligente de qualidade
                  </span>
                  <br />
                  Reduz resolução e bitrate automaticamente quando a sala tem muita gente. As opções abaixo viram o teto — a qualidade real pode ficar menor.
                </span>
              </label>

              <div>
                <label
                  htmlFor="share-resolution"
                  className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Resolução
                </label>
                <select
                  id="share-resolution"
                  value={shareResolution}
                  onChange={(e) => setShareResolution(e.target.value as typeof shareResolution)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                >
                  {SHARE_RESOLUTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="share-fps"
                  className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Taxa de quadros
                </label>
                <select
                  id="share-fps"
                  value={shareFps}
                  onChange={(e) => setShareFps(Number(e.target.value) as typeof shareFps)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                >
                  {SHARE_FPS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="share-bitrate"
                  className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Bitrate
                </label>
                <select
                  id="share-bitrate"
                  value={shareBitrate}
                  onChange={(e) => setShareBitrate(e.target.value as typeof shareBitrate)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                >
                  {SHARE_BITRATE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <legend className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Áudio do compartilhamento
                </legend>
                <div className="flex flex-col gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="share-audio-mode"
                      value="window"
                      checked={shareAudioMode === "window"}
                      disabled={Boolean(localStream)}
                      onChange={() => setShareAudioMode("window")}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">Somente esta janela (recomendado)</span>
                      <br />
                      Evita transmitir outros aplicativos quando o navegador oferecer suporte.
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="share-audio-mode"
                      value="system"
                      checked={shareAudioMode === "system"}
                      disabled={Boolean(localStream)}
                      onChange={() => setShareAudioMode("system")}
                      className="mt-0.5"
                    />
                    <span>Todo o áudio do computador</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="share-audio-mode"
                      value="none"
                      checked={shareAudioMode === "none"}
                      disabled={Boolean(localStream)}
                      onChange={() => setShareAudioMode("none")}
                      className="mt-0.5"
                    />
                    <span>Sem áudio</span>
                  </label>
                </div>
                {!isolatedWindowAudioSupported && (
                  <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    Áudio isolado indisponível neste navegador. Nesse modo, o compartilhamento será somente com vídeo.
                  </p>
                )}
                {localStream && (
                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Pare o compartilhamento de tela para trocar o modo de áudio.
                  </p>
                )}
              </fieldset>
            </div>
          </div>
        )}
      </header>

      {localStream && shareSource === "display" && shareAudioStatus && (
        <div
          className={`px-4 py-2 text-sm ${
            shareAudioStatus.kind === "unavailable"
              ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          }`}
        >
          <p>
            {shareAudioStatus.message}{" "}
            {shareAudioStatus.displaySurface !== "unknown" && (
              <span className="opacity-75">
                Fonte: {shareAudioStatus.displaySurface === "window" ? "janela" : shareAudioStatus.displaySurface === "browser" ? "aba" : "tela inteira"}.
              </span>
            )}
          </p>

          <details className="mt-1 text-xs">
            <summary className="cursor-pointer select-none font-medium opacity-80 hover:opacity-100">
              Diagnóstico da captura
            </summary>
            <div className="mt-2 max-w-xl rounded-md border border-current/20 bg-white/40 p-2 dark:bg-black/20">
              <p>
                <span className="font-semibold">Modo solicitado:</span>{" "}
                {SHARE_AUDIO_MODE_LABELS[shareAudioStatus.requestedMode]}
              </p>
              <p className="mt-2 font-semibold">Resultado observado:</p>
              <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-2 gap-y-1 break-all">
                {shareAudioStatus.displaySurface !== "unknown" && (
                  <><dt>Superfície de vídeo:</dt><dd>{shareAudioStatus.displaySurface}</dd></>
                )}
                {shareAudioStatus.videoTrackEnabled !== null && (
                  <><dt>Vídeo:</dt><dd>{shareAudioStatus.videoTrackEnabled && shareAudioStatus.videoTrackReadyState === "live" ? "ativo" : "inativo"}</dd></>
                )}
                <dt>Faixa de áudio recebida:</dt>
                <dd>{shareAudioStatus.audioRemovedForSafety ? "removida por segurança" : shareAudioStatus.audioTrackEnabled !== null ? "sim" : "não"}</dd>
                {shareAudioStatus.audioTrackEnabled !== null && !shareAudioStatus.audioRemovedForSafety && (
                  <><dt>Áudio:</dt><dd>{shareAudioStatus.audioTrackEnabled && shareAudioStatus.audioTrackReadyState === "live" ? "ativo" : "inativo"}</dd></>
                )}
                {shareAudioStatus.videoTrackLabel && (
                  <><dt>Rótulo do vídeo:</dt><dd>{shareAudioStatus.videoTrackLabel}</dd></>
                )}
                {shareAudioStatus.audioTrackLabel && (
                  <><dt>Rótulo do áudio:</dt><dd>{shareAudioStatus.audioTrackLabel}</dd></>
                )}
                {shareAudioStatus.audioTrackEnabled !== null && (
                  <><dt>Áudio habilitado:</dt><dd>{shareAudioStatus.audioTrackEnabled ? "sim" : "não"}</dd></>
                )}
                {shareAudioStatus.audioTrackMuted !== null && (
                  <><dt>Áudio silenciado:</dt><dd>{shareAudioStatus.audioTrackMuted ? "sim" : "não"}</dd></>
                )}
                {typeof shareAudioStatus.audioTrackSettings?.sampleRate === "number" && (
                  <><dt>Sample rate:</dt><dd>{shareAudioStatus.audioTrackSettings.sampleRate} Hz</dd></>
                )}
                {typeof shareAudioStatus.audioTrackSettings?.channelCount === "number" && (
                  <><dt>Canais:</dt><dd>{shareAudioStatus.audioTrackSettings.channelCount}</dd></>
                )}
                {shareAudioStatus.audioTrackSettings?.deviceId && (
                  <><dt>Device ID:</dt><dd>{shareAudioStatus.audioTrackSettings.deviceId}</dd></>
                )}
              </dl>
            </div>
          </details>
        </div>
      )}

      {shareError && (
        <p className="bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {shareError}
        </p>
      )}
      {micError && (
        <p className="bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {micError}
        </p>
      )}
      {cameraShareError && (
        <p className="bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {cameraShareError}
        </p>
      )}

      {Object.entries(remoteMicStreams).map(([peerId, stream]) => (
        <RemoteAudio
          key={peerId}
          stream={stream}
          muted={micsMuted || mutedPeerIds.has(peerId)}
          volume={peerVolumes[peerId] ?? 1}
        />
      ))}

      <div className="flex min-h-0 flex-1 flex-col gap-6 p-4 lg:flex-row">
        <main className="min-h-0 flex-1 overflow-y-auto">
          {nothingToShow ? (
            <div className="flex h-full min-h-75 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 text-center dark:border-zinc-800">
              <p className="text-zinc-600 dark:text-zinc-400">
                Ninguém está transmitindo ainda.
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                {screenShareMode === "camera"
                  ? 'Clique em "Compartilhar câmera" para começar.'
                  : 'Clique em "Compartilhar tela" para começar.'}
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
                {focusedPeerVisible && isSharing && localStream && (
                  <VideoTile
                    stream={localStream}
                    label="Você"
                    badge={shareSource === "camera" ? "câmera" : "transmitindo"}
                    muted
                    allowUnmute={false}
                    fill={isSingleTile}
                    onDoubleClick={() => setFocusedPeerId("self")}
                  />
                )}
                {focusedPeerVisible && localCameraStream && (
                  <VideoTile
                    stream={localCameraStream}
                    label="Você"
                    badge="câmera"
                    muted
                    allowUnmute={false}
                    fill={isSingleTile}
                    onDoubleClick={() => setFocusedPeerId("self")}
                  />
                )}
                {focusedScreenEntries.map(([peerId, stream]) => {
                  const peerName = state.peers.find((p) => p.id === peerId)?.name ?? "Alguém";
                  return (
                    <VideoTile
                      key={`screen-${peerId}`}
                      stream={stream}
                      label={peerName}
                      badge="ao vivo · tela"
                      muted
                      volume={transmissionVolumes[peerId] ?? 1}
                      onVolumeChange={(volume) => setTransmissionVolume(peerId, volume)}
                      fill={isSingleTile}
                      onStopWatching={() => stopWatchingPeer(peerId)}
                      onDoubleClick={() => setFocusedPeerId(peerId)}
                    />
                  );
                })}
                {focusedCameraEntries.map(([peerId, stream]) => {
                  const peerName = state.peers.find((p) => p.id === peerId)?.name ?? "Alguém";
                  return (
                    <VideoTile
                      key={`camera-${peerId}`}
                      stream={stream}
                      label={peerName}
                      badge="ao vivo · câmera"
                      muted
                      volume={transmissionVolumes[peerId] ?? 1}
                      onVolumeChange={(volume) => setTransmissionVolume(peerId, volume)}
                      fill={isSingleTile}
                      onDoubleClick={() => setFocusedPeerId(peerId)}
                    />
                  );
                })}
                {stoppedEntries.map((peer) => (
                  <StoppedPeerTile
                    key={`stopped-${peer.id}`}
                    label={peer.name}
                    fill={isSingleTile}
                    onResume={() => resumeWatchingPeer(peer.id)}
                  />
                ))}
                {resumingEntries.map((peer) => (
                  <ResumingPeerTile key={`resuming-${peer.id}`} fill={isSingleTile} />
                ))}
              </div>
            </>
          )}
        </main>

        <aside className="w-full shrink-0 lg:w-64">
          {(state.status === "connecting" || state.status === "closed") && (
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              Conectando...
            </p>
          )}
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Participantes
          </h2>
          <ul className="flex flex-col gap-1.5">
            <ParticipantRow
              name={state.name}
              isSelf
              micOn={isMicOn}
              sharing={isSharing}
              micStream={localMicStream}
            />
            {visiblePeers.map((p) => (
              <ParticipantRow
                key={p.id}
                name={p.name}
                micOn={p.mic}
                sharing={p.sharing}
                micStream={remoteMicStreams[p.id]}
                muted={micsMuted || mutedPeerIds.has(p.id)}
                onToggleMute={() => togglePeerMute(p.id)}
                volume={peerVolumes[p.id] ?? 1}
                onVolumeChange={(volume) => setPeerVolume(p.id, volume)}
              />
            ))}
          </ul>

          <ChatPanel
            messages={state.chatMessages}
            selfId={state.selfId}
            onSend={(text) => signalingClient.sendChatMessage(text)}
            onSendGif={(url) => signalingClient.sendGif(url)}
            blockedMessage={state.chatBlockedMessage}
          />

          <WebRtcDiagnosticsPanel selfId={state.selfId} peers={state.peers} />
        </aside>
      </div>
    </div>
  );
}

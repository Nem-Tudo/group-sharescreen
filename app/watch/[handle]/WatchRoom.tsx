"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
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
  SHARE_AUDIO_MODE_OPTIONS,
} from "@/lib/useRoomMedia";
import { trackEvent } from "@/lib/analytics";
import { toRoomHandle, isPrivateRoomHandle } from "@/lib/roomsApi";
import { useRoomSoundEffects } from "@/lib/useRoomSoundEffects";
import { getSoundEffectsEnabled, setSoundEffectsEnabled } from "@/lib/soundEffects";
import {
  getStoredMicsMuted,
  setStoredMicsMuted,
  getStoredPeerVolumes,
  setStoredPeerVolume,
  getStoredTransmissionVolumes,
  setStoredTransmissionVolume,
} from "@/lib/mediaPreferences";
import { VideoTile, StoppedPeerTile, ResumingPeerTile } from "@/components/VideoTile";
import { RemoteAudio } from "@/components/RemoteAudio";
import { ParticipantRow } from "@/components/ParticipantRow";
import { ChatPanel } from "@/components/ChatPanel";
import { PartnerCard } from "@/components/PartnerCard";
import {
  MicIcon,
  MicOffIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  NoiseSuppressionIcon,
  NoiseSuppressionOffIcon,
  LinkIcon,
  CheckIcon,
  SpeakerIcon,
  SpeakerMuteIcon,
} from "@/components/icons";
import { MdHome } from "react-icons/md";

// Mirrors server/signaling.ts's HANDLE_RE — must match exactly, or a name
// this lets through but the server rejects lands the user in a dead room
// (join fails server-side, but the client's already navigated to it).
const HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;

export function WatchRoom({ handle }: { handle: string }) {
  const router = useRouter();
  const state = useSignaling();
  useRoomSoundEffects(state);
  const hasStoredName = useHasStoredName();
  const { loading: resolvingAccount } = useAuth();
  const validHandle = HANDLE_RE.test(handle);
  const screenShareMode = useScreenShareMode();

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
    shareAudioMode,
    setShareAudioMode,
    smartQualityEnabled,
    setSmartQualityEnabled,
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
  const [nameInput, setNameInput] = useState("");
  const [micsMuted, setMicsMuted] = useState(() => getStoredMicsMuted());
  const [soundEffectsOn, setSoundEffectsOn] = useState(() => getSoundEffectsEnabled());
  const [mutedPeerIds, setMutedPeerIds] = useState<Set<string>>(new Set());
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>(() => getStoredPeerVolumes());
  const [transmissionVolumes, setTransmissionVolumes] = useState<Record<string, number>>(() =>
    getStoredTransmissionVolumes()
  );
  const [renaming, setRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [qualityOpen, setQualityOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [focusedPeerId, setFocusedPeerId] = useState<string | null>(null);
  const previousNameRef = useRef(state.name);

  // Same hydration-flash guard as page.tsx: useAccountToken()/
  // useHasStoredName() briefly report empty/false on the very first client
  // paint before correcting to the real localStorage-backed value, which
  // would otherwise flash the "choose a name" form for a logged-in account.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Closes the rename popover once the name actually changes — covers both
  // success (server confirmed the new name) and a plain reconnect, without
  // needing to guess at exact timing.
  useEffect(() => {
    if (renaming && state.name !== previousNameRef.current) {
      setRenaming(false);
      setRenameInput("");
    }
    previousNameRef.current = state.name;
  }, [state.name, renaming]);

  function toggleSoundEffects() {
    const next = !soundEffectsOn;
    setSoundEffectsOn(next);
    setSoundEffectsEnabled(next);
    trackEvent(next ? "sound_effects_on" : "sound_effects_off");
  }

  function toggleMicsMuted() {
    const next = !micsMuted;
    setMicsMuted(next);
    setStoredMicsMuted(next);
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

  // Keyed by the peer's stable userId (falling back to their current
  // connection id for a peer an older server hasn't sent one for yet) —
  // NOT the WebRTC connection id, so a saved dial survives that peer
  // reconnecting with a brand new connection id.
  function setPeerVolume(volumeKey: string, volume: number) {
    setPeerVolumes((prev) => ({ ...prev, [volumeKey]: volume }));
    setStoredPeerVolume(volumeKey, volume);
  }

  function setTransmissionVolume(volumeKey: string, volume: number) {
    setTransmissionVolumes((prev) => ({ ...prev, [volumeKey]: volume }));
    setStoredTransmissionVolume(volumeKey, volume);
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
    if (!validHandle || !state.name) return;
    signalingClient.joinRoom(handle);
    return () => {
      signalingClient.leaveRoom();
    };
  }, [validHandle, state.name, handle]);

  function handleNameSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    signalingClient.register(trimmed);
  }

  function handleRenameSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = renameInput.trim();
    if (!trimmed || trimmed === state.name) return;
    trackEvent("name_change");
    signalingClient.register(trimmed);
  }

  function handleSwitchSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = switchInput.trim();
    const fullHandle = toRoomHandle(trimmed, switchIsPrivate);
    if (!HANDLE_RE.test(fullHandle)) {
      setSwitchError("Use de 1 a 32 letras, números, - e _.");
      return;
    }
    setSwitching(false);
    setSwitchInput("");
    setSwitchError(null);
    trackEvent("room_switch");
    router.push(`/watch/${fullHandle}`);
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
        {false && <>

          <h2 style={{ color: "#ff2828", maxWidth: "500px", fontSize: "1.3rem" }}>Site fora do ar momentâneamente!!</h2>
          <h2 style={{ color: "#ff6767", maxWidth: "500px" }}>A API foi reiniciar pra atualizar e não consegue mais ligar por ter mais de 2000 pessoas tentando reconectar.</h2>
          <h2 style={{ color: "#ff6767", maxWidth: "500px" }}>Eu tô programando um sistema de balanceamento de carga. Aguentaí que já volta</h2>
          <h2 style={{ color: "#ff6767", maxWidth: "500px" }}>Deve voltar em uns 10 minutos</h2>
          <h2 style={{ color: "#67c7ff", maxWidth: "500px" }}>Para atualizações/sugestões/etc entre no meu Discord: <Link style={{ color: "#00ff00" }} href={"https://go.nemtudo.me/golive-nemtudodiscord"} target="_blank">discord.gg/nemtudo</Link></h2>
          <h2 style={{ color: "#67c7ff", maxWidth: "500px" }}>Me segue no Twitter tbm, sempre posto update e projeto por lá <Link style={{ color: "#00ff00" }} href={"https://go.nemtudo.me/golive-nemtudo-twitter"} target="_blank">x.com/NemTudo_</Link></h2>
        </>
        }
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white/80" />
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
          Você foi banido do site. Faz o L
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

  // A different guest/account already holds this name in this specific
  // room (see server/signaling.ts's "join" handler) — unlike "superseded"
  // above, nobody here was kicked; this connection just never got in, so a
  // different name lets it retry immediately instead of waiting/reloading.
  if (state.joinError) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Não foi possível entrar na sala {handle}
          </h1>
          <p className="mt-1 text-sm text-red-500">{state.joinError}</p>
          <form onSubmit={handleNameSubmit} className="mt-8 flex flex-col gap-3">
            <label htmlFor="join-error-name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Escolha outro nome
            </label>
            <input
              id="join-error-name"
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={24}
              placeholder="Ex: Maria"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <button
              type="submit"
              disabled={!nameInput.trim()}
              className="mt-2 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Entrar na sala
            </button>
          </form>
        </main>
      </div>
    );
  }

  if (!state.name) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Entrar na sala {handle}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Escolha um nome para entrar nesta sala.
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
              Entrar na sala
            </button>
          </form>
        </main>
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
            <Link href={"/"} className="text-lg font-semibold text-zinc-950 dark:text-zinc-50"><MdHome /></Link>
          </div>
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

          {/* A logged-in account's room name is locked server-side to its
              account record (see server/signaling.ts's "register" handler)
              — offering a rename control here would just error on every
              attempt (or worse, silently look like it did nothing), so it's
              hidden entirely instead of a confusing dead end. */}
          {!state.account && (
            <div className="relative">
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

              {renaming && (
                <form
                  onSubmit={handleRenameSubmit}
                  className="absolute right-0 top-full z-20 mt-2 w-72 max-w-[90vw] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
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
            </div>
          )}

          <div className="relative">
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

            {switching && (
              <form
                onSubmit={handleSwitchSubmit}
                className="absolute right-0 top-full z-20 mt-2 w-72 max-w-[90vw] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
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
                    onChange={(e) => setSwitchIsPrivate(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
                  />
                  Sala privada
                </label>
                {switchError && <p className="mt-1 text-xs text-red-500">{switchError}</p>}
                <button
                  type="submit"
                  disabled={!switchInput.trim()}
                  className="mt-2 w-full rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Ir para a sala
                </button>
                <Link
                  href="/rooms"
                  className="mt-2 block text-center text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  Ver salas públicas ativas
                </Link>
              </form>
            )}
          </div>

          <button
            type="button"
            onClick={toggleSoundEffects}
            title={soundEffectsOn ? "Desativar efeitos sonoros do site" : "Ativar efeitos sonoros do site"}
            aria-label={soundEffectsOn ? "Desativar efeitos sonoros do site" : "Ativar efeitos sonoros do site"}
            className={`rounded-lg p-2 text-white transition ${soundEffectsOn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-zinc-500 hover:bg-zinc-600"
              }`}
          >
            {soundEffectsOn ? (
              <SpeakerIcon className="h-5 w-5" />
            ) : (
              <SpeakerMuteIcon className="h-5 w-5" />
            )}
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

          <div className="relative">
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

            {qualityOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 w-72 max-w-[90vw] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
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
                </div>
              </div>
            )}
          </div>

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
                onChange={(e) => setSwitchIsPrivate(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
              />
              Sala privada
            </label>
            {switchError && <p className="mt-1 text-xs text-red-500">{switchError}</p>}
            <button
              type="submit"
              disabled={!switchInput.trim()}
              className="mt-2 w-full rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Ir para a sala
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

              <div>
                <label
                  htmlFor="share-audio-mode"
                  className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Áudio da transmissão
                </label>
                <select
                  id="share-audio-mode"
                  value={shareAudioMode}
                  onChange={(e) => setShareAudioMode(e.target.value as typeof shareAudioMode)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                >
                  {SHARE_AUDIO_MODE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 leading-tight">
                  {SHARE_AUDIO_MODE_OPTIONS.find((opt) => opt.value === shareAudioMode)?.description}
                </p>
              </div>
            </div>
          </div>
        )}
      </header>

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

      {Object.entries(remoteMicStreams).map(([peerId, stream]) => {
        const volumeKey = state.peers.find((p) => p.id === peerId)?.userId ?? peerId;
        return (
          <RemoteAudio
            key={peerId}
            stream={stream}
            muted={micsMuted || mutedPeerIds.has(peerId)}
            volume={peerVolumes[volumeKey] ?? 1}
          />
        );
      })}

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
                  const peer = state.peers.find((p) => p.id === peerId);
                  const peerName = peer?.name ?? "Alguém";
                  const volumeKey = peer?.userId ?? peerId;
                  return (
                    <VideoTile
                      key={`screen-${peerId}`}
                      stream={stream}
                      label={peerName}
                      badge="ao vivo · tela"
                      muted
                      volume={transmissionVolumes[volumeKey] ?? 1}
                      onVolumeChange={(volume) => setTransmissionVolume(volumeKey, volume)}
                      fill={isSingleTile}
                      onStopWatching={() => stopWatchingPeer(peerId)}
                      onDoubleClick={() => setFocusedPeerId(peerId)}
                    />
                  );
                })}
                {focusedCameraEntries.map(([peerId, stream]) => {
                  const peer = state.peers.find((p) => p.id === peerId);
                  const peerName = peer?.name ?? "Alguém";
                  const volumeKey = peer?.userId ?? peerId;
                  return (
                    <VideoTile
                      key={`camera-${peerId}`}
                      stream={stream}
                      label={peerName}
                      badge="ao vivo · câmera"
                      muted
                      volume={transmissionVolumes[volumeKey] ?? 1}
                      onVolumeChange={(volume) => setTransmissionVolume(volumeKey, volume)}
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

        {/* Capped and independently scrollable on small screens — without a
            bound here, participants/chat/the ad card could outgrow the
            space actually left below the video area and end up visually
            stacked wrong (the ad landing over the chat) instead of just
            being reachable by scrolling within this pane. Uncapped again
            from lg: on, where it already gets a fixed height matching
            <main> via lg:h-full. */}
        <aside className="flex w-full max-h-[50vh] shrink-0 flex-col overflow-y-auto lg:h-full lg:max-h-none lg:w-64">
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
            {visiblePeers.map((p) => {
              const volumeKey = p.userId ?? p.id;
              return (
                <ParticipantRow
                  key={p.id}
                  name={p.name}
                  micOn={p.mic}
                  sharing={p.sharing}
                  micStream={remoteMicStreams[p.id]}
                  muted={micsMuted || mutedPeerIds.has(p.id)}
                  onToggleMute={() => togglePeerMute(p.id)}
                  volume={peerVolumes[volumeKey] ?? 1}
                  onVolumeChange={(volume) => setPeerVolume(volumeKey, volume)}
                />
              );
            })}
          </ul>

          <ChatPanel
            messages={state.chatMessages}
            selfId={state.selfId}
            selfName={state.name}
            onSend={(text) => signalingClient.sendChatMessage(text)}
            onSendGif={(url) => signalingClient.sendGif(url)}
            blockedMessage={state.chatBlockedMessage}
          />

          <PartnerCard />
        </aside>
      </div>
    </div>
  );
}

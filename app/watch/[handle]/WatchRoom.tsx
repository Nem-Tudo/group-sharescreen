"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signalingClient, type RoomPermissionKey } from "@/lib/signalingClient";
import { useSignaling, useHasStoredName } from "@/lib/useSignaling";
import { useAuth } from "@/lib/AuthContext";
import {
  useRoomMedia,
  useScreenShareMode,
  SHARE_RESOLUTION_OPTIONS,
  SHARE_FPS_OPTIONS,
  SHARE_BITRATE_OPTIONS,
} from "@/lib/useRoomMedia";
import { trackEvent } from "@/lib/analytics";
import { copyText } from "@/lib/clipboard";
import {
  toRoomHandle,
  isPrivateRoomHandle,
  toPrivateRoomHandle,
  generateRoomCode,
  splitPrivateRoomHandle,
  MAX_PRIVATE_ROOM_NAME_LENGTH,
} from "@/lib/roomsApi";
import { rememberRecentRoom } from "@/lib/recentRooms";
import { useRoomSoundEffects } from "@/lib/useRoomSoundEffects";
import { useBackgroundKeepAlive } from "@/lib/useBackgroundKeepAlive";
import { getSoundEffectsEnabled, setSoundEffectsEnabled } from "@/lib/soundEffects";
import { qualityNegotiator } from "@/lib/qualityNegotiation";
import { TURN_CONFIGURED } from "@/lib/iceConfig";
import { useMediaDevices, type MediaDeviceOption } from "@/lib/useMediaDevices";
import {
  getStoredMicsMuted,
  setStoredMicsMuted,
  getStoredPeerVolumes,
  setStoredPeerVolume,
  getStoredTransmissionVolumes,
  setStoredTransmissionVolume,
  getStoredGuestAccountBannerDismissed,
  setStoredGuestAccountBannerDismissed,
  getStoredOpenRoomsInApp,
  setStoredOpenRoomsInApp,
  setStoredOpenInAppDismissed,
} from "@/lib/mediaPreferences";
import { VideoTile, StoppedPeerTile, ResumingPeerTile } from "@/components/VideoTile";
import { RemoteAudio } from "@/components/RemoteAudio";
import { ParticipantRow } from "@/components/ParticipantRow";
import { ChatPanel } from "@/components/ChatPanel";
import { OpenInAppBanner } from "@/components/OpenInAppBanner";
import { RoomInfoControls } from "@/components/RoomInfoControls";
import { isDesktopApp } from "@/lib/desktop";
import { PartnerCard } from "@/components/PartnerCard";
import { SupportersTooltipContent } from "@/components/SupportersTooltip";
import { DisplayUserName } from "@/components/DisplayUserName";
import { CreateAccountForm } from "@/components/CreateAccountForm";
import { LoginForm } from "@/components/LoginForm";
import { VideoSourceTile } from "@/components/VideoSourceTile";
import { videoSourceVolumeKey, type VideoSourceKind } from "@/lib/videoSource";
import useNtPopups from "ntpopups";
import {
  MicIcon,
  MicOffIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  NoiseSuppressionIcon,
  NoiseSuppressionOffIcon,
  ShieldIcon,
  ShieldOffIcon,
  LinkIcon,
  CheckIcon,
  SpeakerIcon,
  SpeakerMuteIcon,
  MoreIcon,
  VerifiedBadgeIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  ScreenIcon,
  CameraIcon,
} from "@/components/icons";
import { Tooltip, Popover } from "@/components/Tooltip";
import { useMediaQuery, SM_BREAKPOINT_QUERY, LG_BREAKPOINT_QUERY } from "@/lib/useMediaQuery";
import {
  MdHome,
  MdOutlineOndemandVideo,
  MdOutlineDesktopWindows,
  MdOutlineMap,
  MdLogin,
  MdOutlineChat,
  MdOutlinePeople,
} from "react-icons/md";
import { BsGearFill, BsCoin } from "react-icons/bs";
import { BetaMark } from "@/components/BetaMark";
import { UpdateAppButton } from "@/components/UpdateAppButton";

// Mirrors server/signaling.ts's HANDLE_RE — must match exactly, or a name
// this lets through but the server rejects lands the user in a dead room
// (join fails server-side, but the client's already navigated to it).
const HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;

// A label + on/off pill for the header's consolidated "more options" panel
// (see WatchRoom below) — every toggle in there (sound effects, noise
// suppression, mute mics) follows the exact same green-on/gray-off shape
// the old per-button icons used, just as a full-width row instead of a
// standalone icon button.
function MenuToggleRow({
  label,
  active,
  onToggle,
  activeIcon,
  inactiveIcon,
  disabled = false,
  hint,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  activeIcon: ReactNode;
  inactiveIcon: ReactNode;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  return (
    // The wrapper is what a disabled row's hint hangs off of: a disabled
    // button emits no pointer events of its own, and "why is this off?" is
    // exactly the row that most needs explaining.
    <Tooltip content={hint} wrapperClassName="flex w-full">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        <span>{label}</span>
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white ${active ? "bg-emerald-600" : "bg-zinc-500"
            }`}
        >
          {active ? activeIcon : inactiveIcon}
        </span>
      </button>
    </Tooltip>
  );
}

// One row in the mic/speaker/camera device-picker popovers (see the split
// buttons next to the mic and mics-muted controls, and the camera segment of
// ShareControls, below).
function DeviceMenuOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition ${selected
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
    >
      <span className="truncate">{label}</span>
      {selected && <CheckIcon className="h-4 w-4 shrink-0" />}
    </button>
  );
}

type RoomMedia = ReturnType<typeof useRoomMedia>;

// The quality dials + live telemetry — shared verbatim between the mobile
// "Mais opções" dropdown (see WatchRoom below) and the desktop quick-access
// popover, so there is exactly one copy of this markup to keep in sync
// instead of two drifting variants of the same controls.
function QualityControls({
  smartQualityEnabled,
  setSmartQualityEnabled,
  shareProfile,
  setShareProfile,
  shareFps,
  setShareFps,
  shareResolution,
  setShareResolution,
  shareBitrate,
  setShareBitrate,
  hasAccount,
  isSharing,
  meshCapacity,
  meshTopology,
}: Pick<
  RoomMedia,
  | "smartQualityEnabled"
  | "setSmartQualityEnabled"
  | "shareProfile"
  | "setShareProfile"
  | "shareFps"
  | "setShareFps"
  | "shareResolution"
  | "setShareResolution"
  | "shareBitrate"
  | "setShareBitrate"
  | "isSharing"
  | "meshCapacity"
  | "meshTopology"
> & { hasAccount: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-3">
        <label className="flex items-start gap-2 rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
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
            Envia para cada pessoa só a qualidade que a tela dela realmente usa — quem
            está num quadradinho não recebe 1080p à toa. Economiza sua internet e seu
            processador. As opções abaixo viram o teto.
          </span>
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            O que você está compartilhando
          </span>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "text", label: "Texto / código", hint: "prioriza nitidez" },
                { value: "motion", label: "Vídeo / jogo", hint: "prioriza fluidez" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setShareProfile(opt.value)}
                className={`rounded-md border px-2 py-1.5 text-left text-xs transition ${shareProfile === opt.value
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
              >
                <span className="block font-medium">{opt.label}</span>
                <span className="block opacity-70">{opt.hint}</span>
              </button>
            ))}
          </div>
          {/* Was `shareFps > 60`, which only ever fired for the account-only
              120fps option — the far more common 60fps pick (see
              SHARE_FPS_OPTIONS) triggered nothing, silently leaving anyone
              who bumped fps without also switching profile to sit through
              exactly the slideshow degradationPreference's own comment
              warns about (see peerQualityController.ts). setShareProfile
              clamps fps back to 30 when switching *into* "text" for the
              same reason — this is the mirror case, raising fps while
              already there, and needs the same threshold. */}
          {shareProfile === "text" && shareFps > 30 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
              Acima de 30fps, escolha &quot;Vídeo / jogo&quot; — no modo texto o
              navegador descarta quadros para manter a nitidez.
            </p>
          )}
        </div>

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
              <option key={opt.value} value={opt.value} disabled={opt.accountOnly && !hasAccount}>
                {opt.label}
                {opt.accountOnly && !hasAccount ? " (conta necessária)" : ""}
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
              <option key={opt.value} value={opt.value} disabled={opt.accountOnly && !hasAccount}>
                {opt.label}
                {opt.accountOnly && !hasAccount ? " (conta necessária)" : ""}
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
              <option key={opt.value} value={opt.value} disabled={opt.accountOnly && !hasAccount}>
                {opt.label}
                {opt.accountOnly && !hasAccount ? " (conta necessária)" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Live measurements, shown only while actually transmitting. This is
            what the quality decisions are made from — surfacing it turns "the
            room is laggy" into something diagnosable instead of a guess. */}
        {isSharing && meshCapacity.sampledAt > 0 && (
          <div className="rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            <div className="flex justify-between gap-2">
              <span>Sua banda de subida</span>
              <span className="font-medium text-zinc-900 tabular-nums dark:text-zinc-100">
                {meshCapacity.availableOutgoingKbps > 0
                  ? `${(meshCapacity.availableOutgoingKbps / 1000).toFixed(1)} Mbps`
                  : "medindo…"}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Em uso agora</span>
              <span className="font-medium text-zinc-900 tabular-nums dark:text-zinc-100">
                {(meshCapacity.usedOutgoingKbps / 1000).toFixed(1)} Mbps
              </span>
            </div>
            {meshCapacity.cpuPressure > 0.25 && (
              <p className="mt-1 text-amber-600 dark:text-amber-500">
                Seu processador está no limite — baixe a resolução ou os fps.
              </p>
            )}
            {meshTopology.reason && (
              <p className="mt-1 text-zinc-700 dark:text-zinc-300">{meshTopology.reason}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// The room's one transmission control: a settings gear, a screen toggle and a
// camera toggle glued into a single segmented button.
//
// It replaces four wide buttons ("Compartilhar tela", "Compartilhar câmera",
// "Parar tela", "Parar câmera") that were really two toggles wearing four
// labels — and that had to be laid out differently for each of the four
// combinations of what happened to be live, which is why the header row
// reflowed every time a share started or stopped. Two icons that each carry
// their own state say the same thing in one fixed shape.
//
// Colour is the state: green means "this will start", red means "this will
// stop", matching what those four buttons already used. The gear is green
// with them rather than neutral — it has no state of its own to report, and
// an outlined segment between two solid ones read as a separate control
// sitting next to the group instead of as part of it. It opens the same
// QualityControls panel used everywhere else.
function ShareControls({
  screenSharing,
  cameraSharing,
  screenSupported,
  cameraSupported,
  screenBlockedReason,
  cameraBlockedReason,
  onToggleScreen,
  onToggleCamera,
  cameraDevices,
  cameraDeviceId,
  setCameraDevice,
  cameraMenuOpen,
  setCameraMenuOpen,
  open,
  setOpen,
  quality,
}: {
  screenSharing: boolean;
  cameraSharing: boolean;
  // getDisplayMedia exists (desktop). A phone has no screen capture at all,
  // and the old labelled button simply threw a visible error when tapped
  // there; an icon has no room to explain itself, so it is disabled with the
  // reason in its tooltip instead.
  screenSupported: boolean;
  cameraSupported: boolean;
  // Set when the *room* — not the browser — is what's in the way: its owner
  // turned this channel off for ordinary members (see WatchRoom's
  // roomPermissions). Only ever blocks *starting*: whoever is already
  // transmitting when a switch flips keeps the button that stops them, which
  // is also what the auto-stop effect in WatchRoom uses.
  screenBlockedReason?: string | null;
  cameraBlockedReason?: string | null;
  onToggleScreen: () => void;
  onToggleCamera: () => void;
  // The camera-source picker hanging off the camera segment: a machine with
  // a webcam *and* a capture card (or a phone with two lenses) would
  // otherwise be stuck with whichever one the browser happens to open
  // first, with no way to change it from inside the room.
  cameraDevices: MediaDeviceOption[];
  cameraDeviceId: string | null;
  setCameraDevice: (deviceId: string | null) => void;
  cameraMenuOpen: boolean;
  setCameraMenuOpen: Dispatch<SetStateAction<boolean>>;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  quality: Pick<
    RoomMedia,
    | "smartQualityEnabled"
    | "setSmartQualityEnabled"
    | "shareProfile"
    | "setShareProfile"
    | "shareFps"
    | "setShareFps"
    | "shareResolution"
    | "setShareResolution"
    | "shareBitrate"
    | "setShareBitrate"
    | "isSharing"
    | "meshCapacity"
    | "meshTopology"
  > & { hasAccount: boolean };
}) {
  const segment =
    "flex items-center px-3 py-2 text-white transition disabled:cursor-not-allowed disabled:opacity-50";
  const live = "bg-red-600 hover:bg-red-700";
  const idle = "bg-emerald-600 hover:bg-emerald-700";

  const screenBlocked = !screenSharing && Boolean(screenBlockedReason);
  const cameraBlocked = !cameraSharing && Boolean(cameraBlockedReason);
  const screenLabel = screenSharing
    ? "Parar de compartilhar a tela"
    : screenBlockedReason
      ? screenBlockedReason
      : screenSupported
        ? "Compartilhar tela"
        : "Seu navegador não permite compartilhar a tela";
  const cameraLabel = cameraSharing
    ? "Parar câmera"
    : cameraBlockedReason
      ? cameraBlockedReason
      : cameraSupported
        ? "Compartilhar câmera"
        : "Seu navegador não permite usar a câmera";

  return (
    <div className="flex items-stretch overflow-hidden rounded-lg">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        placement="bottom-end"
        tooltip="Qualidade da transmissão"
        content={
          <div className="w-80 max-w-[calc(100vw-1rem)]">
            <QualityControls {...quality} />
          </div>
        }
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Qualidade da transmissão"
          className="flex items-center border-r border-black/15 bg-emerald-600 px-2 text-white transition hover:bg-emerald-700"
        >
          <BsGearFill className="h-3.5 w-3.5" />
        </button>
      </Popover>
      {/* Wrapped so the tooltip still opens while the button is disabled —
          which is the one state where it has something to explain. */}
      <Tooltip content={screenLabel} wrapperClassName="flex">
        <button
          type="button"
          onClick={onToggleScreen}
          disabled={!screenSupported || screenBlocked}
          aria-pressed={screenSharing}
          aria-label={screenLabel}
          className={`${segment} ${screenSharing ? live : idle}`}
        >
          <ScreenIcon className="h-5 w-5" />
        </button>
      </Tooltip>
      <Tooltip content={cameraLabel} wrapperClassName="flex">
        <button
          type="button"
          onClick={onToggleCamera}
          disabled={!cameraSupported || cameraBlocked}
          aria-pressed={cameraSharing}
          aria-label={cameraLabel}
          className={`${segment} border-l border-black/15 ${cameraSharing ? live : idle}`}
        >
          <CameraIcon className="h-5 w-5" />
        </button>
      </Tooltip>
      {/* Only where there is actually a choice to make: on the one-webcam
          laptop that most people are on, a chevron whose menu offers a
          single entry is pure clutter. Enumeration fills in after the first
          camera permission, so this can appear mid-session — which is also
          when it starts being useful. */}
      {cameraSupported && cameraDevices.length > 1 && (
        <Popover
          open={cameraMenuOpen}
          onClose={() => setCameraMenuOpen(false)}
          placement="bottom-end"
          tooltip="Escolher câmera"
          content={
            <div className="w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-zinc-300 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <DeviceMenuOption
                label="Padrão do sistema"
                selected={cameraDeviceId === null}
                onClick={() => {
                  setCameraDevice(null);
                  setCameraMenuOpen(false);
                }}
              />
              {cameraDevices.map((d) => (
                <DeviceMenuOption
                  key={d.deviceId}
                  label={d.label}
                  selected={cameraDeviceId === d.deviceId}
                  onClick={() => {
                    setCameraDevice(d.deviceId);
                    setCameraMenuOpen(false);
                  }}
                />
              ))}
            </div>
          }
        >
          <button
            type="button"
            onClick={() => setCameraMenuOpen((o) => !o)}
            aria-label="Escolher câmera"
            className={`flex items-center border-l border-black/15 px-1 text-white transition ${cameraSharing ? live : idle}`}
          >
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </button>
        </Popover>
      )}
    </div>
  );
}

// Same reasoning as QualityControls above: one copy of the "switch room"
// form, shared between the mobile dropdown and the desktop popover.
function SwitchRoomFields({
  switchInput,
  setSwitchInput,
  switchIsPrivate,
  setSwitchIsPrivate,
  switchError,
  onSubmit,
}: {
  switchInput: string;
  setSwitchInput: (value: string) => void;
  switchIsPrivate: boolean;
  setSwitchIsPrivate: (value: boolean) => void;
  switchError: string | null;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
    >
      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Nova sala
      </label>
      <input
        autoFocus
        value={switchInput}
        onChange={(e) => setSwitchInput(e.target.value)}
        placeholder="Ex: reuniao-time ou priv-familia-123456"
        className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
      />
      <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        <input
          type="checkbox"
          checked={switchIsPrivate}
          onChange={(e) => setSwitchIsPrivate(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
        />
        Criar sala privada (gera um código)
      </label>
      {/* Says what the box above already accepts, so nobody assumes the
          only way back into a private room is the home page. */}
      <p className="mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-500">
        Para entrar numa sala privada que já existe, cole o nome.
      </p>
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
  );
}

// Spotlight and hyperfocus address tiles by id, and those ids share one
// namespace with peer connection ids and "self" — so a source's tile id is
// prefixed rather than being its bare id.
const VIDEO_SOURCE_TILE_PREFIX = "video-source:";
function videoSourceTileId(sourceId: string): string {
  return VIDEO_SOURCE_TILE_PREFIX + sourceId;
}

// Which of the two sheets the bottom bar has open below lg — see
// WatchRoom's mobilePanel.
type MobilePanel = "participants" | "chat";

// The bottom bar below lg. Its controls are thumb-sized (44px is the
// smallest target a finger hits reliably) rather than the header's compact
// desktop ones, and they keep the colour language those already use: emerald
// for "on, or ready to start", red for "off" — and for a transmission that
// is live, where the next tap stops it.
//
// Each control fills a DOCK_SLOT rather than being flex-1 itself, because
// every one of them is wrapped by its tooltip: a disabled button fires no
// pointer events, and the disabled state is exactly when the tooltip has
// something to say (see Tooltip's wrapperClassName).
const DOCK_SLOT = "flex min-w-0 flex-1";
const DOCK_BUTTON =
  "flex h-11 w-full min-w-10 items-center justify-center rounded-xl text-white transition disabled:cursor-not-allowed disabled:opacity-50";
const DOCK_ON = "bg-emerald-600 active:bg-emerald-700";
const DOCK_OFF = "bg-red-600 active:bg-red-700";
// Same red as DOCK_OFF, named apart because it means the opposite thing: not
// "this is switched off" but "this is on the air".
const DOCK_LIVE = "bg-red-600 active:bg-red-700";
const DOCK_TAB =
  "flex h-11 min-w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 transition";
const DOCK_TAB_ACTIVE = "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950";
const DOCK_TAB_IDLE =
  "text-zinc-600 active:bg-zinc-100 dark:text-zinc-400 dark:active:bg-zinc-900";

export function WatchRoom({ handle }: { handle: string }) {
  const router = useRouter();
  const state = useSignaling();
  useRoomSoundEffects(state);
  // Keeps the tab's connection alive longer in the background on Android
  // while actually in a room — see the hook's own doc comment for why (and
  // its limits, especially on iOS).
  useBackgroundKeepAlive(Boolean(state.room));
  const hasStoredName = useHasStoredName();
  const { loading: resolvingAccount, account, points } = useAuth();
  const { openPopup } = useNtPopups();
  const validHandle = HANDLE_RE.test(handle);
  // Name and access code, for a private room whose handle carries one — null
  // for a public room, and for a private one predating the code scheme.
  const privateRoomParts = splitPrivateRoomHandle(handle);
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
    cameraDeviceId,
    setCameraDevice,
    stoppedCameraPeers,
    resumingCameraPeers,
    stopWatchingCameraPeer,
    resumeWatchingCameraPeer,
    shareResolution,
    setShareResolution,
    shareFps,
    setShareFps,
    shareBitrate,
    setShareBitrate,
    smartQualityEnabled,
    shareProfile,
    setShareProfile,
    meshCapacity,
    meshTopology,
    setSmartQualityEnabled,
    isMicOn,
    toggleMic,
    micError,
    localMicStream,
    remoteMicStreams,
    micConnectionStates,
    micDeviceId,
    setMicDevice,
    speakerDeviceId,
    setSpeakerDevice,
    noiseSuppressionOn,
    noiseSuppressionAvailable,
    toggleNoiseSuppression,
    forceRelayIce,
    toggleForceRelayIce,
    autoJoin,
    toggleAutoJoin,
  } = useRoomMedia(handle);

  const [switching, setSwitching] = useState(false);
  const [switchInput, setSwitchInput] = useState("");
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchIsPrivate, setSwitchIsPrivate] = useState(false);
  const [nameInput, setNameInput] = useState("");
  // Toggles the first-time name gate below between "pick a name" and "create
  // an account" — mirrors the home page's identity flow so a guest who lands
  // straight in a room link isn't missing the option.
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [guestBannerDismissed, setGuestBannerDismissed] = useState(() =>
    getStoredGuestAccountBannerDismissed()
  );
  // The mid-session identity modal: null when closed, otherwise which half
  // of it is showing. Reuses the same forms as the pre-join gate and the
  // home page, just in a modal since this fires with a room already
  // running. Opened as "create" from the guest banner below (which is
  // specifically an offer to keep your name) and as "login" from the header
  // button (someone who already has an account); either side switches to
  // the other, so neither entry point is a dead end.
  const [accountModal, setAccountModal] = useState<"login" | "create" | null>(null);
  // "Sempre abrir salas no aplicativo" — the same preference the
  // OpenInAppBanner sets, surfaced here so it can be turned back off. Read
  // through the mounted gate below rather than a lazy initializer, because
  // whether we are *inside* the app is a client-only fact and rendering the
  // row differently on the server would hydrate into a mismatch.
  const [openRoomsInApp, setOpenRoomsInApp] = useState(false);
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
  const [micDeviceMenuOpen, setMicDeviceMenuOpen] = useState(false);
  const [speakerDeviceMenuOpen, setSpeakerDeviceMenuOpen] = useState(false);
  const [cameraDeviceMenuOpen, setCameraDeviceMenuOpen] = useState(false);
  const {
    mics: micDevices,
    speakers: speakerDevices,
    cameras: cameraDevices,
    canSelectSpeaker,
  } = useMediaDevices();
  // One gear now serves both toggles (see ShareControls), so there is one
  // panel to open instead of the two that the two separate share buttons
  // each carried their own copy of.
  const [shareQualityOpen, setShareQualityOpen] = useState(false);
  // "Focar": grows one tile and shrinks the rest without touching any
  // connection — see the grid render below, which gives this id's tile a
  // 2x2 grid span instead of hiding everyone else.
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  // "Hiperfoco": grows one tile to near-fullscreen and hides + actively
  // disconnects every other transmission (see enterHyperfocus below) to
  // actually free up bandwidth/CPU, not just screen space. Mutually
  // exclusive with spotlightId.
  const [hyperfocusId, setHyperfocusId] = useState<string | null>(null);
  // "Adicionar fonte de vídeo" itself lives in the AddVideoSourceModal
  // popup (see handleAddVideoSource below) — nothing about that box's own
  // state belongs here.
  // Video sources this viewer stepped out of (the eye button on a source
  // they didn't add). Purely local — the video keeps playing for the room,
  // and the tile is replaced by the same "you left this" placeholder a
  // stopped transmission gets, so there's a way back in.
  const [leftVideoSourceIds, setLeftVideoSourceIds] = useState<Set<string>>(new Set());
  // Consolidates every header control except the mic toggle and the
  // share/camera transmission buttons into one "more options" panel — see
  // the header below. Those sub-toggles (renaming/switching/qualityOpen)
  // now live *inside* that panel instead of behind their own separate
  // buttons, so closing the panel also collapses whichever of them was left
  // open (see closeMenu below).
  const [menuOpen, setMenuOpen] = useState(false);
  // Picks which shell that panel gets: a popover anchored to the button from
  // sm up, the bottom sheet below it (see menuItems further down). Reports
  // false until the first client paint, so the sheet is what a phone gets
  // without waiting on JS to agree.
  const isDesktopLayout = useMediaQuery(SM_BREAKPOINT_QUERY);
  // From lg up: participants get their own full-height column on the left,
  // chat one on the right — see participantsSection/chatSection below.
  // Below lg, they share one pane via the tab switcher right below instead.
  const isWideLayout = useMediaQuery(LG_BREAKPOINT_QUERY);
  // Below lg the room is an app shell rather than a page: the header, the
  // video, and the bar at the bottom of the screen divide the viewport
  // between them and nothing scrolls except the inside of a pane. This is
  // which sheet that bottom bar currently has open over the video — null
  // meaning neither, so the video has the whole area to itself. Unused from
  // lg up, where the list and the chat each have a permanent column.
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null);

  // The bottom bar's two panel buttons are toggles: tapping the sheet that's
  // already up puts it away again, which is the gesture people try first and
  // the only way back to a full-screen video.
  function toggleMobilePanel(panel: MobilePanel) {
    setMobilePanel((current) => (current === panel ? null : panel));
  }

  // Below lg the chat spends most of its time behind a closed sheet, so its
  // button in the bottom bar carries a count — without one, a room talking
  // behind that sheet is completely silent. "Read" means it was on screen
  // when it arrived; the log the server hands over the moment we join counts
  // as read too, or walking into any busy room would open on a badge nobody
  // has any intention of scrolling back through.
  //
  // Adjusted during render rather than from an effect (see React's "you
  // might not need an effect"): this is state derived from a prop-like value
  // changing, and an effect would render the stale count first and only then
  // correct it.
  const chatMessageCount = state.chatMessages.length;
  const chatOnScreen = isWideLayout || mobilePanel === "chat";
  const [seenChatCount, setSeenChatCount] = useState<number | null>(null);
  let nextSeenChatCount = seenChatCount;
  if (chatMessageCount === 0) {
    // Nothing has arrived yet (or the log was wiped) — leave the mark unset
    // so the first batch to land is what gets treated as history.
    nextSeenChatCount = null;
  } else if (seenChatCount === null || chatOnScreen) {
    nextSeenChatCount = chatMessageCount;
  } else if (seenChatCount > chatMessageCount) {
    nextSeenChatCount = chatMessageCount;
  }
  if (nextSeenChatCount !== seenChatCount) setSeenChatCount(nextSeenChatCount);
  const unreadChatCount = Math.max(0, chatMessageCount - (nextSeenChatCount ?? chatMessageCount));
  const previousNameRef = useRef(state.name);

  // Same hydration-flash guard as page.tsx: useAccountToken()/
  // useHasStoredName() briefly report empty/false on the very first client
  // paint before correcting to the real localStorage-backed value, which
  // would otherwise flash the "choose a name" form for a logged-in account.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      setMounted(true);
      // Read here rather than from a lazy initializer: localStorage does not
      // exist during the server render, and this is already the one deferred
      // point where client-only facts become safe to look at.
      setOpenRoomsInApp(getStoredOpenRoomsInApp());
    }, 0);
    return () => clearTimeout(id);
  }, []);

  function toggleOpenRoomsInApp() {
    setOpenRoomsInApp((prev) => {
      const next = !prev;
      setStoredOpenRoomsInApp(next);
      // Turning it on from here also clears any earlier "agora não", so the
      // two controls cannot end up disagreeing about what was decided.
      if (next) setStoredOpenInAppDismissed(false);
      trackEvent(next ? "open_rooms_in_app_on" : "open_rooms_in_app_off");
      return next;
    });
  }

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


  const [chatWidth, setChatWidth] = useState(() => {
    if (typeof window === "undefined") return 288;

    const saved = localStorage.getItem("chat-panel-width");
    const width = saved ? Number(saved) : 288;

    return Number.isFinite(width)
      ? Math.min(Math.max(width, 240), 1000)
      : 288;
  });
  const isResizingChatRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("chat-panel-width", String(chatWidth));
  }, [chatWidth]);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isResizingChatRef.current) return;

      // O lado direito do layout permanece parado.
      // O mouse controla diretamente a posição da borda esquerda.
      const rightEdge = window.innerWidth - 16; // padding direito do container
      const newWidth = rightEdge - e.clientX;

      setChatWidth(Math.min(Math.max(newWidth, 240), 1000));
    }

    function handleMouseUp() {
      if (!isResizingChatRef.current) return;

      isResizingChatRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  function startChatResize(e: React.MouseEvent) {
    e.preventDefault();
    isResizingChatRef.current = true;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }

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

  function closeMenu() {
    setMenuOpen(false);
    setRenaming(false);
    setSwitching(false);
    setQualityOpen(false);
    setShareQualityOpen(false);
  }

  async function handleCopyLink() {
    // copyText, not navigator.clipboard directly: the desktop shell denies
    // the clipboard permission on builds already installed out there, and
    // the fallback inside copyText is what keeps this button working for
    // them. See lib/clipboard.ts.
    if (!(await copyText(window.location.href))) {
      // Nothing sensible to do beyond leaving the button unconfirmed.
      return;
    }
    trackEvent("room_link_copied");
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
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

  // Remember the room only after join actually lands — navigating to
  // /watch/... isn't enough, since a failed join would then pin a dead
  // link on the home page. localStorage, not session, so it survives the
  // leave that takes them back there.
  useEffect(() => {
    if (state.room !== handle) return;
    rememberRecentRoom(handle);
  }, [state.room, handle]);

  // Clears the hyperfocus state once its target is gone (see
  // activeHyperfocusId further down, which already makes the *render* behave
  // as un-focused). Without this the stale id would silently re-engage
  // hyperfocus the moment that same peer started transmitting again. Up here
  // among the other effects because everything below is past an early
  // return; deferred out of the effect body because a setState there is a
  // cascading render.
  useEffect(() => {
    if (hyperfocusId === null) return;
    const gone =
      hyperfocusId === "self"
        ? !((isSharing && localStream) || localCameraStream)
        : hyperfocusId.startsWith(VIDEO_SOURCE_TILE_PREFIX)
          ? !state.videoSources.some((v) => videoSourceTileId(v.id) === hyperfocusId)
          : !(hyperfocusId in remoteStreams) && !(hyperfocusId in remoteCameraStreams);
    if (!gone) return;
    queueMicrotask(() => setHyperfocusId(null));
  }, [
    hyperfocusId,
    isSharing,
    localStream,
    localCameraStream,
    remoteStreams,
    remoteCameraStreams,
    state.videoSources,
  ]);

  // Who runs this room, and therefore which of its controls this viewer gets.
  // Both ids compared here are *stable* ones (see PeerInfo.userId) — a
  // connection id would lose the crown on every reconnect.
  const isRoomOwner = Boolean(state.selfUserId && state.roomOwnerId === state.selfUserId);
  const isRoomAdmin = Boolean(
    state.selfUserId && state.roomAdmins.some((a) => a.id === state.selfUserId)
  );
  // The owner and the admins they promoted are never subject to the room's
  // own permission switches — turning one off is how they say "from here on,
  // only us" (mirrors the server's canUseRoomPermission, which is what
  // actually enforces it; this copy only decides what to render).
  const isRoomManager = isRoomOwner || isRoomAdmin;
  function canUseRoomPermission(key: RoomPermissionKey): boolean {
    return state.roomPermissions[key] || isRoomManager;
  }
  // Populated only for the ones this viewer is actually blocked on, so a
  // control can use `?? undefined` and get its ordinary label back.
  function roomBlockReason(key: RoomPermissionKey, what: string): string | null {
    return canUseRoomPermission(key) ? null : `Você não tem permissão para utilizar ${what} nesta sala.`;
  }
  // Only public rooms are on the map at all (see the server's
  // "room-location-set" and its /rooms listing, which filters private rooms
  // out), so placing a private one is refused rather than quietly kept as
  // state nobody can see.
  const privateRoomCannotBeMapped = isPrivateRoomHandle(handle);
  const roomLocationTooltip = privateRoomCannotBeMapped
    ? "Apenas salas públicas podem definir uma localização"
    : isRoomManager
      ? "Escolha onde esta sala fica no mapa do mundo"
      : "Veja onde esta sala fica no mapa do mundo";
  const micBlockedReason = roomBlockReason("mic", "o microfone");
  const screenBlockedReason = roomBlockReason("screen", "o compartilhamento de tela");
  const cameraBlockedReason = roomBlockReason("camera", "a câmera");
  const videoSourceBlockedReason = roomBlockReason("videoSource", "adicionar fontes de vídeo");
  const chatBlockedReason = roomBlockReason("chat", "o chat");
  const gifBlockedReason = roomBlockReason("gif", "o envio de GIFs");

  // A permission can be turned off while someone is already using it — and
  // the mic in particular auto-starts from a stored preference the moment a
  // room is joined (see useRoomMedia), which can well be a room that doesn't
  // allow it. The server refuses either way; these are what actually stop the
  // local capture instead of leaving it running with the room told otherwise.
  //
  // Going through toggleMic (rather than some quieter stop) also clears the
  // stored "mic starts on" preference, which is what stops this from
  // repeating the whole start-then-refuse round trip on every join into a
  // room that doesn't allow it. The cost is that the preference is genuinely
  // forgotten, not just suspended for this room — turning the mic back on
  // anywhere sets it again.
  useEffect(() => {
    if (isMicOn && !canUseRoomPermission("mic")) toggleMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMicOn, isRoomManager, state.roomPermissions.mic]);

  useEffect(() => {
    if (localStream && !canUseRoomPermission("screen")) stopShare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStream, isRoomManager, state.roomPermissions.screen]);

  useEffect(() => {
    if (localCameraStream && !canUseRoomPermission("camera")) stopCameraShare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localCameraStream, isRoomManager, state.roomPermissions.camera]);

  // The refusal banner is a one-shot notice, not a state — clear it on its
  // own after a few seconds so it doesn't sit there for the rest of the call.
  // Keyed on the counter rather than the object, so being refused twice in a
  // row restarts the timer instead of the second one inheriting the first's.
  useEffect(() => {
    if (!state.permissionDenied) return;
    const id = setTimeout(() => signalingClient.clearPermissionDenied(), 6000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.permissionDeniedSeq]);

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
    // Three ways in, in order of how specific the input is:
    //
    // A full private handle pasted straight in ("priv-familia-123456", the
    // tail of a link someone sent) already carries its own code and is
    // taken as-is — prefixing it again would build "priv-priv-...".
    //
    // Otherwise the checkbox decides: ticked means *create*, so a fresh
    // code is minted here exactly like the home page's "Criar sala" does
    // (see roomsApi's toPrivateRoomHandle). There's deliberately no code
    // field in this little popover — joining a specific private room is
    // what pasting its handle above is for.
    let fullHandle: string;
    if (isPrivateRoomHandle(trimmed)) {
      fullHandle = trimmed;
    } else if (switchIsPrivate) {
      if (trimmed.length > MAX_PRIVATE_ROOM_NAME_LENGTH) {
        setSwitchError(`O nome pode ter no máximo ${MAX_PRIVATE_ROOM_NAME_LENGTH} caracteres.`);
        return;
      }
      fullHandle = toPrivateRoomHandle(trimmed, generateRoomCode());
    } else {
      fullHandle = toRoomHandle(trimmed, false);
    }
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
          {state.bannedReason
            ? `Você foi banido do site: ${state.bannedReason}`
            : "Você foi temporariamente banido do site pelo AntiSpam. Duração: 1h. Faz o L"}
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
          {creatingAccount ? (
            <CreateAccountForm
              initialDisplayName={nameInput}
              onCancel={() => setCreatingAccount(false)}
              onSuccess={() => setCreatingAccount(false)}
            />
          ) : (
            <form onSubmit={handleNameSubmit} className="mt-8 flex flex-col gap-3">
              <label htmlFor="name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Seu nome
              </label>
              <div className="flex gap-2">
                <input
                  id="name"
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={24}
                  placeholder="Ex: Maria"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
                <button
                  type="submit"
                  disabled={!nameInput.trim()}
                  className="shrink-0 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Entrar na sala
                </button>
              </div>
              {state.nameError && <p className="text-sm text-red-500">{state.nameError}</p>}
              <button
                type="button"
                onClick={() => setCreatingAccount(true)}
                className="rounded-lg border border-zinc-300 px-4 py-2.5 font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Criar uma conta
              </button>
            </form>
          )}
        </main>
      </div>
    );
  }

  // Ran out of automatic retries resolving a Turnstile challenge for this
  // join (see signalingClient.ts's performJoin/MAX_JOIN_RETRIES) — unlike
  // "banned" above, this is usually transient (network blip, ad blocker
  // interfering with the challenge script), so offer a manual retry instead
  // of a dead end.
  if (state.joinError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Não foi possível entrar na sala.
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{state.joinError}</p>
        <button
          type="button"
          onClick={() => signalingClient.joinRoom(handle)}
          className="rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  // Registered but the "join" for this room hasn't resolved into a
  // "room-state" yet — covers the (usually sub-second) time spent resolving
  // a Turnstile token before the join is even sent. Without this the room
  // UI below would render immediately with an empty peer list, looking
  // joined when it isn't yet.
  if (!state.room) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300" />
        <p className="text-zinc-600 dark:text-zinc-400">Entrando na sala...</p>
      </div>
    );
  }

  // Moderator "ghost" peers (see server/signaling.ts's admin-join) ride the
  // same peer list so their WebRTC connections get set up transparently,
  // but must never show up to real participants — filtered out here rather
  // than never added, so this is the one place that has to remember it.
  const visiblePeers = state.peers.filter((p) => p.role !== "moderator");
  const peerCount = visiblePeers.length + (state.name ? 1 : 0);
  // A peer showing mic-on doesn't mean their audio is actually reaching us
  // yet — the recvPC for it still has to come up, which right after joining
  // a room that already has people talking can take a moment (everyone
  // looks silent for a beat). Surfaced as a "Conectando..." banner rather
  // than left silent and unexplained.
  const connectingAudioPeers = visiblePeers.some(
    (p) => p.mic && micConnectionStates[p.id] !== "connected"
  );
  // Screen and camera are independent broadcast channels (see
  // useRoomMedia's useBroadcastChannel) — a peer sharing both gets one tile
  // for each, never one tile with the other crammed into a corner.
  const remoteScreenEntries = Object.entries(remoteStreams);
  const remoteCameraEntries = Object.entries(remoteCameraStreams);
  // Hyperfocus survives only as long as what it's focused on does. When that
  // transmission ends — the peer stops sharing, or leaves — its tile goes
  // with it, and that tile is the only way out of hyperfocus (see
  // toggleHyperfocus): the room was left showing nothing at all, every other
  // transmission still hidden, and no button anywhere to bring them back.
  // Dropping the focus the moment its target is gone is what un-sticks it.
  const hasLocalTile = Boolean((isSharing && localStream) || localCameraStream);
  const hyperfocusTargetGone =
    hyperfocusId !== null &&
    (hyperfocusId === "self"
      ? !hasLocalTile
      : // A room video source is a tile like any other here, and this check
      // not knowing that was why hyperfocusing one did nothing at all:
      // every source id looked like a peer that had stopped transmitting,
      // so the focus was dropped in the same render that set it.
      hyperfocusId.startsWith(VIDEO_SOURCE_TILE_PREFIX)
        ? !state.videoSources.some((v) => videoSourceTileId(v.id) === hyperfocusId)
        : !(hyperfocusId in remoteStreams) && !(hyperfocusId in remoteCameraStreams));
  // Used everywhere below instead of the raw state, so this render already
  // behaves as un-focused rather than waiting for the effect that clears it.
  const activeHyperfocusId = hyperfocusTargetGone ? null : hyperfocusId;

  // Hyperfocus hides every tile except the chosen one (its connections are
  // also actively closed — see enterHyperfocus below — so this isn't just a
  // display filter, the streams genuinely stop arriving).
  const hyperfocusVisible = !activeHyperfocusId || activeHyperfocusId === "self";
  const visibleScreenEntries = activeHyperfocusId
    ? activeHyperfocusId === "self"
      ? []
      : remoteScreenEntries.filter(([peerId]) => peerId === activeHyperfocusId)
    : remoteScreenEntries;
  const visibleCameraEntries = activeHyperfocusId
    ? activeHyperfocusId === "self"
      ? []
      : remoteCameraEntries.filter(([peerId]) => peerId === activeHyperfocusId)
    : remoteCameraEntries;
  const localTileCount = (isSharing && localStream ? 1 : 0) + (localCameraStream ? 1 : 0);
  // Room video sources (YouTube, today — see components/VideoSourceTile).
  // They are tiles in every sense the room cares about: they take a grid
  // slot, they can be focused and hyperfocused, and they count toward
  // "is there more than one thing on screen". The only difference is that
  // nobody is transmitting them.
  const watchedVideoSources = state.videoSources.filter((v) => !leftVideoSourceIds.has(v.id));
  const visibleVideoSources = activeHyperfocusId
    ? watchedVideoSources.filter((v) => videoSourceTileId(v.id) === activeHyperfocusId)
    : watchedVideoSources;
  // Placeholders for the ones this viewer stepped out of — hidden while
  // hyperfocused for the same reason a stopped peer's placeholder is.
  const leftVideoSources = activeHyperfocusId
    ? []
    : state.videoSources.filter((v) => leftVideoSourceIds.has(v.id));
  const hasMultipleShares =
    remoteScreenEntries.length +
    remoteCameraEntries.length +
    state.videoSources.length +
    localTileCount >
    1;
  // A peer we deliberately stopped watching (manually, or via the autoJoin
  // gate, or hyperfocus freeing them up) has no entry in remoteStreams, but
  // still gets a tile slot showing a "click to watch"/"you left this
  // transmission" placeholder instead of just vanishing from the grid. Camera
  // mirrors screen here — see useRoomMedia's stoppedCameraPeers.
  const stoppedEntries = visiblePeers.filter((p) => stoppedPeers.has(p.id) && !(p.id in remoteStreams));
  const resumingEntries = visiblePeers.filter(
    (p) => resumingPeers.has(p.id) && !(p.id in remoteStreams)
  );
  const stoppedCameraEntries = visiblePeers.filter(
    (p) => stoppedCameraPeers.has(p.id) && !(p.id in remoteCameraStreams)
  );
  const resumingCameraEntries = visiblePeers.filter(
    (p) => resumingCameraPeers.has(p.id) && !(p.id in remoteCameraStreams)
  );
  // Hidden along with everything else while hyperfocused — a placeholder for
  // someone hyperfocus itself just stopped watching would be confusing right
  // next to the "sair do hiperfoco" banner.
  const visibleStoppedEntries = activeHyperfocusId ? [] : stoppedEntries;
  const visibleResumingEntries = activeHyperfocusId ? [] : resumingEntries;
  const visibleStoppedCameraEntries = activeHyperfocusId ? [] : stoppedCameraEntries;
  const visibleResumingCameraEntries = activeHyperfocusId ? [] : resumingCameraEntries;
  const nothingToShow =
    remoteScreenEntries.length === 0 &&
    remoteCameraEntries.length === 0 &&
    state.videoSources.length === 0 &&
    stoppedEntries.length === 0 &&
    resumingEntries.length === 0 &&
    !isSharing;
  const tileCount =
    visibleScreenEntries.length +
    visibleCameraEntries.length +
    visibleStoppedEntries.length +
    visibleResumingEntries.length +
    visibleStoppedCameraEntries.length +
    visibleResumingCameraEntries.length +
    visibleVideoSources.length +
    leftVideoSources.length +
    (hyperfocusVisible ? localTileCount : 0);
  const isSingleTile = tileCount === 1;
  // Below `sm`, 2 tiles side by side are still each bigger than a single
  // full-width 16:9 tile would end up after the header/aside eat into a
  // phone's height, so they stay stacked — but 3+ was the actual complaint
  // ("não aparece todas, tem que scrollar"): one column per tile meant
  // scrolling through a wall of tiles even though 2-up comfortably fits
  // more of them in view at once.
  const mobileGridCols = tileCount <= 2 ? "grid-cols-1" : "grid-cols-2";

  // The actual add — link parsing/validation lives in AddVideoSourceModal
  // itself now (see components/AddVideoSourceModal.tsx), which only calls
  // this once it's satisfied. Opened from two places (the header button and
  // the empty pane's centred one), both passing this same callback.
  function handleAddVideoSource(kind: VideoSourceKind, url: string, controlMode: "owner" | "anyone") {
    signalingClient.addVideoSource(kind, url, controlMode);
    trackEvent("video_source_added", { kind });
  }

  function toggleSpotlight(id: string) {
    setSpotlightId((prev) => (prev === id ? null : id));
  }

  // Actually frees up the other transmissions' bandwidth/CPU instead of just
  // hiding them — closes every other screen/camera recvPC (see
  // stopWatchingPeer/stopWatchingCameraPeer), which is what makes hyperfocus
  // worth using over spotlight for someone on a constrained link.
  function enterHyperfocus(id: string) {
    setSpotlightId(null);
    setHyperfocusId(id);
    for (const [peerId] of remoteScreenEntries) {
      if (peerId !== id) stopWatchingPeer(peerId);
    }
    for (const [peerId] of remoteCameraEntries) {
      if (peerId !== id) stopWatchingCameraPeer(peerId);
    }
    trackEvent("hyperfocus_enter");
  }

  // Deliberately does not resume anyone hyperfocus stopped watching — that's
  // the whole point (save resources), so whoever wants them back clicks
  // "Retomar transmissão" on their own placeholder tile.
  function exitHyperfocus() {
    setHyperfocusId(null);
    trackEvent("hyperfocus_exit");
  }

  // The tile's own hyperfocus button is the only entry/exit point (see
  // VideoTile's isHyperfocused green state) — no separate banner/button.
  function toggleHyperfocus(id: string) {
    if (activeHyperfocusId === id) exitHyperfocus();
    else enterHyperfocus(id);
  }

  // Shared prop bundle for every QualityControls instance on this page (the
  // desktop quick-access popover and the two share-button pickers below) —
  // built once so the three call sites can't quietly drift out of sync.
  const qualityControlsProps = {
    smartQualityEnabled,
    setSmartQualityEnabled,
    shareProfile,
    setShareProfile,
    shareFps,
    setShareFps,
    shareResolution,
    setShareResolution,
    shareBitrate,
    setShareBitrate,
    hasAccount: Boolean(state.account),
    isSharing,
    meshCapacity,
    meshTopology,
  };

  // The body of the header's "Mais opções" panel. Extracted because it is
  // rendered by two different shells: a Tippy popover hanging off the button
  // from sm up, and the full-width bottom sheet below it — a sheet is fixed
  // to the viewport rather than positioned against the button, which is
  // exactly what a popover cannot be.
  const menuItems = (
    <>
      <div className="mb-1 flex items-center justify-between gap-2 sm:hidden">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Mais opções</p>
        <button
          type="button"
          onClick={closeMenu}
          aria-label="Fechar"
          className="text-xl leading-none text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          ×
        </button>
      </div>

      <span
        className={`mb-2 inline-block w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-white sm:hidden ${isPrivateRoomHandle(handle) ? "bg-red-600" : "bg-emerald-600"
          }`}
      >
        {isPrivateRoomHandle(handle) ? "Sala privada" : "Sala pública"}
      </span>

      {/* The room's category and blurb, which sit in the header from lg up
          (see RoomInfoControls there). Skipped entirely for a viewer of a
          room that has neither and who couldn't set one anyway — the
          component renders nothing in that case, and a heading over nothing
          is worse than no heading. */}
      {!isWideLayout && (isRoomManager || state.roomDescription || state.roomCategory) && (
        <div className="mb-1">
          <p className="mb-1.5 px-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            Sobre a sala
          </p>
          <RoomInfoControls
            description={state.roomDescription}
            category={state.roomCategory}
            canEdit={isRoomManager}
          />
          <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />
        </div>
      )}

      {/* Also reachable from the main row on desktop (see the
          quick-access group below) — kept here too since mobile
          has no room for it outside this menu. */}
      <button
        type="button"
        onClick={handleCopyLink}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-sm font-medium transition sm:hidden ${linkCopied
          ? "border-emerald-600 text-emerald-600 dark:border-emerald-500 dark:text-emerald-500"
          : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          }`}
      >
        {linkCopied ? <CheckIcon className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" />}
        {linkCopied ? "Link copiado!" : "Compartilhar sala"}
      </button>

      <a
        href="https://discord.gg/nemtudo"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg px-2 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:text-red-500 dark:hover:bg-red-950/40"
      >
        Reportar bug
      </a>

      <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />

      <MenuToggleRow
        label="Efeitos sonoros do site"
        active={soundEffectsOn}
        onToggle={toggleSoundEffects}
        activeIcon={<SpeakerIcon className="h-4 w-4" />}
        inactiveIcon={<SpeakerMuteIcon className="h-4 w-4" />}
      />
      <MenuToggleRow
        label="Supressão de ruído"
        active={noiseSuppressionOn}
        onToggle={toggleNoiseSuppression}
        disabled={isMicOn && !noiseSuppressionAvailable}
        hint={
          isMicOn && !noiseSuppressionAvailable
            ? "Supressão de ruído indisponível neste navegador"
            : undefined
        }
        activeIcon={<NoiseSuppressionIcon className="h-4 w-4" />}
        inactiveIcon={<NoiseSuppressionOffIcon className="h-4 w-4" />}
      />
      <MenuToggleRow
        label="Entrar em transmissões automaticamente"
        active={autoJoin}
        onToggle={toggleAutoJoin}
        hint="Quando desligado, uma nova tela/câmera só conecta depois que você clicar pra assistir"
        activeIcon={<EyeIcon className="h-4 w-4" />}
        inactiveIcon={<EyeOffIcon className="h-4 w-4" />}
      />
      {/* Only outside the desktop app: inside it, "always open in the app"
          is a preference about something already true. Gated on `mounted`
          too, since isDesktopApp() reads a client-only global. */}
      {mounted && !isDesktopApp() && (
        <MenuToggleRow
          label="Sempre abrir salas no aplicativo"
          active={openRoomsInApp}
          onToggle={toggleOpenRoomsInApp}
          hint="Abre links de sala no aplicativo do GoLive em vez do navegador. Precisa do aplicativo instalado."
          activeIcon={<MdOutlineDesktopWindows className="h-4 w-4" />}
          inactiveIcon={<MdOutlineDesktopWindows className="h-4 w-4 opacity-50" />}
        />
      )}
      <MenuToggleRow
        label="Impedir conexões diretas"
        active={forceRelayIce}
        onToggle={toggleForceRelayIce}
        disabled={!TURN_CONFIGURED}
        hint={
          TURN_CONFIGURED
            ? "Força suas conexões a passar por um servidor TURN em vez de P2P direto, sem revelar seu IP para outros participantes"
            : "Indisponível: nenhum servidor TURN configurado neste site"
        }
        activeIcon={<ShieldIcon className="h-4 w-4" />}
        inactiveIcon={<ShieldOffIcon className="h-4 w-4" />}
      />
      {forceRelayIce && (
        <p className="mb-1 px-2 text-xs text-amber-600 dark:text-amber-500">
          Suas conexões passam sempre por um servidor intermediário, sem revelar seu IP a quem você assiste ou transmite. Isso pode deixar a transmissão com mais atraso e piorar a qualidade.
        </p>
      )}
      <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />

      <div className="sm:hidden">
        <Tooltip content="Qualidade da transmissão — reduza se a sala estiver travando">
          <button
            type="button"
            onClick={() => setQualityOpen((q) => !q)}
            className="rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Qualidade: {shareResolution} · {shareFps}fps
          </button>
        </Tooltip>
        {qualityOpen && (
          <div className="mx-2 mb-1">
            <QualityControls {...qualityControlsProps} />
          </div>
        )}
      </div>

      {/* A logged-in account's room name is locked server-side
          to its account record (see server/signaling.ts's
          "register" handler) — offering a rename control here
          would just error on every attempt (or worse, silently
          look like it did nothing), so it's hidden entirely
          instead of a confusing dead end. */}
      {!state.account && (
        <>
          <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />
          <button
            type="button"
            onClick={() => {
              setRenaming((r) => {
                if (!r) setRenameInput(state.name ?? "");
                return !r;
              });
            }}
            className="rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Mudar nome
          </button>
          {renaming && (
            <form
              onSubmit={handleRenameSubmit}
              className="mx-2 mb-1 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
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
                className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
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
        </>
      )}

      <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />

      <div className="sm:hidden">
        <button
          type="button"
          onClick={() => setSwitching((s) => !s)}
          className="rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Trocar de sala
        </button>
        {switching && (
          <div className="mx-2 mb-1">
            <SwitchRoomFields
              switchInput={switchInput}
              setSwitchInput={setSwitchInput}
              switchIsPrivate={switchIsPrivate}
              setSwitchIsPrivate={setSwitchIsPrivate}
              switchError={switchError}
              onSubmit={handleSwitchSubmit}
            />
          </div>
        )}
      </div>
    </>
  );

  // The mic toggle, mute-mics toggle, and share/camera controls — kept
  // prominent since they're used mid-call, not just once at setup, unlike
  // everything else in "Mais opções" above. Rendered in the header's single
  // control row, alongside "Compartilhar sala"/"Trocar de sala" and
  // "Apoiar projeto".
  const mainControls = (
    <>
      <div className="flex items-stretch">
        <Popover
          open={micDeviceMenuOpen}
          onClose={() => setMicDeviceMenuOpen(false)}
          placement="bottom-start"
          tooltip="Escolher microfone"
          content={
            <div className="w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-zinc-300 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <DeviceMenuOption
                label="Padrão do sistema"
                selected={micDeviceId === null}
                onClick={() => {
                  setMicDevice(null);
                  setMicDeviceMenuOpen(false);
                }}
              />
              {micDevices.map((d) => (
                <DeviceMenuOption
                  key={d.deviceId}
                  label={d.label}
                  selected={micDeviceId === d.deviceId}
                  onClick={() => {
                    setMicDevice(d.deviceId);
                    setMicDeviceMenuOpen(false);
                  }}
                />
              ))}
            </div>
          }
        >
          <button
            type="button"
            onClick={() => setMicDeviceMenuOpen((o) => !o)}
            aria-label="Escolher microfone"
            className={`rounded-l-lg border-r border-black/15 px-1 text-white transition ${isMicOn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
              }`}
          >
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </button>
        </Popover>
        <Tooltip
          content={
            isMicOn
              ? "Desativar microfone"
              : (micBlockedReason ?? "Ativar microfone")
          }
          wrapperClassName="flex"
        >
          <button
            type="button"
            onClick={toggleMic}
            // Only turning it *on* is blocked — see ShareControls'
            // screenBlockedReason for the same reasoning.
            disabled={!isMicOn && Boolean(micBlockedReason)}
            aria-label={isMicOn ? "Desativar microfone" : "Ativar microfone"}
            className={`rounded-r-lg p-2 text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${isMicOn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
              }`}
          >
            {isMicOn ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5" />}
          </button>
        </Tooltip>
      </div>

      <div className="flex items-stretch">
        {canSelectSpeaker && (
          <Popover
            open={speakerDeviceMenuOpen}
            onClose={() => setSpeakerDeviceMenuOpen(false)}
            placement="bottom-start"
            tooltip="Escolher saída de áudio"
            content={
              <div className="w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-zinc-300 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                <DeviceMenuOption
                  label="Padrão do sistema"
                  selected={speakerDeviceId === null}
                  onClick={() => {
                    setSpeakerDevice(null);
                    setSpeakerDeviceMenuOpen(false);
                  }}
                />
                {speakerDevices.map((d) => (
                  <DeviceMenuOption
                    key={d.deviceId}
                    label={d.label}
                    selected={speakerDeviceId === d.deviceId}
                    onClick={() => {
                      setSpeakerDevice(d.deviceId);
                      setSpeakerDeviceMenuOpen(false);
                    }}
                  />
                ))}
              </div>
            }
          >
            <button
              type="button"
              onClick={() => setSpeakerDeviceMenuOpen((o) => !o)}
              aria-label="Escolher saída de áudio"
              className={`rounded-l-lg border-r border-black/15 px-1 text-white transition ${micsMuted ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
                }`}
            >
              <ChevronDownIcon className="h-3.5 w-3.5" />
            </button>
          </Popover>
        )}
        <Tooltip content={micsMuted ? "Reativar microfones" : "Silenciar microfones"}>
          <button
            type="button"
            onClick={toggleMicsMuted}
            aria-label={micsMuted ? "Reativar microfones" : "Silenciar microfones"}
            className={`p-2 text-white transition ${canSelectSpeaker ? "rounded-r-lg" : "rounded-lg"} ${micsMuted ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
              }`}
          >
            {micsMuted ? (
              <HeadphonesOffIcon className="h-5 w-5" />
            ) : (
              <HeadphonesIcon className="h-5 w-5" />
            )}
          </button>
        </Tooltip>
      </div>

      <div className="flex items-center border-l border-zinc-300 pl-2 dark:border-zinc-700">
        <ShareControls
          screenSharing={Boolean(localStream)}
          cameraSharing={Boolean(localCameraStream)}
          screenSupported={screenShareMode === "display"}
          cameraSupported={screenShareMode !== "unsupported"}
          screenBlockedReason={screenBlockedReason}
          cameraBlockedReason={cameraBlockedReason}
          onToggleScreen={() => (localStream ? stopShare() : startShare("display"))}
          onToggleCamera={() => (localCameraStream ? stopCameraShare() : startCameraShare())}
          cameraDevices={cameraDevices}
          cameraDeviceId={cameraDeviceId}
          setCameraDevice={setCameraDevice}
          cameraMenuOpen={cameraDeviceMenuOpen}
          setCameraMenuOpen={setCameraDeviceMenuOpen}
          open={shareQualityOpen}
          setOpen={setShareQualityOpen}
          quality={qualityControlsProps}
        />
      </div>
    </>
  );

  // Same reasoning as mainControls above — defined once, rendered either in
  // the shared mobile pane (tab-switched with chatSection) or in its own
  // full-height column from lg up (see isWideLayout), never both at once.
  // Whether this person has a room video source on screen — which is also
  // who controls it (see the server's "video-source-state" handler), so the
  // icon it drives in the participant list doubles as "ask them to pause".
  function peerSharesVideo(userId: string | null | undefined): boolean {
    if (!userId) return false;
    return state.videoSources.some((v) => v.addedById === userId);
  }

  // Opens the popup shared by both triggers below (the header's icon button
  // and the empty pane's centred one) — see components/AddVideoSourceModal.
  function openAddVideoSourcePopup() {
    openPopup("add_video_source", {
      data: { onSubmit: handleAddVideoSource },
    });
  }

  // Both open components/ManageRoomModal — it just starts on a different
  // screen. No other `data`: the popup reads the room's live state itself, so
  // it keeps up with people joining and other admins' changes while it's
  // open. The map one is wider, since a world map in a 20rem column is a
  // postage stamp.
  function openManageRoomPopup() {
    openPopup("manage_room", { data: {} });
  }

  function openRoomLocationPopup() {
    // The map view is the one place that needs a real box rather than the
    // narrow column the other views use, and the width has to be set *here*:
    // the popup sizes its own frame, and a width class on the child would be
    // measured against the viewport instead, overflowing the frame by
    // whatever padding sits between them.
    openPopup("manage_room", {
      width: "min(64rem, calc(100vw - 3rem))",
      maxWidth: "min(64rem, calc(100vw - 3rem))",
      maxHeight: "92dvh",
      data: { initialView: "location", canEdit: isRoomManager },
    });
  }

  const participantsSection = (
    <>
      {connectingAudioPeers && (
        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          Conectando...
        </p>
      )}
      <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        Participantes ({peerCount})
      </h2>
      <ul className="flex flex-col gap-1.5">
        <ParticipantRow
          name={state.name}
          isSelf
          isGuest={!state.account}
          userId={account?.id}
          isOwner={isRoomOwner}
          isAdmin={isRoomAdmin}
          isApp={mounted && isDesktopApp()}
          verified={state.account?.flags?.includes("VERIFIED")}
          micOn={isMicOn}
          sharing={isSharing}
          screen={Boolean(localStream)}
          camera={Boolean(localCameraStream)}
          sharingVideo={peerSharesVideo(state.selfUserId)}
          micStream={localMicStream}
        />
        {visiblePeers.map((p) => {
          const volumeKey = p.userId ?? p.id;
          return (
            <ParticipantRow
              key={p.id}
              name={p.name}
              isGuest={p.isGuest}
              userId={p.userId}
              isOwner={Boolean(p.userId) && p.userId === state.roomOwnerId}
              isAdmin={state.roomAdmins.some((a) => a.id === p.userId)}
              isApp={p.app}
              verified={p.flags?.includes("VERIFIED")}
              micOn={p.mic}
              sharing={p.sharing}
              screen={p.screen}
              camera={p.camera}
              sharingVideo={peerSharesVideo(p.userId)}
              micStream={remoteMicStreams[p.id]}
              muted={micsMuted || mutedPeerIds.has(p.id)}
              onToggleMute={() => togglePeerMute(p.id)}
              volume={peerVolumes[volumeKey] ?? 1}
              onVolumeChange={(volume) => setPeerVolume(volumeKey, volume)}
              connectionLost={micConnectionStates[p.id] === "disconnected"}
            />
          );
        })}
      </ul>
    </>
  );

  // Same reasoning again. Capped height in the shared mobile pane (matches
  // however it always looked there); fills its own column's full height
  // from lg up instead, where it has the whole right side to itself.
  // Sits directly above the chat from lg up rather than in the header's
  // "Mais opções" panel because that panel is everyone's, and the gear here
  // isn't: it's for whoever actually runs the room. Admins get it too —
  // placing the room and the permission switches are alike theirs (see the
  // server's isRoomManager); the popup is what hides "Gerenciar
  // administradores" from anyone but the owner.
  //
  // The map button is the exception: everyone sees it once the room has been
  // placed, because "where is this room" is something to look at, not
  // something to run. It just opens read-only for them (see ManageRoomModal's
  // canEdit).
  //
  // Below lg it moves to the top of the participants sheet instead: it is
  // about the room and the people in it, and above a phone-sized chat it was
  // two buttons of setup sitting on top of the conversation.
  const roomManageRow = (
    <>
      {(isRoomManager || state.roomLocation) && (
        <div className="mb-2 flex items-center gap-2">
          <Tooltip content={roomLocationTooltip} wrapperClassName="flex flex-1">
            <button
              type="button"
              onClick={openRoomLocationPopup}
              // A private room can never be on the map (the map lists public
              // rooms only, and the server refuses the write) — so this is
              // dead for a manager of one, with the tooltip explaining why
              // rather than the button silently doing nothing.
              disabled={isRoomManager && privateRoomCannotBeMapped}
              className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${state.roomLocation
                ? "border-sky-500 text-sky-600 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-400 dark:hover:bg-sky-950/40"
                : "border-sky-500 text-sky-600 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-400 dark:hover:bg-sky-950/40"
                }`}
            >
              <MdOutlineMap className="h-4 w-4 shrink-0" />
              {state.roomLocation || !isRoomManager ? "Local no mapa" : "Definir local no mapa"}
            </button>
          </Tooltip>
          {isRoomManager && (
            <button
              type="button"
              onClick={openManageRoomPopup}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <BsGearFill className="h-3.5 w-3.5 shrink-0" />
              Gerenciar sala
            </button>
          )}
        </div>
      )}
    </>
  );

  const chatPanel = (
    <ChatPanel
        messages={state.chatMessages}
        selfId={state.selfId}
        selfName={state.name}
        peers={visiblePeers}
        onSend={(text) => signalingClient.sendChatMessage(text)}
        onSendGif={
          state.account && !gifBlockedReason ? (url) => signalingClient.sendGif(url) : undefined
        }
        onTypingChange={(typing) => signalingClient.setTyping(typing)}
        typingNames={visiblePeers
          .filter((p) => state.typingPeerIds.includes(p.id))
          .map((p) => p.name)}
        blockedMessage={state.chatBlockedMessage}
        sendDisabledReason={chatBlockedReason}
        gifDisabledReason={gifBlockedReason}
        // Fills whatever box it is given, in both layouts: its own column
        // from lg up, the sheet the bottom bar raises below that. The margins
        // go with it — they separate it from what shares its column on
        // desktop, and there is nothing to separate it from inside a sheet
        // that is already only chat.
        heightClassName="flex-1 min-h-0"
        marginClassName={isWideLayout ? "mt-4 mb-4" : ""}
      />
  );

  const chatSection = (
    <>
      {roomManageRow}
      {chatPanel}
    </>
  );

  return (
    <div
      // Marks this page as an app shell for globals.css, which is what pins
      // it to the viewport actually on screen below lg — see the
      // `[data-room-shell]` rule there.
      data-room-shell
      className="flex min-h-0 flex-1 flex-col bg-zinc-50 dark:bg-black"
    >
      {/* Above the header so it reads as a property of the page rather than
          of the room's controls. Renders nothing inside the app itself, and
          nothing for anyone who has already answered. */}
      <OpenInAppBanner handle={handle} />
      <header className="border-b border-black/10 px-3 py-2.5 dark:border-white/10 sm:px-4 sm:py-3">
        {/* One row for everything, wrapping instead of splitting: the room's
            identity on the left, and every control on the right — the
            mid-call ones (mic/mute/share/camera), the room link and the room
            switcher, the points readout, "Apoiar projeto" and "Mais opções".
            These used to be two fixed rows, which cost a full row of vertical
            space on a wide screen that had room to spare. `ml-auto` keeps the
            control group against the right edge whether it shares the line
            with the title or has been pushed onto its own. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5">
          {/* flex-1 rather than content-width: the description input inside
              RoomInfoControls grows into whatever this group has spare (it
              caps itself), which it can only do if this group claims the room
              between the title and the controls in the first place.

              The lg min-width is what makes the row above actually wrap.
              Without it this group (which shrinks to nothing) gave up all of
              its space to the control group before the browser ever
              considered breaking the line — and since the badge, the category
              chip and the room code inside it are shrink-0, they carried on
              past the group's edge and ran underneath the buttons. With a
              floor, the two groups stop fitting on one line while the left one
              still has room for its chips, so the controls drop to their own
              line instead.

              Below lg there is nothing to hold a floor for and every reason
              not to: the description and the mid-call controls are elsewhere
              (see the header's isWideLayout branches), and a floor there
              would push the four remaining buttons onto a second row on a
              phone rather than let the room name truncate. */}
          <div className="flex min-w-0 flex-1 items-center gap-2 lg:min-w-[20rem]">
            <Link href={"/"} className="shrink-0 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              <MdHome />
            </Link>
            {/* For a private room the code is split out of the handle and
                shown on its own: it's the room's whole secret now (see
                roomsApi's toPrivateRoomHandle), so it's the thing someone
                reads out loud to let a friend in, and picking it out of
                "priv-familia-123456" by eye is needless work. The tooltip
                still carries the raw handle for anyone who wants it. */}
            <Tooltip content={handle} placement="bottom">
              <h1 className="truncate text-base font-semibold text-zinc-950 dark:text-zinc-50 sm:text-lg">
                {privateRoomParts ? privateRoomParts.name : handle}
              </h1>
            </Tooltip>
            {privateRoomParts && (
              <span className="shrink-0 rounded-full bg-zinc-200 px-2.5 py-1 font-mono text-xs font-medium tracking-wider text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {privateRoomParts.code}
              </span>
            )}
            <span
              className={`hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-white sm:inline-block ${isPrivateRoomHandle(handle) ? "bg-red-600" : "bg-emerald-600"
                }`}
            >
              {isPrivateRoomHandle(handle) ? "Sala privada" : "Sala pública"}
            </span>
            {/* Right of the public/private badge, where the headcount chip
                used to be — the participant list already carries that number
                (and the bottom bar repeats it), so this is the more useful
                thing to spend the space on. Editable for the owner and
                admins, read-only text for everyone else.

                From lg up only: below that, an editable text field in the
                header was the single widest thing competing for a phone's
                one row, and it is room *metadata* — worth reading once,
                changed about as often. It moves into "Mais opções" (see
                roomInfoItem), which is where the rest of the once-per-visit
                controls already are. */}
            {isWideLayout && (
              <RoomInfoControls
                description={state.roomDescription}
                category={state.roomCategory}
                canEdit={isRoomManager}
              />
            )}
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {/* The mid-call controls (mic, mute-mics, screen, camera) and the
                add-video button — kept out of "Mais opções" because they're
                used while talking, not once at setup.

                From lg up only. Below that they are the bottom bar (see
                mobileDock): a phone's header is the furthest point from the
                thumb holding it, and these four were also what turned that
                header into three wrapped rows of buttons on a 360px screen.
                Rendered in one place at a time rather than hidden with a
                `lg:` class, so there is only ever one mic button, one device
                popover and one open/closed state for them. */}
            {isWideLayout && (
              <>
                <div className="flex flex-wrap items-center justify-end gap-2">{mainControls}</div>

                {/* Adding a YouTube/Twitch video/live to the room. Sits with
                    the transmission controls because that's what it produces:
                    one more tile everyone in the room sees, with the same
                    focus and hyperfocus buttons — the difference is that
                    nobody is uploading it. Opens
                    components/AddVideoSourceModal as an ntpopups popup rather
                    than the little inline box this used to be — picking a
                    platform and who gets to control it needs more room than a
                    popover corner has. */}
                <Tooltip
                  content={videoSourceBlockedReason ?? "Adicionar fonte de vídeo"}
                  wrapperClassName="flex"
                >
                  <button
                    type="button"
                    onClick={openAddVideoSourcePopup}
                    disabled={Boolean(videoSourceBlockedReason)}
                    aria-label="Adicionar fonte de vídeo"
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <MdOutlineOndemandVideo className="h-5 w-5 shrink-0" />
                    <span className="hidden lg:inline"><BetaMark /></span>
                  </button>
                </Tooltip>
              </>
            )}

            {/* Still desktop-only: on a phone these two live inside "Mais
                opções" (see above), the only place with room for them. */}
            <div className="hidden items-center justify-end gap-2 sm:flex">
              <Tooltip content={linkCopied ? "Link copiado!" : "Copiar o link desta sala"}>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${linkCopied
                    ? "border-emerald-600 text-emerald-600 dark:border-emerald-500 dark:text-emerald-500"
                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    }`}
                >
                  {linkCopied ? <CheckIcon className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" />}
                  {linkCopied ? "Copiado!" : "Compartilhar sala"}
                </button>
              </Tooltip>
              <Popover
                open={switching}
                onClose={() => setSwitching(false)}
                placement="bottom-end"
                content={
                  <div className="w-72 max-w-[calc(100vw-1rem)]">
                    <SwitchRoomFields
                      switchInput={switchInput}
                      setSwitchInput={setSwitchInput}
                      switchIsPrivate={switchIsPrivate}
                      setSwitchIsPrivate={setSwitchIsPrivate}
                      switchError={switchError}
                      onSubmit={handleSwitchSubmit}
                    />
                  </div>
                }
              >
                <button
                  type="button"
                  onClick={() => setSwitching((s) => !s)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${switching
                    ? "border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    }`}
                >
                  Trocar de sala
                </button>
              </Popover>
            </div>

            {/* Name + points. Both kinds of identity have a total worth
                showing now that guests earn them too (see AuthContext's
                `points`); the only real difference is that an account has a
                public profile to link to and a guest has nowhere to go, so
                the guest version is the same chip minus the link. Kept
                deliberately muted (no fill color) either way so it reads as
                a status readout, not another button. Shown only once there
                *is* an identity — a name is what mints the guest one. */}
            {account ? (
              <Tooltip content="Ver seu perfil" placement="bottom">
                <Link
                  href={`/user/${account.id}`}
                  target="_blank"
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  <span className="hidden max-w-[8rem] truncate text-zinc-700 dark:text-zinc-300 sm:inline">
                    {state.name}
                  </span>
                  <span className="hidden h-3 w-px bg-zinc-300 dark:bg-zinc-700 sm:inline-block" />
                  <span className="flex items-center gap-1 tabular-nums">
                    <BsCoin className="h-3.5 w-3.5 shrink-0" />
                    {points}
                  </span>
                </Link>
              </Tooltip>
            ) : (
              state.name && (
                <Tooltip
                  content="Seus pontos de convidado ficam salvos só neste navegador. Limpar os dados do site, ou entrar de outro navegador, começa do zero — crie uma conta para não perdê-los."
                  placement="bottom"
                >
                  <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <span className="hidden max-w-[8rem] truncate text-zinc-700 dark:text-zinc-300 sm:inline">
                      {state.name}
                    </span>
                    <span className="hidden h-3 w-px bg-zinc-300 dark:bg-zinc-700 sm:inline-block" />
                    <span className="flex items-center gap-1 tabular-nums">
                      <BsCoin className="h-3.5 w-3.5 shrink-0" />
                      {points}
                    </span>
                  </div>
                </Tooltip>
              )
            )}
            <Tooltip content={<SupportersTooltipContent />} placement="bottom" interactive>
              <a
                href="https://livepix.gg/nemtudo"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEvent("support_project_clicked")}
                className="flex items-center gap-1.5 rounded-lg border border-pink-300 px-2 py-2 text-sm font-medium text-pink-600 transition hover:bg-pink-50 dark:border-pink-800 dark:text-pink-400 dark:hover:bg-pink-950/40 sm:px-3"
              >
                {/* The verified badge rather than a heart: the badge is what
                    supporting actually gets you now (see
                    SupportersTooltipContent), so the button shows the thing
                    instead of a generic affection icon. */}
                {/* Blue rather than the button's pink: this is the same
                    badge that appears next to a verified name (see
                    DisplayUserName, which uses the same colour), and it only
                    reads as that badge if it keeps its own. */}
                <VerifiedBadgeIcon className="h-5 w-5 shrink-0 text-blue-500" />
                <span className="hidden sm:inline">Apoiar projeto</span>
              </a>
            </Tooltip>

            <Popover
              open={isDesktopLayout && menuOpen}
              onClose={closeMenu}
              placement="bottom-end"
              tooltip="Mais opções"
              content={
                <div className="flex max-h-[80vh] w-80 flex-col gap-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
                  {menuItems}
                </div>
              }
            >
              <button
                type="button"
                onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
                aria-label="Mais opções"
                className={`rounded-lg border p-2 transition ${menuOpen
                  ? "border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
              >
                <MoreIcon className="h-5 w-5" />
              </button>
            </Popover>

            {/* Guests only — an account already has the profile chip above,
                and this is the one control that isn't buried in the menu:
                the menu is where you go to change something about the room,
                while this is about who you are. Sits after the menu so it's
                the last thing in the row (and the closest to the thumb on a
                phone). Label hidden below sm like "Apoiar projeto" beside
                it, so the row still fits. Keyed off the same `account` as
                the profile chip above, not `state.account`, so logging in
                swaps one for the other in the same render instead of
                showing both while the signaling re-registration lands. */}
            {!account && (
              <Tooltip content="Entrar ou criar uma conta" placement="bottom">
                <button
                  type="button"
                  onClick={() => {
                    trackEvent("account_button_clicked");
                    // Signup rather than login: whoever is reading a header
                    // that still says "Entrar" is far more often someone
                    // without an account than someone who has one and is
                    // logged out. "Já tenho uma conta" inside the form is one
                    // click away for the other case.
                    setAccountModal("create");
                  }}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-950 bg-zinc-950 px-2 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 sm:px-3"
                >
                  <MdLogin className="h-5 w-5 shrink-0" />
                  <span className="hidden sm:inline">Entrar</span>
                </button>
              </Tooltip>
            )}

            <UpdateAppButton />

            {!isDesktopLayout && menuOpen && (
              <>
                {/* Full-screen tap-to-close catcher — also what turns this
                    into a proper bottom sheet on a phone (the panel below is
                    fixed to the viewport, not to this button). */}
                <div className="fixed inset-0 z-30" onClick={closeMenu} />
                <div className="fixed inset-x-0 bottom-0 z-40 flex max-h-[85vh] flex-col gap-1 overflow-y-auto rounded-t-2xl border-t border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
                  {menuItems}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {!state.account && !guestBannerDismissed && (
        <div className="flex shrink-0 items-center justify-between gap-3 bg-blue-50 px-3 py-1.5 text-xs text-blue-800 lg:px-4 lg:py-2 lg:text-sm dark:bg-blue-950/40 dark:text-blue-300">
          {/* The reasoning trails off below lg. The room there is a fixed
              box the video has to share with everything else, and three
              wrapped lines of optional advice at the top of it cost more
              than they explain — the offer itself, and the button beside the
              three dots, still say what this is. */}
          <p>
            Você está usando um nome de convidado. Se quiser, você pode{" "}
            <button
              type="button"
              onClick={() => setAccountModal("create")}
              className="font-semibold underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-200"
            >
              Criar uma conta
            </button>{" "}
            <span className="hidden lg:inline">
              pra reservar seu nome e manter suas configurações. Mas só se quiser, é opcional :)
            </span>
          </p>
          <Tooltip content="Fechar aviso">
            <button
              type="button"
              onClick={() => {
                setGuestBannerDismissed(true);
                setStoredGuestAccountBannerDismissed(true);
              }}
              aria-label="Fechar aviso"
              className="shrink-0 text-lg leading-none text-blue-500 transition hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
            >
              ×
            </button>
          </Tooltip>
        </div>
      )}

      {/* The room refused something this client had already started locally
          (see the server's "room-permission-denied"). Amber rather than red:
          nothing broke — the room simply doesn't allow it. Clears itself
          after a few seconds; the × is for whoever wants it gone sooner. */}
      {state.permissionDenied && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
          <p>{state.permissionDenied.message}</p>
          <button
            type="button"
            onClick={() => signalingClient.clearPermissionDenied()}
            aria-label="Fechar aviso"
            className="shrink-0 text-lg leading-none opacity-70 transition hover:opacity-100"
          >
            ×
          </button>
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

      {Object.entries(remoteMicStreams).map(([peerId, stream]) => {
        const volumeKey = state.peers.find((p) => p.id === peerId)?.userId ?? peerId;
        return (
          <RemoteAudio
            key={peerId}
            stream={stream}
            muted={micsMuted || mutedPeerIds.has(peerId)}
            volume={peerVolumes[volumeKey] ?? 1}
            sinkId={speakerDeviceId}
          />
        );
      })}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-6 lg:p-4">
        {/* From lg up, participants get this dedicated full-height column
            instead of sharing a pane with chat — see isWideLayout. The ad
            card lives here (below the list) rather than in the chat column,
            so chat gets the full column to itself. */}
        {isWideLayout && (
          <aside className="flex h-full w-64 shrink-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">{participantsSection}</div>
            <PartnerCard />
          </aside>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto p-2 lg:p-0">
          {nothingToShow ? (
            <div className="flex h-full min-h-75 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 text-center dark:border-zinc-800">
              <p className="text-zinc-600 dark:text-zinc-400">
                Ninguém está transmitindo ainda.
              </p>
              {/* The empty pane is the one place with room for the labelled
                  version of the header's icon toggles, and the one moment
                  when starting a share is the only thing anyone can do here.
                  Pointing at the header instead ("clique no ícone lá em
                  cima") asked the person to go find a control while standing
                  on the space where it fits. Only ever shown while nobody —
                  including us — is transmitting, so these are always "start",
                  never "stop": see nothingToShow. */}
              {screenShareMode === "unsupported" && (
                <p className="text-sm text-zinc-500 dark:text-zinc-500">
                  Seu navegador não permite compartilhar tela nem câmera.
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                {/* Each is hidden outright rather than disabled here (unlike
                    the header's copies, which stay put so the row doesn't
                    reflow): this pane exists to offer what can be done right
                    now, and a wall of dead buttons is not that. The note
                    below says why, once, for whatever ends up missing. */}
                {screenShareMode === "display" && !screenBlockedReason && (
                  <button
                    type="button"
                    onClick={() => startShare("display")}
                    className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  >
                    <ScreenIcon className="h-5 w-5" />
                    Compartilhar tela
                  </button>
                )}

                {screenShareMode !== "unsupported" && !cameraBlockedReason && (
                  <button
                    type="button"
                    onClick={() => startCameraShare()}
                    className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  >
                    <CameraIcon className="h-5 w-5" />
                    Compartilhar câmera
                  </button>
                )}

                <div className="basis-full flex justify-center">
                  {videoSourceBlockedReason ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-500">
                      O dono da sala limitou o que os participantes podem transmitir aqui.
                    </p>
                  ) : (
                  <button
                    type="button"
                    onClick={openAddVideoSourcePopup}
                    className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  >
                    <MdOutlineOndemandVideo className="h-5 w-5 shrink-0" />
                    Adicionar fonte de vídeo
                    <BetaMark />
                  </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {!activeHyperfocusId && spotlightId && hasMultipleShares && (
                <button
                  type="button"
                  onClick={() => setSpotlightId(null)}
                  className="mb-3 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  Remover destaque
                </button>
              )}
              <div
                className={
                  isSingleTile
                    ? "h-full"
                    : `grid ${mobileGridCols} auto-rows-fr gap-2 sm:grid-cols-2 sm:gap-5 2xl:grid-cols-3`
                }
              >
                {hyperfocusVisible && isSharing && localStream && (
                  <VideoTile
                    stream={localStream}
                    label="Você"
                    accessibleLabel="Você"
                    badge={shareSource === "camera" ? "câmera" : "transmitindo"}
                    muted
                    allowUnmute={false}
                    fill={isSingleTile || spotlightId === "self"}
                    className={spotlightId === "self" && !isSingleTile ? "sm:col-span-2 sm:row-span-2" : ""}
                    onFocus={() => toggleSpotlight("self")}
                    isSpotlighted={spotlightId === "self"}
                    onHyperfocus={() => toggleHyperfocus("self")}
                    isHyperfocused={activeHyperfocusId === "self"}
                    isMicOn={isMicOn}
                    onToggleMic={toggleMic}
                    micsMuted={micsMuted}
                    onToggleMicsMuted={toggleMicsMuted}
                  />
                )}
                {hyperfocusVisible && localCameraStream && (
                  <VideoTile
                    stream={localCameraStream}
                    label="Você"
                    accessibleLabel="Você"
                    badge="câmera"
                    muted
                    allowUnmute={false}
                    fill={isSingleTile || spotlightId === "self"}
                    className={spotlightId === "self" && !isSingleTile ? "sm:col-span-2 sm:row-span-2" : ""}
                    onFocus={() => toggleSpotlight("self")}
                    isSpotlighted={spotlightId === "self"}
                    onHyperfocus={() => toggleHyperfocus("self")}
                    isHyperfocused={activeHyperfocusId === "self"}
                    isMicOn={isMicOn}
                    onToggleMic={toggleMic}
                    micsMuted={micsMuted}
                    onToggleMicsMuted={toggleMicsMuted}
                  />
                )}
                {visibleVideoSources.map((videoSource) => {
                  const tileId = videoSourceTileId(videoSource.id);
                  // Keyed on the YouTube id (or playlist id), not the source
                  // id: a source id is minted fresh every time someone adds
                  // the video, so keying on it would mean the dial never
                  // actually persists. A playlist is one source even as the
                  // current video changes, so the playlist id is the stable
                  // key when present. The prefix keeps it out of the way of
                  // the peer ids sharing this same store.
                  const volumeKey = videoSourceVolumeKey(videoSource);
                  return (
                    <VideoSourceTile
                      key={tileId}
                      source={videoSource}
                      volume={transmissionVolumes[volumeKey] ?? 1}
                      onVolumeChange={(volume) => setTransmissionVolume(volumeKey, volume)}
                      // Whoever added it drives — or, if they set it to
                      // "anyone" when adding it, everyone does. Either way
                      // this is enforced again server-side (see
                      // "video-source-state" in signaling.ts), not just here.
                      canControl={
                        state.selfUserId !== null &&
                        (videoSource.controlMode === "anyone" ||
                          videoSource.addedById === state.selfUserId)
                      }
                      // Ownership itself, unlike canControl, never widens
                      // with controlMode — ending the video for the room
                      // stays with whoever added it regardless of who's
                      // allowed to drive it.
                      isOwner={
                        state.selfUserId !== null && videoSource.addedById === state.selfUserId
                      }
                      label={`${videoSource.addedByName} adicionou`}
                      fill={isSingleTile || spotlightId === tileId}
                      className={spotlightId === tileId && !isSingleTile ? "sm:col-span-2 sm:row-span-2" : ""}
                      onStateChange={(playing, positionSeconds, playbackRate, playlistIndex) =>
                        signalingClient.setVideoSourceState(
                          videoSource.id,
                          playing,
                          positionSeconds,
                          playbackRate,
                          playlistIndex
                        )
                      }
                      onRemove={() => signalingClient.removeVideoSource(videoSource.id)}
                      onLeave={() =>
                        setLeftVideoSourceIds((prev) => new Set(prev).add(videoSource.id))
                      }
                      onFocus={() => toggleSpotlight(tileId)}
                      isSpotlighted={spotlightId === tileId}
                      onHyperfocus={() => toggleHyperfocus(tileId)}
                      isHyperfocused={activeHyperfocusId === tileId}
                    />
                  );
                })}
                {leftVideoSources.map((videoSource) => (
                  <StoppedPeerTile
                    key={`left-${videoSource.id}`}
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
                {visibleScreenEntries.map(([peerId, stream]) => {
                  const peer = state.peers.find((p) => p.id === peerId);
                  const volumeKey = peer?.userId ?? peerId;
                  return (
                    <VideoTile
                      key={`screen-${peerId}`}
                      stream={stream}
                      label={
                        <DisplayUserName
                          name={peer?.name ?? "Alguém"}
                          isGuest={peer?.isGuest}
                          verified={peer?.flags?.includes("VERIFIED")}
                        />
                      }
                      accessibleLabel={peer?.name ?? "Alguém"}
                      badge="ao vivo · tela"
                      muted
                      volume={transmissionVolumes[volumeKey] ?? 1}
                      onVolumeChange={(volume) => setTransmissionVolume(volumeKey, volume)}
                      fill={isSingleTile || spotlightId === peerId}
                      className={spotlightId === peerId && !isSingleTile ? "sm:col-span-2 sm:row-span-2" : ""}
                      onRenderedSizeChange={(w, h) => qualityNegotiator.report("screen", peerId, w, h)}
                      onStopWatching={() => stopWatchingPeer(peerId)}
                      onFocus={() => toggleSpotlight(peerId)}
                      isSpotlighted={spotlightId === peerId}
                      onHyperfocus={() => toggleHyperfocus(peerId)}
                      isHyperfocused={activeHyperfocusId === peerId}
                      isMicOn={isMicOn}
                      onToggleMic={toggleMic}
                      micsMuted={micsMuted}
                      onToggleMicsMuted={toggleMicsMuted}
                    />
                  );
                })}
                {visibleCameraEntries.map(([peerId, stream]) => {
                  const peer = state.peers.find((p) => p.id === peerId);
                  const volumeKey = peer?.userId ?? peerId;
                  return (
                    <VideoTile
                      key={`camera-${peerId}`}
                      stream={stream}
                      label={
                        <DisplayUserName
                          name={peer?.name ?? "Alguém"}
                          isGuest={peer?.isGuest}
                          verified={peer?.flags?.includes("VERIFIED")}
                        />
                      }
                      accessibleLabel={peer?.name ?? "Alguém"}
                      badge="ao vivo · câmera"
                      muted
                      volume={transmissionVolumes[volumeKey] ?? 1}
                      onVolumeChange={(volume) => setTransmissionVolume(volumeKey, volume)}
                      fill={isSingleTile || spotlightId === peerId}
                      className={spotlightId === peerId && !isSingleTile ? "sm:col-span-2 sm:row-span-2" : ""}
                      onRenderedSizeChange={(w, h) => qualityNegotiator.report("camera", peerId, w, h)}
                      onStopWatching={() => stopWatchingCameraPeer(peerId)}
                      onFocus={() => toggleSpotlight(peerId)}
                      isSpotlighted={spotlightId === peerId}
                      onHyperfocus={() => toggleHyperfocus(peerId)}
                      isHyperfocused={activeHyperfocusId === peerId}
                      isMicOn={isMicOn}
                      onToggleMic={toggleMic}
                      micsMuted={micsMuted}
                      onToggleMicsMuted={toggleMicsMuted}
                    />
                  );
                })}
                {visibleStoppedEntries.map((peer) => (
                  <StoppedPeerTile
                    key={`stopped-${peer.id}`}
                    label={<DisplayUserName name={peer.name} isGuest={peer.isGuest} />}
                    fill={isSingleTile}
                    onResume={() => resumeWatchingPeer(peer.id)}
                  />
                ))}
                {visibleResumingEntries.map((peer) => (
                  <ResumingPeerTile key={`resuming-${peer.id}`} fill={isSingleTile} />
                ))}
                {visibleStoppedCameraEntries.map((peer) => (
                  <StoppedPeerTile
                    key={`stopped-camera-${peer.id}`}
                    label={<DisplayUserName name={peer.name} isGuest={peer.isGuest} />}
                    fill={isSingleTile}
                    onResume={() => resumeWatchingCameraPeer(peer.id)}
                  />
                ))}
                {visibleResumingCameraEntries.map((peer) => (
                  <ResumingPeerTile key={`resuming-camera-${peer.id}`} fill={isSingleTile} />
                ))}
              </div>
            </>
          )}
        </main>

        {/* From lg up, chat gets this dedicated full-height column instead
            of sharing a pane with participants — see isWideLayout. Nothing
            else in here but the owner/admin "Gerenciar sala" button, so
            chatSection's flex-1 (see its heightClassName) still has
            practically the whole column to fill. */}
        {isWideLayout && (
          <aside
            className="relative flex h-full shrink-0 flex-col overflow-hidden"
            style={{ width: `${chatWidth}px` }}
          >
            <div
              onMouseDown={startChatResize}
              className="group absolute inset-y-0 left-0 z-30 w-2 cursor-ew-resize"
              title="Arraste para redimensionar o chat"
            >
              <div className="absolute inset-y-0 left-0 w-1 bg-zinc-300 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-zinc-700" />
            </div>

            {chatSection}
          </aside>
        )}

        {/* Below lg the room stops being a page and becomes an app shell:
            the header, the video and the bar below split the viewport between
            them, and the only things that scroll are the insides of those
            three. Chat and the participant list come up as a sheet over the
            bottom of the video — not instead of it, since half the point of
            the room is talking about what is on screen. What used to be here
            was a pane that grew downwards as it filled: it pushed the page
            taller than the viewport, so the whole room slid up and down under
            the thumb, and the only hint that a chat existed at all was a grey
            tab strip floating under the video. */}
        {!isWideLayout && (
          <>
            {/* Out here rather than inside a sheet: it is the ad that pays
                for the room, and below lg it collapses itself to a single
                slim line (see PartnerCard) — small enough to leave on screen,
                one tap from the whole card. Above the sheet rather than below
                it, so the sheet always comes up off the bar that opened it. */}
            <PartnerCard />

            {mobilePanel && (
              <section
                // Mounted only while open, which is also what keeps the chat
                // opening on the newest message: ChatPanel jumps to the
                // bottom of the log on mount (see its initializedRef), and a
                // panel kept alive behind `display: none` cannot scroll
                // itself, so it would come back holding whatever position it
                // had when it was put away.
                className="flex h-[55dvh] min-h-72 shrink-0 flex-col border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
              >
                {/* The usual sheet grab bar, and a second way out: a sheet
                    whose only exit is the control that opened it is the kind
                    of thing people get stuck inside. */}
                <button
                  type="button"
                  onClick={() => setMobilePanel(null)}
                  aria-label="Fechar"
                  className="flex w-full shrink-0 justify-center py-2"
                >
                  <span className="h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                </button>

                {mobilePanel === "participants" ? (
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                    {roomManageRow}
                    {participantsSection}
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">{chatPanel}</div>
                )}
              </section>
            )}

            {(state.status === "connecting" || state.status === "closed") && (
              <p className="flex shrink-0 items-center justify-center gap-1.5 border-t border-amber-200 bg-amber-50 py-1 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                Conectando...
              </p>
            )}

            {/* The bar itself: what you do *in* the room on the left (the
                controls that were wrapping into three rows up in the header,
                as far from the thumb as a phone can put them), what you open
                *over* it on the right. One row, thumb-sized targets, never
                scrolls, never moves. */}
            <nav className="flex shrink-0 items-center gap-1 border-t border-zinc-200 bg-white px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <Tooltip
                  content={isMicOn ? "Desativar microfone" : (micBlockedReason ?? "Ativar microfone")}
                  wrapperClassName={DOCK_SLOT}
                >
                  <button
                    type="button"
                    onClick={toggleMic}
                    // Only turning it *on* is blocked — same rule as the
                    // desktop control, see ShareControls.
                    disabled={!isMicOn && Boolean(micBlockedReason)}
                    aria-pressed={isMicOn}
                    aria-label={isMicOn ? "Desativar microfone" : "Ativar microfone"}
                    className={`${DOCK_BUTTON} ${isMicOn ? DOCK_ON : DOCK_OFF}`}
                  >
                    {isMicOn ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5" />}
                  </button>
                </Tooltip>

                <Tooltip
                  content={micsMuted ? "Reativar microfones" : "Silenciar microfones"}
                  wrapperClassName={DOCK_SLOT}
                >
                  <button
                    type="button"
                    onClick={toggleMicsMuted}
                    aria-pressed={!micsMuted}
                    aria-label={micsMuted ? "Reativar microfones" : "Silenciar microfones"}
                    className={`${DOCK_BUTTON} ${micsMuted ? DOCK_OFF : DOCK_ON}`}
                  >
                    {micsMuted ? (
                      <HeadphonesOffIcon className="h-5 w-5" />
                    ) : (
                      <HeadphonesIcon className="h-5 w-5" />
                    )}
                  </button>
                </Tooltip>

                {/* Screen capture doesn't exist in a phone browser at all
                    (see useScreenShareMode), and a bar this narrow has no
                    room for a button whose only job is to explain why it
                    can't work. The desktop header keeps its disabled copy,
                    where there is space for the tooltip. */}
                {screenShareMode === "display" && (
                  <Tooltip
                    content={
                      localStream
                        ? "Parar de compartilhar a tela"
                        : (screenBlockedReason ?? "Compartilhar tela")
                    }
                    wrapperClassName={DOCK_SLOT}
                  >
                    <button
                      type="button"
                      onClick={() => (localStream ? stopShare() : startShare("display"))}
                      disabled={!localStream && Boolean(screenBlockedReason)}
                      aria-pressed={Boolean(localStream)}
                      aria-label={localStream ? "Parar de compartilhar a tela" : "Compartilhar tela"}
                      className={`${DOCK_BUTTON} ${localStream ? DOCK_LIVE : DOCK_ON}`}
                    >
                      <ScreenIcon className="h-5 w-5" />
                    </button>
                  </Tooltip>
                )}

                {screenShareMode !== "unsupported" && (
                  <Tooltip
                    content={
                      localCameraStream
                        ? "Parar câmera"
                        : (cameraBlockedReason ?? "Compartilhar câmera")
                    }
                    wrapperClassName={DOCK_SLOT}
                  >
                    <button
                      type="button"
                      onClick={() => (localCameraStream ? stopCameraShare() : startCameraShare())}
                      disabled={!localCameraStream && Boolean(cameraBlockedReason)}
                      aria-pressed={Boolean(localCameraStream)}
                      aria-label={localCameraStream ? "Parar câmera" : "Compartilhar câmera"}
                      className={`${DOCK_BUTTON} ${localCameraStream ? DOCK_LIVE : DOCK_ON}`}
                    >
                      <CameraIcon className="h-5 w-5" />
                    </button>
                  </Tooltip>
                )}

                <Tooltip
                  content={videoSourceBlockedReason ?? "Adicionar fonte de vídeo"}
                  wrapperClassName={DOCK_SLOT}
                >
                  <button
                    type="button"
                    onClick={openAddVideoSourcePopup}
                    disabled={Boolean(videoSourceBlockedReason)}
                    aria-label="Adicionar fonte de vídeo"
                    className={`${DOCK_BUTTON} ${DOCK_ON}`}
                  >
                    <MdOutlineOndemandVideo className="h-5 w-5" />
                  </button>
                </Tooltip>
              </div>

              <span className="mx-0.5 h-8 w-px shrink-0 bg-zinc-200 dark:bg-zinc-800" />

              {/* Labelled, unlike the controls beside them: an icon says
                  enough about a microphone, and said nothing about "there is
                  a chat in here" — which is the actual complaint about the
                  tab strip these replace. */}
              <button
                type="button"
                onClick={() => toggleMobilePanel("chat")}
                aria-pressed={mobilePanel === "chat"}
                className={`${DOCK_TAB} ${mobilePanel === "chat" ? DOCK_TAB_ACTIVE : DOCK_TAB_IDLE}`}
              >
                <span className="relative">
                  <MdOutlineChat className="h-5 w-5" />
                  {unreadChatCount > 0 && (
                    <span className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white">
                      {unreadChatCount > 9 ? "9+" : unreadChatCount}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-medium leading-none">Chat</span>
              </button>

              <button
                type="button"
                onClick={() => toggleMobilePanel("participants")}
                aria-pressed={mobilePanel === "participants"}
                className={`${DOCK_TAB} ${mobilePanel === "participants" ? DOCK_TAB_ACTIVE : DOCK_TAB_IDLE}`}
              >
                <MdOutlinePeople className="h-5 w-5" />
                <span className="text-[10px] font-medium leading-none">Pessoas ({peerCount})</span>
              </button>
            </nav>
          </>
        )}
      </div>

      {accountModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setAccountModal(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-black/10 bg-white p-8 shadow-xl dark:border-white/10 dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {accountModal === "login" ? "Entrar na conta" : "Criar conta"}
            </h2>
            {accountModal === "login" ? (
              <LoginForm
                onCancel={() => setAccountModal(null)}
                onSuccess={() => setAccountModal(null)}
                onSwitchToCreate={() => setAccountModal("create")}
              />
            ) : (
              <CreateAccountForm
                initialDisplayName={state.name ?? ""}
                onCancel={() => setAccountModal(null)}
                onSuccess={() => setAccountModal(null)}
                onSwitchToLogin={() => setAccountModal("login")}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

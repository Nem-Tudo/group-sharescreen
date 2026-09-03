"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  signalingClient,
  type RoomPermissionKey,
  type PeerInfo,
  type ChatReplyTo,
} from "@/lib/signalingClient";
import { useSignaling, useHasStoredName } from "@/lib/useSignaling";
import { useAuth } from "@/lib/AuthContext";
import { getAccountToken } from "@/lib/accountApi";
import { sendChatImages } from "@/lib/chatImage";
import {
  useRoomMedia,
  useScreenShareMode,
  SHARE_RESOLUTION_OPTIONS,
  SHARE_FPS_OPTIONS,
  SHARE_BITRATE_OPTIONS,
  SHARE_PROFILE_OPTIONS,
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
import {
  getSoundEffectsEnabled,
  setSoundEffectsEnabled,
  playMicOnSound,
  playMicOffSound,
  playDeafenSound,
  playUndeafenSound,
  playShareStartSound,
  playShareStopSound,
} from "@/lib/soundEffects";
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
  getStoredMicHintSeen,
  setStoredMicHintSeen,
  getStoredDoubleClickFocus,
  setStoredDoubleClickFocus,
  getStoredOpenRoomsInApp,
  setStoredOpenRoomsInApp,
  setStoredOpenInAppDismissed,
} from "@/lib/mediaPreferences";
import { VideoTile, StoppedPeerTile, ResumingPeerTile } from "@/components/VideoTile";
import { RemoteAudio } from "@/components/RemoteAudio";
import { ParticipantRow } from "@/components/ParticipantRow";
import { countDevicesByOwner, withDeviceSuffix } from "@/lib/displayName";
import { isMobileDevice } from "@/lib/announcement";
import { enterAndroidPip, onAndroidPipModeChange } from "@/lib/androidPictureInPicture";
import type { CameraFacing } from "@/lib/mediaPreferences";
import { ChatPanel } from "@/components/ChatPanel";
import { OpenInAppBanner } from "@/components/OpenInAppBanner";
import { RoomInfoControls } from "@/components/RoomInfoControls";
import { MusicBar } from "@/components/MusicBar";
import { LocalMediaControls, RemoteMediaControls } from "@/components/LocalMediaControls";
import { LocalMusicBar, RemoteMusicBar } from "@/components/LocalMusicBar";
import { MemberActionsMenu, type MemberActions } from "@/components/MemberActionsModal";
import { isDesktopApp, isMobileApp, armSavedShareSource } from "@/lib/desktop";
import { PartnerCard } from "@/components/PartnerCard";
import { QualitySelect } from "@/components/QualitySelect";
import { AdsterraBanner } from "@/components/AdsterraBanner";
import { AdsterraNative } from "@/components/AdsterraNative";
import { useAdRotation } from "@/lib/useAdRotation";
import { useAdsterraBlocked } from "@/lib/adsterraFill";
import { useAdsterraAvailable } from "@/lib/useAdsAllowed";
import { DisplayUserName } from "@/components/DisplayUserName";
import { CreateAccountForm } from "@/components/CreateAccountForm";
import { RoomSkeleton } from "@/components/RoomSkeleton";
import { MobileQualitySheet, type MobileQualityChoice } from "@/components/MobileQualitySheet";
import { UserProfileDialog } from "@/components/UserProfileDialog";
import { prewarmCaptcha } from "@/lib/turnstile";
import { RoomAccountCard } from "@/components/RoomAccountCard";
import { VideoSourceTile } from "@/components/VideoSourceTile";
import {
  videoSourceVolumeKey,
  videoSourceAdderVolumeKey,
  type VideoSourceKind,
} from "@/lib/videoSource";
import {
  LOCAL_MEDIA_SLOTS,
  localMediaSources,
  nextFreeLocalMediaSlot,
  type LocalMediaSlot,
} from "@/lib/localMediaSource";
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
  FocusIcon,
  ScreenIcon,
  CameraIcon,
} from "@/components/icons";
import { Tooltip, Popover } from "@/components/Tooltip";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { useMediaQuery, SM_BREAKPOINT_QUERY, LG_BREAKPOINT_QUERY } from "@/lib/useMediaQuery";
import {
  MdHome,
  MdOutlineOndemandVideo,
  MdOutlineDesktopWindows,
  MdOutlineMap,
  MdLogin,
  MdOutlineChat,
  MdOutlinePeople,
  MdMusicNote,
  MdCameraswitch,
  MdFlipCameraAndroid,
  MdOutlineKeyboard,
} from "react-icons/md";
import { BsGearFill, BsCoin } from "react-icons/bs";
import {
  LuPanelLeftClose,
  LuPanelLeftOpen,
  LuPanelRightClose,
  LuPanelRightOpen,
} from "react-icons/lu";
import { BetaMark } from "@/components/BetaMark";
import { UpdateAppButton } from "@/components/UpdateAppButton";
import { AccountModal } from "@/components/AccountModal";
import { GUEST_FEATURES, hasFeature } from "@/lib/entitlements";
import { PartnerMediaTile } from "@/components/PartnerMediaTile";
import { usePartnerAd } from "@/lib/usePartnerAd";
import {
  useGlobalShortcutListener,
  type ShortcutAction,
} from "@/lib/keyboardShortcuts";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { ShortcutQuickPopover } from "@/components/ShortcutQuickPopover";
import { hasVerifiedBadge } from "@/lib/entitlements";

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

// How long after joining the mic nudge below appears.
const MIC_HINT_DELAY_MS = 2500;
// And how long after creating a public room its "put it on the map" popup
// does. Shorter, because it is the answer to something the person just did
// rather than an interruption of what they came here for — but not instant:
// the room they just made should be on screen behind it.
const NEW_ROOM_POPUP_DELAY_MS = 900;

// The one-time nudge over the mic button, for a first-time visitor who has
// landed in a room with the mic off and no reason to suspect the site has
// voice in it at all. Rooms are built around people talking to each other,
// and someone who never finds the button silently gets the worst version of
// the product — so this points at it once, on the first room this browser
// ever opens, and never again (see getStoredMicHintSeen).
//
// A Popover rather than a Tooltip because it has to stay up on its own
// without being hovered, and because it carries the button that acts on it:
// the nudge is worth little if taking it up means finding the control anyway.
// It also takes over the mic button's ordinary hover hint (Popover's
// `tooltip`), which suppresses that hint while the panel is open instead of
// letting the two stack on top of each other.
function MicUsageHint({
  open,
  onDismiss,
  onEnableMic,
  tooltip,
  wrapperClassName,
  children,
}: {
  open: boolean;
  onDismiss: () => void;
  onEnableMic: () => void;
  tooltip: ReactNode;
  wrapperClassName: string;
  children: ReactElement<{ ref?: Ref<Element> }>;
}) {
  return (
    <Popover
      open={open}
      onClose={onDismiss}
      // Above the button in both layouts: the desktop control row sits under
      // the header with the video below it, and the mobile dock is at the
      // very bottom of the screen — under it there is nothing to open into.
      placement="top"
      tooltip={tooltip}
      wrapperClassName={wrapperClassName}
      content={
        <div className="w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-zinc-300 bg-white p-3 text-left shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <MicIcon className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
            Fale com a sala
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
            Ligue o microfone aqui para conversar com quem está na sala. O áudio
            do site é feito para isso — com cancelamento de ruído e volume por
            pessoa — e a sala fica bem melhor de acompanhar do que só assistindo.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onEnableMic}
              className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700"
            >
              Ativar microfone
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Agora não
            </button>
          </div>
        </div>
      }
    >
      {children}
    </Popover>
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
  features,
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
> & { features: readonly string[] }) {
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
          {/* One column on a phone rather than three cramped ones: the hints
              are what make these choosable, and they are the first thing to
              become unreadable when the buttons get narrow. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {SHARE_PROFILE_OPTIONS.map((opt) => (
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
              Acima de 30fps, escolha &quot;Equilibrado&quot; ou &quot;Vídeo /
              jogo&quot; — no modo texto o navegador descarta quadros para
              manter a nitidez.
            </p>
          )}
        </div>

        <QualitySelect
          label="Resolução"
          value={shareResolution}
          options={SHARE_RESOLUTION_OPTIONS}
          features={features}
          onChange={setShareResolution}
        />

        <QualitySelect
          label="Taxa de quadros"
          value={shareFps}
          options={SHARE_FPS_OPTIONS}
          features={features}
          onChange={setShareFps}
        />

        <QualitySelect
          label="Bitrate"
          value={shareBitrate}
          options={SHARE_BITRATE_OPTIONS}
          features={features}
          onChange={setShareBitrate}
        />

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
  cameraFacing,
  setCameraFacing,
  onPhone,
  cameraMenuOpen,
  setCameraMenuOpen,
  open,
  setOpen,
  quality,
  onOpenShortcutQuick,
  quickShortcutAction,
  onCloseShortcutQuick,
  onRequestAccount,
  onOpenAllShortcuts,
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
  // The phone's replacement for that picker: which way the camera points,
  // and a button to turn it round. A list of opaque lens ids is the wrong
  // control on a phone — see useRoomMedia's setCameraFacing for why the flip
  // is built on facingMode rather than on that list.
  cameraFacing: CameraFacing;
  setCameraFacing: (facing: CameraFacing) => void;
  // Actual phone/tablet hardware, not a narrow window. A laptop dragged
  // narrow still wants the picker; a phone in landscape still wants the flip.
  onPhone: boolean;
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
  > & { hasAccount: boolean; features: readonly string[] };
  onOpenShortcutQuick?: (action: ShortcutAction) => void;
  quickShortcutAction?: ShortcutAction | null;
  onCloseShortcutQuick?: () => void;
  onRequestAccount?: () => void;
  onOpenAllShortcuts?: () => void;
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
      <ShortcutQuickPopover
        action="toggleScreenShare"
        open={quickShortcutAction === "toggleScreenShare"}
        onClose={onCloseShortcutQuick ?? (() => {})}
        hasAccount={quality.hasAccount}
        onRequestAccount={onRequestAccount ?? (() => {})}
        onOpenAllShortcuts={onOpenAllShortcuts}
      >
        <Tooltip content={screenLabel} wrapperClassName="flex">
          <button
            type="button"
            onClick={onToggleScreen}
            onContextMenu={(e) => {
              e.preventDefault();
              onOpenShortcutQuick?.("toggleScreenShare");
            }}
            disabled={!screenSupported || screenBlocked}
            aria-pressed={screenSharing}
            aria-label={screenLabel}
            className={`${segment} ${screenSharing ? live : idle}`}
          >
            <ScreenIcon className="h-5 w-5" />
          </button>
        </Tooltip>
      </ShortcutQuickPopover>
      <ShortcutQuickPopover
        action="toggleCamera"
        open={quickShortcutAction === "toggleCamera"}
        onClose={onCloseShortcutQuick ?? (() => {})}
        hasAccount={quality.hasAccount}
        onRequestAccount={onRequestAccount ?? (() => {})}
        onOpenAllShortcuts={onOpenAllShortcuts}
      >
        <Tooltip content={cameraLabel} wrapperClassName="flex">
          <button
            type="button"
            onClick={onToggleCamera}
            onContextMenu={(e) => {
              e.preventDefault();
              onOpenShortcutQuick?.("toggleCamera");
            }}
            disabled={!cameraSupported || cameraBlocked}
            aria-pressed={cameraSharing}
            aria-label={cameraLabel}
            className={`${segment} border-l border-black/15 ${cameraSharing ? live : idle}`}
          >
            <CameraIcon className="h-5 w-5" />
          </button>
        </Tooltip>
      </ShortcutQuickPopover>
      {/* Only where there is actually a choice to make: on the one-webcam
          laptop that most people are on, a chevron whose menu offers a
          single entry is pure clutter. Enumeration fills in after the first
          camera permission, so this can appear mid-session — which is also
          when it starts being useful. */}
      {/* One control or the other, never both: they answer the same question
          ("which camera?") and a phone showing a flip button *and* a list of
          "camera2 0, facing back" entries would be two ways to do one thing,
          one of them unreadable. */}
      {cameraSupported && onPhone ? (
        <Tooltip
          content={
            cameraFacing === "environment"
              ? "Usar a câmera frontal"
              : "Usar a câmera traseira"
          }
          placement="bottom"
        >
          <button
            type="button"
            onClick={() =>
              setCameraFacing(cameraFacing === "environment" ? "user" : "environment")
            }
            aria-label="Virar a câmera"
            className={`flex items-center border-l border-black/15 px-2 text-white transition ${cameraSharing ? live : idle}`}
          >
            <MdFlipCameraAndroid className="h-4 w-4" />
          </button>
        </Tooltip>
      ) : cameraSupported && cameraDevices.length > 1 ? (
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
      ) : null}
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

// How "Focar" and "Hiperfoco" address a tile.
//
// One id per *tile*, not per person: screen and camera are independent
// broadcast channels (see useRoomMedia's useBroadcastChannel) and each gets a
// tile of its own, so someone sharing both has two. These used to be keyed by
// the bare peer id, which meant focusing either one focused both — the camera
// came along onto the stage uninvited, and hyperfocus kept receiving a channel
// nobody had asked to see.
//
// The owner half is a peer connection id, SELF_TILE_OWNER for our own tiles,
// or a video source's id. Those namespaces overlap, which is what the kind
// half keeps apart.
// "file" tiles are addressed by `${slot}:${ownerId}` in their id — a person
// can be playing three at once, so the owner alone no longer identifies one.
type TileKind = "screen" | "camera" | "file" | "video-source";
const SELF_TILE_OWNER = "self";

function tileId(kind: TileKind, ownerId: string): string {
  return `${kind}:${ownerId}`;
}

// Null for anything this doesn't recognise — an id left over from an older
// scheme, say — which every caller treats as "that tile is gone", the same
// answer it gives for a peer who left.
function parseTileId(id: string): { kind: TileKind; ownerId: string } | null {
  const separator = id.indexOf(":");
  if (separator < 0) return null;
  const kind = id.slice(0, separator);
  const ownerId = id.slice(separator + 1);
  if (!ownerId) return null;
  if (kind !== "screen" && kind !== "camera" && kind !== "video-source") return null;
  return { kind, ownerId };
}

// Which of the two sheets the bottom bar has open below lg — see
// WatchRoom's mobilePanel.
type MobilePanel = "participants" | "chat";

// The chat column's width, in px, from lg up (see chatWidth below). The
// default is also what a double-click on the drag handle restores — a width
// dragged to something unusable is otherwise a fiddly thing to undo by hand.
// The maximum is a ceiling, not the real limit: the drag also refuses to take
// more than half the room, which on most screens bites first.
const DEFAULT_CHAT_WIDTH = 320;
const MIN_CHAT_WIDTH = 260;
const MAX_CHAT_WIDTH = 720;

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
// Split so the one control that shares its slot can opt out of the minimum
// width. `min-w-10` is right for a button alone in a slot — it stops a very
// narrow phone squeezing a tap target below 40px — and wrong for one paired
// with the camera switch, where the floor plus the switch's fixed 28px add up
// to more than a `flex-1` slot has on a narrow screen. The pair then
// overflowed instead of shrinking, which is what put the switch on top of the
// camera button.
const DOCK_BUTTON_BASE =
  "flex h-11 w-full items-center justify-center rounded-xl text-white transition disabled:cursor-not-allowed disabled:opacity-50";
const DOCK_BUTTON = `${DOCK_BUTTON_BASE} min-w-10`;
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

  // Start minting a captcha token now rather than when the join fires. There
  // is real time between this page mounting and a join — resolving the
  // account, opening the socket, and often somebody typing a name — and
  // Turnstile does its work when its widget is rendered, not when the script
  // loads (unlike the reCAPTCHA this replaced, where a token was a ~200ms
  // lookup of an assessment the page had already done). Spending that window
  // is the difference between joining instantly and watching a spinner.
  useEffect(() => {
    prewarmCaptcha("join_room");
  }, []);

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
    fileChannels,
    localMediaSnapshots,
    startCameraShare,
    stopCameraShare,
    localCameraStream,
    remoteCameraStreams,
    cameraShareError,
    cameraDeviceId,
    setCameraDevice,
    cameraFacing,
    setCameraFacing,
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
    setMicOn,
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
  // Read by the join announcement below, which is registered once and must see
  // the current value rather than the one that existed at mount. Written in an
  // effect rather than during render — a join can only land after the commit
  // anyway, so there is no window where this is stale.
  const micsMutedRef = useRef(micsMuted);
  useEffect(() => {
    micsMutedRef.current = micsMuted;
  }, [micsMuted]);

  // A sound on your own mute and unmute, both for the mic and for the room.
  //
  // Driven by the resulting *state* rather than wired into the buttons on
  // purpose: these are toggled from the header, the bottom bar, the tile
  // overlay, a keyboard shortcut, and — the case that matters most — a global
  // shortcut fired while the app is behind a game. Hanging the sound off each
  // handler would mean five places to keep in step and one of them missed;
  // watching the value catches every path, including the ones added later.
  //
  // The refs start at the mounted value and the effects compare against them,
  // so restoring a stored "microfones silenciados" on entry is silent. Only a
  // change somebody actually made makes a noise.
  // What the mic was doing when the room was deafened, so undeafening can put
  // it back exactly there. Deafening with the mic already closed has nothing
  // to restore, which is the whole of the "fica apenas deafen" case.
  const micBeforeDeafenRef = useRef(false);
  // Set to the value a deafen/undeafen is about to move the mic to, so the
  // mic's own sound below stays quiet for that one change. Without it,
  // deafening plays two sounds at once — the deafen chime and the mic-off
  // blip — for a single press, and the pair is no longer recognisable as
  // either.
  const micFollowingDeafenRef = useRef<boolean | null>(null);

  const micSoundRef = useRef(isMicOn);
  useEffect(() => {
    if (micSoundRef.current === isMicOn) return;
    micSoundRef.current = isMicOn;
    if (micFollowingDeafenRef.current === isMicOn) {
      micFollowingDeafenRef.current = null;
      return;
    }
    if (isMicOn) playMicOnSound();
    else playMicOffSound();
  }, [isMicOn]);

  // Your own transmissions, the same way the mic pair works and for the same
  // reason: these are toggled by a global shortcut fired from inside a game,
  // where nothing on screen confirms that anything happened.
  //
  // The two channels share one pair of sounds rather than having four. What
  // the sound reports is "a transmission of yours started/stopped", and which
  // one it was is not something a chime can say better than the tile that
  // appears a moment later. Starting both does chime twice, which is right —
  // two things started.
  const screenSharingSoundRef = useRef(Boolean(localStream));
  useEffect(() => {
    const sharing = Boolean(localStream);
    if (screenSharingSoundRef.current === sharing) return;
    screenSharingSoundRef.current = sharing;
    if (sharing) playShareStartSound();
    else playShareStopSound();
  }, [localStream]);

  const cameraSharingSoundRef = useRef(Boolean(localCameraStream));
  useEffect(() => {
    const sharing = Boolean(localCameraStream);
    if (cameraSharingSoundRef.current === sharing) return;
    cameraSharingSoundRef.current = sharing;
    if (sharing) playShareStartSound();
    else playShareStopSound();
  }, [localCameraStream]);

  const micsMutedSoundRef = useRef(micsMuted);
  useEffect(() => {
    // Only an actual change of the deafen state does anything here. The guard
    // is what makes it safe to depend on isMicOn as well: the mic moving does
    // re-run this effect, and without this it would re-apply the follow.
    if (micsMutedSoundRef.current === micsMuted) return;
    micsMutedSoundRef.current = micsMuted;
    if (micsMuted) {
      playDeafenSound();
      // Deafened: the mic goes with it, and is remembered so undeafening can
      // bring it back. Muting yourself is what deafening means — leaving the
      // mic open while you cannot hear anyone is a way to talk over people
      // without knowing it.
      micBeforeDeafenRef.current = isMicOn;
      if (isMicOn) {
        micFollowingDeafenRef.current = false;
        setMicOn(false);
      }
      return;
    }
    playUndeafenSound();
    // Undeafened: back to whatever the mic was. Closed before means closed
    // now — coming back from deafen must never open a microphone the person
    // had deliberately shut.
    if (micBeforeDeafenRef.current && !isMicOn) {
      micFollowingDeafenRef.current = true;
      setMicOn(true);
    }
    micBeforeDeafenRef.current = false;
  }, [micsMuted, isMicOn, setMicOn]);
  const [soundEffectsOn, setSoundEffectsOn] = useState(() => getSoundEffectsEnabled());
  const [doubleClickFocus, setDoubleClickFocus] = useState(() => getStoredDoubleClickFocus());
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
  // Which transmission is waiting on the quality question, or null. Only ever
  // set on a phone (see MobileQualitySheet); "screen" covers both the real
  // screen capture of the Android app and the camera fallback a phone browser
  // gets instead, because from the person's side both are "transmitir".
  //
  // Up here with the other hooks, not down beside the render that uses it:
  // everything below the pre-join early returns runs conditionally, and a
  // useState there changes hook order between the skeleton and the room.
  const [qualityPrompt, setQualityPrompt] = useState<"screen" | null>(null);
  // True while Android is floating this app's window (see
  // lib/androidPictureInPicture.ts). Drives `data-pip` on the room shell,
  // which is what strips the page down to the one tile being watched — the
  // system floats whatever the page renders, so this has to happen in CSS
  // here rather than being something the native side could do.
  const [pipActive, setPipActive] = useState(false);
  // Whose profile is open over the room, or null. Every screen size: the
  // point of the dialog is not saving space, it is not losing the room you
  // are in — which is if anything truer on a phone, where the alternative was
  // a second tab to find your way back out of.
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  // Android tells us when the floating window opens *and* when it closes —
  // the second one is what matters, since the person closing it or tapping
  // back into the app is not something this side could otherwise detect, and
  // the room would stay stripped down to one tile forever.
  useEffect(() => {
    return onAndroidPipModeChange((active) => setPipActive(active));
  }, []);

  // Real phone/tablet hardware, not a narrow window — a laptop dragged narrow
  // still wants the desktop picker. Gated on the mount flag because it reads the
  // user agent, which the server render has no answer for.
  const onPhone = mounted && isMobileDevice();
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

  // The room has one ad square and two advertisers for it, so they take
  // turns — a minute each (see useAdRotation). Which Adsterra unit is in play
  // depends on the layout: the wide sidebar is 256px, where only the fluid
  // native format is worth anything, and below lg the slot is a strip beside
  // the partner card, which is a fixed banner.
  const adsterraFormat = isWideLayout ? "native" : "banner";
  // An ad blocker ends the arrangement: the slot goes back to being the
  // partner's alone, exactly as it was before Adsterra was added here. Worth
  // being explicit about, because the alternative is the failure mode this
  // whole check exists to avoid — the room's own paying ad disappearing for a
  // minute at a time to make room for a blank rectangle.
  //
  // Learned rather than guessed: the first Adsterra turn reports whether
  // anything was actually drawn (see fillProbeScript), and a blocker that
  // refuses the request outright is caught in milliseconds by the script
  // tag's own onerror, so in practice the slot never visibly empties.
  const adsterraBlocked = useAdsterraBlocked();
  const adsterraReady = useAdsterraAvailable(adsterraFormat) && !adsterraBlocked;
  const showAdsterra = useAdRotation(adsterraReady);

  const {
    ad: activePartnerAd,
    rawPartner: rawActivePartner,
    loaded: partnerLoaded,
    // Told when it is off screen, so it stops counting impressions for an ad
    // nobody can see and defers its rotation to a minute it owns.
  } = usePartnerAd({ visible: !showAdsterra });

  const hasLocalScreen = Boolean(isSharing && localStream);
  const hasLocalCamera = Boolean(localCameraStream);
  const hasLocalFiles = LOCAL_MEDIA_SLOTS.some((slot) => fileChannels[slot]?.localStream);
  const hasRemoteScreens =
    Object.keys(remoteStreams).length > 0 ||
    stoppedPeers.size > 0 ||
    resumingPeers.size > 0;
  const hasRemoteCameras =
    Object.keys(remoteCameraStreams).length > 0 ||
    stoppedCameraPeers.size > 0 ||
    resumingCameraPeers.size > 0;
  const hasRemoteFiles = LOCAL_MEDIA_SLOTS.some(
    (slot) =>
      Object.keys(fileChannels[slot]?.remoteStreams ?? {}).length > 0 ||
      fileChannels[slot]?.stoppedPeers.size > 0 ||
      fileChannels[slot]?.resumingPeers.size > 0
  );
  const hasVideoSources = (state.videoSources?.length ?? 0) > 0;

  const hasAnyMedia =
    hasLocalScreen ||
    hasLocalCamera ||
    hasLocalFiles ||
    hasRemoteScreens ||
    hasRemoteCameras ||
    hasRemoteFiles ||
    hasVideoSources;

  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("sharescreen:leftSidebarCollapsed") === "true";
    } catch {
      return false;
    }
  });

  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("sharescreen:rightSidebarCollapsed") === "true";
    } catch {
      return false;
    }
  });

  const leftSidebarCollapsedRef = useRef(leftSidebarCollapsed);
  leftSidebarCollapsedRef.current = leftSidebarCollapsed;
  const rightSidebarCollapsedRef = useRef(rightSidebarCollapsed);
  rightSidebarCollapsedRef.current = rightSidebarCollapsed;

  const previousHasAnyMediaRef = useRef<boolean | null>(null);
  const mediaLostAtRef = useRef<number | null>(null);
  const savedCollapsedBeforeLossRef = useRef<{ left: boolean; right: boolean } | null>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (previousHasAnyMediaRef.current === null) {
      previousHasAnyMediaRef.current = hasAnyMedia;
      if (!hasAnyMedia) {
        if (leftSidebarCollapsedRef.current) setLeftSidebarCollapsed(false);
        if (rightSidebarCollapsedRef.current) setRightSidebarCollapsed(false);
      }
      return;
    }

    const hadMedia = previousHasAnyMediaRef.current;
    previousHasAnyMediaRef.current = hasAnyMedia;

    if (hadMedia && !hasAnyMedia) {
      // All media ended: remember if sidebars were collapsed, then reopen both
      mediaLostAtRef.current = Date.now();
      savedCollapsedBeforeLossRef.current = {
        left: leftSidebarCollapsedRef.current,
        right: rightSidebarCollapsedRef.current,
      };

      if (leftSidebarCollapsedRef.current) setLeftSidebarCollapsed(false);
      if (rightSidebarCollapsedRef.current) setRightSidebarCollapsed(false);

      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = setTimeout(() => {
        savedCollapsedBeforeLossRef.current = null;
        mediaLostAtRef.current = null;
      }, 10_000);
    } else if (!hadMedia && hasAnyMedia) {
      // Media returned: if within 10 seconds, restore previous collapsed state
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }

      const elapsed = mediaLostAtRef.current ? Date.now() - mediaLostAtRef.current : Infinity;
      if (elapsed <= 10_000 && savedCollapsedBeforeLossRef.current) {
        const { left, right } = savedCollapsedBeforeLossRef.current;
        if (left) setLeftSidebarCollapsed(true);
        if (right) setRightSidebarCollapsed(true);
      }

      savedCollapsedBeforeLossRef.current = null;
      mediaLostAtRef.current = null;
    }
  }, [hasAnyMedia]);

  useEffect(() => {
    try {
      localStorage.setItem("sharescreen:leftSidebarCollapsed", String(leftSidebarCollapsed));
    } catch {}
  }, [leftSidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem("sharescreen:rightSidebarCollapsed", String(rightSidebarCollapsed));
    } catch {}
  }, [rightSidebarCollapsed]);

  const toggleLeftSidebar = useCallback(() => {
    setLeftSidebarCollapsed((prev) => {
      // Only allow collapsing when there is at least one media
      if (!hasAnyMedia && !prev) return prev;
      const next = !prev;
      if (next) {
        if (rawActivePartner?.id) {
          signalingClient.reportPartnerMinimize(rawActivePartner.id);
        }
        trackEvent("partner_ad_minimized", {
          partnerId: rawActivePartner?.id ?? "fallback",
          title: activePartnerAd.title,
        });
      }
      trackEvent("left_sidebar_toggle", { collapsed: next });
      return next;
    });
  }, [hasAnyMedia, rawActivePartner, activePartnerAd]);

  const toggleRightSidebar = useCallback(() => {
    setRightSidebarCollapsed((prev) => {
      // Only allow collapsing when there is at least one media
      if (!hasAnyMedia && !prev) return prev;
      const next = !prev;
      trackEvent("right_sidebar_toggle", { collapsed: next });
      return next;
    });
  }, [hasAnyMedia]);

  const [visibleCameraError, setVisibleCameraError] = useState<string | null>(null);

  useEffect(() => {
    if (!cameraShareError) {
      setVisibleCameraError(null);
      return;
    }
    setVisibleCameraError(cameraShareError);
    const timer = setTimeout(() => {
      setVisibleCameraError(null);
    }, 10_000);
    return () => clearTimeout(timer);
  }, [cameraShareError]);

  const [chatWidth, setChatWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_CHAT_WIDTH;

    const saved = localStorage.getItem("chat-panel-width");
    const width = saved ? Number(saved) : DEFAULT_CHAT_WIDTH;

    return Number.isFinite(width)
      ? Math.min(Math.max(width, MIN_CHAT_WIDTH), MAX_CHAT_WIDTH)
      : DEFAULT_CHAT_WIDTH;
  });
  const isResizingChatRef = useRef(false);
  // The chat column itself. Measured while dragging so its edge follows the
  // pointer exactly: the old arithmetic derived that edge from
  // `window.innerWidth` minus a hard-coded padding, so the column jumped by
  // however far that guess was off the moment a drag started, and drifted
  // again whenever the layout's padding changed.
  const chatAsideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    localStorage.setItem("chat-panel-width", String(chatWidth));
  }, [chatWidth]);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isResizingChatRef.current) return;
      const aside = chatAsideRef.current;
      if (!aside) return;

      // The column's right edge stays put; the pointer is its left edge.
      const newWidth = aside.getBoundingClientRect().right - e.clientX;
      // Never past half the room — the other half is what the video needs,
      // and a chat dragged over it is not a state anyone means to be in.
      const roomWidth = aside.parentElement?.clientWidth ?? window.innerWidth;
      const max = Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, roomWidth * 0.5));

      setChatWidth(Math.min(Math.max(newWidth, MIN_CHAT_WIDTH), max));
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

  function toggleDoubleClickFocus() {
    const next = !doubleClickFocus;
    setDoubleClickFocus(next);
    setStoredDoubleClickFocus(next);
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
    signalingClient.setMicsMuted(next);
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

  // A video source's dial writes two entries: the video's own, and one for
  // whoever added it (see videoSourceAdderVolumeKey). The second is only ever
  // read as a *default* — the next video that person adds opens at whatever
  // this viewer last chose for one of theirs, instead of starting at full
  // volume every time and being turned down again.
  function setVideoSourceVolume(volumeKey: string, adderKey: string, volume: number) {
    setTransmissionVolumes((prev) => ({ ...prev, [volumeKey]: volume, [adderKey]: volume }));
    setStoredTransmissionVolume(volumeKey, volume);
    setStoredTransmissionVolume(adderKey, volume);
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
      state.status !== "banned" &&
      // Same reasoning as "banned", and the same bug it was written to fix:
      // a superseded connection has deliberately stopped reconnecting (see
      // signalingClient's onclose), so it is not restoring either. This check
      // renders above the superseded screen below, so without this a tab that
      // was taken over before it ever registered sat on the spinner forever
      // and never reached the screen that explains what happened.
      state.status !== "superseded");

  // Announced on every join, and on the rejoin after a reconnect: the server
  // resets this for the new socket, and unlike the mic it is restored from
  // storage rather than switched on by hand — so without this nobody would
  // ever be told about a setting that came back on its own.
  useEffect(() => {
    const unsubscribe = signalingClient.onRoomJoined(() => {
      signalingClient.setMicsMuted(micsMutedRef.current);
    });
    return () => {
      unsubscribe();
    };
  }, []);

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

  // Whether the tile an id points at still has anything to show. The one
  // place that knows how each kind of tile answers that — used both by the
  // effect right below (which clears a stale hyperfocus) and by
  // hyperfocusTargetGone further down (which makes the render behave as
  // un-focused immediately, without waiting for it).
  function isTileGone(id: string): boolean {
    const target = parseTileId(id);
    if (!target) return true;
    if (target.kind === "video-source") {
      return !state.videoSources.some((v) => v.id === target.ownerId);
    }
    if (target.ownerId === SELF_TILE_OWNER) {
      return target.kind === "screen" ? !(isSharing && localStream) : !localCameraStream;
    }
    return target.kind === "screen"
      ? !(target.ownerId in remoteStreams)
      : !(target.ownerId in remoteCameraStreams);
  }

  // Clears the hyperfocus state once its target is gone (see
  // activeHyperfocusId further down, which already makes the *render* behave
  // as un-focused). Without this the stale id would silently re-engage
  // hyperfocus the moment that same peer started transmitting again. Up here
  // among the other effects because everything below is past an early
  // return; deferred out of the effect body because a setState there is a
  // cascading render.
  useEffect(() => {
    if (hyperfocusId === null) return;
    if (!state.account || isTileGone(hyperfocusId)) {
      queueMicrotask(() => setHyperfocusId(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hyperfocusId,
    state.account,
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
  const imageBlockedReason = roomBlockReason("image", "o envio de imagens");

  // The top dial positions are gated (see each SHARE_*_OPTIONS' `feature`),
  // and the pickers enforce that by disabling those options. Now that the
  // dials survive a reload, that is no longer the only way one can be
  // selected: somebody who picked 4K while subscribed and came back after the
  // subscription lapsed would have it restored straight past the disabled
  // option, because localStorage does not know who is holding the browser —
  // or what they are still paying for.
  //
  // So the entitlement is re-checked once it is actually known, rather than
  // at restore time — at restore time it is not: the account resolves a
  // moment later, and downgrading against a not-yet-resolved `null` would
  // demote the very people who are entitled to it.
  //
  // Checked against the resolved feature list rather than "is there an
  // account", which is what makes this keep working as perks are added: a
  // future paid option needs nothing here, because the option already knows
  // which feature it needs and this only asks whether that feature is held.
  useEffect(() => {
    if (!mounted || resolvingAccount) return;
    const features = account?.features ?? GUEST_FEATURES;
    const resolution = SHARE_RESOLUTION_OPTIONS.find((o) => o.value === shareResolution);
    if (!hasFeature(resolution?.feature, features)) setShareResolution("1080p");
    const fps = SHARE_FPS_OPTIONS.find((o) => o.value === shareFps);
    if (!hasFeature(fps?.feature, features)) setShareFps(30);
    const bitrate = SHARE_BITRATE_OPTIONS.find((o) => o.value === shareBitrate);
    if (!hasFeature(bitrate?.feature, features)) setShareBitrate("high");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, resolvingAccount, account, shareResolution, shareFps, shareBitrate]);

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

  // "Você criou uma sala pública!" — opened by itself, once, for whoever's
  // join brought the room into existence (see the server's "room-state"
  // `created`). A room is at its most findable the moment it is created and
  // its owner is right here; asking later means asking someone who has
  // already settled into a room nobody can find.
  //
  // Private rooms are excluded outright: they are not on the map, not in the
  // listing, and the server refuses the write (see privateRoomCannotBeMapped).
  const [newRoomPopupOpen, setNewRoomPopupOpen] = useState(false);
  // Guards against a second opening — `roomCreated` stays true for as long as
  // this room's state is held, so anything that re-runs the effect (a new
  // `openPopup` identity, say) would otherwise reopen the popup on someone
  // who already answered it.
  const newRoomPopupShown = useRef(false);
  useEffect(() => {
    if (!state.roomCreated || privateRoomCannotBeMapped || newRoomPopupShown.current) return;
    const timer = setTimeout(() => {
      newRoomPopupShown.current = true;
      setNewRoomPopupOpen(true);
      openPopup("manage_room", {
        // Same box as openRoomLocationPopup below — it is the same map view,
        // and the width has to be set on the popup for the same reason.
        width: "min(64rem, calc(100vw - 3rem))",
        maxWidth: "min(64rem, calc(100vw - 3rem))",
        maxHeight: "92dvh",
        data: { initialView: "location", canEdit: true, justCreated: true },
        onClose: () => setNewRoomPopupOpen(false),
      });
    }, NEW_ROOM_POPUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.roomCreated, privateRoomCannotBeMapped, openPopup]);

  // The one-time "ligue o microfone" nudge (see MicUsageHint above). Its
  // state lives here rather than in the component because the two mic
  // buttons — the desktop control row and the mobile dock — are one control
  // rendered in one place at a time (see isWideLayout), and this is where
  // both of them already read their state from.
  const [micHintOpen, setMicHintOpen] = useState(false);
  const closeMicHint = useCallback(() => setMicHintOpen(false), []);
  const enableMicFromHint = useCallback(() => {
    setMicHintOpen(false);
    if (!isMicOn) toggleMic();
  }, [isMicOn, toggleMic]);
  // What both mic buttons call instead of toggleMic directly: reaching for
  // the control is itself an answer to the nudge, so it gets out of the way
  // rather than hanging over the button that was just pressed.
  const handleToggleMic = useCallback(() => {
    setMicHintOpen(false);
    toggleMic();
  }, [toggleMic]);
  useEffect(() => {
    // Nothing to teach when the mic is already on or the room doesn't allow
    // it, and nothing to point at before the join lands (`state.name`) — the
    // controls aren't on screen until then. Someone whose mic auto-starts
    // from a stored preference never gets here at all: this re-runs when
    // that lands and clears the pending timer on the way out.
    if (!state.name || isMicOn || micBlockedReason || getStoredMicHintSeen()) return;
    // A coach mark opening behind the new-room popup would be spent without
    // ever being read — it waits for that to be dealt with first.
    if (newRoomPopupOpen) return;
    // Late enough not to land on top of a room still connecting, early
    // enough to still be the first thing someone reads about the room.
    const timer = setTimeout(() => {
      setMicHintOpen(true);
      // Marked spent as it goes up, not as it's dismissed: whatever someone
      // does with it — press it, wave it off, close the tab — it has had its
      // one turn, and a nudge that reappears until it's clicked is nagging.
      setStoredMicHintSeen(true);
    }, MIC_HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.name, isMicOn, micBlockedReason, newRoomPopupOpen]);

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

  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [quickShortcutAction, setQuickShortcutAction] = useState<ShortcutAction | null>(null);

  useGlobalShortcutListener({
    enabled: Boolean(state.account),
    handlers: {
      toggleDeafen: toggleMicsMuted,
      toggleMute: handleToggleMic,
      toggleScreenShare: () => {
        if (localStream) {
          stopShare();
          return;
        }
        if (screenShareMode !== "display" || screenBlockedReason) return;
        // The shortcut's whole point is not having to be at the app. Opening
        // the source picker put a window in front of somebody who is inside a
        // game and cannot see it — so this reuses the last screen/window
        // instead, and the shell only falls back to the picker when there is
        // nothing to reuse (see lib/desktop's armSavedShareSource).
        //
        // Awaited before startShare, not alongside it: the arming is a
        // one-shot read by the getDisplayMedia that startShare is about to
        // make, so racing them would let the request arrive first and open
        // the picker anyway.
        //
        // Deliberately only here. Pressing the button is being at the app,
        // looking at it, having chosen to — that is exactly when being asked
        // which screen is the right thing to happen.
        void armSavedShareSource().then(() => startShare("display"));
      },
      toggleCamera: () => {
        if (localCameraStream) stopCameraShare();
        else if (screenShareMode !== "unsupported" && !cameraBlockedReason) startCameraShare();
      },
      toggleMusicPlay: () => {
        const activeSlot = LOCAL_MEDIA_SLOTS.find((s) => fileChannels[s]?.localStream);
        if (activeSlot !== undefined) {
          localMediaSources[activeSlot]?.togglePlay();
        } else if (state.music) {
          signalingClient.setMusicState(
            state.music.id,
            !state.music.playing,
            state.music.positionSeconds,
            state.music.playbackRate,
            state.music.playlistIndex
          );
        }
      },
      nextMusic: () => {
        const activeSlot = LOCAL_MEDIA_SLOTS.find((s) => fileChannels[s]?.localStream);
        if (activeSlot !== undefined) {
          localMediaSources[activeSlot]?.next();
        } else if (state.music?.playlistId) {
          const nextIdx = (state.music.playlistIndex ?? 0) + 1;
          signalingClient.setMusicState(
            state.music.id,
            state.music.playing,
            0,
            state.music.playbackRate,
            nextIdx
          );
        }
      },
      previousMusic: () => {
        const activeSlot = LOCAL_MEDIA_SLOTS.find((s) => fileChannels[s]?.localStream);
        if (activeSlot !== undefined) {
          localMediaSources[activeSlot]?.previous();
        } else if (state.music?.playlistId) {
          const prevIdx = Math.max(0, (state.music.playlistIndex ?? 0) - 1);
          signalingClient.setMusicState(
            state.music.id,
            state.music.playing,
            0,
            state.music.playbackRate,
            prevIdx
          );
        }
      },
    },
  });

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

  // Still resolving who this person is — a stored guest name, or an account
  // token on its way through /auth/me. The room's own shape stands in for it
  // (see components/RoomSkeleton) rather than a spinner on an empty page,
  // because what follows this is the room itself: drawing its layout now
  // means the only thing that changes when it lands is the content inside it.
  if (restoring) {
    return (
      <>
        <RoomSkeleton />
        <p className="sr-only" role="status">
          Entrando na sala...
        </p>
      </>
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

  // This room threw us out (see the server's "room-kick"/"room-ban"). Its own
  // screen rather than a toast: the room is gone from under this tab either
  // way, and being dropped back into an empty page with a notification would
  // leave someone wondering whether it broke. A kick says come back; a ban
  // does not, because they cannot.
  if (state.roomRemoval) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          {state.roomRemoval.banned
            ? "Você foi banido desta sala."
            : "Você foi removido desta sala."}
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {!state.roomRemoval.banned && "Você pode entrar de novo, se quiser."}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {!state.roomRemoval.banned && (
            <button
              type="button"
              onClick={() => signalingClient.joinRoom(handle)}
              className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Entrar de novo
            </button>
          )}
          <Link
            href="/rooms"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Ver outras salas
          </Link>
        </div>
      </div>
    );
  }

  // The room turned this connection away. One screen for every reason, but
  // the reason decides the words, the icon and — the whole point — which
  // action is offered first: a rename only where a rename actually helps
  // (the name is taken), a retry where retrying can change the outcome, and
  // never a rename box for someone who is banned or in a full room, which is
  // what the old single screen showed everyone. See joinErrorKind in
  // signalingClient. Home, other rooms and support are always there, because
  // Already in this room somewhere else. A question, not a failure — which is
  // why it sits above the joinError screen and looks nothing like it: nothing
  // has gone wrong, the other device is not being disconnected, and the only
  // thing missing is an answer. Rendered as a full pre-join screen rather than
  // a modal for the same reason every other pre-join state is: there is no
  // room behind it yet to layer anything over.
  if (state.deviceConflict) {
    const { devices, maxDevices } = state.deviceConflict;
    // The count is of the *others* already there, so this one would be the
    // next. Said out loud because "you can have 3" means nothing without
    // knowing which number you are about to become.
    const afterJoining = devices + 1;
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <div
            aria-hidden
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-2xl dark:bg-zinc-900"
          >
            {"\u{1F4BB}"}
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Você está conectado nesta sala com outro dispositivo.
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {devices === 1
              ? "Entrar aqui não desconecta o outro — vocês dois ficam na sala."
              : `Entrar aqui não desconecta os outros ${devices} — todos ficam na sala.`}{" "}
            Na lista e no chat, cada um aparece com um número para dar para
            diferenciar.
          </p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            {afterJoining} de {maxDevices} dispositivos.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => signalingClient.confirmDeviceJoin()}
              className="rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Entrar mesmo assim
            </button>
            <button
              type="button"
              onClick={() => signalingClient.dismissDeviceJoin()}
              className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Cancelar
            </button>
          </div>
        </main>
      </div>
    );
  }

  // "this didn't work" should never be a dead end.
  if (state.joinError) {
    const kind = state.joinErrorKind;
    const failure: {
      icon: string;
      title: string;
      // Whether a plain retry can plausibly succeed next time. A taken name
      // needs the form instead; a ban never will.
      retry: boolean;
    } =
      kind === "name"
        ? { icon: "\u{1F464}", title: "Esse nome já está em uso", retry: false }
        : kind === "full"
          ? { icon: "\u{1F6AA}", title: "Esta sala está cheia", retry: true }
          : kind === "banned"
            ? { icon: "\u{1F6D1}", title: "Você foi banido desta sala", retry: false }
            : kind === "captcha"
              ? { icon: "\u{1F6E1}\uFE0F", title: "Verificação de segurança", retry: true }
              : kind === "device-limit"
                ? // Retryable on purpose, unlike a ban: the fix is on another
                  // screen the person can go and close, and coming back here
                  // to press a button is the whole of what they then have to
                  // do. The message already says how many and what to do.
                  { icon: "\u{1F4BB}", title: "Dispositivos demais nesta sala", retry: true }
                : { icon: "\u26A0\uFE0F", title: "Não foi possível entrar na sala", retry: true };

    return (
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <div
            aria-hidden
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-2xl dark:bg-zinc-900"
          >
            {failure.icon}
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {failure.title}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{state.joinError}</p>

          {/* Only where changing the name is the actual fix. Everywhere else a
              name field would be the same misdirection the old screen gave
              everyone. */}
          {kind === "name" && (
            <form onSubmit={handleNameSubmit} className="mt-6 flex flex-col gap-2 text-left">
              <label
                htmlFor="join-error-name"
                className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Escolha outro nome
              </label>
              <div className="flex gap-2">
                <input
                  id="join-error-name"
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
                  Entrar
                </button>
              </div>
            </form>
          )}

          <div className="mt-6 flex flex-col gap-2">
            {failure.retry && (
              <button
                type="button"
                onClick={() => signalingClient.joinRoom(handle)}
                className="rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                Tentar novamente
              </button>
            )}
            <div className="flex gap-2">
              <Link
                href="/"
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Início
              </Link>
              <Link
                href="/rooms"
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Outras salas
              </Link>
            </div>
            <a
              href="https://discord.gg/nemtudo"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg px-4 py-2 text-sm font-medium text-blue-600 transition hover:text-blue-700 dark:text-blue-500 dark:hover:text-blue-400"
            >
              Precisa de ajuda? Fale com o suporte no Discord
            </a>
          </div>
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

  // Registered but the "join" for this room hasn't resolved into a
  // "room-state" yet — covers the (usually sub-second) time spent resolving
  // a captcha token before the join is even sent. Without this the room
  // UI below would render immediately with an empty peer list, looking
  // joined when it isn't yet.
  if (!state.room) {
    return (
      <>
        <RoomSkeleton />
        <p className="sr-only" role="status">
          Entrando na sala...
        </p>
      </>
    );
  }

  // Moderator "ghost" peers (see server/signaling.ts's admin-join) ride the
  // same peer list so their WebRTC connections get set up transparently,
  // but must never show up to real participants — filtered out here rather
  // than never added, so this is the one place that has to remember it.
  const visiblePeers = state.peers.filter((p) => p.role !== "moderator");
  // Built from the peer list *plus this client*, because the peer list never
  // contains us and our own second device has to be numbered like anybody
  // else's. Recomputed every render on purpose: the label is a fact about the
  // room right now, so a device leaving un-numbers the one left behind with no
  // message from the server. See lib/displayName.ts.
  const deviceCounts = countDevicesByOwner([
    ...visiblePeers,
    { userId: state.selfUserId ?? undefined },
  ]);
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
  // The file channels: local files people are playing for the room. One entry
  // per slot per peer, for the same reason the camera has its own — one tile
  // per channel, so playing a film and sharing a screen are two tiles rather
  // than a fight over one, and three files are three tiles.
  const allRemoteFileEntries = LOCAL_MEDIA_SLOTS.flatMap((slot) =>
    Object.entries(fileChannels[slot].remoteStreams).map(([peerId, stream]) => {
      const peer = state.peers.find((p) => p.id === peerId);
      const shared = peer?.files?.find((f) => f.channel === slot) ?? null;
      return { slot, peerId, stream, peer, shared } as const;
    })
  );
  // A file its owner put on as music is the room's soundtrack, not something
  // to watch: it belongs in the strip under the header next to a YouTube one,
  // and taking a tile for it would spend a grid slot on a black rectangle.
  // Everything else is a tile like any other transmission.
  const remoteMusicEntries = allRemoteFileEntries.filter((e) => e.shared?.mode === "music");
  const remoteFileEntries = allRemoteFileEntries.filter((e) => e.shared?.mode !== "music");
  // Hyperfocus survives only as long as what it's focused on does. When that
  // transmission ends — the peer stops sharing, or leaves — its tile goes
  // with it, and that tile is the only way out of hyperfocus (see
  // toggleHyperfocus): the room was left showing nothing at all, every other
  // transmission still hidden, and no button anywhere to bring them back.
  // Dropping the focus the moment its target is gone is what un-sticks it.
  const hyperfocusTargetGone =
    hyperfocusId !== null && (!state.account || isTileGone(hyperfocusId));
  // Used everywhere below instead of the raw state, so this render already
  // behaves as un-focused rather than waiting for the effect that clears it.
  const activeHyperfocusId = hyperfocusTargetGone ? null : hyperfocusId;
  // Parsed once here rather than at each of the filters below. Null whenever
  // nothing is hyperfocused, which is what every one of them tests first.
  const hyperfocusTarget = activeHyperfocusId ? parseTileId(activeHyperfocusId) : null;

  // Hyperfocus hides every tile except the chosen one (its connections are
  // also actively closed — see enterHyperfocus below — so this isn't just a
  // display filter, the streams genuinely stop arriving).
  //
  // "Except the chosen one" means exactly one tile now. Sharing your screen
  // and your camera at once used to keep both of them on screen, because both
  // answered to the same id.
  const localScreenVisible =
    !hyperfocusTarget ||
    (hyperfocusTarget.kind === "screen" && hyperfocusTarget.ownerId === SELF_TILE_OWNER);
  const localCameraVisible =
    !hyperfocusTarget ||
    (hyperfocusTarget.kind === "camera" && hyperfocusTarget.ownerId === SELF_TILE_OWNER);
  const visibleScreenEntries = hyperfocusTarget
    ? hyperfocusTarget.kind === "screen"
      ? remoteScreenEntries.filter(([peerId]) => peerId === hyperfocusTarget.ownerId)
      : []
    : remoteScreenEntries;
  const visibleCameraEntries = hyperfocusTarget
    ? hyperfocusTarget.kind === "camera"
      ? remoteCameraEntries.filter(([peerId]) => peerId === hyperfocusTarget.ownerId)
      : []
    : remoteCameraEntries;
  const visibleFileEntries = hyperfocusTarget
    ? hyperfocusTarget.kind === "file"
      ? remoteFileEntries.filter(
          ({ slot, peerId }) => `${slot}:${peerId}` === hyperfocusTarget.ownerId
        )
      : []
    : remoteFileEntries;
  // Ours, one per slot that is actually going out, split the same way.
  const liveLocalSlots = LOCAL_MEDIA_SLOTS.filter((slot) => fileChannels[slot].localStream);
  const localMusicSlots = liveLocalSlots.filter(
    (slot) => localMediaSnapshots[slot].mode === "music"
  );
  const localFileSlots = liveLocalSlots.filter(
    (slot) => localMediaSnapshots[slot].mode !== "music"
  );
  // Music is a soundtrack: a room has one, not a pile. So the music picker
  // aims at the slot already playing mine when there is one — "trocar música"
  // means the next track replaces this one, not that the two play over each
  // other — and only falls back to a free slot when there is nothing to
  // replace. The video picker keeps taking a free slot every time, because
  // several videos at once is the whole point of having three.
  const myMusicSlot = localMusicSlots[0] ?? null;

  // Putting music on the room (see components/MusicBar). Two gates, both
  // re-checked server-side: a room manager, since this is one shared output
  // for everybody rather than something each participant brings; and a real
  // account, since a guest identity lasts as long as a browser profile does
  // and the room's soundtrack should not sit behind one.
  //
  // The account read here is `state.account` — the one this *socket* is
  // registered as — rather than the auth context's, because that is precisely
  // what the server checks (`info.accountId`). They agree in the end, but for
  // a moment after load one says "signed in" while the other hasn't
  // registered yet, and gating on the wrong one offers a button whose click
  // the server then refuses.
  // The camera the switch below moves to, named so the tooltip says where it
  // is going rather than just "trocar". Falls back to the first when the
  // current one isn't in the list — which is what a freshly unplugged (or
  // never-yet-permitted) device looks like.
  const nextCamera =
    cameraDevices[
      (cameraDevices.findIndex((d) => d.deviceId === cameraDeviceId) + 1) %
        Math.max(cameraDevices.length, 1)
    ] ?? null;
  const nextCameraLabel = nextCamera ? `Mudar para ${nextCamera.label}` : "Trocar câmera";
  function switchToNextCamera() {
    if (nextCamera) setCameraDevice(nextCamera.deviceId);
  }

  // On a phone the switch is driven by facingMode, not by the device list
  // above — and that is not a preference, it is the only thing that works.
  // The Android shell's WebView does not enumerate the phone's lenses as
  // separate video inputs the way mobile Chrome does, so `cameraDevices`
  // comes back with one entry and the button that gated on `length > 1`
  // simply never appeared in the app. It appeared in the browser, which is
  // exactly the shape of the bug that was reported.
  //
  // facingMode asks for "the one pointing the other way" and lets the
  // platform resolve it, with no enumeration and no labels — see
  // useRoomMedia's setCameraFacing. Used for every phone rather than only the
  // app, so both behave the same and the label says something a person
  // recognises ("usar a câmera traseira") instead of "camera2 0, facing back".
  const flipsByFacing = onPhone;
  const canSwitchCamera = flipsByFacing || cameraDevices.length > 1;
  const switchCameraLabel = flipsByFacing
    ? cameraFacing === "environment"
      ? "Usar a câmera frontal"
      : "Usar a câmera traseira"
    : nextCameraLabel;
  function switchCamera() {
    if (flipsByFacing) {
      setCameraFacing(cameraFacing === "environment" ? "user" : "environment");
      return;
    }
    switchToNextCamera();
  }

  const canManageMusic = isRoomManager && Boolean(state.account);
  const musicBlockedReason = !isRoomManager
    ? "Só o dono e os administradores da sala podem colocar música."
    : !state.account
      ? "Utilize uma conta para colocar música na sala."
      : null;

  function startLocalMediaShare(slot: LocalMediaSlot) {
    // The picker has already put the new queue into this slot. When the slot
    // is *already* broadcasting — which is what "trocar" does, by aiming at
    // the slot in use — the stream, the canvas and the audio graph are all
    // still wired to the same element, so there is nothing to restart: just
    // play what is now loaded. Stopping and starting instead would drop the
    // channel and renegotiate it with every peer for a change of file.
    if (fileChannels[slot].active) {
      void localMediaSources[slot].playAt(0);
      return;
    }
    void fileChannels[slot].start();
  }

  // The slot a picker would fill, or null when all three are busy — which is
  // what the picker shows instead of quietly replacing something.
  const freeLocalMediaSlot = nextFreeLocalMediaSlot((slot) =>
    Boolean(fileChannels[slot].localStream)
  );

  // Putting music on means the room ends up with *one* soundtrack, whichever
  // of the two kinds it is — so each one turns the other off on the way in.
  function replaceMusicWithYouTube(url: string, controlMode: "owner" | "anyone") {
    for (const slot of localMusicSlots) fileChannels[slot].stop();
    signalingClient.setMusicSource("youtube", url, controlMode);
  }

  function replaceMusicWithLocalFiles(slot: LocalMediaSlot) {
    // Only the room's music record, never someone else's local file: this
    // client cannot stop another machine's playback, and taking a manager's
    // ability to put music on and turning it into "kick whatever anyone else
    // is playing" is not what this button is.
    if (state.music) signalingClient.clearMusicSource();
    startLocalMediaShare(slot);
  }

  // The room's actions for one person, from a right click on them in the
  // participant list or on one of their chat messages (see
  // MemberActionsModal). What this viewer may do is worked out here, which is
  // the only place that knows both who is asking and who runs the room — and
  // re-checked server-side either way.
  //
  // Two limits keep the power from turning on the room itself: nobody throws
  // out the owner, and only the owner throws out an admin. Without the second,
  // one admin could clear the bench of the others.
  function memberActionsFor(peer: PeerInfo): MemberActions | null {
    if (!peer.userId) return null;
    const targetIsOwner = peer.userId === state.roomOwnerId;
    const targetIsAdmin = state.roomAdmins.some((a) => a.id === peer.userId);
    const allowed = isRoomManager && !targetIsOwner && (!targetIsAdmin || isRoomOwner);
    return {
      userId: peer.userId,
      name: peer.name,
      isGuest: peer.isGuest,
      verified: hasVerifiedBadge(peer?.flags),
      nameColor: peer.nameColor,
      canKick: allowed,
      canBan: allowed,
      blockedReason: allowed
        ? null
        : targetIsOwner
          ? "Ninguém pode expulsar ou banir o dono da sala."
          : targetIsAdmin
            ? "Só o dono da sala pode expulsar ou banir um administrador."
            : "Só o dono e os administradores da sala podem expulsar ou banir.",
    };
  }

  // The phone's shell. A panel anchored to a row needs somewhere to hang, and
  // a 360px column has nowhere — so below sm the same menu opens as a popup
  // instead. Above it, the row renders the menu itself, beside the person it
  // is about (see ParticipantRow/ChatPanel's renderMenu).
  function openMemberActions(peer: PeerInfo) {
    const actions = memberActionsFor(peer);
    if (actions) openPopup("member_actions", { data: actions });
  }

  function chatAuthorPeer(from: string, name: string): PeerInfo | null {
    return (
      state.peers.find((p) => p.id === from) ??
      state.peers.find((p) => p.name.toLowerCase() === name.toLowerCase()) ??
      null
    );
  }

  // The phone opens member actions from a tap on the message rather than a
  // right click — it has no right click, and long-press is the browser's text
  // selection.
  function openMemberActionsFromChat(from: string, name: string) {
    const peer = chatAuthorPeer(from, name);
    if (peer) openMemberActions(peer);
  }

  // Built on open, not per row: `renderMenu` is only called for the one row
  // whose menu is actually showing.
  function renderMemberMenu(peer: PeerInfo | null, onDone: () => void) {
    const actions = peer && memberActionsFor(peer);
    if (!actions) return null;
    return <MemberActionsMenu actions={actions} onDone={onDone} />;
  }

  function openAddMusicPopup() {
    openPopup("add_music_source", {
      data: {
        onSubmit: replaceMusicWithYouTube,
        onLocalFiles: replaceMusicWithLocalFiles,
        localFilesSlot: myMusicSlot ?? freeLocalMediaSlot,
        hasAccount: Boolean(state.account),
        localFilesBlockedReason: videoSourceBlockedReason,
        replacing: Boolean(state.music) || myMusicSlot !== null,
      },
    });
  }

  const visibleLocalFileSlots = hyperfocusTarget
    ? hyperfocusTarget.kind === "file"
      ? localFileSlots.filter((slot) => hyperfocusTarget.ownerId === `${slot}:${SELF_TILE_OWNER}`)
      : []
    : localFileSlots;
  // Room video sources (YouTube, today — see components/VideoSourceTile).
  // They are tiles in every sense the room cares about: they take a grid
  // slot, they can be focused and hyperfocused, and they count toward
  // "is there more than one thing on screen". The only difference is that
  // nobody is transmitting them.
  const watchedVideoSources = state.videoSources.filter((v) => !leftVideoSourceIds.has(v.id));
  const visibleVideoSources = hyperfocusTarget
    ? hyperfocusTarget.kind === "video-source"
      ? watchedVideoSources.filter((v) => v.id === hyperfocusTarget.ownerId)
      : []
    : watchedVideoSources;
  // Placeholders for the ones this viewer stepped out of — hidden while
  // hyperfocused for the same reason a stopped peer's placeholder is.
  const leftVideoSources = activeHyperfocusId
    ? []
    : state.videoSources.filter((v) => leftVideoSourceIds.has(v.id));
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
  // Music slots are skipped: a placeholder stands in for a missing *tile*, and
  // a soundtrack never had one.
  const isMusicSlotOf = (peer: PeerInfo, slot: string) =>
    peer.files?.some((f) => f.channel === slot && f.mode === "music") ?? false;
  const stoppedFileEntries = LOCAL_MEDIA_SLOTS.flatMap((slot) =>
    visiblePeers
      .filter(
        (p) =>
          fileChannels[slot].stoppedPeers.has(p.id) &&
          !(p.id in fileChannels[slot].remoteStreams) &&
          !isMusicSlotOf(p, slot)
      )
      .map((p) => [slot, p] as const)
  );
  const resumingFileEntries = LOCAL_MEDIA_SLOTS.flatMap((slot) =>
    visiblePeers
      .filter(
        (p) =>
          fileChannels[slot].resumingPeers.has(p.id) &&
          !(p.id in fileChannels[slot].remoteStreams) &&
          !isMusicSlotOf(p, slot)
      )
      .map((p) => [slot, p] as const)
  );
  // Hidden along with everything else while hyperfocused — a placeholder for
  // someone hyperfocus itself just stopped watching would be confusing right
  // next to the "sair do hiperfoco" banner.
  const visibleStoppedEntries = activeHyperfocusId ? [] : stoppedEntries;
  const visibleResumingEntries = activeHyperfocusId ? [] : resumingEntries;
  const visibleStoppedCameraEntries = activeHyperfocusId ? [] : stoppedCameraEntries;
  const visibleResumingCameraEntries = activeHyperfocusId ? [] : resumingCameraEntries;
  const visibleStoppedFileEntries = activeHyperfocusId ? [] : stoppedFileEntries;
  const visibleResumingFileEntries = activeHyperfocusId ? [] : resumingFileEntries;
  // Every tile the room has on screen, in the order they appear, as
  // descriptors rather than as JSX laid out where it is used. Two reasons:
  //
  // - the same tile now has to render into three different boxes — a grid
  //   cell, the stage when it is the focused one, a filmstrip thumbnail when
  //   something else is — and only the caller knows which;
  // - the tile count was a hand-written sum of these same eight arrays,
  //   sitting a hundred lines away from the JSX it had to agree with. It is
  //   `tiles.length` now, and cannot drift.
  //
  // `id` is what "Focar" and "Hiperfoco" address, one per tile — see tileId.
  // It doubles as the React key: there is exactly one tile per id.
  type RoomTile = {
    id: string;
    // `fill` is "you have been given a box — grow into it"; false keeps the
    // tile its own 16:9 card, which is what a grid cell wants. `compact` says
    // the box is a filmstrip thumbnail, so drop the controls and shrink the
    // name — tile kinds with nothing to drop simply ignore it. See VideoTile.
    render: (fill: boolean, compact?: boolean, overlayRightOffset?: boolean) => ReactNode;
  };
  const tiles: RoomTile[] = [];

  if (localScreenVisible && isSharing && localStream) {
    const id = tileId("screen", SELF_TILE_OWNER);
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset) => (
        <VideoTile
          stream={localStream}
          label="Você"
          accessibleLabel="Você"
          badge={shareSource === "camera" ? "câmera" : "transmitindo"}
          muted
          allowUnmute={false}
          fill={fill}
          compact={compact}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          overlayRightOffset={overlayRightOffset}
          isMicOn={isMicOn}
          onToggleMic={toggleMic}
          micsMuted={micsMuted}
          onToggleMicsMuted={toggleMicsMuted}
        />
      ),
    });
  }

  if (localCameraVisible && localCameraStream) {
    const id = tileId("camera", SELF_TILE_OWNER);
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset) => (
        <VideoTile
          stream={localCameraStream}
          label="Você"
          accessibleLabel="Você"
          badge="câmera"
          muted
          allowUnmute={false}
          fill={fill}
          compact={compact}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          overlayRightOffset={overlayRightOffset}
          isMicOn={isMicOn}
          onToggleMic={toggleMic}
          micsMuted={micsMuted}
          onToggleMicsMuted={toggleMicsMuted}
        />
      ),
    });
  }

  // The local file this person is playing for the room. Captioned as one of
  // the room's video sources rather than as a transmission, because that is
  // what it is — its own channel is only how it gets there — and carrying its
  // own transport, inside the tile the buttons actually drive.
  for (const slot of visibleLocalFileSlots) {
    const stream = fileChannels[slot].localStream;
    if (!stream) continue;
    const snap = localMediaSnapshots[slot];
    const raw = snap.queue[snap.index]?.name ?? null;
    const name = raw ? raw.split("/").pop() ?? raw : "Arquivo do computador";
    const id = tileId("file", `${slot}:${SELF_TILE_OWNER}`);
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset) => (
        <VideoTile
          stream={stream}
          label={name}
          accessibleLabel={name}
          badge="você adicionou"
          badgeClassName="bg-sky-500/90"
          transport={
            <LocalMediaControls
              slot={slot}
              canRestrictControl={Boolean(state.account)}
              onRequestAccount={() => setAccountModal("create")}
              onStop={() => fileChannels[slot].stop()}
            />
          }
          onTogglePlay={() => localMediaSources[slot].togglePlay()}
          muted
          allowUnmute={false}
          fill={fill}
          compact={compact}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          overlayRightOffset={overlayRightOffset}
          isMicOn={isMicOn}
          onToggleMic={toggleMic}
          micsMuted={micsMuted}
          onToggleMicsMuted={toggleMicsMuted}
        />
      ),
    });
  }

  // Everyone else's copy of somebody's local file. Same captioning, from
  // PeerInfo.file — which is why that name travels at all.
  // What its owner last announced about each (see PeerInfo.files) — the name
  // for the caption, and, when they opened it up, everything the transport
  // needs to show a real position for a file on their machine.
  for (const { slot, peerId, stream, peer, shared } of visibleFileEntries) {
    const volumeKey = `file:${slot}:${peer?.userId ?? peerId}`;
    const id = tileId("file", `${slot}:${peerId}`);
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset) => (
        <VideoTile
          stream={stream}
          label={shared?.name ?? `arquivo de ${peer?.name ?? "alguém"}`}
          accessibleLabel={shared?.name ?? "Arquivo"}
          badge={`${peer?.name ?? "alguém"} adicionou`}
          badgeClassName="bg-sky-500/90"
          // Shown to everybody watching, and disabled for anyone its owner
          // did not open it up to: the position, the length and which of how
          // many it is are worth knowing whoever holds the wheel. Whether the
          // buttons do anything is checked here and again on the owner's
          // machine (see LocalMediaSource.applyRemote), which is the one that
          // counts.
          transport={
            shared ? (
              <RemoteMediaControls
                peerId={peerId}
                file={shared}
                canControl={shared.controlMode === "anyone"}
              />
            ) : undefined
          }
          // Same relay the transport's buttons use — a click in the picture is
          // just another way to press pause.
          onTogglePlay={
            shared?.controlMode === "anyone"
              ? () =>
                  signalingClient.sendSignal(peerId, {
                    kind: "file-control",
                    channel: slot,
                    action: "toggle",
                  })
              : undefined
          }
          muted
          volume={transmissionVolumes[volumeKey] ?? 1}
          onVolumeChange={(volume) => setTransmissionVolume(volumeKey, volume)}
          fill={fill}
          compact={compact}
          onRenderedSizeChange={(w, h) => qualityNegotiator.report(slot, peerId, w, h)}
          onStopWatching={() => fileChannels[slot].stopWatchingPeer(peerId)}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          overlayRightOffset={overlayRightOffset}
          isMicOn={isMicOn}
          onToggleMic={toggleMic}
          micsMuted={micsMuted}
          onToggleMicsMuted={toggleMicsMuted}
        />
      ),
    });
  }

  for (const videoSource of visibleVideoSources) {
    const id = tileId("video-source", videoSource.id);
    // The saved volume dial is keyed on the YouTube id (or playlist id), not
    // the source id the tile uses: a source id is minted fresh every time
    // someone adds the video, so keying on it would mean the dial never
    // actually persists. A playlist is one source even as the current video
    // changes, so the playlist id is the stable key when present. Its own
    // prefix keeps it out of the way of the peer ids sharing that store.
    const volumeKey = videoSourceVolumeKey(videoSource);
    // Falls back to whatever this viewer last set on another video from the
    // same person before falling back to full volume — the video's own saved
    // dial still wins whenever there is one.
    const adderVolumeKey = videoSourceAdderVolumeKey(videoSource.addedById);
    tiles.push({
      id,
      render: (fill) => (
        <VideoSourceTile
          source={videoSource}
          volume={transmissionVolumes[volumeKey] ?? transmissionVolumes[adderVolumeKey] ?? 1}
          onVolumeChange={(volume) => setVideoSourceVolume(volumeKey, adderVolumeKey, volume)}
          // Whoever added it drives — or, if they set it to "anyone" when
          // adding it, everyone does. Either way this is enforced again
          // server-side (see "video-source-state" in signaling.ts), not just
          // here.
          canControl={
            state.selfUserId !== null &&
            (videoSource.controlMode === "anyone" ||
              videoSource.addedById === state.selfUserId)
          }
          // Ownership itself, unlike canControl, never widens with
          // controlMode — ending the video for the room stays with whoever
          // added it regardless of who's allowed to drive it.
          isOwner={state.selfUserId !== null && videoSource.addedById === state.selfUserId}
          canRestrictControl={Boolean(state.account)}
          onRequestAccount={() => setAccountModal("create")}
          label={`${videoSource.addedByName} adicionou`}
          fill={fill}
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
          onLeave={() => setLeftVideoSourceIds((prev) => new Set(prev).add(videoSource.id))}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
        />
      ),
    });
  }

  for (const videoSource of leftVideoSources) {
    tiles.push({
      // The same id its live tile had: this is that tile, with the video
      // stepped out of rather than gone, so a focus on it stays put.
      id: tileId("video-source", videoSource.id),
      render: (fill) => (
        <StoppedPeerTile
          label={`vídeo de ${videoSource.addedByName}`}
          fill={fill}
          onResume={() =>
            setLeftVideoSourceIds((prev) => {
              const next = new Set(prev);
              next.delete(videoSource.id);
              return next;
            })
          }
        />
      ),
    });
  }

  for (const [peerId, stream] of visibleScreenEntries) {
    const peer = state.peers.find((p) => p.id === peerId);
    const volumeKey = peer?.userId ?? peerId;
    const id = tileId("screen", peerId);
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset) => (
        <VideoTile
          stream={stream}
          label={
            <DisplayUserName
              name={peer?.name ?? "Alguém"}
              isGuest={peer?.isGuest}
              verified={hasVerifiedBadge(peer?.flags)}
              color={peer?.nameColor}
            />
          }
          accessibleLabel={peer?.name ?? "Alguém"}
          badge="ao vivo · tela"
          muted
          volume={transmissionVolumes[volumeKey] ?? 1}
          onVolumeChange={(volume) => setTransmissionVolume(volumeKey, volume)}
          fill={fill}
          compact={compact}
          onRenderedSizeChange={(w, h) => qualityNegotiator.report("screen", peerId, w, h)}
          onStopWatching={() => stopWatchingPeer(peerId)}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          overlayRightOffset={overlayRightOffset}
          isMicOn={isMicOn}
          onToggleMic={toggleMic}
          micsMuted={micsMuted}
          onToggleMicsMuted={toggleMicsMuted}
        />
      ),
    });
  }

  for (const [peerId, stream] of visibleCameraEntries) {
    const peer = state.peers.find((p) => p.id === peerId);
    const volumeKey = peer?.userId ?? peerId;
    const id = tileId("camera", peerId);
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset) => (
        <VideoTile
          stream={stream}
          label={
            <DisplayUserName
              name={peer?.name ?? "Alguém"}
              isGuest={peer?.isGuest}
              verified={hasVerifiedBadge(peer?.flags)}
              color={peer?.nameColor}
            />
          }
          accessibleLabel={peer?.name ?? "Alguém"}
          badge="ao vivo · câmera"
          muted
          volume={transmissionVolumes[volumeKey] ?? 1}
          onVolumeChange={(volume) => setTransmissionVolume(volumeKey, volume)}
          fill={fill}
          compact={compact}
          onRenderedSizeChange={(w, h) => qualityNegotiator.report("camera", peerId, w, h)}
          onStopWatching={() => stopWatchingCameraPeer(peerId)}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          overlayRightOffset={overlayRightOffset}
          isMicOn={isMicOn}
          onToggleMic={toggleMic}
          micsMuted={micsMuted}
          onToggleMicsMuted={toggleMicsMuted}
        />
      ),
    });
  }

  for (const peer of visibleStoppedEntries) {
    tiles.push({
      id: tileId("screen", peer.id),
      render: (fill) => (
        <StoppedPeerTile
          label={<DisplayUserName name={peer.name} isGuest={peer.isGuest} />}
          fill={fill}
          onResume={() => resumeWatchingPeer(peer.id)}
        />
      ),
    });
  }

  for (const peer of visibleResumingEntries) {
    tiles.push({
      id: tileId("screen", peer.id),
      render: (fill) => <ResumingPeerTile fill={fill} />,
    });
  }

  for (const peer of visibleStoppedCameraEntries) {
    tiles.push({
      id: tileId("camera", peer.id),
      render: (fill) => (
        <StoppedPeerTile
          label={<DisplayUserName name={peer.name} isGuest={peer.isGuest} />}
          fill={fill}
          onResume={() => resumeWatchingCameraPeer(peer.id)}
        />
      ),
    });
  }

  for (const peer of visibleResumingCameraEntries) {
    tiles.push({
      id: tileId("camera", peer.id),
      render: (fill) => <ResumingPeerTile fill={fill} />,
    });
  }

  for (const [slot, peer] of visibleStoppedFileEntries) {
    tiles.push({
      id: tileId("file", `${slot}:${peer.id}`),
      render: (fill) => (
        <StoppedPeerTile
          label={<DisplayUserName name={peer.name} isGuest={peer.isGuest} />}
          fill={fill}
          onResume={() => fileChannels[slot].resumeWatchingPeer(peer.id)}
        />
      ),
    });
  }

  for (const [slot, peer] of visibleResumingFileEntries) {
    tiles.push({
      id: tileId("file", `${slot}:${peer.id}`),
      render: (fill) => <ResumingPeerTile fill={fill} />,
    });
  }

  const realMediaTileCount = tiles.length;
  const isFocusMode = spotlightId !== null && tiles.some((t) => t.id === spotlightId);

  // When the left sidebar (participants and ad card) is collapsed and not in hyperfocus:
  // - In focus mode (spotlight): ad is shown in the thumbnail strip
  // - In normal grid mode: ad is ONLY shown when there are 3 or more media sources transmitting
  if (
    leftSidebarCollapsed &&
    isWideLayout &&
    !activeHyperfocusId &&
    (isFocusMode || realMediaTileCount >= 3)
  ) {
    const adId = "sponsored-partner-tile";
    tiles.push({
      id: adId,
      render: (fill, compact) => (
        <PartnerMediaTile
          partner={activePartnerAd}
          fill={fill}
          compact={compact}
        />
      ),
    });
  }

  const tileCount = tiles.length;
  const isSingleTile = tileCount === 1;
  const nothingToShow = tileCount === 0;

  // "Focar", resolved. Derived rather than read straight off `spotlightId`
  // for the same reason activeHyperfocusId is: whatever was focused can stop
  // transmitting, and a stage built around a tile that no longer exists is an
  // empty box with everything else crammed into a filmstrip below it. A
  // vanished target simply falls back to the grid, and re-takes the stage if
  // that person starts again — nothing was disconnected on its behalf, so
  // there is nothing to restore either way.
  //
  // Off entirely while hyperfocused (the two are mutually exclusive) and with
  // a single tile, which already has the whole pane.
  //
  // Exactly one tile, since ids are per tile: focusing someone's screen puts
  // their screen on the stage and leaves their camera in the strip with
  // everyone else, which is what clicking that particular tile asked for.
  const stageTile =
    !activeHyperfocusId && spotlightId !== null && tileCount > 1
      ? (tiles.find((tile) => tile.id === spotlightId) ?? null)
      : null;
  const stripTiles = stageTile ? tiles.filter((tile) => tile !== stageTile) : [];

  // Below `sm`, 2 tiles side by side are still each bigger than a single
  // full-width 16:9 tile would end up after the header/aside eat into a
  // phone's height, so they stay stacked — but 3+ was the actual complaint
  // ("não aparece todas, tem que scrollar"): one column per tile meant
  // scrolling through a wall of tiles even though 2-up comfortably fits
  // more of them in view at once.
  const mobileGridCols = tileCount <= 2 ? "grid-cols-1" : "grid-cols-2";
  // From lg up the video pane is a fixed box rather than a page that grows,
  // so the grid is shaped to fill it instead of being left to a static
  // column count that runs off the bottom: roughly square, at most four
  // across.
  //
  // Rows have a floor, so a room with a dozen transmissions still shows
  // readable tiles and scrolls for the rest — past a point, scrolling beats
  // shrinking. Applied as an inline style rather than classes because the
  // count is a number, not one of a handful of breakpoints, and only from lg
  // up (isWideLayout): below that the responsive classes on the grid still
  // decide, and this is `undefined`. Nothing here has to know about "Focar"
  // any more — that has a layout of its own now instead of a 2x2 span
  // borrowed from this one.
  const tileGridCols = tileCount <= 1 ? 1 : tileCount <= 4 ? 2 : tileCount <= 9 ? 3 : 4;
  const tileGridRows = Math.max(1, Math.ceil(tileCount / tileGridCols));
  const tileGridStyle =
    isWideLayout && !isSingleTile
      ? {
        gridTemplateColumns: `repeat(${tileGridCols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${tileGridRows}, minmax(11rem, 1fr))`,
      }
      : undefined;

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
  /**
   * Floats the app window with this tile in it (Android only).
   *
   * Hyperfocus first, and that is not decoration: Android floats whatever the
   * page is rendering, so the page has to *be* one tile before the window
   * shrinks. Hyperfocus is already exactly that — it hides every other
   * transmission and drops their connections — so PiP reuses it rather than
   * inventing a second "show only this" mode that would have to be kept in
   * step with it.
   *
   * If the system refuses (PiP switched off for this app in Android settings,
   * or a state it will not enter from), the hyperfocus is left in place: the
   * person asked to watch this one thing, and undoing that as well would
   * answer a request they did not make.
   */
  async function enterNativePip(id: string, aspectRatio: number) {
    if (hyperfocusId !== id) enterHyperfocus(id);
    const entered = await enterAndroidPip(aspectRatio);
    // The mode-change listener sets this too, but only once Android has
    // actually switched — setting it here as well would risk stripping the
    // layout for a window that never floated.
    if (!entered) setPipActive(false);
  }

  function enterHyperfocus(id: string) {
    setSpotlightId(null);
    setHyperfocusId(id);
    // Everything that isn't this exact tile, which now includes the *other*
    // channel of the same person: hyperfocusing someone's screen used to keep
    // receiving their camera too, because both answered to their peer id.
    // That is bandwidth spent on a tile the layout has already hidden.
    const target = parseTileId(id);
    for (const [peerId] of remoteScreenEntries) {
      if (target?.kind !== "screen" || target.ownerId !== peerId) stopWatchingPeer(peerId);
    }
    for (const [peerId] of remoteCameraEntries) {
      if (target?.kind !== "camera" || target.ownerId !== peerId) stopWatchingCameraPeer(peerId);
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
    if (!state.account) {
      setAccountModal("create");
      return;
    }
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
    // The resolved entitlement list from the API (see the account's
    // `features`), not something derived here: what premium includes is the
    // server's answer, and this end only renders it. Falls back to the guest
    // list while auth is still resolving, which is the safe direction — an
    // option that appears a moment later is better than one that is offered
    // and then taken away.
    features: account?.features ?? GUEST_FEATURES,
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

      <button
        type="button"
        onClick={() => {
          closeMenu();
          setShortcutsModalOpen(true);
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        <MdOutlineKeyboard className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
        Atalhos de teclado
      </button>

      <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />

      {/* Above the toggles rather than among them: it is the only setting in
          here that changes how the whole site looks, and it is three states
          rather than the on/off every MenuToggleRow below is. The same
          control sits in the site header on every page that has one (see
          components/SiteHeader.tsx) — a room has no such header, which is
          exactly why it needs a copy in here. */}
      <div className="mb-1 px-1">
        <p className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Tema</p>
        <ThemeSegmented />
      </div>

      <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />

      {/* Below lg the header's control row does not exist — the bottom dock
          replaces it, and a dock wide enough for a phone has room for the
          things used every minute and nothing else. Everything that lived
          only in that row therefore needs a way in from here, or it is simply
          unreachable on a phone. */}
      {!isWideLayout && (
        <>
          <Tooltip content={musicBlockedReason ?? undefined} wrapperClassName="flex w-full">
            <button
              type="button"
              onClick={() => {
                closeMenu();
                openAddMusicPopup();
              }}
              disabled={!canManageMusic}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <MdMusicNote className="h-4 w-4 shrink-0 text-emerald-500" />
              {state.music || myMusicSlot ? "Trocar a música da sala" : "Colocar música na sala"}
              <BetaMark />
            </button>
          </Tooltip>

          <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />
        </>
      )}

      <MenuToggleRow
        label="Duplo clique para deixar em foco"
        active={doubleClickFocus}
        onToggle={toggleDoubleClickFocus}
        hint="Quando desligado, focar em um vídeo é apenas pelo botão"
        activeIcon={<FocusIcon className="h-4 w-4" />}
        inactiveIcon={<EyeOffIcon className="h-4 w-4" />}
      />
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

      {/* At every width now, not just on a phone: it used to have its own
          button in the desktop header, where a once-a-session action was
          taking permanent space from the controls used all call long. */}
      <div>
        <button
          type="button"
          onClick={() => setSwitching((s) => !s)}
          className="w-full rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
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
  // control row, alongside "Compartilhar sala"/"Trocar de sala" and the
  // "Pro" button.
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
        <ShortcutQuickPopover
          action="toggleMute"
          open={quickShortcutAction === "toggleMute"}
          onClose={() => setQuickShortcutAction(null)}
          hasAccount={Boolean(state.account)}
          onRequestAccount={() => setAccountModal("create")}
          onOpenAllShortcuts={() => setShortcutsModalOpen(true)}
        >
          <MicUsageHint
            open={micHintOpen}
            onDismiss={closeMicHint}
            onEnableMic={enableMicFromHint}
            tooltip={
              isMicOn
                ? "Desativar microfone"
                : (micBlockedReason ?? "Ativar microfone")
            }
            wrapperClassName="flex"
          >
            <button
              type="button"
              onClick={handleToggleMic}
              onContextMenu={(e) => {
                e.preventDefault();
                setQuickShortcutAction("toggleMute");
              }}
              // Only turning it *on* is blocked — see ShareControls'
              // screenBlockedReason for the same reasoning.
              disabled={!isMicOn && Boolean(micBlockedReason)}
              aria-label={isMicOn ? "Desativar microfone" : "Ativar microfone"}
              className={`rounded-r-lg p-2 text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${isMicOn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
                }`}
            >
              {isMicOn ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5" />}
            </button>
          </MicUsageHint>
        </ShortcutQuickPopover>
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
        <ShortcutQuickPopover
          action="toggleDeafen"
          open={quickShortcutAction === "toggleDeafen"}
          onClose={() => setQuickShortcutAction(null)}
          hasAccount={Boolean(state.account)}
          onRequestAccount={() => setAccountModal("create")}
          onOpenAllShortcuts={() => setShortcutsModalOpen(true)}
        >
          <Tooltip content={micsMuted ? "Reativar microfones" : "Silenciar microfones"}>
            <button
              type="button"
              onClick={toggleMicsMuted}
              onContextMenu={(e) => {
                e.preventDefault();
                setQuickShortcutAction("toggleDeafen");
              }}
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
        </ShortcutQuickPopover>
      </div>

      {/* A rule between "what everyone hears" and "what everyone sees" —
          a standalone separator rather than a border on the group, so the
          spacing matches the one before the add-video button in the header
          dock that holds all of this. */}
      <span className="mx-0.5 h-6 w-px shrink-0 self-center bg-zinc-300 dark:bg-zinc-700" />

      <div className="flex items-center">
        <ShareControls
          screenSharing={Boolean(localStream)}
          cameraSharing={Boolean(localCameraStream)}
          screenSupported={screenShareMode === "display"}
          cameraSupported={screenShareMode !== "unsupported"}
          screenBlockedReason={screenBlockedReason}
          cameraBlockedReason={cameraBlockedReason}
          onToggleScreen={() => {
            if (localStream) {
              stopShare();
              return;
            }
            // On a phone the quality question is asked here rather than left
            // in a settings menu nobody opens — see MobileQualitySheet. The
            // start is deferred until it is answered; on anything else it
            // goes straight through, unchanged.
            if (onPhone) {
              setQualityPrompt("screen");
              return;
            }
            void startShare("display");
          }}
          onToggleCamera={() => (localCameraStream ? stopCameraShare() : startCameraShare())}
          cameraDevices={cameraDevices}
          cameraDeviceId={cameraDeviceId}
          cameraFacing={cameraFacing}
          setCameraFacing={setCameraFacing}
          onPhone={onPhone}
          setCameraDevice={setCameraDevice}
          cameraMenuOpen={cameraDeviceMenuOpen}
          setCameraMenuOpen={setCameraDeviceMenuOpen}
          open={shareQualityOpen}
          setOpen={setShareQualityOpen}
          quality={qualityControlsProps}
          onOpenShortcutQuick={(action) => setQuickShortcutAction(action)}
          quickShortcutAction={quickShortcutAction}
          onCloseShortcutQuick={() => setQuickShortcutAction(null)}
          onRequestAccount={() => setAccountModal("create")}
          onOpenAllShortcuts={() => setShortcutsModalOpen(true)}
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
      data: {
        onSubmit: handleAddVideoSource,
        onLocalFiles: startLocalMediaShare,
        localFilesSlot: freeLocalMediaSlot,
        // The account this *socket* is registered as, which is exactly what
        // the server checks — see the note on canManageMusic.
        hasAccount: Boolean(state.account),
        localFilesBlockedReason: videoSourceBlockedReason,
      },
    });
  }

  // What both add-source popups call once their local-file picker has a queue
  // (see LocalMediaPicker). Local files are only ever offered *inside* those
  // two pickers — one more option next to YouTube/Twitch/Kick and next to a
  // YouTube link — but what happens behind the option is neither: nobody else
  // has the file, so there is no link to share and it is played here and
  // broadcast on a channel of its own (see useRoomMedia's `file` channel).
  //
  // A channel of its own is what lets this run *alongside* a screen share
  // rather than replacing it. Restarting it is a stop-then-start, because a
  // running channel is already bound to the previous queue's stream.
  //
  // Called from inside the picker's own click, so the capture still has the
  // user gesture a browser wants to see behind it.
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

  // Split from the list below so the desktop column can pin this as a card
  // header with the list scrolling under it — a list of twenty people used
  // to scroll its own heading away, leaving a column of names with nothing
  // saying what they were. The phone sheet keeps both in the same scrolling
  // box: there is no height up there to spend on a second fixed bar.
  //
  // "Conectando..." rides in here as a chip rather than a line of its own,
  // for the same reason: it is a note about this list, and a line above the
  // heading pushed everything down every time somebody's audio came up.
  const participantsHeader = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Participantes
        </h2>
        {connectingAudioPeers && (
          <Tooltip content="Conectando o áudio de quem está com o microfone ligado">
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Conectando
            </span>
          </Tooltip>
        )}
      </div>
      {/* The count alone until the room has a limit, and "8/12" once it does —
          a number with nothing to compare it to is just a number, and knowing
          how much room is left is the whole reason a limit is visible at all.
          Turns amber on the last slot and red when full, so "quase cheia" is
          something you notice rather than something you work out. */}
      <div className="flex items-center gap-1.5">
        <Tooltip
          content={
            state.roomMemberLimit
              ? `${peerCount} de ${state.roomMemberLimit} pessoas — o limite da sala`
              : undefined
          }
        >
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
              state.roomMemberLimit && peerCount >= state.roomMemberLimit
                ? "bg-red-200 text-red-800 dark:bg-red-950 dark:text-red-300"
                : state.roomMemberLimit && peerCount >= state.roomMemberLimit - 1
                  ? "bg-amber-200 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                  : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {state.roomMemberLimit ? `${peerCount}/${state.roomMemberLimit}` : peerCount}
          </span>
        </Tooltip>

        {isWideLayout && hasAnyMedia && (
          <Tooltip content="Ocultar participantes">
            <button
              type="button"
              onClick={toggleLeftSidebar}
              aria-label="Ocultar participantes"
              className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <LuPanelLeftClose className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );

  const participantsList = (
    <ul className="flex flex-col gap-1.5">
      <ParticipantRow
        name={withDeviceSuffix(state.name, state.selfUserId ?? undefined, state.selfDevice ?? undefined, deviceCounts)}
        isSelf
        isGuest={!state.account}
        userId={account?.id}
        // Your own row too. It was left out on the reasoning that this row has
        // "nobody else's profile to open", which missed that it opens *yours*
        // — and it was the one name in the list still leaving the room for a
        // new tab.
        onOpenProfile={setProfileUserId}
        micsMuted={micsMuted}
        isOwner={isRoomOwner}
        isAdmin={isRoomAdmin}
        isApp={mounted && isDesktopApp() && !isMobileApp()}
        isMobileApp={mounted && isMobileApp()}
        verified={hasVerifiedBadge(state.account?.flags)}
        nameColor={account?.equippedNameColor}
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
            name={withDeviceSuffix(p.name, p.userId, p.device, deviceCounts)}
            onOpenProfile={setProfileUserId}
            isGuest={p.isGuest}
            userId={p.userId}
            micsMuted={p.micsMuted}
            // Only where there is something to offer: for anyone else the
            // browser's own context menu is more use than an empty one. Which
            // of the two shells it gets is the screen's call — see
            // openMemberActions.
            renderMenu={
              isRoomManager && p.userId && isDesktopLayout
                ? (close) => renderMemberMenu(p, close)
                : undefined
            }
            onContextMenu={
              isRoomManager && p.userId && !isDesktopLayout
                ? () => openMemberActions(p)
                : undefined
            }
            isOwner={Boolean(p.userId) && p.userId === state.roomOwnerId}
            isAdmin={state.roomAdmins.some((a) => a.id === p.userId)}
            isApp={p.app}
            isMobileApp={p.mobileApp}
            verified={hasVerifiedBadge(p?.flags)}
            nameColor={p.nameColor}
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
  );

  // Heading and list together, for the phone sheet — the desktop column
  // splits them across a fixed header and a scrolling body instead (see the
  // participants aside below).
  const participantsSection = (
    <>
      <div className="mb-2">{participantsHeader}</div>
      {participantsList}
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

  // The client half of sending a message with pictures in it. ChatPanel has
  // already shrunk them (see lib/chatImage.ts); this hands the whole message
  // — caption included — to the API in one request, and the API is what puts
  // the files on the CDN and broadcasts the result. Nothing about the CDN,
  // not its address and not its token, exists on this side.
  //
  // The message arrives back through the socket like any other, so there is
  // nothing to append locally; only a failure has anything to report, which
  // is why this answers instead of throwing.
  async function handleSendChatImages(
    text: string,
    images: string[],
    replyTo?: ChatReplyTo | null
  ): Promise<{ ok: boolean; error?: string }> {
    const token = getAccountToken();
    if (!token) return { ok: false, error: "Entre com uma conta para enviar imagens." };
    if (!state.selfId) return { ok: false, error: "Reconectando... tente de novo em instantes." };

    const result = await sendChatImages({
      handle,
      clientId: state.selfId,
      token,
      text,
      images,
      replyTo,
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  const chatPanel = (
    <ChatPanel
        messages={state.chatMessages}
        selfId={state.selfId}
        selfName={state.name}
        renderAuthorMenu={
          isRoomManager && isDesktopLayout
            ? (from, name, close) => renderMemberMenu(chatAuthorPeer(from, name), close)
            : undefined
        }
        onAuthorContextMenu={
          isRoomManager && !isDesktopLayout ? openMemberActionsFromChat : undefined
        }
        peers={visiblePeers}
        deviceCounts={deviceCounts}
        onOpenProfile={setProfileUserId}
        onSend={(text, replyTo) => signalingClient.sendChatMessage(text, replyTo)}
        onSendGif={
          state.account && !gifBlockedReason ? (url, replyTo) => signalingClient.sendGif(url, replyTo) : undefined
        }
        onSendImages={
          state.account && !imageBlockedReason ? handleSendChatImages : undefined
        }
        onTypingChange={(typing) => signalingClient.setTyping(typing)}
        typingNames={visiblePeers
          .filter((p) => state.typingPeerIds.includes(p.id))
          .map((p) => p.name)}
        blockedMessage={state.chatBlockedMessage}
        sendDisabledReason={chatBlockedReason}
        gifDisabledReason={gifBlockedReason}
        imageDisabledReason={imageBlockedReason}
        onCollapse={isWideLayout && hasAnyMedia ? toggleRightSidebar : undefined}
        onRequestAccount={() => setAccountModal("create")}
        // Fills whatever box it is given, in both layouts: its own column
        // from lg up, the sheet the bottom bar raises below that. No margins
        // of its own in either: on desktop it now starts flush with the top
        // of the participants card beside it (the manage-room row above
        // carries the only gap there is), and inside a sheet that is already
        // only chat there is nothing to separate it from.
        heightClassName="flex-1 min-h-0"
        marginClassName=""
      />
  );

  // Only ever rendered in the chat column, which only exists from lg up — so
  // the header's own identity chip is kept for narrower screens and the two
  // never both appear. See RoomAccountCard, and the chip in the header below.
  const chatSection = (
    <>
      {roomManageRow}
      {chatPanel}
      <RoomAccountCard
        onCreateAccount={() => setAccountModal("create")}
        onOpenProfile={setProfileUserId}
      />
    </>
  );

  return (
    <div
      // Marks this page as an app shell for globals.css, which is what pins
      // it to the viewport actually on screen below lg — see the
      // `[data-room-shell]` rule there.
      data-room-shell
      // Read by app/globals.css, which hides the header, both side columns
      // and the bottom bar while Android is floating the window. A React
      // branch would mean unmounting the video element the floating window is
      // showing, which is exactly the thing that must survive.
      data-pip={pipActive ? "true" : undefined}
      className="flex min-h-0 flex-1 flex-col bg-zinc-50 dark:bg-black"
    >
      {/* Above the header so it reads as a property of the page rather than
          of the room's controls. Renders nothing inside the app itself, and
          nothing for anyone who has already answered. */}
      <OpenInAppBanner handle={handle} />
      {/* One bar, three zones from lg up: where you are on the left, what
          you do in the call in the middle, who you are (and everything about
          the page) on the right.

          A grid, rather than the wrapping flex row this used to be. That row
          laid every control out from the right edge inwards, so the mid-call
          buttons — the ones actually used while talking — ended up wherever
          the room's name and description happened to leave them, and moved
          again every time either changed. Three zones put them in the middle
          of the screen and keep them there whatever the room is called; the
          side zones truncate instead of pushing anything onto a second line,
          so the header stays exactly one row tall at every width.

          Below lg the same children stay the wrapping flex row they were:
          the mid-call controls are the bottom bar down there, not in here,
          so there is no middle zone to centre anything around. */}
      <header className="shrink-0 border-b border-black/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-zinc-950 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:flex-nowrap lg:gap-3">
          {/* Where you are. min-w-0 the whole way down, so a long room name
              truncates instead of shoving the middle zone off-centre — and
              the description input inside RoomInfoControls grows into
              whatever this zone has spare (it caps itself), which it can only
              do if the zone claims that room in the first place. */}
          <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
            <Tooltip content="Voltar ao início" placement="bottom">
              <Link
                href="/"
                aria-label="Início"
                className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-lg text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              >
                <MdHome />
              </Link>
            </Tooltip>

            <span className="hidden h-6 w-px shrink-0 bg-zinc-200 lg:block dark:bg-zinc-800" />

            {/* The room's own identity — name, access code, public/private —
                held together in one group, so the description beside it is
                the only thing that gives space up as the window narrows. */}
            <div className="flex min-w-0 items-center gap-2">
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
              {/* A dot at every width, the word only where there's room for
                  it. Public-or-private is the single most load-bearing fact
                  about a room, so the badge shrinks rather than disappearing
                  — the tooltip carries the word at the widths that can't. */}
              <Tooltip
                content={isPrivateRoomHandle(handle) ? "Sala privada" : "Sala pública"}
                placement="bottom"
              >
                <span
                  className={`flex shrink-0 items-center gap-1.5 rounded-full text-xs font-medium text-white xl:px-2.5 xl:py-1 ${isPrivateRoomHandle(handle) ? "xl:bg-red-600" : "xl:bg-emerald-600"
                    }`}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full xl:hidden ${isPrivateRoomHandle(handle) ? "bg-red-600" : "bg-emerald-600"
                      }`}
                  />
                  <span className="hidden xl:inline">
                    {isPrivateRoomHandle(handle) ? "Sala privada" : "Sala pública"}
                  </span>
                </span>
              </Tooltip>
            </div>

            {/* The room's category and blurb. Editable for the owner and
                admins, read-only text for everyone else.

                From lg up only: below that, an editable text field in the
                header was the single widest thing competing for a phone's
                one row, and it is room *metadata* — worth reading once,
                changed about as often. It moves into "Mais opções" (see
                menuItems), which is where the rest of the once-per-visit
                controls already are. */}
            {isWideLayout && (
              <RoomInfoControls
                description={state.roomDescription}
                category={state.roomCategory}
                canEdit={isRoomManager}
              />
            )}
          </div>

          {/* What you do in the call: mic, what you hear, screen, camera and
              the room's video sources — the controls used *while* talking,
              which is why they are the one group given the middle of the
              screen and a surface of their own, instead of being the tail end
              of a row of page-level buttons.

              From lg up only. Below that they are the bottom bar (see
              mobileDock): a phone's header is the furthest point from the
              thumb holding it, and these were also what turned that header
              into three wrapped rows of buttons on a 360px screen. Rendered
              in one place at a time rather than hidden with a `lg:` class, so
              there is only ever one mic button, one device popover and one
              open/closed state for them. */}
          {isWideLayout && (
            <div className="flex items-center justify-center gap-1.5 justify-self-center rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900">
              {mainControls}

              <span className="mx-0.5 h-6 w-px shrink-0 bg-zinc-300 dark:bg-zinc-700" />

              {/* Adding a YouTube/Twitch video/live to the room. Sits with
                  the transmission controls because that's what it produces:
                  one more tile everyone in the room sees, with the same focus
                  and hyperfocus buttons — the difference is that nobody is
                  uploading it. Opens components/AddVideoSourceModal as an
                  ntpopups popup rather than the little inline box this used
                  to be — picking a platform and who gets to control it needs
                  more room than a popover corner has. */}
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
                  <span className="hidden 2xl:inline"><BetaMark /></span>
                </button>
              </Tooltip>

              {/* The room's soundtrack. Next to the video button because it
                  is the same kind of act — bringing something in for the
                  whole room to hear — but a different thing entirely once
                  it's here: one per room, managers only, and a bar under the
                  header rather than a tile (see components/MusicBar). Shown
                  to everyone, disabled with the reason in its tooltip for
                  whoever may not use it, rather than hidden: "why can't I put
                  music on" is a question the UI should answer by itself. */}
              <Tooltip
                content={
                  musicBlockedReason ??
                  (state.music || myMusicSlot
                    ? "Trocar a música da sala"
                    : "Colocar música na sala")
                }
                wrapperClassName="flex"
              >
                <button
                  type="button"
                  onClick={openAddMusicPopup}
                  disabled={!canManageMusic}
                  aria-label="Colocar música na sala"
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <MdMusicNote className="h-5 w-5 shrink-0" />
                  <span className="hidden 2xl:inline"><BetaMark /></span>
                </button>
              </Tooltip>
            </div>
          )}

          {/* Who you are, and everything that is about the page rather than
              about the call. Labels drop out before anything else does, so a
              narrow desktop loses words and never buttons. */}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 lg:ml-0 lg:flex-nowrap">
            {/* Still desktop-only: on a phone this lives inside "Mais opções"
                (see menuItems), the only place with room for it. "Trocar de
                sala" moved in there at every width — it is a once-a-session
                action, and next to the mid-call controls it was a wide button
                spending header space on something nobody clicks twice. */}
            <Tooltip content={linkCopied ? "Link copiado!" : "Copiar o link desta sala"}>
              <button
                type="button"
                onClick={handleCopyLink}
                aria-label="Compartilhar sala"
                className={`hidden shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium transition sm:flex ${linkCopied
                  ? "border-emerald-600 text-emerald-600 dark:border-emerald-500 dark:text-emerald-500"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
              >
                {linkCopied ? <CheckIcon className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" />}
                <span className="hidden 2xl:inline">
                  {linkCopied ? "Copiado!" : "Compartilhar sala"}
                </span>
              </button>
            </Tooltip>

            {/* Name + points, below lg only — from there up this is the card
                at the foot of the chat column instead (see RoomAccountCard),
                which has a whole column's width for it rather than the
                sliver left over between the mid-call controls and "Apoiar
                projeto". Rendered in one place at a time, never both.

                Both kinds of identity have a total worth showing now that
                guests earn them too (see AuthContext's `points`); the only
                real difference is that an account has a public profile to
                link to and a guest has nowhere to go, so the guest version is
                the same chip minus the link. Kept deliberately muted (no fill
                color) either way so it reads as a status readout, not another
                button. Shown only once there *is* an identity — a name is
                what mints the guest one. */}
            {isWideLayout ? null : account ? (
              <Tooltip content="Ver seu perfil" placement="bottom">
                {/* Your own profile opens in the room's dialog like everybody
                    else's — it was the last name here that still took you out
                    to a second tab. */}
                <button
                  type="button"
                  onClick={() => setProfileUserId(account.id)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  <span className="hidden max-w-[8rem] truncate text-zinc-700 sm:inline dark:text-zinc-300">
                    {state.name}
                  </span>
                  <span className="hidden h-3 w-px bg-zinc-300 sm:inline-block dark:bg-zinc-700" />
                  <span className="flex items-center gap-1 tabular-nums">
                    <BsCoin className="h-3.5 w-3.5 shrink-0" />
                    {points}
                  </span>
                </button>
              </Tooltip>
            ) : (
              state.name && (
                <Tooltip
                  content="Seus pontos de convidado ficam salvos só neste navegador. Limpar os dados do site, ou entrar de outro navegador, começa do zero — crie uma conta para não perdê-los."
                  placement="bottom"
                >
                  <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <span className="hidden max-w-[8rem] truncate text-zinc-700 sm:inline dark:text-zinc-300">
                      {state.name}
                    </span>
                    <span className="hidden h-3 w-px bg-zinc-300 sm:inline-block dark:bg-zinc-700" />
                    <span className="flex items-center gap-1 tabular-nums">
                      <BsCoin className="h-3.5 w-3.5 shrink-0" />
                      {points}
                    </span>
                  </div>
                </Tooltip>
              )
            )}
            {/* Was "Apoiar projeto", a link to LivePix. The badge it already
                carried is now what the subscription grants, so the button
                points at the thing that sells it instead of at a donation
                page — see app/pro. */}
            <Tooltip content="GoLive Pro — Seja Verificado, transmita em 4K e 120fps" placement="bottom">
              <Link
                href="/pro"
                target="_blank"
                onClick={() => trackEvent("pro_button_clicked")}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-300 px-2 py-2 text-sm font-medium text-blue-600 transition hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/40 2xl:px-3"
              >
                {/* Blue rather than inheriting the label's colour: this is the
                    same badge that appears next to a verified name (see
                    DisplayUserName), and it only reads as that badge if it
                    keeps its own. */}
                <VerifiedBadgeIcon className="h-5 w-5 shrink-0 text-blue-500" />
                <span className="hidden sm:inline lg:hidden 2xl:inline">Pro</span>
              </Link>
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
                className={`shrink-0 rounded-lg border p-2 transition ${menuOpen
                  ? "border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
              >
                <MoreIcon className="h-5 w-5" />
              </button>
            </Popover>

            {/* Guests only, and below lg only — the same rule as the chip
                above, and for the same reason: from lg up the account card at
                the foot of the chat column carries this, as a full-width
                "Criar conta ou entrar" sitting directly under the guest
                points it exists to protect. Two ways in, 400px apart, is
                exactly the clutter the header was being cleared of.

                Down here it is the one control that isn't buried in the menu:
                the menu is where you go to change something about the room,
                while this is about who you are. Sits after the menu so it's
                the last thing in the row (and the closest to the thumb on a
                phone). Keyed off the same `account` as the chip above, not
                `state.account`, so logging in swaps one for the other in the
                same render instead of showing both while the signaling
                re-registration lands. */}
            {!isWideLayout && !account && (
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
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-950 bg-zinc-950 px-2 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 sm:px-3 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
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

      {/* Directly under the header, above everything the room is actually
          looking at: it is a strip rather than a tile because music is not
          something you watch, and it must not take a slot away from the
          people and screens that are. */}
      {/* Local files somebody put on as music — the same strip, the same
          place, as a YouTube soundtrack. Several can be up at once, the same
          way several people can be sharing a screen. */}
      {localMusicSlots.map((slot) => (
        <LocalMusicBar
          key={slot}
          slot={slot}
          canRestrictControl={Boolean(state.account)}
          onRequestAccount={() => setAccountModal("create")}
          onStop={() => fileChannels[slot].stop()}
        />
      ))}
      {remoteMusicEntries.map(({ slot, peerId, stream, peer, shared }) =>
        shared ? (
          <RemoteMusicBar
            key={`${slot}:${peerId}`}
            peerId={peerId}
            peerName={peer?.name ?? "alguém"}
            file={shared}
            stream={stream}
            isRoomManager={isRoomManager}
          />
        ) : null
      )}

      {state.music && (
        <MusicBar
          music={state.music}
          // Transport follows the music's own control mode, and never the
          // account check that gates *setting* it — this is playback, and a
          // room's owner may well be a guest. Mirrors the server's rule in
          // "music-state" exactly.
          canControl={isRoomManager || state.music.controlMode === "anyone"}
          isRoomManager={isRoomManager}
          isMusicOwner={state.selfUserId !== null && state.music.addedById === state.selfUserId}
          onReplace={openAddMusicPopup}
        />
      )}

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
      {visibleCameraError && (
        <div className="flex items-center justify-between gap-3 bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          <p>{visibleCameraError}</p>
          <button
            type="button"
            onClick={() => setVisibleCameraError(null)}
            aria-label="Fechar aviso"
            className="shrink-0 text-lg leading-none opacity-70 transition hover:opacity-100"
          >
            ×
          </button>
        </div>
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

      {/* Asked at the moment a phone starts transmitting, and nowhere else —
          see MobileQualitySheet for why this is a question rather than a
          setting on this one platform. */}
      {profileUserId && (
        <UserProfileDialog userId={profileUserId} onClose={() => setProfileUserId(null)} />
      )}

      {qualityPrompt === "screen" && (
        <MobileQualitySheet
          currentResolution={shareResolution}
          onChoose={(choice: MobileQualityChoice) => {
            // Applied before starting, not after: the capture reads these
            // through refs when it opens (see useRoomMedia's capture
            // closures), so setting them afterwards would leave this
            // transmission on the previous quality and only move the next one.
            setShareResolution(choice.resolution);
            setShareFps(choice.fps);
            setQualityPrompt(null);
            void startShare("display");
          }}
          onCancel={() => setQualityPrompt(null)}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-3 lg:p-3">
        {/* From lg up, participants get this dedicated full-height column
            instead of sharing a pane with chat — see isWideLayout. A card of
            its own rather than loose text on the page background: the room is
            three panes side by side up here, and each needs an edge for the
            video in the middle to read as the thing you came for. Narrower
            than it was, too, and growing again only where there is width to
            spare — the names in it are one line each.

            The ad card lives here (below the list) rather than in the chat
            column, so chat gets the full column to itself. */}
        {isWideLayout && !leftSidebarCollapsed && (
          <aside className="flex h-full w-64 shrink-0 flex-col gap-3 2xl:w-72">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <div className="shrink-0 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
                {participantsHeader}
              </div>
              {/* Barely any padding of its own: the rows carry theirs, and
                  every pixel spent here comes off a name that has to fit
                  beside up to five status icons. */}
              <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">{participantsList}</div>
            </div>
            {/* One at a time, not both: two ads stacked in a 256px column
                read as a page made of advertising. The partner holds the
                first minute because it is the ad this room sold itself.
                Swapped rather than hidden, so each turn is a fresh Adsterra
                creative — the partner's own state survives regardless, since
                it lives in usePartnerAd above and not in this card. */}
            {showAdsterra ? (
              <AdsterraNative className="shrink-0" label={false} />
            ) : (
              <PartnerCard partner={rawActivePartner} loaded={partnerLoaded} />
            )}
          </aside>
        )}

        <main className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2 lg:p-0">
          {/* Floating expand buttons when sidebars are collapsed on wide screens */}
          {isWideLayout && leftSidebarCollapsed && (
            <div className="absolute left-2 top-2 z-20">
              <Tooltip content="Mostrar participantes" placement="right">
                <button
                  type="button"
                  onClick={toggleLeftSidebar}
                  aria-label="Mostrar participantes"
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-zinc-700 shadow-md backdrop-blur-xs transition hover:bg-white hover:text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white"
                >
                  <LuPanelLeftOpen className="h-4 w-4" />
                  {/* <span className="hidden sm:inline">Participantes</span> */}
                </button>
              </Tooltip>
            </div>
          )}

          {isWideLayout && rightSidebarCollapsed && (
            <div className="absolute right-2 top-2 z-20">
              <Tooltip content="Mostrar chat e perfil" placement="left">
                <button
                  type="button"
                  onClick={toggleRightSidebar}
                  aria-label="Mostrar chat e perfil"
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-zinc-700 shadow-md backdrop-blur-xs transition hover:bg-white hover:text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white"
                >
                  <LuPanelRightOpen className="h-4 w-4" />
                  {/* <span className="hidden sm:inline">Chat</span> */}
                </button>
              </Tooltip>
            </div>
          )}

          {nothingToShow ? (
            // Wrapped the same way the tile grid is: `main` doesn't scroll,
            // so the one thing in it that has a minimum height of its own
            // needs a box that can.
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex h-full min-h-75 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white/50 px-4 text-center dark:border-zinc-800 dark:bg-zinc-950/40">
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
            </div>
          ) : (
            <>
              {/* Centred and slim rather than a full-size button in the top
                  left: it is a way *out* of a state you can see you're in,
                  not one of the pane's own controls, and at its old size it
                  took a strip of the video's height to say so.

                  Keyed on the resolved focus rather than the raw state, so it
                  is never a button offering to leave a state the layout is
                  not actually in (see stageTile). */}
              {stageTile && (
                <div className="flex shrink-0 justify-center">
                  <button
                    type="button"
                    onClick={() => setSpotlightId(null)}
                    className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Remover destaque
                  </button>
                </div>
              )}
              {/* Nothing scrolls the page: from lg up `main` is a
                  fixed-height pane, so whichever layout is on below scrolls
                  inside this box or not at all. */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {stageTile ? (
                  /* "Focar": a stage with the rest of the room as a strip of
                     thumbnails under it.

                     This used to be a 2x2 span inside the ordinary grid, which
                     bought the focused tile four cells out of nine — barely
                     twice the size of the others, and less than that once
                     auto-placement started leaving holes around it, since the
                     spanning tile stayed wherever its turn in the DOM put it.
                     Below `sm` the span classes didn't apply at all, so on a
                     phone "Focar" did nothing whatsoever. A stage takes the
                     whole pane minus one short row, at every width.

                     It also makes the room cheaper to watch: every thumbnail
                     reports its real drawn size like any other tile (see
                     onRenderedSizeChange), so the people in the strip are
                     asked for thumbnail-sized streams instead of full ones. */
                  <div className="flex h-full min-h-0 flex-col gap-2 sm:gap-3">
                    {/* `min-h-0 flex-1` is what gives the tile inside a real
                        height to fill: `h-full` against a box sized by its own
                        content is circular, and the tile is the side that
                        gives up and collapses. */}
                    <div className="min-h-0 flex-1">
                      {stageTile.render(true, false, isWideLayout && rightSidebarCollapsed)}
                    </div>
                    {stripTiles.length > 0 && (
                      /* Scrolls sideways rather than wrapping onto a second
                         row: the whole point of the strip is to cost the stage
                         a small, fixed amount of height however many people
                         are in the room. */
                      <div className="shrink-0 overflow-x-auto overflow-y-hidden">
                        <div className="flex h-20 gap-2 sm:h-24 sm:gap-3 lg:h-28">
                          {stripTiles.map((tile) => (
                            <div
                              key={tile.id}
                              className="relative aspect-video h-full shrink-0"
                            >
                              {tile.render(true, true)}
                              {/* One transparent target over the whole
                                  thumbnail to focus it — except for the sponsored
                                  ad, where clicking the compact tile acts directly
                                  as an action click to open the sponsor link. */}
                              {tile.id !== "sponsored-partner-tile" && (
                                <button
                                  type="button"
                                  onClick={() => setSpotlightId(tile.id)}
                                  aria-label="Destacar esta transmissão"
                                  className="absolute inset-0 z-10 cursor-pointer rounded-xl ring-emerald-500 transition hover:ring-2 focus-visible:ring-2 focus-visible:outline-none"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className={
                      isSingleTile
                        ? "h-full"
                        : `grid ${mobileGridCols} auto-rows-fr gap-2 sm:grid-cols-2 sm:gap-3 lg:min-h-full 2xl:grid-cols-3`
                    }
                    style={tileGridStyle}
                  >
                    {/* Fragments rather than wrapper divs: the tile itself has
                        to be the grid item, or its `aspect-video` would size a
                        box inside a stretched cell instead of the cell. */}
                    {tiles.map((tile, index) => {
                      const shouldOffsetRight =
                        isWideLayout &&
                        rightSidebarCollapsed &&
                        (isSingleTile ||
                          (tileCount === 2 && index === 1) ||
                          (tileCount > 2 &&
                            (index + 1) % tileGridCols === 0 &&
                            index < tileGridCols));
                      return (
                        <Fragment key={tile.id}>
                          {isSingleTile && tile.id === "sponsored-partner-tile" ? (
                            <div className="flex h-full w-full items-center justify-center p-4">
                              {tile.render(true, false, shouldOffsetRight)}
                            </div>
                          ) : (
                            tile.render(isSingleTile, false, shouldOffsetRight)
                          )}
                        </Fragment>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </main>

        {/* From lg up, chat gets this dedicated full-height column instead
            of sharing a pane with participants — see isWideLayout. Nothing
            else in here but the owner/admin "Gerenciar sala" button, so
            chatSection's flex-1 (see its heightClassName) still has
            practically the whole column to fill. */}
        {isWideLayout && !rightSidebarCollapsed && (
          <aside
            ref={chatAsideRef}
            className="relative flex h-full shrink-0 flex-col"
            style={{ width: `${chatWidth}px` }}
          >
            {/* The grab handle sits in the gap *between* the video and the
                chat rather than on the chat's own edge, so reaching for it is
                never a click that lands on a message — and it shows a grip
                on hover instead of a bare hairline, which was easy to miss
                entirely. Double-click restores the default width. */}
            <div
              onMouseDown={startChatResize}
              onDoubleClick={() => setChatWidth(DEFAULT_CHAT_WIDTH)}
              role="separator"
              aria-orientation="vertical"
              className="group absolute inset-y-0 -left-3 z-30 flex w-3 cursor-ew-resize items-center justify-center"
              title="Arraste para redimensionar o chat (clique duas vezes para restaurar)"
            >
              <div className="h-12 w-1 rounded-full bg-zinc-300 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-zinc-600" />
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
            {/* Out here rather than inside a sheet: this is the ad that pays
                for the room, and below lg the partner card collapses itself
                to a single slim line (see PartnerCard) — small enough to
                leave on screen, one tap from the whole card. Above the sheet
                rather than below it, so the sheet always comes up off the bar
                that opened it.

                Below lg the room is a fixed-height shell, which makes this
                band the one slot on the site that costs somebody video area
                rather than page — and that is exactly why the two advertisers
                take turns here instead of stacking. A 320x50 is what the
                budget affords on the Adsterra minute; see
                NEXT_PUBLIC_ADSTERRA_BANNER_MOBILE_KEY. */}
            {showAdsterra ? (
              <AdsterraBanner className="shrink-0" />
            ) : (
              <PartnerCard partner={rawActivePartner} loaded={partnerLoaded} />
            )}

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
                <ShortcutQuickPopover
                  action="toggleMute"
                  open={quickShortcutAction === "toggleMute"}
                  onClose={() => setQuickShortcutAction(null)}
                  hasAccount={Boolean(state.account)}
                  onRequestAccount={() => setAccountModal("create")}
                  onOpenAllShortcuts={() => setShortcutsModalOpen(true)}
                >
                  <MicUsageHint
                    open={micHintOpen}
                    onDismiss={closeMicHint}
                    onEnableMic={enableMicFromHint}
                    tooltip={isMicOn ? "Desativar microfone" : (micBlockedReason ?? "Ativar microfone")}
                    wrapperClassName={DOCK_SLOT}
                  >
                    <button
                      type="button"
                      onClick={handleToggleMic}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setQuickShortcutAction("toggleMute");
                      }}
                      // Only turning it *on* is blocked — same rule as the
                      // desktop control, see ShareControls.
                      disabled={!isMicOn && Boolean(micBlockedReason)}
                      aria-pressed={isMicOn}
                      aria-label={isMicOn ? "Desativar microfone" : "Ativar microfone"}
                      className={`${DOCK_BUTTON} ${isMicOn ? DOCK_ON : DOCK_OFF}`}
                    >
                      {isMicOn ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5" />}
                    </button>
                  </MicUsageHint>
                </ShortcutQuickPopover>

                <ShortcutQuickPopover
                  action="toggleDeafen"
                  open={quickShortcutAction === "toggleDeafen"}
                  onClose={() => setQuickShortcutAction(null)}
                  hasAccount={Boolean(state.account)}
                  onRequestAccount={() => setAccountModal("create")}
                  onOpenAllShortcuts={() => setShortcutsModalOpen(true)}
                >
                  <Tooltip
                    content={micsMuted ? "Reativar microfones" : "Silenciar microfones"}
                    wrapperClassName={DOCK_SLOT}
                  >
                    <button
                      type="button"
                      onClick={toggleMicsMuted}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setQuickShortcutAction("toggleDeafen");
                      }}
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
                </ShortcutQuickPopover>

                {/* Screen capture doesn't exist in a phone browser at all
                    (see useScreenShareMode), and a bar this narrow has no
                    room for a button whose only job is to explain why it
                    can't work. The desktop header keeps its disabled copy,
                    where there is space for the tooltip. */}
                {screenShareMode === "display" && (
                  <ShortcutQuickPopover
                    action="toggleScreenShare"
                    open={quickShortcutAction === "toggleScreenShare"}
                    onClose={() => setQuickShortcutAction(null)}
                    hasAccount={Boolean(state.account)}
                    onRequestAccount={() => setAccountModal("create")}
                    onOpenAllShortcuts={() => setShortcutsModalOpen(true)}
                  >
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
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setQuickShortcutAction("toggleScreenShare");
                        }}
                        disabled={!localStream && Boolean(screenBlockedReason)}
                        aria-pressed={Boolean(localStream)}
                        aria-label={localStream ? "Parar de compartilhar a tela" : "Compartilhar tela"}
                        className={`${DOCK_BUTTON} ${localStream ? DOCK_LIVE : DOCK_ON}`}
                      >
                        <ScreenIcon className="h-5 w-5" />
                      </button>
                    </Tooltip>
                  </ShortcutQuickPopover>
                )}

                {screenShareMode !== "unsupported" && (
                  // Two segments in one slot when there is more than one
                  // camera, the same shape the desktop's mic and camera
                  // controls have: the button does the thing, and the strip
                  // welded to its side changes which thing it does. A separate
                  // entry buried in a menu is where "frontal ou traseira" —
                  // the one camera setting anyone on a phone actually reaches
                  // for — goes to be never found.
                  //
                  // It cycles rather than opening a list: with two cameras a
                  // list is a menu with one useful row, and setCameraDevice
                  // already restarts a live camera onto the new one, so this
                  // works mid-call and before starting alike.
                  // Wider than a plain slot when it holds two controls, so
                  // the camera button keeps a usable share of it rather than
                  // being reduced to whatever the switch leaves over.
                  <div
                    className={`flex min-w-0 items-stretch gap-px ${
                      canSwitchCamera ? "flex-[1.8]" : "flex-1"
                    }`}
                  >
                    <Tooltip
                      content={
                        localCameraStream
                          ? "Parar câmera"
                          : (cameraBlockedReason ?? "Compartilhar câmera")
                      }
                      wrapperClassName="flex min-w-0 flex-1"
                    >
                      <button
                        type="button"
                        onClick={() => (localCameraStream ? stopCameraShare() : startCameraShare())}
                        disabled={!localCameraStream && Boolean(cameraBlockedReason)}
                        aria-pressed={Boolean(localCameraStream)}
                        aria-label={localCameraStream ? "Parar câmera" : "Compartilhar câmera"}
                        // DOCK_BUTTON_BASE, not DOCK_BUTTON: the latter's
                        // `min-w-10` floor plus the switch's fixed 28px add up
                        // to more than a slot has on a narrow phone, so the
                        // pair overflowed instead of shrinking and the switch
                        // landed on top of this button. The floor is still
                        // right when this button is alone in its slot.
                        className={`${DOCK_BUTTON_BASE} ${
                          canSwitchCamera ? "rounded-r-none" : "min-w-10"
                        } ${localCameraStream ? DOCK_LIVE : DOCK_ON}`}
                      >
                        <CameraIcon className="h-5 w-5" />
                      </button>
                    </Tooltip>
                    {canSwitchCamera && (
                      <Tooltip content={switchCameraLabel} wrapperClassName="flex">
                        <button
                          type="button"
                          onClick={switchCamera}
                          aria-label={switchCameraLabel}
                          className={`flex h-11 w-7 shrink-0 items-center justify-center rounded-r-xl text-white transition ${
                            localCameraStream ? DOCK_LIVE : DOCK_ON
                          }`}
                        >
                          <MdCameraswitch className="h-4 w-4" />
                        </button>
                      </Tooltip>
                    )}
                  </div>
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
                {/* Same "x/y" as the sidebar heading — the phone has no
                    sidebar, so this tab is the only place it can say it. */}
                <span className="text-[10px] font-medium leading-none">
                  Pessoas (
                  {state.roomMemberLimit ? `${peerCount}/${state.roomMemberLimit}` : peerCount})
                </span>
              </button>
            </nav>
          </>
        )}
      </div>

      <AccountModal
        mode={accountModal}
        onModeChange={setAccountModal}
        initialDisplayName={state.name ?? ""}
      />

      <KeyboardShortcutsModal
        open={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
        hasAccount={Boolean(state.account)}
        onRequestAccount={() => setAccountModal("create")}
      />
    </div>
  );
}

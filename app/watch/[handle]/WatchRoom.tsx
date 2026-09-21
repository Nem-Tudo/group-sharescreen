"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { openContextMenu } from "@/lib/contextMenu";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  signalingClient,
  isObsPeer,
  type RoomPermissionKey,
  type PeerInfo,
  type ChatReplyTo,
  type RoomConversion,
} from "@/lib/signalingClient";
import { useHasStoredName } from "@/lib/useSignaling";
import { useSignalingSelector, shallow } from "@/lib/useSignalingSelector";
import { selectWatchRoom } from "@/lib/signalingSelectors";
import { groupPath } from "@/lib/groupLinks";
import { useGroupDetail } from "@/lib/useGroups";
import { canManage } from "@/lib/groupPermissions";
import {
  RoomToGroupButton,
  ROOM_TO_GROUP_MIN_PEOPLE,
  dismissRoomToGroup,
  isRoomToGroupDismissed,
  type RoomToGroupPerson,
} from "@/components/RoomToGroup";
import { useGroupAdHidden } from "@/components/groups/GroupPartnerSlot";
import { DockedPip, type DockedPipSource } from "@/components/DockedPip";
import {
  setGroupVoiceColumns,
  setGroupVoiceControls,
  setGroupVoiceLive,
  useGroupVoiceFocusRequest,
  type GroupVoiceLive,
  type GroupVoiceLivePerson,
} from "@/lib/groupVoiceSession";
import { peerPresence } from "@/lib/presence";
import { useAuth } from "@/lib/AuthContext";
import { usePlanOnSale } from "@/lib/usePlanOnSale";
import { sendChatImages } from "@/lib/chatImage";
import { uploadAuthToken } from "@/lib/uploadApi";
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
import { createObsSecurityToken } from "@/lib/obsToken";
import {
  toRoomHandle,
  isPrivateRoomHandle,
  toPrivateRoomHandle,
  generateRoomCode,
  splitPrivateRoomHandle,
  MAX_PRIVATE_ROOM_NAME_LENGTH,
} from "@/lib/roomsApi";
import { rememberRecentRoom } from "@/lib/recentRoomsSync";
import { openDirectMessages } from "@/lib/dmWindow";
import type { CallDockPhase } from "@/lib/callSession";
import { useRoomSoundEffects } from "@/lib/useRoomSoundEffects";
import { useBackgroundKeepAlive } from "@/lib/useBackgroundKeepAlive";
import { useAndroidCallService } from "@/lib/androidCallService";
import { recentRoomPresentation } from "@/lib/recentRooms";
import {
  getSoundEffectsEnabled,
  setSoundEffectsEnabled,
  playMicOnSound,
  playMicOffSound,
  playDeafenSound,
  playUndeafenSound,
  playShareStartSound,
  playShareStopSound,
  playHangUpSound,
} from "@/lib/soundEffects";
import { qualityNegotiator } from "@/lib/qualityNegotiation";
import { isTurnConfigured, subscribeIceServers, TURN_CONFIGURED } from "@/lib/iceConfig";
import { useMediaDevices, type MediaDeviceOption } from "@/lib/useMediaDevices";
import {
  getStoredMicsMuted,
  setStoredMicsMuted,
  getStoredPeerVolumes,
  setStoredPeerVolume,
  getStoredTransmissionVolumes,
  setStoredTransmissionVolume,
  getStoredTransmissionMuted,
  setStoredTransmissionMuted,
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
import { ViewerConnectionList } from "@/components/ViewerConnectionList";
import { RemoteAudio } from "@/components/RemoteAudio";
import { ParticipantRow } from "@/components/ParticipantRow";
import { countDevicesByOwner, withDeviceSuffix } from "@/lib/displayName";
import { isMobileDevice } from "@/lib/announcement";
import { enterAndroidPip, onAndroidPipModeChange } from "@/lib/androidPictureInPicture";
import type { CameraFacing } from "@/lib/mediaPreferences";
import { ChatPanel } from "@/components/ChatPanel";
import { RoomInfoControls } from "@/components/RoomInfoControls";
import { MusicBar } from "@/components/MusicBar";
import type { MusicControlMode } from "@/lib/musicSource";
import { LocalMediaControls, RemoteMediaControls } from "@/components/LocalMediaControls";
import { LocalMusicBar, RemoteMusicBar } from "@/components/LocalMusicBar";
import { MemberActionsMenu, type MemberActions } from "@/components/MemberActionsModal";
import { isDesktopApp, isMobileApp, armSavedShareSource } from "@/lib/desktop";
import { OpenInAppBanner } from "@/components/OpenInAppBanner";
import { CallStage, type CallStagePerson } from "@/components/CallStage";
import { NotificationInboxBell } from "@/components/NotificationInboxBell";
import { PartnerCard } from "@/components/PartnerCard";
import { QualitySelect } from "@/components/QualitySelect";
import { DisplayUserName } from "@/components/DisplayUserName";
import { CreateAccountForm } from "@/components/CreateAccountForm";
import { LoginForm } from "@/components/LoginForm";
import { RoomSkeleton } from "@/components/RoomSkeleton";
import { MobileQualitySheet, type MobileQualityChoice } from "@/components/MobileQualitySheet";
import { openAndroidAppSettings } from "@/lib/androidScreenCapture";
import { UserProfileDialog } from "@/components/UserProfileDialog";
import { InviteToRoomModal } from "@/components/InviteToRoomModal";
import { prewarmCaptcha } from "@/lib/turnstile";
import { RoomAccountCard } from "@/components/RoomAccountCard";
import { openProModal } from "@/lib/proModal";
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
import { MIN_MIC_GAIN, MAX_MIC_GAIN, DEFAULT_MIC_GAIN } from "@/lib/rnnoise";
import { planTileGrid } from "@/lib/tileGrid";
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
  ClipIcon,
  RecordIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  FocusIcon,
  OrientationIcon,
  ScreenIcon,
  CameraIcon,
  ObsSourceIcon,
} from "@/components/icons";
import { Tooltip, Popover } from "@/components/Tooltip";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { MenuToggleRow } from "@/components/MenuToggleRow";
import { NewBadge, markFeatureUsed } from "@/components/NewBadge";
import { trackFeatureEvent } from "@/lib/features";
import Tippy from "@tippyjs/react";
import { setTileExperimentMode, useTileExperiment, useTileExperimentTip } from "@/lib/clipsMode";
import {
  isDefaultOrientation,
  parseOrientation,
  type Orientation,
} from "@/lib/tileOrientation";
import {
  usePushToTalk,
  usePushToTalkGate,
  trackPushToTalkKeySet,
  PUSH_TO_TALK_BADGE,
} from "@/lib/pushToTalk";
import { ShortcutRecorder } from "@/components/ShortcutRecorder";
import {
  EXTRA_SCREEN_SLOTS,
  isExtraScreenSlot,
  MULTI_SCREEN_EVENTS,
  multiScreenLimit,
  nextScreenUpgrade,
} from "@/lib/multiScreen";
import { planIcon } from "@/components/planIcons";
import { TIER_NAMES, tierIconId } from "@/lib/entitlements";
import { useRecordingNotices } from "@/lib/recordingNotice";
import { sendTileCommand } from "@/lib/tileCommands";
import { getRoomProOffer } from "@/components/RoomProOffer";
import { isAppShell } from "@/lib/desktop";
import { getProfileSongAutoplay, setProfileSongAutoplay } from "@/lib/profileSong";
import { useMediaQuery, SM_BREAKPOINT_QUERY, LG_BREAKPOINT_QUERY } from "@/lib/useMediaQuery";
import {
  MdArrowBack,
  MdHome,
  MdShare,
  MdMenu,
  MdVolumeUp,
  MdOutlineOndemandVideo,
  MdOutlineDesktopWindows,
  MdOutlineMap,
  MdPalette,
  MdLogin,
  MdOutlineChat,
  MdOutlinePeople,
  MdCallEnd,
  MdMusicNote,
  MdCameraswitch,
  MdFlipCameraAndroid,
  MdOutlineKeyboard,
  MdKeyboardArrowUp,
  MdPersonAddAlt1,
  MdChevronRight,
  MdAdd,
  MdClose,
} from "react-icons/md";
import { BsGearFill, BsCoin } from "react-icons/bs";
import {
  LuPanelLeftClose,
  LuPanelLeftOpen,
  LuPanelRightClose,
  LuPanelRightOpen,
} from "react-icons/lu";
import { BetaMark } from "@/components/BetaMark";
import { StreamerModeModal } from "@/components/StreamerModeModal";
import { UpdateAppButton } from "@/components/UpdateAppButton";
import { AccountModal } from "@/components/AccountModal";
import { GuestBroadcastLimitModal } from "@/components/GuestBroadcastLimitModal";
import { GpuShareSurveyModal } from "@/components/GpuShareSurveyModal";
import { MobileScreenShareModal } from "@/components/MobileScreenShareModal";
import { GUEST_FEATURES, accountTierOf, hasFeature, isThemeBanned, tierAtLeast } from "@/lib/entitlements";
import { PartnerMediaTile } from "@/components/PartnerMediaTile";
import { usePartnerAd } from "@/lib/usePartnerAd";
import { usePartnerExperiment } from "@/lib/partnerExperiment";
import {
  useGlobalShortcutListener,
  setStoredShortcut,
  type ShortcutAction,
} from "@/lib/keyboardShortcuts";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { ObsBrowserSourceModal } from "@/components/ObsBrowserSourceModal";
import { ShortcutQuickPopover } from "@/components/ShortcutQuickPopover";
import { hasVerifiedBadge, verifiedBadge } from "@/lib/entitlements";
import { useRoomTheme } from "@/lib/useRoomTheme";
import {
  isRoomThemeOptedOut,
  isRoomThemeOptedOutServer,
  setRoomThemeOptedOut,
  subscribeRoomThemeOptOut,
  THEME_EDITOR_PARAM,
  wantsThemeEditor,
} from "@/lib/roomThemes";
import { useT } from "@/lib/useI18n";
import { MobileSheet } from "@/components/MobileSheet";
import { canShareNatively, haptic, shareLink } from "@/lib/nativeApp";
import { useBackHandler } from "@/lib/useBackHandler";
import { translate } from "@/lib/i18n";

// Mirrors server/signaling.ts's HANDLE_RE — must match exactly, or a name
// this lets through but the server rejects lands the user in a dead room
// (join fails server-side, but the client's already navigated to it).
const HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;

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

// A settings-panel row that names a device and opens the list of devices beside
// it on hover — the mic's panel, where the list would otherwise push volume and
// noise suppression far down. A tap toggles it too, for a screen with no hover.
// Below `sm` the list opens under the row instead: beside it would be off the
// edge of a phone. The flyout's own padding bridges the gap to it, so moving
// the pointer across does not count as leaving.
function DeviceSubmenuRow({
  label,
  current,
  children,
}: {
  label: string;
  current: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition ${open
          ? "bg-zinc-100 dark:bg-zinc-800"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
          <span className="truncate text-zinc-800 dark:text-zinc-200">{current}</span>
        </span>
        <MdChevronRight className="h-4 w-4 shrink-0 text-zinc-500 max-sm:rotate-90" />
      </button>
      {open && (
        <div className="absolute z-20 max-sm:left-0 max-sm:right-0 max-sm:top-full max-sm:pt-1 sm:left-full sm:top-0 sm:pl-2">
          <div className="max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-zinc-300 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

// The mic's input-volume dial, at the foot of the input-device picker.
// It lives there because it is a property of the microphone you just picked
// — a level that compensates for that device being quiet or hot — and
// because the picker is where someone goes after being told they can barely
// be heard.
//
// Shown as a percentage rather than in dB: what people are told is "você
// está muito baixo", not "-6 dB".
function MicGainRow({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <div className="-mx-1 mt-1 border-t border-zinc-200 px-3 pb-2 pt-2.5 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          <MicIcon className="h-3.5 w-3.5 shrink-0" />
          {t("watch.watchRoom.microphoneVolume")}
        </span>
        <span className="text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
          {Math.round(value * 100)}%
        </span>
      </div>
      {/* Double click puts it back to exactly 100%. Every slider with a
          neutral point in the middle of its range needs that: landing on
          1.00 again by dragging is luck, not aim. */}
      <input
        type="range"
        min={MIN_MIC_GAIN}
        max={MAX_MIC_GAIN}
        step="0.01"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onDoubleClick={() => onChange(DEFAULT_MIC_GAIN)}
        aria-label={t("watch.watchRoom.microphoneVolume")}
        className="mt-2 h-1.5 w-full cursor-pointer accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <p className="mt-1.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-500">
        {disabled
          ? t("watch.watchRoom.unavailableWithThisAudioSetup")
          : value > 1
            ? t("watch.watchRoom.above100TheBackgroundNoiseIncreases")
            : t("watch.watchRoom.doubleClickTheBarToGo")}
      </p>
    </div>
  );
}

// The gap between tiles in the wide-layout grid, in px. Has to be a number
// here as well as a class on the grid (`sm:gap-3`) because planTileGrid
// subtracts it from the pane before dividing up what's left — a plan made
// against the wrong gap is a grid that overflows by exactly that much.
const TILE_GRID_GAP = 12;

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
  const t = useT();
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
            {t("watch.watchRoom.talkToTheRoom")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
            {t("watch.watchRoom.turnTheMicrophoneOnHereTo")}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onEnableMic}
              className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700"
            >
              {t("common.turnOnMicrophone")}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {t("common.notNow")}
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
  nativeVideoOption,
  setNativeVideoOption,
  nativeVideoMethod,
  setNativeVideoMethod,
  screenRestartNeeded,
  restartScreenShare,
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
  | "nativeVideoOption"
  | "setNativeVideoOption"
  | "nativeVideoMethod"
  | "setNativeVideoMethod"
  | "screenRestartNeeded"
  | "restartScreenShare"
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
  const t = useT();
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-3">
        {/* Settings that only a new share applies (see useRoomMedia's
            screenRestartNeeded) were changed while this one is running. */}
        {screenRestartNeeded && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
            <span>{t("watch.watchRoom.restartToApply")}</span>
            <button
              type="button"
              onClick={() => void restartScreenShare()}
              className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white transition hover:bg-amber-700"
            >
              {t("watch.watchRoom.restartShare")}
            </button>
          </div>
        )}
        <label className="flex items-start gap-2 rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={smartQualityEnabled}
            onChange={(e) => setSmartQualityEnabled(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
          />
          <span>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {t("watch.watchRoom.turnOnSmartQualityControl")}
            </span>
            <br />
            {t("watch.watchRoom.sendsEachPersonOnlyTheQuality")}
          </span>
        </label>

        {/* The GPU capture experiment's card (see useRoomMedia's
            nativeVideoOption and nativeVideoMethod): the switch, for the two
            sides that have one, and how a whole screen is captured. */}
        {nativeVideoMethod !== null && (
          <div className="rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
            {nativeVideoOption !== null ? (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={nativeVideoOption}
                  onChange={(e) => setNativeVideoOption(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
                />
                <span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    <BetaMark /> {t("watch.watchRoom.useGpuCapture")}
                  </span>
                  <br />
                  {t("watch.watchRoom.useGpuCaptureHint")}
                </span>
              </label>
            ) : (
              <p>
                <span className="font-medium text-zinc-900 dark:text-zinc-100"><BetaMark /> {t("watch.watchRoom.gpuCapture")}</span>
                <br />
                {t("watch.watchRoom.useGpuCaptureHint")}
              </p>
            )}
            {nativeVideoOption !== false && (
              <div className="mt-2">
                <span className="mb-1 block font-medium text-zinc-600 dark:text-zinc-400">
                  {t("watch.watchRoom.gpuCaptureMethod")}
                </span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["duplication", t("watch.watchRoom.gpuCaptureDuplication")],
                      ["wgc", t("watch.watchRoom.gpuCaptureWgc")],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setNativeVideoMethod(value)}
                      aria-pressed={nativeVideoMethod === value}
                      className={`rounded-md border px-2 py-1.5 text-left transition ${nativeVideoMethod === value
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        }`}
                    >
                      <span className="block font-medium">{label}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-zinc-500">{t("watch.watchRoom.gpuCaptureMethodNote")}</p>
              </div>
            )}
          </div>
        )}

        <div>
          <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t("watch.watchRoom.whatYouAreSharing")}
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
              {t("watch.watchRoom.above30fpsChooseBalancedOrVideo")}
            </p>
          )}
        </div>

        <QualitySelect
          label={t("watch.watchRoom.resolution")}
          value={shareResolution}
          options={SHARE_RESOLUTION_OPTIONS}
          features={features}
          onChange={setShareResolution}
        />

        <QualitySelect
          label={t("watch.watchRoom.frameRate")}
          value={shareFps}
          options={SHARE_FPS_OPTIONS}
          features={features}
          onChange={setShareFps}
        />

        <QualitySelect
          label={t("watch.watchRoom.bitrate")}
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
              <span>{t("watch.watchRoom.yourUploadBandwidth")}</span>
              <span className="font-medium text-zinc-900 tabular-nums dark:text-zinc-100">
                {meshCapacity.availableOutgoingKbps > 0
                  ? t("watch.watchRoom.valueMbps", { value: (meshCapacity.availableOutgoingKbps / 1000).toFixed(1) })
                  : "medindo…"}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span>{t("watch.watchRoom.inUseNow")}</span>
              <span className="font-medium text-zinc-900 tabular-nums dark:text-zinc-100">
                {(meshCapacity.usedOutgoingKbps / 1000).toFixed(1)} {t("watch.watchRoom.mbps")}
              </span>
            </div>
            {meshCapacity.cpuPressure > 0.25 && (
              <p className="mt-1 text-amber-600 dark:text-amber-500">
                {t("watch.watchRoom.yourProcessorIsAtItsLimit")}
              </p>
            )}
            {meshTopology.reason && (
              <p className="mt-1 text-zinc-700 dark:text-zinc-300">{meshTopology.reason}</p>
            )}
            <ViewerConnectionList />
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
  open,
  setOpen,
  quality,
  onOpenShortcutQuick,
  quickShortcutAction,
  onCloseShortcutQuick,
  onRequestAccount,
  onOpenAllShortcuts,
  compact = false,
  extraMotion = "",
  addScreen = null,
}: {
  // "Várias telas" (see lib/multiScreen): the "+" beside the screen button
  // while a screen is going out. Null where the person does not have it.
  // `items` is every screen going out, each closable on its own — listed in
  // the "+"'s hover panel.
  addScreen?: {
    count: number;
    limit: number;
    onClick: () => void;
    items: { id: string; label: string; onStop: () => void }[];
    // The next plan with a higher limit, null on the top one.
    upgrade: { tier: "premium_max" | "pro_ultra"; limit: number; onClick: () => void } | null;
    // The blue "novo" tip, pinned under the "+" while it shows.
    tip: { show: boolean; dismiss: () => void; clicked: () => void };
  } | null;
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
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  quality: Pick<
    RoomMedia,
    | "smartQualityEnabled"
    | "setSmartQualityEnabled"
    | "nativeVideoOption"
    | "setNativeVideoOption"
    | "nativeVideoMethod"
    | "setNativeVideoMethod"
    | "screenRestartNeeded"
    | "restartScreenShare"
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
  // The floating call bar's compact size (see WatchRoom's dockExtra): only the
  // screen and camera buttons, without the quality gear or the camera picker.
  compact?: boolean;
  // The bar's animation class for those two while it is expanded — empty
  // anywhere but the bar.
  extraMotion?: string;
}) {
  const t = useT();
  const segment =
    "flex items-center px-3 py-2 text-white transition disabled:cursor-not-allowed disabled:opacity-50";
  const live = "bg-red-600 hover:bg-red-700";
  const idle = "bg-emerald-600 hover:bg-emerald-700";

  // A list of cameras to pick from: a computer with more than one. A phone
  // gets the flip button instead (see below), never both.
  const canPickCamera = cameraSupported && !onPhone && cameraDevices.length > 1;
  const screenBlocked = !screenSharing && Boolean(screenBlockedReason);
  const atScreenLimit = Boolean(addScreen && addScreen.count >= addScreen.limit);
  const upgradeMark = addScreen?.upgrade ? planIcon(tierIconId(addScreen.upgrade.tier)) : null;
  const cameraBlocked = !cameraSharing && Boolean(cameraBlockedReason);
  const screenLabel = screenSharing
    ? t("watch.watchRoom.stopSharingTheScreen")
    : screenBlockedReason
      ? screenBlockedReason
      : screenSupported
        ? t("watch.watchRoom.shareScreen")
        : t("watch.watchRoom.yourBrowserDoesNotAllowSharing");
  const cameraLabel = cameraSharing
    ? t("watch.watchRoom.stopCamera")
    : cameraBlockedReason
      ? cameraBlockedReason
      : cameraSupported
        ? t("watch.watchRoom.shareCamera")
        : t("watch.watchRoom.yourBrowserDoesNotAllowUsing");

  // Same job as WatchRoom's dockExtra, for the two pieces of this segment the
  // compact bar leaves out.
  const extra = (node: ReactNode): ReactNode => {
    if (compact || !node) return null;
    if (!extraMotion) return node;
    return (
      <span className={`call-dock-extra ${extraMotion}`}>
        <span className="flex items-stretch">{node}</span>
      </span>
    );
  };

  return (
    <div className="flex items-stretch overflow-hidden rounded-lg">
      {extra(
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        placement="bottom-end"
        tooltip={t("common.broadcastQuality")}
        content={
          <div className="w-80 max-w-[calc(100vw-1rem)]">
            <QualityControls {...quality} />
          </div>
        }
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={t("common.broadcastQuality")}
          className="flex items-center border-r border-black/15 bg-emerald-600 px-2 text-white transition hover:bg-emerald-700"
        >
          <BsGearFill className="h-3.5 w-3.5" />
        </button>
      </Popover>
      )}
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
      {addScreen && (screenSharing || addScreen.count > 0) && (
        <Tippy
          visible={addScreen.tip.show}
          placement="bottom"
          interactive
          theme="golive-panel"
          appendTo={() => document.body}
          content={
            <span
              role="status"
              className="relative block w-60 rounded-lg bg-blue-600 px-3 py-2 text-left text-xs font-medium text-white shadow-lg"
            >
              <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-blue-600" />
              <span className="flex items-start gap-2">
                <span className="flex-1">{t("watch.watchRoom.multiScreenTip")}</span>
                <button
                  type="button"
                  onClick={addScreen.tip.dismiss}
                  aria-label={t("watch.watchRoom.clipsModeTipDismiss")}
                  className="-m-1 rounded p-1 leading-none text-white/80 hover:text-white"
                >
                  ✕
                </button>
              </span>
            </span>
          }
        >
        <span className="flex">
        <Tooltip
          placement="bottom"
          interactive
          content={
            <div className="flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-2">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                {atScreenLimit
                  ? t("watch.watchRoom.screenLimitReached", { limit: addScreen.limit })
                  : t("watch.watchRoom.addAnotherScreen", { count: addScreen.count, limit: addScreen.limit })}
                <NewBadge id="multi-screen-share" />
              </span>
              {/* Only at the limit: below it there is nothing to sell. Stacked,
                  because the bubble caps its width (Tooltip's maxWidth). */}
              {atScreenLimit && addScreen.upgrade && upgradeMark && (
                <button
                  type="button"
                  onClick={addScreen.upgrade.onClick}
                  className="flex w-full flex-col gap-1.5 overflow-hidden rounded-lg border border-amber-400/50 bg-amber-400/10 p-2.5 text-left transition hover:bg-amber-400/20"
                >
                  <span className="flex items-center gap-2">
                    <upgradeMark.Icon className={`h-5 w-5 shrink-0 ${upgradeMark.className}`} />
                    <span className="text-sm font-semibold">
                      {t("watch.watchRoom.upgradeScreensTitle", {
                        plan: TIER_NAMES[addScreen.upgrade.tier],
                        limit: addScreen.upgrade.limit,
                      })}
                    </span>
                  </span>
                  <span className="text-xs leading-snug opacity-80">
                    {t("watch.watchRoom.upgradeScreensHint", { plan: TIER_NAMES[addScreen.upgrade.tier] })}
                  </span>
                  <span className="mt-0.5 block w-full rounded-md bg-amber-500 py-1 text-center text-xs font-semibold text-white">
                    {t("watch.watchRoom.seePlans")} →
                  </span>
                </button>
              )}
              {addScreen.items.length > 0 && (
                <ul className="flex flex-col gap-1 border-t border-white/15 pt-1.5">
                  {addScreen.items.map((item) => (
                    <li key={item.id} className="flex items-center gap-2">
                      <ScreenIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <button
                        type="button"
                        onClick={item.onStop}
                        aria-label={`${t("watch.watchRoom.stopThisScreen")}: ${item.label}`}
                        className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white transition hover:bg-red-700"
                      >
                        {t("watch.watchRoom.closeScreen")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          }
          wrapperClassName="flex"
        >
          <button
            type="button"
            onClick={() => {
              if (addScreen.tip.show) addScreen.tip.clicked();
              addScreen.onClick();
            }}
            aria-label={t("watch.watchRoom.addAnotherScreen", { count: addScreen.count, limit: addScreen.limit })}
            className={`${segment} gap-1.5 border-l border-black/15 px-2.5 ${live}`}
          >
            <span className={`flex items-center ${atScreenLimit ? "opacity-60" : ""}`}>
              <MdAdd className="h-4 w-4" />
              <span className="ml-0.5 text-xs font-semibold tabular-nums">
                {addScreen.count}/{addScreen.limit}
              </span>
            </span>
            {/* The next plan's limit, right after the counter — only once the
                current plan's is used up. */}
            {atScreenLimit && addScreen.upgrade && upgradeMark && (
              <span className="flex items-center gap-1 rounded-md bg-black/25 px-1.5 py-0.5 text-[11px] font-semibold leading-none">
                <upgradeMark.Icon className={`h-3.5 w-3.5 shrink-0 ${upgradeMark.className}`} />
                <span className="whitespace-nowrap">
                  {TIER_NAMES[addScreen.upgrade.tier]}: {addScreen.upgrade.limit}
                </span>
              </span>
            )}
          </button>
        </Tooltip>
        </span>
        </Tippy>
      )}
      {/* Same panel as the mic's: which camera (where there is a choice) and
          the shortcut, from the arrow and from a right-click alike. */}
      <ShortcutQuickPopover
        action="toggleCamera"
        open={quickShortcutAction === "toggleCamera"}
        onClose={onCloseShortcutQuick ?? (() => {})}
        hasAccount={quality.hasAccount}
        onRequestAccount={onRequestAccount ?? (() => {})}
        onOpenAllShortcuts={onOpenAllShortcuts}
        extra={
          canPickCamera ? (
            <div className="w-64 max-w-[calc(100vw-2rem)]">
              <DeviceSubmenuRow
                label={t("common.chooseCamera")}
                current={
                  cameraDevices.find((d) => d.deviceId === cameraDeviceId)?.label ??
                  t("watch.watchRoom.systemDefault")
                }
              >
                <DeviceMenuOption
                  label={t("watch.watchRoom.systemDefault")}
                  selected={cameraDeviceId === null}
                  onClick={() => setCameraDevice(null)}
                />
                {cameraDevices.map((d) => (
                  <DeviceMenuOption
                    key={d.deviceId}
                    label={d.label}
                    selected={cameraDeviceId === d.deviceId}
                    onClick={() => setCameraDevice(d.deviceId)}
                  />
                ))}
              </DeviceSubmenuRow>
            </div>
          ) : undefined
        }
      >
        <div className="flex items-stretch">
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
        {/* Inside the panel's anchor, like the mic's arrow — see there. Only
            where there is a choice to make: on the one-webcam laptop most
            people are on, an arrow over a single entry is clutter. */}
        {extra(canPickCamera ? (
          <Tooltip content={t("watch.watchRoom.cameraSettings")}>
            <button
              type="button"
              onClick={() =>
                quickShortcutAction === "toggleCamera"
                  ? onCloseShortcutQuick?.()
                  : onOpenShortcutQuick?.("toggleCamera")
              }
              aria-label={t("watch.watchRoom.cameraSettings")}
              aria-expanded={quickShortcutAction === "toggleCamera"}
              className={`flex h-full items-center border-l border-black/15 px-1 text-white transition ${cameraSharing ? live : idle}`}
            >
              <ChevronDownIcon className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        ) : null)}
        </div>
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
      {extra(cameraSupported && onPhone ? (
        <Tooltip
          content={
            cameraFacing === "environment"
              ? t("watch.watchRoom.useTheFrontCamera")
              : t("watch.watchRoom.useTheRearCamera")
          }
          placement="bottom"
        >
          <button
            type="button"
            onClick={() =>
              setCameraFacing(cameraFacing === "environment" ? "user" : "environment")
            }
            aria-label={t("watch.watchRoom.flipTheCamera")}
            className={`flex items-center border-l border-black/15 px-2 text-white transition ${cameraSharing ? live : idle}`}
          >
            <MdFlipCameraAndroid className="h-4 w-4" />
          </button>
        </Tooltip>
      ) : null)}
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
  const t = useT();
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
    >
      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {t("watch.watchRoom.newRoom")}
      </label>
      <input
        autoFocus
        value={switchInput}
        onChange={(e) => setSwitchInput(e.target.value)}
        placeholder={t("watch.watchRoom.exTeamMeetingOrPrivFamily")}
        className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
      />
      <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        <input
          type="checkbox"
          checked={switchIsPrivate}
          onChange={(e) => setSwitchIsPrivate(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
        />
        {t("watch.watchRoom.createAPrivateRoomGeneratesA")}
      </label>
      {/* Says what the box above already accepts, so nobody assumes the
          only way back into a private room is the home page. */}
      <p className="mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-500">
        {t("watch.watchRoom.toJoinAPrivateRoomThat")}
      </p>
      {switchError && <p className="mt-1 text-xs text-red-500">{switchError}</p>}
      <button
        type="submit"
        disabled={!switchInput.trim()}
        className="mt-2 w-full rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {t("common.goToTheRoom")}
      </button>
      <Link
        href="/rooms"
        className="mt-2 block text-center text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {t("watch.watchRoom.seeActivePublicRooms")}
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
// "screen-extra" tiles are the extra screens of "Várias telas" (see
// lib/multiScreen.ts), addressed by `${slot}:${ownerId}` like the files.
// "camera2" is the phone's second lens (front and rear at once).
type TileKind = "screen" | "camera" | "camera2" | "file" | "video-source" | "screen-extra";
const SELF_TILE_OWNER = "self";

function tileId(kind: TileKind, ownerId: string): string {
  return `${kind}:${ownerId}`;
}

// How long a focus request from the rooms list waits for the transmission it
// prefers before taking what is there. Someone sharing screen and camera
// announces both at once, but the two streams connect separately, and the
// camera arriving first should not win the stage just by being quicker.
const FOCUS_REQUEST_SETTLE_MS = 5000;

// The order a focus request picks a person's tiles in when they have several:
// the screen first, then a file they are playing, then the camera.
const FOCUS_KIND_ORDER = ["screen", "file", "camera"] as const;

// Null for anything this doesn't recognise — an id left over from an older
// scheme, say — which every caller treats as "that tile is gone", the same
// answer it gives for a peer who left.
function parseTileId(id: string): { kind: TileKind; ownerId: string } | null {
  const separator = id.indexOf(":");
  if (separator < 0) return null;
  const kind = id.slice(0, separator);
  const ownerId = id.slice(separator + 1);
  if (!ownerId) return null;
  if (
    kind !== "screen" &&
    kind !== "camera" &&
    kind !== "camera2" &&
    kind !== "video-source" &&
    kind !== "screen-extra"
  ) {
    return null;
  }
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
const DEFAULT_CHAT_WIDTH = 350;
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
const DOCK_SLOT = "flex min-w-0 flex-1 items-center justify-center";
const DOCK_BUTTON_BASE =
  "flex h-11 w-full items-center justify-center rounded-xl text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";
const DOCK_BUTTON = `${DOCK_BUTTON_BASE}`;
const DOCK_ON = "bg-emerald-600 active:bg-emerald-700";
const DOCK_OFF = "bg-red-600 active:bg-red-700";
// Same red as DOCK_OFF, named apart because it means the opposite thing: not
// "this is switched off" but "this is on the air".
const DOCK_LIVE = "bg-red-600 active:bg-red-700";
const DOCK_TAB =
  "flex h-11 w-11 sm:w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl transition active:scale-95";
// The one surface in the room that is a deliberate highlight rather than a
// surface, so it is the one that wears a theme's accent (see globals.css's
// .room-accent, which falls back to exactly these colours when no theme is
// on). Everything else in the room is painted by the palette through the zinc
// tokens and needs no class of its own.
const DOCK_TAB_ACTIVE = "room-accent";
const DOCK_TAB_IDLE =
  "text-zinc-600 active:bg-zinc-100 dark:text-zinc-400 dark:active:bg-zinc-900";

/**
 * What changes when this room is a group's voice room (see
 * components/groups/GroupAppShell). Absent for every /watch room, which is the
 * whole guarantee: without it, nothing below behaves any differently.
 */
export type WatchRoomGroupMode = {
  groupId: string;
  channelId: string;
  channelName: string;
  groupName: string;
  /** Opens the group's rooms drawer on a phone. */
  onOpenNav: () => void;
};

export function WatchRoom({
  handle,
  viewThemeId = null,
  visible = true,
  onDisconnect,
  dockSlot = null,
  dockPhase = "expanded",
  headerSlots = null,
  musicSlot = null,
  group,
  dm = null,
}: {
  handle: string;
  /** A theme this room was opened to show. See useRoomTheme. */
  viewThemeId?: string | null;
  /**
   * Whether a page is drawing the room right now. False while the call is
   * docked — connected and audible, with somebody reading another page (see
   * components/RoomCallHost). The room stays mounted either way: unmounting it
   * is what ends the call.
   */
  visible?: boolean;
  /** Hanging up. Clearing the session is what unmounts this and leaves the room. */
  onDisconnect: () => void;
  /**
   * The floating call bar's box, while the call is docked: the room's own call
   * controls are drawn into it (see inHeaderSlot), so the bar carries the real
   * ones rather than copies of a few.
   */
  dockSlot?: HTMLElement | null;
  /**
   * Which size that bar is. Its lesser controls are left out while compact
   * and animated in and out around its arrow (see dockExtra). Means nothing
   * anywhere but the bar.
   */
  dockPhase?: CallDockPhase;
  /**
   * The slots of whatever top bar is lending itself to the call — a group's,
   * while the group's pages are on screen, whether the call is that group's or
   * one carried in from an ordinary room. The call controls are portalled into
   * it, and the room's page buttons too while the room is the page shown (see
   * inHeaderSlot). Null anywhere else.
   */
  headerSlots?: { center: HTMLElement | null; right: HTMLElement | null; end: HTMLElement | null } | null;
  /**
   * The strip under a group's header that a group voice room draws its music
   * bars into (see CallChrome.musicSlot). Used only when this room *is* a
   * group's — an ordinary room keeps its bars under its own header even while
   * its call is carried through a group's pages.
   */
  musicSlot?: HTMLElement | null;
  /** Set only when the room is a group's voice room. See WatchRoomGroupMode. */
  group?: WatchRoomGroupMode;
  /**
   * Set only when the room is a direct call — somebody rang, somebody answered
   * (see lib/callSession's `dm`). It is not another kind of room but another
   * kind of page: the call is drawn inside a conversation, a pane beside the
   * messages rather than a screen of its own, so everything a room page is
   * made of *around* the call — its header, its participant column, its own
   * chat, the ads — is left out, and what is left is the call (see callLayout).
   */
  dm?: { userId: string; displayName: string; avatarUrl: string | null } | null;
}) {
  const router = useRouter();
  // The room stripped down to the call itself. See the `dm` prop.
  const callLayout = Boolean(dm);
  const state = useSignalingSelector(selectWatchRoom, shallow);
  useRoomSoundEffects(state);
  // Paints the room. The room's own theme when it has one, this account's
  // otherwise — see lib/useRoomTheme, which is where that precedence lives.
  // It writes CSS variables onto the document, so nothing here has to be
  // passed a colour: every `bg-zinc-950` and `border-zinc-200` in this file
  // already reads one.
  // In a group the page's look is the group's, painted by the group shell for
  // every page of it — this room paints nothing of its own (see useRoomTheme's
  // `enabled`), or a call in one group would recolour another one being read.
  // ...and nothing at all while the call is docked: the room's colours belong
  // to the room, and a call carried around the site must not repaint the page
  // somebody walked off to read.
  const roomTheme = useRoomTheme(state.roomTheme, viewThemeId, !group && visible);
  // Whether this browser refuses room themes (see the toggle in the menu). Read
  // here as well as inside the hook, because the row has to draw its own state.
  const roomThemeOptedOut = useSyncExternalStore(
    subscribeRoomThemeOptOut,
    isRoomThemeOptedOut,
    isRoomThemeOptedOutServer
  );
  // Whether "Impedir conexões diretas" has a TURN server to force through —
  // the build's own, or Cloudflare's once lib/iceServers.ts has them.
  const turnConfigured = useSyncExternalStore(subscribeIceServers, isTurnConfigured, () => TURN_CONFIGURED);
  // Keeps the tab's connection alive longer in the background on Android
  // while actually in a room — see the hook's own doc comment for why (and
  // its limits, especially on iOS).
  useBackgroundKeepAlive(Boolean(state.room));
  const hasStoredName = useHasStoredName();
  const { loading: resolvingAccount, account, points, retryIdentity } = useAuth();
  // Up here with the other hooks rather than beside the Pro button, which is
  // drawn past an early return (see getRoomProOffer).
  const proUltraOnSale = usePlanOnSale(
    "pro_ultra",
    Boolean(account?.flags.includes("PRO_MAX") && !account.flags.includes("PRO_ULTRA"))
  );
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
    setShareSystemAudio,
    shareSystemAudioUnavailable,
    shareSource,
    fileChannels,
    localMediaSnapshots,
    extraScreens,
    extraScreensActive,
    addExtraScreen,
    dualCamera,
    dualCameraSupported,
    startDualCamera,
    dualCameraError,
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
    nativeVideoOption,
    setNativeVideoOption,
    nativeVideoMethod,
    setNativeVideoMethod,
    screenRestartNeeded,
    restartScreenShare,
    isMicOn,
    toggleMic: toggleMicDevice,
    setMicOn,
    micError,
    localMicStream,
    remoteMicStreams,
    micConnectionStates,
    micDeviceId,
    setMicDevice,
    micGain,
    setMicGain,
    micGainAvailable,
    speakerDeviceId,
    setSpeakerDevice,
    noiseSuppressionOn,
    noiseSuppressionAvailable,
    toggleNoiseSuppression,
    forceRelayIce,
    forceRelayAllowed,
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
  // The login half of the same gate. Rendered inline rather than through
  // <AccountModal>, which is mounted far below this screen's early return —
  // "Já tenho uma conta" used to set that modal's mode from here and produce
  // nothing at all on screen, because the component that reads it never
  // rendered on this branch.
  const [signingIn, setSigningIn] = useState(false);
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
  // RoomAppGate sets, surfaced here so it can be turned back off. Read
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

  // The mic button, wherever it is pressed — the controls, the tile overlay,
  // the group's voice dock, a global shortcut. Opening the mic while deafened
  // undeafens too, as Discord does: talking to a room you cannot hear is not
  // a state anybody means to be in, and it used to be one click away.
  //
  // The undeafen goes through the same state the deafen button sets, so the
  // effect above plays its chime; the mic is opened here rather than by that
  // effect's restore, because this is a choice about the mic and is stored as
  // one (see useRoomMedia's toggleMic). Its own blip is kept quiet, so the
  // press makes one sound, the way deafening does.
  const toggleMic = useCallback(() => {
    if (micsMuted && !isMicOn) {
      micBeforeDeafenRef.current = false;
      micFollowingDeafenRef.current = true;
      setMicsMuted(false);
      setStoredMicsMuted(false);
      signalingClient.setMicsMuted(false);
      trackEvent("mics_unmuted");
    }
    toggleMicDevice();
  }, [micsMuted, isMicOn, toggleMicDevice]);
  // Which shell this is, read once — see lib/desktop's isAppShell.
  const [appShell] = useState(() => isAppShell());
  const [soundEffectsOn, setSoundEffectsOn] = useState(() => getSoundEffectsEnabled());
  const [profileSongAutoplay, setProfileSongAutoplayState] = useState(() =>
    getProfileSongAutoplay()
  );
  const [doubleClickFocus, setDoubleClickFocus] = useState(() => getStoredDoubleClickFocus());
  const [mutedPeerIds, setMutedPeerIds] = useState<Set<string>>(new Set());
  // Whom a manager turned the mic off for (see the server's "room-silence"),
  // by stable user id: shown in red everywhere a mic is, never played here,
  // and — for ourselves — the mic kept off.
  const silencedIds = useMemo(() => new Set(state.roomSilenced), [state.roomSilenced]);
  const selfSilenced = Boolean(state.selfUserId && silencedIds.has(state.selfUserId));
  const isPeerSilenced = (peer: { userId?: string | null } | undefined) =>
    Boolean(peer?.userId && silencedIds.has(peer.userId));
  // In a group, "Silenciar membros" lets somebody who is not an
  // administrator silence people too — the group's detail says whether we
  // have it (the group's shell has it loaded already).
  const { detail: groupDetail } = useGroupDetail(group?.groupId ?? null);
  const groupCanMuteMembers = Boolean(group && groupDetail && canManage(groupDetail, "muteMembers"));
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>(() => getStoredPeerVolumes());
  // Screen/camera tiles' sound on/off, per person and per kind, keyed like
  // transmissionVolumes. A tile nobody has touched starts muted.
  const [transmissionMuted, setTransmissionMutedState] = useState<Record<string, boolean>>(() =>
    getStoredTransmissionMuted()
  );
  const [transmissionVolumes, setTransmissionVolumes] = useState<Record<string, number>>(() =>
    getStoredTransmissionVolumes()
  );
  const [renaming, setRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [qualityOpen, setQualityOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
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
  // Our own screen and camera previews taken off the grid, for somebody who
  // does not need to watch themselves share. Only the tiles: the share goes on
  // for everybody else. Put back from the right-click menu on the video pane
  // (see ownPreviewMenu). Remembered in this browser, like the side columns.
  const [ownPreviewHidden, setOwnPreviewHidden] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("sharescreen:ownPreviewHidden") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("sharescreen:ownPreviewHidden", String(ownPreviewHidden));
    } catch {}
  }, [ownPreviewHidden]);
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
  // Who is recording one of my transmissions right now (see lib/recordingNotice).
  const recordingNotices = useRecordingNotices();
  // Which of my transmissions are being recorded — "screen", "camera", or a
  // file slot, as the recorder's tile names it — for the red frame.
  const recordedChannels = new Set(recordingNotices.flatMap((n) => n.channels));
  // The tile experiments, "Modo clipes" and "Gravação" (see lib/clipsMode).
  // Tracked here, where their switches are shown, rather than in every tile.
  const clipsMode = useTileExperiment("clips", { track: true });
  const recordingMode = useTileExperiment("recording", { track: true });
  const clipsTip = useTileExperimentTip("clips", clipsMode.available);
  const recordingTip = useTileExperimentTip("recording", recordingMode.available);
  // "Várias telas" (see lib/multiScreen): same shape — who gets the switch is
  // the experiment, and the switch (off by default) is what shows the "+" next
  // to the screen button.
  const multiScreenMode = useTileExperiment("multiScreen", { track: true });
  // Not on "⋯" like the others: anchored on the "+" itself, which only exists
  // while a screen is going out — so it appears the first time somebody with
  // the feature starts a share, whether or not they used GoLive before.
  const multiScreenTip = useTileExperimentTip("multiScreen", multiScreenMode.active, { everyone: true });
  // The phone's own tip, on the dual-camera button (see clipsMode's dualCamera).
  const dualCameraTip = useTileExperimentTip("dualCamera", multiScreenMode.active, { everyone: true });
  // How many screens/windows (the first included) this account may share.
  const screenLimit = multiScreenLimit(account?.flags);
  const screenUpgrade = nextScreenUpgrade(account?.flags);
  // "Apertar para falar" (see lib/pushToTalk): the same two gates, plus a key
  // the person records in the shortcuts panel. Desktop app only.
  const pushToTalk = usePushToTalk();
  const pushToTalkTip = useTileExperimentTip("pushToTalk", pushToTalk.available);
  // "Girar/inverter" (see lib/tileOrientation): the button in each tile's
  // corner. Tracked here, where its switch is, rather than in every tile.
  const orientationMode = useTileExperiment("orientation", { track: true });
  const orientationTip = useTileExperimentTip("orientation", orientationMode.available);
  // How *we* asked the room to show each of our own transmissions, by
  // broadcast channel ("screen", "camera", "screen2", "file1", ...). Kept
  // here rather than in the tile because the server forgets it on every join
  // (see its ClientInfo.tileOrientations), so somebody has to say it again
  // after a reconnect — the effect below. Every viewer may still turn the
  // same tile their own way, which wins for them alone.
  const [myOrientations, setMyOrientations] = useState<Record<string, Orientation>>({});
  const setMyOrientation = useCallback((channel: string, orientation: Orientation) => {
    setMyOrientations((prev) => {
      const next = { ...prev };
      if (isDefaultOrientation(orientation)) delete next[channel];
      else next[channel] = orientation;
      return next;
    });
    signalingClient.setTileOrientation(channel, orientation);
  }, []);
  // Our connection id changes on every (re)connect, and the server drops
  // these on join — so this is both "announce what we already chose" and
  // "say it again after a reconnect".
  const myOrientationsRef = useRef(myOrientations);
  myOrientationsRef.current = myOrientations;
  useEffect(() => {
    if (!state.selfId) return;
    for (const [channel, orientation] of Object.entries(myOrientationsRef.current)) {
      signalingClient.setTileOrientation(channel, orientation);
    }
  }, [state.selfId]);
  // What a peer asked everyone to see for one of their channels, if anything.
  const peerOrientation = useCallback(
    (peerId: string, channel: string): Orientation | null =>
      parseOrientation(state.peers.find((p) => p.id === peerId)?.orientations?.[channel]),
    [state.peers]
  );
  // The mic is left open and its track muted between presses — see
  // usePushToTalkGate for why that rather than stopping the capture.
  usePushToTalkGate(isMicOn ? localMicStream : null, pushToTalk);
  // One blue tip at a time; the other waits for the next visit.
  const newFeatureTip = clipsTip.show
    ? { ...clipsTip, text: "watch.watchRoom.clipsModeTip" }
    : recordingTip.show
      ? { ...recordingTip, text: "watch.watchRoom.recordingModeTip" }
      : orientationTip.show
        ? { ...orientationTip, text: "watch.watchRoom.orientationTip" }
        : null;
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
  const [mobileExtraMenuOpen, setMobileExtraMenuOpen] = useState(false);
  const mobileDrawerTouchStartY = useRef<number | null>(null);

  // Permite fechar o painel mobile (Chat e Pessoas) puxando para baixo
  const mobilePanelRef = useRef<HTMLElement | null>(null);
  const panelClosingRef = useRef<boolean>(false);

  function closeMobilePanel(callback?: () => void) {
    if (panelClosingRef.current) return;
    const section = mobilePanelRef.current;
    if (!section) {
      setMobilePanel(null);
      callback?.();
      return;
    }
    panelClosingRef.current = true;
    section.style.transition = "transform 0.18s ease-out";
    section.style.transform = "translateY(100%)";
    setTimeout(() => {
      setMobilePanel(null);
      panelClosingRef.current = false;
      if (section) {
        section.style.transform = "";
        section.style.transition = "";
      }
      callback?.();
    }, 180);
  }

  // The bottom bar's two panel buttons are toggles: tapping the sheet that's
  // already up puts it away again, which is the gesture people try first and
  // the only way back to a full-screen video.
  function toggleMobilePanel(panel: MobilePanel) {
    setMobileExtraMenuOpen(false);
    if (mobilePanel === panel) {
      closeMobilePanel();
    } else {
      panelClosingRef.current = false;
      setMobilePanel(panel);
    }
  }

  function toggleMobileExtraMenu() {
    if (!mobileExtraMenuOpen && mobilePanel) {
      closeMobilePanel();
    }
    setMobileExtraMenuOpen((prev) => !prev);
  }

  // Android's back button puts away what the bottom bar opened before it
  // leaves the room — see lib/useBackHandler. The newest wins, so the
  // options drawer (opened over a sheet) closes first.
  useBackHandler(mobilePanel !== null, () => closeMobilePanel());
  useBackHandler(mobileExtraMenuOpen, () => setMobileExtraMenuOpen(false));

  function handleDrawerTouchStart(e: React.TouchEvent) {
    mobileDrawerTouchStartY.current = e.touches[0].clientY;
  }

  function handleDrawerTouchEnd(e: React.TouchEvent) {
    if (mobileDrawerTouchStartY.current === null) return;
    const deltaY = mobileDrawerTouchStartY.current - e.changedTouches[0].clientY;
    mobileDrawerTouchStartY.current = null;
    // Swiped up by more than 25px -> open extra menu
    if (deltaY > 25) {
      if (mobilePanel) closeMobilePanel();
      setMobileExtraMenuOpen(true);
    } else if (deltaY < -25) {
      // Swiped down by more than 25px -> close extra menu
      setMobileExtraMenuOpen(false);
    }
  }
  const panelTouchStartY = useRef<number | null>(null);
  const panelTouchStartX = useRef<number | null>(null);
  const panelTouchStartTime = useRef<number>(0);
  const panelIsDragging = useRef<boolean>(false);
  const panelScrollElement = useRef<HTMLElement | null>(null);

  function handlePanelTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    panelTouchStartY.current = touch.clientY;
    panelTouchStartX.current = touch.clientX;
    panelTouchStartTime.current = Date.now();
    panelIsDragging.current = false;

    const section = mobilePanelRef.current;
    if (!section) return;

    const target = e.target as HTMLElement | null;
    const isGrabHandle = Boolean(target?.closest("[data-panel-grab-handle]"));

    if (isGrabHandle) {
      panelScrollElement.current = null;
      panelIsDragging.current = true;
      section.style.transition = "none";
      return;
    }

    // Se o toque foi no conteúdo, acha o container de scroll mais próximo
    let cur = target;
    let scrollable: HTMLElement | null = null;
    while (cur && cur !== section) {
      const overflowY = window.getComputedStyle(cur).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && cur.scrollHeight > cur.clientHeight) {
        scrollable = cur;
        break;
      }
      cur = cur.parentElement;
    }
    panelScrollElement.current = scrollable;
  }

  function handlePanelTouchMove(e: React.TouchEvent) {
    if (panelTouchStartY.current === null || panelTouchStartX.current === null) return;
    const section = mobilePanelRef.current;
    if (!section) return;

    const touch = e.touches[0];
    const deltaY = touch.clientY - panelTouchStartY.current;
    const deltaX = touch.clientX - panelTouchStartX.current;

    // Se estiver subindo ou neutro
    if (deltaY <= 0) {
      if (panelIsDragging.current) {
        section.style.transform = "translateY(0px)";
        panelIsDragging.current = false;
      }
      return;
    }

    // Se estiver dentro de um elemento rolável que ainda tem scroll acima, deixa rolar normal
    if (panelScrollElement.current && panelScrollElement.current.scrollTop > 0) {
      return;
    }

    // Se o movimento for mais horizontal do que vertical, ignora
    if (!panelIsDragging.current && Math.abs(deltaY) < Math.abs(deltaX)) {
      return;
    }

    panelIsDragging.current = true;
    section.style.transition = "none";
    section.style.transform = `translateY(${Math.max(0, deltaY)}px)`;
  }

  function handlePanelTouchEnd(e: React.TouchEvent) {
    if (panelTouchStartY.current === null) return;
    const section = mobilePanelRef.current;
    const touch = e.changedTouches[0];
    const deltaY = touch.clientY - panelTouchStartY.current;
    const duration = Math.max(1, Date.now() - panelTouchStartTime.current);
    const velocity = deltaY / duration;

    panelTouchStartY.current = null;
    panelTouchStartX.current = null;
    panelScrollElement.current = null;

    if (!section) return;

    // Fecha se arrastou mais de 60px para baixo OU swipe rápido (>25px com velocidade > 0.35)
    const shouldClose = panelIsDragging.current && (deltaY > 60 || (velocity > 0.35 && deltaY > 25));
    panelIsDragging.current = false;

    if (shouldClose) {
      closeMobilePanel();
    } else {
      section.style.transition = "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)";
      section.style.transform = "translateY(0px)";
      setTimeout(() => {
        if (section) {
          section.style.transform = "";
          section.style.transition = "";
        }
      }, 200);
    }
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
  const [mobileScreenShareModalOpen, setMobileScreenShareModalOpen] = useState(false);
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
  const [inviting, setInviting] = useState(false);
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
  const isMobileBrowser = mounted && isMobileDevice() && !isMobileApp();
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

  // The participant list and the ad under it, folded away to give the video
  // their width. In a group the room has no such column of its own, and this is
  // the group's instead — its rail of groups and its rooms column, with the ad
  // under them (see the publishing effect further down, and GroupAppShell) —
  // remembered apart, so folding one kind of room away does not fold the other.
  const leftSidebarStorageKey = group
    ? "sharescreen:groupColumnsCollapsed"
    : "sharescreen:leftSidebarCollapsed";
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(leftSidebarStorageKey) === "true";
    } catch {
      return false;
    }
  });

  const {
    ad: activePartnerAd,
    rawPartner: rawActivePartner,
    loaded: partnerLoaded,
    // Told when it is off screen, so it stops counting impressions for an ad
    // nobody can see and defers its rotation to a minute it owns.
    // In a group on a wide screen the room draws no ad at all — the group's
    // rooms column does (see GroupPartnerSlot) — so this one must not count;
    // not until that column is folded away, when the ad is this room's to draw.
  } = usePartnerAd({
    visible: visible && !callLayout && !(group && isWideLayout && !leftSidebarCollapsed),
  });
  // A Pro Max subscriber may close the group's ad (see GroupPartnerSlot); the
  // one this room draws in its place is the same ad, and stays closed with it.
  const groupAdHidden = useGroupAdHidden();
  // The partner-ctr experiment (see lib/partnerExperiment): its exposure is
  // counted by usePartnerAd above, this only reads which side we are on.
  const partnerExperimentOn = usePartnerExperiment();

  const hasLocalScreen = Boolean(isSharing && localStream) || extraScreensActive > 0;
  const hasLocalCamera = Boolean(localCameraStream);
  const hasLocalFiles = LOCAL_MEDIA_SLOTS.some((slot) => fileChannels[slot]?.localStream);
  const hasRemoteScreens =
    Object.keys(remoteStreams).length > 0 ||
    stoppedPeers.size > 0 ||
    resumingPeers.size > 0 ||
    EXTRA_SCREEN_SLOTS.some(
      (slot) =>
        Object.keys(extraScreens[slot].remoteStreams).length > 0 ||
        extraScreens[slot].stoppedPeers.size > 0 ||
        extraScreens[slot].resumingPeers.size > 0
    );
  const hasRemoteCameras =
    Object.keys(dualCamera.remoteStreams).length > 0 ||
    dualCamera.stoppedPeers.size > 0 ||
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
      localStorage.setItem(leftSidebarStorageKey, String(leftSidebarCollapsed));
    } catch {}
  }, [leftSidebarStorageKey, leftSidebarCollapsed]);

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

  // In a group, the columns the left toggle folds away are the group's, drawn
  // by its shell — so the state is published there (see lib/groupVoiceSession's
  // GroupVoiceColumns), with the button to fold them in its rooms column and
  // the one to bring them back floating over this room's video, like a room's
  // own. Through a stable wrapper, so the shell is not told about a "new"
  // toggle every time the ad on screen changes.
  const toggleLeftSidebarRef = useRef(toggleLeftSidebar);
  useEffect(() => {
    toggleLeftSidebarRef.current = toggleLeftSidebar;
  }, [toggleLeftSidebar]);
  const stableToggleLeftSidebar = useCallback(() => toggleLeftSidebarRef.current(), []);
  const publishesGroupColumns = Boolean(group);
  useEffect(() => {
    if (!publishesGroupColumns) return;
    setGroupVoiceColumns({
      collapsed: leftSidebarCollapsed,
      canCollapse: isWideLayout && hasAnyMedia,
      toggle: stableToggleLeftSidebar,
    });
  }, [publishesGroupColumns, leftSidebarCollapsed, isWideLayout, hasAnyMedia, stableToggleLeftSidebar]);
  useEffect(() => {
    if (!publishesGroupColumns) return;
    return () => setGroupVoiceColumns(null);
  }, [publishesGroupColumns]);

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

  // The box the tile grid lives in, measured. planTileGrid needs the pane's
  // real shape — how many tiles fit best across is a question about width
  // *and* height, and neither is knowable from a breakpoint: this pane
  // changes size when either sidebar collapses, when the chat column is
  // dragged, and when the window resizes, none of which cross a breakpoint.
  //
  // The content box, so a scrollbar appearing (which only happens once the
  // tiles have hit their floor) doesn't feed its own width back in.
  const [videoPaneSize, setVideoPaneSize] = useState({ width: 0, height: 0 });
  const videoPaneRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      setVideoPaneSize((prev) =>
        prev.width === box.width && prev.height === box.height
          ? prev
          : { width: box.width, height: box.height }
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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

  function toggleProfileSongAutoplay() {
    const next = !profileSongAutoplay;
    setProfileSongAutoplayState(next);
    setProfileSongAutoplay(next);
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

  // Keyed by the peer's stable userId (falling back to their current
  // connection id for a peer an older server hasn't sent one for yet) —
  // NOT the WebRTC connection id, so a saved dial survives that peer
  // reconnecting with a brand new connection id.
  function setPeerVolume(volumeKey: string, volume: number) {
    setPeerVolumes((prev) => ({ ...prev, [volumeKey]: volume }));
    setStoredPeerVolume(volumeKey, volume);
  }

  function setTransmissionMuted(volumeKey: string, muted: boolean) {
    setTransmissionMutedState((prev) => ({ ...prev, [volumeKey]: muted }));
    setStoredTransmissionMuted(volumeKey, muted);
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

  // The phone's share sheet — WhatsApp, Telegram, a message — for the room's
  // link, where there is one (see lib/nativeApp). Copying is the fallback.
  async function handleShareLink() {
    const result = await shareLink({ url: window.location.href });
    if (result === "shared") trackEvent("room_link_shared");
    else if (result === "unsupported") await handleCopyLink();
  }

  // A stored guest name, an account already resolved, or an account token
  // still being resolved (see AuthContext's registration effect — it's what
  // turns that resolved account into a signalingClient.register() call,
  // including on a direct link straight into a room like this one), means the
  // client is still (re)connecting/registering — show a loading state instead
  // of asking again.
  //
  // `account` is in there because `hasStoredName` cannot answer this in the
  // installed app: that shell never registers a guest name, so it has nothing
  // stored, and somebody who had just signed in was shown the "é preciso ter
  // uma conta" screen for the whole time the register was in flight (or
  // retrying, see REGISTER_ACK_TIMEOUT_MS) — which reads exactly like a login
  // that silently failed. A real refusal sets nameError and drops out of this
  // into that screen, which now shows the reason.
  //
  // Excludes "banned": that connection attempt already resolved
  // (rejected), so it's not actually still restoring and would otherwise
  // get stuck on this loading state forever instead of showing the ban
  // screen below.
  const restoring =
    !mounted ||
    (!state.name &&
      (resolvingAccount || ((hasStoredName || Boolean(account)) && !state.nameError)) &&
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
    // A group's room is reached through its group, never from the list of
    // rooms somebody walked into by name.
    if (state.room !== handle || group) return;
    rememberRecentRoom(handle);
  }, [state.room, handle, group]);

  // In a group, the voice dock outside this room offers the mute button (see
  // components/groups/GroupSidebar's VoiceControls). Published through a stable
  // wrapper, so the dock is not told about a "new" toggle on every render.
  const toggleMicRef = useRef(toggleMic);
  useEffect(() => {
    toggleMicRef.current = toggleMic;
  }, [toggleMic]);
  const stableToggleMic = useCallback(() => toggleMicRef.current(), []);

  // On the Android app, the call's own notification — and the foreground
  // service behind it, without which leaving the app mutes the mic and soon
  // freezes the call (see lib/androidCallService). Held for as long as the
  // room is: from the first time the join is answered until this unmounts, so
  // a reconnect (which clears state.room for a moment) does not stop a service
  // Android would refuse to start again while the app is in the background.
  const [callHeld, setCallHeld] = useState(false);
  if (!callHeld && state.room === handle) setCallHeld(true);
  const hangUpFromNotification = useCallback(() => {
    playHangUpSound();
    onDisconnect();
  }, [onDisconnect]);
  useAndroidCallService({
    active: callHeld,
    title: group ? group.channelName : dm ? dm.displayName : recentRoomPresentation(handle).name,
    micOn: isMicOn,
    onToggleMic: stableToggleMic,
    onLeave: hangUpFromNotification,
  });

  // The per-person audio controls, for the rooms list of a group: from lg up
  // a group's voice room has no participant list of its own (who is in it is
  // on the group's room card instead), so the card is where turning somebody
  // down has to be offered. The same state the participant rows use — one
  // person's dial is one person's dial wherever it is turned.
  //
  // By person, not by connection: somebody on a phone and a laptop is one row
  // on the card, so muting them mutes both, and unmuting only happens once
  // every one of their devices is muted (otherwise the click mutes the rest).
  const personAudioRef = useRef<{
    toggle: (userId: string) => void;
    volume: (userId: string, volume: number) => void;
  } | null>(null);
  useEffect(() => {
    personAudioRef.current = {
      toggle: (userId: string) => {
        const ids = state.peers.some((p) => p.id === userId)
          ? [userId]
          : state.peers.filter((p) => (p.userId ?? p.id) === userId).map((p) => p.id);
        if (ids.length === 0) return;
        setMutedPeerIds((prev) => {
          const next = new Set(prev);
          const allMuted = ids.every((id) => next.has(id));
          for (const id of ids) {
            if (allMuted) next.delete(id);
            else next.add(id);
          }
          return next;
        });
      },
      // The participant rows key a volume by userId (see setPeerVolume), and
      // a person on the card is keyed the same way.
      volume: (userId: string, volume: number) => setPeerVolume(userId, volume),
    };
  });
  const stableTogglePersonMute = useCallback((userId: string) => personAudioRef.current?.toggle(userId), []);
  const stableSetPersonVolume = useCallback(
    (userId: string, volume: number) => personAudioRef.current?.volume(userId, volume),
    []
  );
  const inGroup = Boolean(group);
  // Published for every call, not only a group's: the bar that carries a call
  // around the rest of the site offers the same mute button (see
  // components/RoomCallHost's CallDock), and it has no other way to reach it.
  useEffect(() => {
    setGroupVoiceControls({
      isMicOn,
      toggleMic: stableToggleMic,
      togglePersonMute: stableTogglePersonMute,
      setPersonVolume: stableSetPersonVolume,
    });
  }, [isMicOn, stableToggleMic, stableTogglePersonMute, stableSetPersonVolume]);
  useEffect(() => () => setGroupVoiceControls(null), []);

  // In a group, the rooms list outside this room draws the room you are in
  // from here rather than from the server's group-wide update (see
  // lib/groupVoiceSession's GroupVoiceLive): a mute, a camera, deafening
  // yourself all show the moment they happen, and the list gets everybody's
  // mic audio to light up whoever is speaking. Only once joined — until then
  // the server's list is the better answer.
  //
  // Built from the values it reads rather than from visiblePeers, which is a
  // fresh array every render: this is published to another part of the page,
  // and should only be when something in it changed.
  const joinedGroupRoom = inGroup && state.room === handle;
  const groupVoiceLive = useMemo((): GroupVoiceLive | null => {
    if (!joinedGroupRoom) return null;
    // One row per device, numbered "(1)" "(2)" exactly as the room's own
    // participant list numbers them (see lib/displayName) — folding them into
    // one person hid which device was which and tangled their controls.
    const members = state.peers.filter((p) => p.role !== "moderator" && !isObsPeer(p));
    const counts = countDevicesByOwner([...members, { userId: state.selfUserId ?? undefined }]);
    const people: GroupVoiceLivePerson[] = [];
    const add = (person: GroupVoiceLivePerson) => people.push(person);
    if (state.selfUserId && state.name) {
      const camera = Boolean(localCameraStream);
      add({
        userId: state.selfUserId,
        key: "self",
        name: withDeviceSuffix(state.name, state.selfUserId, state.selfDevice ?? undefined, counts),
        avatarUrl: account?.avatarUrl ?? null,
        mic: isMicOn,
        silenced: selfSilenced,
        deafened: micsMuted,
        camera,
        screen: isSharing && (!camera || Boolean(localStream)),
        micStream: isMicOn ? localMicStream ?? null : null,
      });
    }
    for (const p of members) {
      const camera = p.camera === true;
      add({
        userId: p.userId ?? p.id,
        key: p.id,
        peerId: p.id,
        name: withDeviceSuffix(p.name, p.userId, p.device, counts),
        avatarUrl: p.avatarUrl ?? null,
        mic: p.mic && !isPeerSilenced(p),
        silenced: isPeerSilenced(p),
        deafened: p.micsMuted === true,
        camera,
        screen: p.sharing && (!camera || p.screen === true || (p.files?.length ?? 0) > 0),
        micStream: p.mic ? remoteMicStreams[p.id] ?? null : null,
        // Read exactly as the participant row reads them: deafening yourself
        // shows everybody as muted, and a volume is keyed by the person.
        audio: {
          muted: micsMuted || mutedPeerIds.has(p.id) || isPeerSilenced(p),
          volume: peerVolumes[p.userId ?? p.id] ?? 1,
        },
      });
    }
    return {
      handle,
      people,
      music: state.music ? { playing: state.music.playing } : null,
    };
  }, [
    joinedGroupRoom,
    handle,
    state.selfUserId,
    state.name,
    state.peers,
    state.music,
    account?.avatarUrl,
    isMicOn,
    micsMuted,
    isSharing,
    localStream,
    localCameraStream,
    localMicStream,
    remoteMicStreams,
    mutedPeerIds,
    peerVolumes,
    silencedIds,
  ]);
  useEffect(() => {
    setGroupVoiceLive(groupVoiceLive);
  }, [groupVoiceLive]);
  useEffect(() => () => setGroupVoiceLive(null), []);

  // The rooms list's "ao vivo" badge: put that person's transmission on the
  // stage (see lib/groupVoiceSession's requestGroupVoiceFocus). Their tile
  // usually does not exist yet when the request lands — the room is still
  // joining, or the stream still connecting — so it stays pending until it
  // does, and is resolved against the tiles further down (see pendingFocus
  // there). `handled` is which request that already happened for, so each
  // click focuses once and the viewer is free to focus something else after.
  const focusRequest = useGroupVoiceFocusRequest();
  const [handledFocusRequestId, setHandledFocusRequestId] = useState(0);
  // Which request has waited long enough to settle for whatever of that person
  // is on screen, rather than for the transmission it prefers (the screen over
  // the camera) — see FOCUS_REQUEST_SETTLE_MS.
  const [settledFocusRequestId, setSettledFocusRequestId] = useState(0);
  const pendingFocus =
    joinedGroupRoom &&
    focusRequest &&
    focusRequest.handle === handle &&
    focusRequest.id !== handledFocusRequestId
      ? focusRequest
      : null;
  const pendingFocusId = pendingFocus?.id ?? null;
  useEffect(() => {
    if (pendingFocusId === null) return;
    const timer = setTimeout(() => setSettledFocusRequestId(pendingFocusId), FOCUS_REQUEST_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [pendingFocusId]);

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
    if (target.kind === "camera2") {
      return target.ownerId === SELF_TILE_OWNER
        ? !dualCamera.localStream
        : !(target.ownerId in dualCamera.remoteStreams);
    }
    if (target.kind === "screen-extra") {
      const separator = target.ownerId.indexOf(":");
      const slot = target.ownerId.slice(0, separator);
      const owner = target.ownerId.slice(separator + 1);
      if (!isExtraScreenSlot(slot)) return true;
      return owner === SELF_TILE_OWNER
        ? !extraScreens[slot].localStream
        : !(owner in extraScreens[slot].remoteStreams);
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
    extraScreens,
    dualCamera,
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
  // In a group's voice room, our own switches — our roles may give us what
  // the room's (@everyone's) do not. Never the theme, which is the room's.
  const myPermissions = state.myRoomPermissions;
  function canUseRoomPermission(key: RoomPermissionKey): boolean {
    const own = key !== "theme" && myPermissions ? myPermissions[key] : state.roomPermissions[key];
    return own || isRoomManager;
  }
  // Repainting the room is two questions at once, and they are kept apart
  // because the button says something different about each: a plan (Pro Max, a
  // fact about the account) and the room's own switch (which managers are
  // never subject to, like every other one). The server checks both again —
  // see its "room-theme-set".
  const hasThemePlan = hasFeature("room_theme_set", account?.features ?? []);

  // The premium button — which of its three offers, decided in one place with
  // the group bar's copy (see components/RoomProOffer).
  const proButton = getRoomProOffer(
    account?.flags ?? [],
    translate,
    () => void openPopup("gift_plan", { data: {} }),
    proUltraOnSale
  );
  const roomAllowsTheme = canUseRoomPermission("theme");
  const canSetRoomTheme = hasThemePlan && roomAllowsTheme;
  // Populated only for the ones this viewer is actually blocked on, so a
  // control can use `?? undefined` and get its ordinary label back.
  function roomBlockReason(key: RoomPermissionKey, what: string): string | null {
    return canUseRoomPermission(key) ? null : translate("watch.watchRoom.youDoNotHavePermissionTo", { what });
  }
  // Only public rooms are on the map at all (see the server's
  // "room-location-set" and its /rooms listing, which filters private rooms
  // out), so placing a private one is refused rather than quietly kept as
  // state nobody can see.
  // A group's room belongs to its group's members and is on no map either.
  const privateRoomCannotBeMapped = isPrivateRoomHandle(handle) || Boolean(group);
  const roomLocationTooltip = privateRoomCannotBeMapped
    ? translate("watch.watchRoom.onlyPublicRoomsCanSetA")
    : isRoomManager
      ? translate("watch.watchRoom.chooseWhereThisRoomSitsOn")
      : translate("watch.watchRoom.seeWhereThisRoomSitsOn");
  const micBlockedReason = selfSilenced
    ? translate("watch.watchRoom.adminMutedYou")
    : roomBlockReason("mic", "o microfone");
  const screenBlockedReason = roomBlockReason("screen", "o compartilhamento de tela");
  const cameraBlockedReason = roomBlockReason("camera", translate("watch.watchRoom.theCamera"));
  const videoSourceBlockedReason = roomBlockReason("videoSource", translate("watch.watchRoom.addVideoSources"));
  const chatBlockedReason = roomBlockReason("chat", "o chat");
  const gifBlockedReason = roomBlockReason("gif", translate("watch.watchRoom.sendingGifs"));
  const imageBlockedReason = roomBlockReason("image", "o envio de imagens e arquivos");

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
  // Going through the mic's toggle (rather than some quieter stop) also clears the
  // stored "mic starts on" preference, which is what stops this from
  // repeating the whole start-then-refuse round trip on every join into a
  // room that doesn't allow it. The cost is that the preference is genuinely
  // forgotten, not just suspended for this room — turning the mic back on
  // anywhere sets it again.
  useEffect(() => {
    // The device's own toggle: this only ever closes the mic, so the
    // undeafen rule in toggleMic has nothing to do here.
    // A manager silencing us closes it the same way — see selfSilenced.
    if (isMicOn && (selfSilenced || !canUseRoomPermission("mic"))) toggleMicDevice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMicOn, isRoomManager, state.roomPermissions.mic, myPermissions?.mic, selfSilenced]);

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

  // "Criar tema" on the themes page lands here — an ordinary room, with the
  // editor already open on it.
  //
  // The editor previews onto whatever is behind it, so it needs a room to be
  // any use; the themes page has no room, so the button brings you to one and
  // says so in the address (see themeCreationRoomLink). Nothing about this
  // room is special otherwise.
  //
  // Waits for the socket rather than opening on mount: the preview repaints
  // the page the room is drawing, and starting that before the room has drawn
  // itself means colouring an empty screen.
  const themeEditorShown = useRef(false);
  useEffect(() => {
    if (state.status !== "open" || themeEditorShown.current) return;
    if (!wantsThemeEditor(window.location.search)) return;
    themeEditorShown.current = true;
    // Taken back out of the address bar straight away. This is a real room
    // people share, and the link copied out of that bar should be the room —
    // not an instruction to open an editor on somebody else's screen.
    const url = new URL(window.location.href);
    url.searchParams.delete(THEME_EDITOR_PARAM);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    // Only for somebody who can actually save one. A guest or a free account
    // that followed a shared link is simply in a room, which is the truth of
    // where they are — better than an editor whose save will be refused.
    if (!hasFeature("room_theme", account?.features ?? []) || isThemeBanned(account?.flags)) {
      return;
    }
    openPopup("theme_editor", { data: {} });
  }, [state.status, account, openPopup]);

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
  }, [localStream, isRoomManager, state.roomPermissions.screen, myPermissions?.screen]);

  useEffect(() => {
    if (localCameraStream && !canUseRoomPermission("camera")) stopCameraShare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localCameraStream, isRoomManager, state.roomPermissions.camera, myPermissions?.camera]);

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

  // Out of guest broadcast time. The server has already stopped counting this
  // client as sharing; what's left is to actually let go of the capture here,
  // which is the half that frees the camera/screen and takes the browser's
  // "you are sharing" bar down. Without it the person would be left staring
  // at a picker that says they're live to a room that can no longer see them.
  //
  // Keyed on the counter, and unconditional rather than checking `isSharing`
  // first: the two channels stop independently, and a stale render of either
  // flag is not a reason to leave a capture open. Both stops are no-ops when
  // nothing is running, which is exactly the "turned away before starting"
  // case.
  useEffect(() => {
    if (!state.guestBroadcastLimit) return;
    stopShare();
    stopCameraShare();
    trackEvent("guest_broadcast_limit_reached");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.guestBroadcastLimitSeq]);

  // They took the offer. The notice was a question, registering is the
  // answer, and leaving it sitting behind the account dialog for them to
  // dismiss afterwards would be asking it twice.
  useEffect(() => {
    if (state.account) signalingClient.clearGuestBroadcastLimit();
  }, [state.account]);

  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [obsModalUrl, setObsModalUrl] = useState<string | null>(null);

  // Active OBS Browser Source streams tracked in this room
  const [activeObsSignals, setActiveObsSignals] = useState<
    Map<string, { target: string; lastSeen: number }>
  >(new Map());

  useEffect(() => {
    const unsub = signalingClient.onSignal((from, data) => {
      if (
        data &&
        typeof data === "object" &&
        (data as Record<string, unknown>).type === "obs-stream-active" &&
        typeof (data as Record<string, unknown>).target === "string"
      ) {
        const target = (data as Record<string, unknown>).target as string;
        setActiveObsSignals((prev) => {
          const next = new Map(prev);
          next.set(from, { target, lastSeen: Date.now() });
          return next;
        });
      }
    });
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveObsSignals((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        const livePeerIds = new Set(state.peers.map((p) => p.id));
        for (const [peerId, entry] of next) {
          if (!livePeerIds.has(peerId) || now - entry.lastSeen > 30000) {
            next.delete(peerId);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [state.peers]);

  const obsActiveTargets = useMemo(() => {
    const targets = new Set<string>();
    for (const entry of activeObsSignals.values()) {
      targets.add(entry.target);
    }
    for (const peer of state.peers) {
      if (isObsPeer(peer) && peer.obsTarget) {
        targets.add(peer.obsTarget);
      }
    }
    return targets;
  }, [activeObsSignals, state.peers]);

  const isTargetObsActive = useCallback(
    (tileIdentifier: string) => {
      if (obsActiveTargets.has(tileIdentifier)) return true;
      if (tileIdentifier.endsWith(`:${SELF_TILE_OWNER}`)) {
        const prefix = tileIdentifier.slice(0, -SELF_TILE_OWNER.length);
        if (state.selfId && obsActiveTargets.has(prefix + state.selfId)) return true;
        if (state.selfUserId && obsActiveTargets.has(prefix + state.selfUserId)) return true;
      }
      for (const target of obsActiveTargets) {
        if (target.endsWith(tileIdentifier) || tileIdentifier.endsWith(target)) return true;
      }
      return false;
    },
    [obsActiveTargets, state.selfId, state.selfUserId]
  );

  const [streamerMode, setStreamerMode] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("golive_streamer_mode") === "true";
    } catch {
      return false;
    }
  });

  // Switching it on opens the tutorial (see StreamerModeModal): the name
  // only says "hides the code", and the OBS links are the other half of it.
  const [streamerModeIntroOpen, setStreamerModeIntroOpen] = useState(false);
  const toggleStreamerMode = useCallback(() => {
    const next = !streamerMode;
    setStreamerMode(next);
    try {
      localStorage.setItem("golive_streamer_mode", String(next));
    } catch {}
    if (next) setStreamerModeIntroOpen(true);
  }, [streamerMode]);

  const canUseStreamerMode = Boolean(isRoomManager && state.account);
  const canUseObsSource = Boolean(canUseStreamerMode && streamerMode);

  useEffect(() => {
    if (state.room) {
      signalingClient.setStreamerMode(streamerMode);
    }
  }, [streamerMode, state.room]);

  const handleObsSource = useCallback(
    async (id: string) => {
      if (!state.account) {
        setAccountModal("create");
        return;
      }
      if (!canUseObsSource || !state.selfUserId) {
        return;
      }
      const authorId = state.selfUserId;
      const authorName = state.account.username || state.name || translate("common.administrator");
      let exportId = id;
      if (id.endsWith(`:${SELF_TILE_OWNER}`)) {
        const selfIdentifier = state.selfUserId ?? state.selfId;
        if (selfIdentifier) {
          exportId = id.slice(0, -SELF_TILE_OWNER.length) + selfIdentifier;
        }
      }
      const token = await createObsSecurityToken(handle, exportId, authorId, authorName);
      const url = `${window.location.origin}/stream/${encodeURIComponent(handle)}/${encodeURIComponent(exportId)}?token=${encodeURIComponent(token)}`;
      await copyText(url);
      setObsModalUrl(url);
    },
    [handle, state.account, canUseObsSource, state.selfUserId, state.selfId]
  );
  const [quickShortcutAction, setQuickShortcutAction] = useState<ShortcutAction | null>(null);
  // The tile the clip/record shortcuts act on — hyperfocus, else "Focar",
  // else the only tile there is. Worked out further down, once the tiles are.
  const shortcutTileIdRef = useRef<string | null>(null);

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
      clipTile: () => {
        if (!clipsMode.active || !shortcutTileIdRef.current) return;
        if (sendTileCommand(shortcutTileIdRef.current, "clip")) markFeatureUsed("shortcut-clipTile");
      },
      toggleRecordTile: () => {
        if (!recordingMode.active || !shortcutTileIdRef.current) return;
        if (sendTileCommand(shortcutTileIdRef.current, "toggleRecord")) markFeatureUsed("shortcut-toggleRecordTile");
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
        setSwitchError(translate("common.theNameCanHaveAtMost", { MAX_PRIVATE_ROOM_NAME_LENGTH }));
        return;
      }
      fullHandle = toPrivateRoomHandle(trimmed, generateRoomCode());
    } else {
      fullHandle = toRoomHandle(trimmed, false);
    }
    if (!HANDLE_RE.test(fullHandle)) {
      setSwitchError(translate("common.use1To32LettersNumbers"));
      return;
    }
    setSwitching(false);
    setSwitchInput("");
    setSwitchError(null);
    trackEvent("room_switch");
    router.push(`/watch/${fullHandle}`);
  }

  // The room turned into a group (see the "Turning the room into a group"
  // card further down): go to its voice room — the call goes on there (the
  // group's shell joins it, which ends this one; see GroupAppShell). Or, for
  // somebody the server could not take along, say why. Up here, above the
  // early returns, so it runs whatever this render is showing. Once per event:
  // openPopup is a new function on every render.
  const roomConverted = state.roomConverted;
  // ── The people, derived once per change ──
  //
  // Up here, above the early returns, because they are memoised: this room
  // re-renders on anything in the call, and these used to be rebuilt every
  // time — which also handed every participant row "new" props, so the rows'
  // memo (see ParticipantRow) could never hold.
  //
  // Moderator "ghost" peers (see server/signaling.ts's admin-join) ride the
  // same peer list so their WebRTC connections get set up transparently,
  // but must never show up to real participants — filtered out here rather
  // than never added, so this is the one place that has to remember it.
  const visiblePeers = useMemo(
    () => state.peers.filter((p) => p.role !== "moderator" && !isObsPeer(p)),
    [state.peers]
  );
  // Built from the peer list *plus this client*, because the peer list never
  // contains us and our own second device has to be numbered like anybody
  // else's. Rebuilt whenever the list changes: the label is a fact about the
  // room right now, so a device leaving un-numbers the one left behind with no
  // message from the server. See lib/displayName.ts.
  const selfUserIdForCounts = state.selfUserId ?? undefined;
  const deviceCounts = useMemo(
    () => countDevicesByOwner([...visiblePeers, { userId: selfUserIdForCounts }]),
    [visiblePeers, selfUserIdForCounts]
  );
  // Three lookups the render used to do by scanning an array per item, which
  // is fine at six people and quadratic at six hundred: the mic fan-out below
  // looked up a peer per stream, the file entries did the same per slot, and
  // every participant row asked whether that person was an admin or had a
  // video source on screen.
  const peersById = useMemo(() => new Map(state.peers.map((p) => [p.id, p])), [state.peers]);
  const adminIds = useMemo(() => new Set(state.roomAdmins.map((a) => a.id)), [state.roomAdmins]);
  const videoSourceOwners = useMemo(
    () => new Set(state.videoSources.map((v) => v.addedById)),
    [state.videoSources]
  );

  // What a participant row calls back into, stable for the life of the room.
  // Each takes the peer's id; the ones that need more than a state setter
  // look the current peer and handlers up at the moment they are used.
  const [memberMenuFor, setMemberMenuFor] = useState<string | null>(null);
  const participantActionsRef = useRef({ peersById, openMemberActions });
  useLayoutEffect(() => {
    participantActionsRef.current = { peersById, openMemberActions };
  });
  // Keyed by connection, so whoever left since is dropped on the way — the set
  // otherwise kept every connection id ever muted for as long as the room was
  // open.
  const toggleParticipantMute = useCallback((peerId: string) => {
    const live = participantActionsRef.current.peersById;
    setMutedPeerIds((prev) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      if (next.has(peerId)) next.delete(peerId);
      else next.add(peerId);
      return next;
    });
  }, []);
  const setParticipantMenuOpen = useCallback((peerId: string, open: boolean) => {
    setMemberMenuFor((current) => (open ? peerId : current === peerId ? null : current));
  }, []);
  const closeParticipantMenu = useCallback(() => setMemberMenuFor(null), []);
  const openParticipantActions = useCallback((peerId: string) => {
    const { peersById: byId, openMemberActions: open } = participantActionsRef.current;
    const peer = byId.get(peerId);
    if (peer) open(peer);
  }, []);

  const handledConversionRef = useRef<RoomConversion | null>(null);
  useEffect(() => {
    if (!roomConverted || handledConversionRef.current === roomConverted) return;
    handledConversionRef.current = roomConverted;
    if (roomConverted.joined) {
      router.push(groupPath(roomConverted.groupId, roomConverted.channelId));
      return;
    }
    void openPopup("generic", {
      data: {
        title: translate("roomToGroup.notJoinedTitle", { name: roomConverted.groupName }),
        message: account ? roomConverted.reason : translate("roomToGroup.notJoinedGuest"),
      },
    });
  }, [roomConverted, router, openPopup, account]);
  // Closed in this visit — the browser's memory of it is read where the card is.
  const [roomToGroupClosed, setRoomToGroupClosed] = useState(false);

  if (!validHandle) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          {translate("watch.watchRoom.thatRoomIsNotValid")}
        </p>
        <Link href="/" className="text-sm font-medium underline underline-offset-4">
          {translate("watch.watchRoom.backToHome")}
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
          {translate("watch.watchRoom.joiningTheRoom")}
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
          {translate("common.thisSessionWasOpenedInAnother")}
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {translate("common.youCanOnlyStayConnectedWith")}
        </p>
        <button
          type="button"
          onClick={() => state.name && signalingClient.register(state.name)}
          className="rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {translate("common.useThisTab")}
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
            ? translate("common.youHaveBeenBannedFromThe", { bannedReason: state.bannedReason })
            : translate("watch.watchRoom.youHaveBeenTemporarilyBannedFrom")}
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {translate("common.ifYouThinkThisIsA")} <a
            href="https://discord.gg/nemtudo"
            target="_blank"
            className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-500 dark:hover:text-blue-400"
          >{translate("common.discordGgNemtudo")}</a>
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
            ? translate("watch.watchRoom.youHaveBeenBannedFromThis")
            : translate("watch.watchRoom.youHaveBeenRemovedFromThis")}
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {!state.roomRemoval.banned && translate("watch.watchRoom.youCanJoinAgainIfYou")}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {!state.roomRemoval.banned && (
            <button
              type="button"
              onClick={() => signalingClient.joinRoom(handle)}
              className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {translate("watch.watchRoom.joinAgain")}
            </button>
          )}
          <Link
            href="/rooms"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {translate("watch.watchRoom.seeOtherRooms")}
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
            {translate("watch.watchRoom.youAreConnectedToThisRoom")}
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {devices === 1
              ? translate("watch.watchRoom.joiningHereDoesNotDisconnectThe")
              : translate("watch.watchRoom.joiningHereDoesNotDisconnectThe2", { devices })}{" "}
            {translate("watch.watchRoom.inTheListAndInThe")}
          </p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            {translate("watch.watchRoom.afterjoiningOfMaxdevicesDevices", { afterJoining, maxDevices })}
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => signalingClient.confirmDeviceJoin()}
              className="rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {translate("watch.watchRoom.joinAnyway")}
            </button>
            <button
              type="button"
              onClick={() => signalingClient.dismissDeviceJoin()}
              className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {translate("common.cancel")}
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
        ? { icon: "\u{1F464}", title: translate("watch.watchRoom.thatNameIsAlreadyInUse"), retry: false }
        : kind === "full"
          ? { icon: "\u{1F6AA}", title: translate("watch.watchRoom.thisRoomIsFull"), retry: true }
          : kind === "banned"
            ? { icon: "\u{1F6D1}", title: translate("watch.watchRoom.youHaveBeenBannedFromThis2"), retry: false }
            : kind === "captcha"
              ? { icon: "\u{1F6E1}\uFE0F", title: translate("watch.watchRoom.securityCheck"), retry: true }
              : kind === "device-limit"
                ? // Retryable on purpose, unlike a ban: the fix is on another
                  // screen the person can go and close, and coming back here
                  // to press a button is the whole of what they then have to
                  // do. The message already says how many and what to do.
                  { icon: "\u{1F4BB}", title: translate("watch.watchRoom.tooManyDevicesInThisRoom"), retry: true }
                : { icon: "\u26A0\uFE0F", title: translate("watch.watchRoom.couldNotJoinTheRoom"), retry: true };

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
                {translate("watch.watchRoom.chooseAnotherName")}
              </label>
              <div className="flex gap-2">
                <input
                  id="join-error-name"
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={24}
                  placeholder={translate("common.exMaria")}
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
                <button
                  type="submit"
                  disabled={!nameInput.trim()}
                  className="shrink-0 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  {translate("common.signIn")}
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
                {translate("common.tryAgain")}
              </button>
            )}
            <div className="flex gap-2">
              <Link
                href="/"
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {translate("common.home")}
              </Link>
              <Link
                href="/rooms"
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {translate("watch.watchRoom.otherRooms")}
              </Link>
            </div>
            <a
              href="https://discord.gg/nemtudo"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg px-4 py-2 text-sm font-medium text-blue-600 transition hover:text-blue-700 dark:text-blue-500 dark:hover:text-blue-400"
            >
              {translate("watch.watchRoom.needHelpTalkToSupportOn")}
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
            {translate("common.joinTheRoom")} {privateRoomParts ? privateRoomParts.name : handle}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {appShell
              ? translate("watch.watchRoom.inTheAppYouNeedAn")
              : translate("watch.watchRoom.chooseANameToJoinThis")}
          </p>
          {/* The app has no guest mode — this shell is account-only, so the
              name box here would be a form whose only outcome is an identity
              the app doesn't offer. */}
          {appShell && !creatingAccount && !signingIn ? (
            <div className="mt-8 flex flex-col gap-3">
              {/* Signed in, and the signaling registration was still refused.
                  Without this the screen simply reappeared after a successful
                  login, saying nothing — state.nameError is only rendered by
                  the name form, which is exactly what the app never shows. */}
              {account && state.nameError && (
                <div className="flex flex-col items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                  <p className="text-sm text-red-500">{state.nameError}</p>
                  <button
                    type="button"
                    onClick={() => void retryIdentity()}
                    className="text-sm font-medium text-zinc-500 underline underline-offset-2 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    {translate("common.tryAgain")}
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setCreatingAccount(true)}
                className="rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {translate("common.createAnAccount")}
              </button>
              <button
                type="button"
                onClick={() => setSigningIn(true)}
                className="text-sm font-medium text-zinc-500 underline underline-offset-2 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                {translate("common.iAlreadyHaveAnAccount")}
              </button>
            </div>
          ) : signingIn ? (
            <LoginForm
              onCancel={() => setSigningIn(false)}
              onSuccess={() => setSigningIn(false)}
              onSwitchToCreate={() => {
                setSigningIn(false);
                setCreatingAccount(true);
              }}
            />
          ) : creatingAccount ? (
            <CreateAccountForm
              initialDisplayName={nameInput}
              onCancel={() => setCreatingAccount(false)}
              onSuccess={() => setCreatingAccount(false)}
            />
          ) : (
            <form onSubmit={handleNameSubmit} className="mt-8 flex flex-col gap-3">
              <label htmlFor="name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {translate("common.yourName")}
              </label>
              <div className="flex gap-2">
                <input
                  id="name"
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={24}
                  placeholder={translate("common.exMaria")}
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
                <button
                  type="submit"
                  disabled={!nameInput.trim()}
                  className="shrink-0 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  {translate("common.joinTheRoom")}
                </button>
              </div>
              {state.nameError && <p className="text-sm text-red-500">{state.nameError}</p>}
              <button
                type="button"
                onClick={() => setCreatingAccount(true)}
                className="rounded-lg border border-zinc-300 px-4 py-2.5 font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {translate("common.createAnAccount")}
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
          {translate("watch.watchRoom.joiningTheRoom")}
        </p>
      </>
    );
  }

  // Moderator "ghost" peers (see server/signaling.ts's admin-join) ride the
  // same peer list so their WebRTC connections get set up transparently,
  // but must never show up to real participants — filtered out here rather
  // than never added, so this is the one place that has to remember it.
  // (visiblePeers and deviceCounts are derived above the early returns — see
  // "The people, derived once per change".)
  const peerCount = visiblePeers.length + (state.name ? 1 : 0);
  // Three lookups the render used to do by scanning an array per item, which
  // is fine at six people and quadratic at six hundred: the mic fan-out below
  // looked up a peer per stream, the file entries did the same per slot, and
  // every participant row asked whether that person was an admin or had a
  // video source on screen.
  // (All three are memoised above the early returns, with the people.)
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
      const peer = peersById.get(peerId) ?? null;
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
  // "Várias telas": everybody's extra screens, one tile each.
  const remoteExtraScreenEntries = EXTRA_SCREEN_SLOTS.flatMap((slot) =>
    Object.entries(extraScreens[slot].remoteStreams).map(([peerId, stream]) => ({ slot, peerId, stream }))
  );
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
  // ...and our own previews only while they have not been hidden (see
  // ownPreviewHidden). Hiding one clears any focus on it first, see
  // hideOwnPreview.
  const localScreenVisible =
    !ownPreviewHidden &&
    (!hyperfocusTarget ||
      (hyperfocusTarget.kind === "screen" && hyperfocusTarget.ownerId === SELF_TILE_OWNER));
  const localCameraVisible =
    !ownPreviewHidden &&
    (!hyperfocusTarget ||
      (hyperfocusTarget.kind === "camera" && hyperfocusTarget.ownerId === SELF_TILE_OWNER));
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
  // The second lens of everybody doing front and rear at once.
  const remoteCamera2Entries = Object.entries(dualCamera.remoteStreams);
  const visibleCamera2Entries = hyperfocusTarget
    ? hyperfocusTarget.kind === "camera2"
      ? remoteCamera2Entries.filter(([peerId]) => peerId === hyperfocusTarget.ownerId)
      : []
    : remoteCamera2Entries;
  const localCamera2Visible =
    Boolean(dualCamera.localStream) &&
    !ownPreviewHidden &&
    (!hyperfocusTarget ||
      (hyperfocusTarget.kind === "camera2" && hyperfocusTarget.ownerId === SELF_TILE_OWNER));
  const visibleExtraScreenEntries = hyperfocusTarget
    ? hyperfocusTarget.kind === "screen-extra"
      ? remoteExtraScreenEntries.filter(
          ({ slot, peerId }) => `${slot}:${peerId}` === hyperfocusTarget.ownerId
        )
      : []
    : remoteExtraScreenEntries;
  const localExtraScreenSlots = EXTRA_SCREEN_SLOTS.filter(
    (slot) =>
      extraScreens[slot].localStream &&
      !ownPreviewHidden &&
      (!hyperfocusTarget ||
        (hyperfocusTarget.kind === "screen-extra" &&
          hyperfocusTarget.ownerId === `${slot}:${SELF_TILE_OWNER}`))
  );
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
  const nextCameraLabel = nextCamera ? translate("watch.watchRoom.switchToLabel", { label: nextCamera.label }) : translate("watch.watchRoom.switchCamera");
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
  // Front and rear at once (see useRoomMedia's camera2) — part of "Várias telas".
  // Gone for good on a device that already showed it cannot (dualCameraSupported).
  const showDualCameraButton =
    canSwitchCamera && multiScreenMode.active && Boolean(localCameraStream) && dualCameraSupported;
  const switchCameraLabel = flipsByFacing
    ? cameraFacing === "environment"
      ? translate("watch.watchRoom.useTheFrontCamera")
      : translate("watch.watchRoom.useTheRearCamera")
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
    ? translate("watch.watchRoom.onlyTheRoomSOwnerAnd")
    : !state.account
      ? translate("watch.watchRoom.useAnAccountToPlayMusic")
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
  function replaceMusicWithYouTube(url: string, controlMode: MusicControlMode) {
    for (const slot of localMusicSlots) fileChannels[slot].stop();
    signalingClient.setMusicSource("youtube", url, controlMode);
  }

  // Uma playlist do Spotify, já resolvida em faixas do YouTube (ver
  // lib/musicImportApi): vira a fila da sala de uma vez.
  function replaceMusicWithTracks(
    tracks: { videoId: string; title?: string }[],
    controlMode: MusicControlMode
  ) {
    for (const slot of localMusicSlots) fileChannels[slot].stop();
    signalingClient.setMusicQueue(tracks, controlMode);
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
    const volumeKey = peer.userId ?? peer.id;
    return {
      userId: peer.userId,
      name: peer.name,
      isGuest: peer.isGuest,
      verified: hasVerifiedBadge(peer?.flags),
      bot: peer.bot,
      nameColor: peer.nameColor,
      avatarUrl: peer.avatarUrl,
      isOwner: targetIsOwner,
      canKick: allowed,
      canBan: allowed,
      // The owner alone, and never on themselves. Everything else the server
      // insists on — that they are actually in the room, that the room is not
      // already full of admins — is left to it (see "room-admin-add"): those
      // are facts this side would only be guessing at.
      canPromote: isRoomOwner && !targetIsOwner,
      isAdmin: targetIsAdmin,
      // Same two limits as kicking, but in a group "Silenciar membros" is
      // enough — it doesn't take being an administrator (see the server's
      // canSilenceInRoom).
      canSilence:
        (isRoomManager || groupCanMuteMembers) &&
        peer.userId !== state.selfUserId &&
        !targetIsOwner &&
        (!targetIsAdmin || isRoomOwner),
      silenced: isPeerSilenced(peer),
      // Explained only to whoever might otherwise expect the buttons — a
      // regular participant never sees an admin section at all, so there is
      // nothing for them to be told they can't do.
      blockedReason: !isRoomManager || allowed
        ? null
        : targetIsOwner
          ? translate("watch.watchRoom.nobodyCanKickOrBanThe")
          : targetIsAdmin
            ? translate("watch.watchRoom.onlyTheRoomSOwnerCan")
            : translate("watch.watchRoom.onlyTheRoomSOwnerAnd2"),
      onOpenProfile: () => setProfileUserId(peer.userId as string),
      onSendMessage: account && peer.userId !== state.selfUserId ? () => openDirectMessages(peer.userId) : undefined,
      volume: peerVolumes[volumeKey] ?? 1,
      muted: micsMuted || mutedPeerIds.has(peer.id) || isPeerSilenced(peer),
      onVolumeChange: (v) => setPeerVolume(volumeKey, v),
      onToggleMute: () => toggleParticipantMute(peer.id),
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
        onSubmitTracks: replaceMusicWithTracks,
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
  // Whether this peer is currently announcing the channel a placeholder would
  // stand in for.
  //
  // A placeholder is the one kind of tile that deliberately outlives the
  // connection justifying it, so this is the only thing between a stale entry
  // in stoppedPeers/resumingPeers and a tile for a transmission that is not
  // happening. The room's peer list is the right authority: it is server
  // state, rebroadcast to everyone on every change, where the peer-to-peer
  // "stop" that is *supposed* to clear those sets is a single message the
  // socket drops outright whenever it happens to be reconnecting.
  //
  // Deliberately conservative about what counts as "no". `screen` and `camera`
  // are null on a client too old to report the breakdown and undefined on a
  // server that predates the fields, and neither of those means off — only an
  // explicit false does. `sharing` has been sent by every client there has
  // ever been, so it carries the load for the rest.
  const announcesScreen = (p: PeerInfo) => p.sharing && p.screen !== false;
  const announcesCamera = (p: PeerInfo) => p.sharing && p.camera !== false;
  const stoppedEntries = visiblePeers.filter(
    (p) => stoppedPeers.has(p.id) && announcesScreen(p) && !(p.id in remoteStreams)
  );
  // The two placeholder sets are kept mutually exclusive at the source (see
  // useRoomMedia's markResuming and stopWatchingPeer), and this is where it
  // would matter if they ever stopped being: both push a tile under the same
  // tileId, which is also its React key, so a peer in both sets is one peer
  // rendered twice under one key. Stopped wins the tie deliberately — that
  // placeholder carries a "Retomar transmissão" button, and "Retomando..."
  // carries nothing, so if the two ever disagree the actionable one is the
  // one worth showing.
  const resumingEntries = visiblePeers.filter(
    (p) =>
      resumingPeers.has(p.id) &&
      !stoppedPeers.has(p.id) &&
      announcesScreen(p) &&
      !(p.id in remoteStreams)
  );
  const stoppedCameraEntries = visiblePeers.filter(
    (p) => stoppedCameraPeers.has(p.id) && announcesCamera(p) && !(p.id in remoteCameraStreams)
  );
  const resumingCameraEntries = visiblePeers.filter(
    (p) =>
      resumingCameraPeers.has(p.id) &&
      !stoppedCameraPeers.has(p.id) &&
      announcesCamera(p) &&
      !(p.id in remoteCameraStreams)
  );
  // Music slots are skipped: a placeholder stands in for a missing *tile*, and
  // a soundtrack never had one.
  const isMusicSlotOf = (peer: PeerInfo, slot: string) =>
    peer.files?.some((f) => f.channel === slot && f.mode === "music") ?? false;
  // announcesScreen/announcesCamera's counterpart for the file slots, which
  // are full siblings of those two channels and can strand a placeholder the
  // same way. `files` is the same authority the tile caption already reads —
  // undefined only from a server that predates the field, which is unknown
  // rather than "not playing one".
  const announcesFile = (p: PeerInfo, slot: string) =>
    p.sharing && (p.files === undefined || p.files.some((f) => f.channel === slot));
  const stoppedFileEntries = LOCAL_MEDIA_SLOTS.flatMap((slot) =>
    visiblePeers
      .filter(
        (p) =>
          fileChannels[slot].stoppedPeers.has(p.id) &&
          announcesFile(p, slot) &&
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
          !fileChannels[slot].stoppedPeers.has(p.id) &&
          announcesFile(p, slot) &&
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
  // The extra screens are not announced one by one (see useRoomMedia), so the
  // person announcing a screen at all is the best the peer list can say.
  const stoppedExtraScreenEntries = EXTRA_SCREEN_SLOTS.flatMap((slot) =>
    visiblePeers
      .filter(
        (p) =>
          extraScreens[slot].stoppedPeers.has(p.id) &&
          announcesScreen(p) &&
          !(p.id in extraScreens[slot].remoteStreams)
      )
      .map((p) => [slot, p] as const)
  );
  const resumingExtraScreenEntries = EXTRA_SCREEN_SLOTS.flatMap((slot) =>
    visiblePeers
      .filter(
        (p) =>
          extraScreens[slot].resumingPeers.has(p.id) &&
          !extraScreens[slot].stoppedPeers.has(p.id) &&
          announcesScreen(p) &&
          !(p.id in extraScreens[slot].remoteStreams)
      )
      .map((p) => [slot, p] as const)
  );
  const stoppedCamera2Entries = visiblePeers.filter(
    (p) => dualCamera.stoppedPeers.has(p.id) && announcesCamera(p) && !(p.id in dualCamera.remoteStreams)
  );
  const resumingCamera2Entries = visiblePeers.filter(
    (p) =>
      dualCamera.resumingPeers.has(p.id) &&
      !dualCamera.stoppedPeers.has(p.id) &&
      announcesCamera(p) &&
      !(p.id in dualCamera.remoteStreams)
  );
  const visibleStoppedCamera2Entries = activeHyperfocusId ? [] : stoppedCamera2Entries;
  const visibleResumingCamera2Entries = activeHyperfocusId ? [] : resumingCamera2Entries;
  const visibleStoppedExtraScreenEntries = activeHyperfocusId ? [] : stoppedExtraScreenEntries;
  const visibleResumingExtraScreenEntries = activeHyperfocusId ? [] : resumingExtraScreenEntries;
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
    render: (
      fill: boolean,
      compact?: boolean,
      overlayRightOffset?: boolean,
      overlayLeftOffset?: boolean
    ) => ReactNode;
  };
  const tiles: RoomTile[] = [];

  if (localScreenVisible && isSharing && localStream) {
    const id = tileId("screen", SELF_TILE_OWNER);
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset, overlayLeftOffset) => (
        <VideoTile
          tileId={id}
          stream={localStream}
          beingRecorded={recordedChannels.has("screen")}
          // Our own capture keeps running whether or not this preview is on
          // screen, so releasing it would cost a black tile on the way back and
          // save nothing on the machine that matters.
          detachWhenHidden={false}
          label={translate("common.you")}
          accessibleLabel={translate("common.you")}
          badge={shareSource === "camera" ? translate("watch.watchRoom.camera") : "transmitindo"}
          muted
          allowUnmute={false}
          fill={fill}
          compact={compact}
          onStopWatching={extraScreensActive > 0 ? stopShare : hideOwnPreview}
          stopWatchingLabel={translate(extraScreensActive > 0 ? "watch.watchRoom.stopThisScreen" : "watch.watchRoom.hideMyBroadcast")}
          orientation={myOrientations["screen"] ?? null}
          onOrientationChange={(next) => setMyOrientation("screen", next)}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          onObsSource={canUseObsSource ? () => void handleObsSource(id) : undefined}
          isObsActive={isTargetObsActive(id)}
          overlayRightOffset={overlayRightOffset}
          overlayLeftOffset={overlayLeftOffset}
          isMicOn={isMicOn}
          onToggleMic={toggleMic}
          micsMuted={micsMuted}
          onToggleMicsMuted={toggleMicsMuted}
        />
      ),
    });
  }

  // Our second lens (front and rear at once). Its "stop" ends just that one.
  if (localCamera2Visible && dualCamera.localStream) {
    const id = tileId("camera2", SELF_TILE_OWNER);
    const stream = dualCamera.localStream;
    const label = `${translate("common.you")} (${translate("watch.watchRoom.secondCamera")})`;
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset, overlayLeftOffset) => (
        <VideoTile
          tileId={id}
          stream={stream}
          detachWhenHidden={false}
          label={label}
          accessibleLabel={label}
          badge={translate("watch.watchRoom.camera")}
          muted
          allowUnmute={false}
          fill={fill}
          compact={compact}
          onStopWatching={() => dualCamera.stop()}
          stopWatchingLabel={translate("watch.watchRoom.dualCameraOff")}
          orientation={myOrientations["camera2"] ?? null}
          onOrientationChange={(next) => setMyOrientation("camera2", next)}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          overlayRightOffset={overlayRightOffset}
          overlayLeftOffset={overlayLeftOffset}
          isMicOn={isMicOn}
          onToggleMic={toggleMic}
          micsMuted={micsMuted}
          onToggleMicsMuted={toggleMicsMuted}
        />
      ),
    });
  }

  // Our extra screens ("Várias telas"). Their tile's "stop" button ends that
  // one screen — the only per-screen stop there is.
  localExtraScreenSlots.forEach((slot) => {
    const stream = extraScreens[slot].localStream;
    if (!stream) return;
    const id = tileId("screen-extra", `${slot}:${SELF_TILE_OWNER}`);
    const label = `${translate("common.you")} (${EXTRA_SCREEN_SLOTS.indexOf(slot) + 2})`;
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset, overlayLeftOffset) => (
        <VideoTile
          tileId={id}
          stream={stream}
          detachWhenHidden={false}
          label={label}
          accessibleLabel={label}
          badge="transmitindo"
          muted
          allowUnmute={false}
          fill={fill}
          compact={compact}
          onStopWatching={() => extraScreens[slot].stop()}
          orientation={myOrientations[slot] ?? null}
          onOrientationChange={(next) => setMyOrientation(slot, next)}
          stopWatchingLabel={translate("watch.watchRoom.stopThisScreen")}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          overlayRightOffset={overlayRightOffset}
          overlayLeftOffset={overlayLeftOffset}
          isMicOn={isMicOn}
          onToggleMic={toggleMic}
          micsMuted={micsMuted}
          onToggleMicsMuted={toggleMicsMuted}
        />
      ),
    });
  });

  if (localCameraVisible && localCameraStream) {
    const id = tileId("camera", SELF_TILE_OWNER);
    // Our own front camera is previewed mirrored, the way every camera app and
    // call shows it — unmirrored, raising your right hand moves the left side
    // of the picture, which reads as "the camera is flipped". Only this
    // preview: the room still receives the true picture, so text held up to
    // the camera reads the right way round for them. The track's own report
    // is what decides it; the chosen facing is the fallback for a browser that
    // does not fill it in.
    const cameraTrackFacing = localCameraStream.getVideoTracks()[0]?.getSettings().facingMode;
    const mirrorOwnCamera = cameraTrackFacing
      ? cameraTrackFacing === "user"
      : onPhone && cameraFacing === "user";
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset, overlayLeftOffset) => (
        <VideoTile
          tileId={id}
          stream={localCameraStream}
          mirrored={mirrorOwnCamera}
          orientation={myOrientations["camera"] ?? null}
          onOrientationChange={(next) => setMyOrientation("camera", next)}
          beingRecorded={recordedChannels.has("camera")}
          // Our own capture keeps running whether or not this preview is on
          // screen, so releasing it would cost a black tile on the way back and
          // save nothing on the machine that matters.
          detachWhenHidden={false}
          label={translate("common.you")}
          accessibleLabel={translate("common.you")}
          badge={translate("watch.watchRoom.camera")}
          muted
          allowUnmute={false}
          fill={fill}
          compact={compact}
          onStopWatching={hideOwnPreview}
          stopWatchingLabel={translate("watch.watchRoom.hideMyBroadcast")}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          onObsSource={canUseObsSource ? () => void handleObsSource(id) : undefined}
          isObsActive={isTargetObsActive(id)}
          overlayRightOffset={overlayRightOffset}
          overlayLeftOffset={overlayLeftOffset}
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
    const name = raw ? raw.split("/").pop() ?? raw : translate("watch.watchRoom.fileFromTheComputer");
    const id = tileId("file", `${slot}:${SELF_TILE_OWNER}`);
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset, overlayLeftOffset) => (
        <VideoTile
          tileId={id}
          stream={stream}
          beingRecorded={recordedChannels.has(slot)}
          label={name}
          accessibleLabel={name}
          badge={translate("watch.watchRoom.youAdded")}
          badgeClassName={"bg-sky-500/90"}
          transport={
            <LocalMediaControls
              slot={slot}
              canRestrictControl={Boolean(state.account)}
              onRequestAccount={() => setAccountModal("create")}
              onStop={() => fileChannels[slot].stop()}
            />
          }
          onTogglePlay={() => localMediaSources[slot].togglePlay()}
          orientation={myOrientations[slot] ?? null}
          onOrientationChange={(next) => setMyOrientation(slot, next)}
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
          onObsSource={canUseObsSource ? () => void handleObsSource(id) : undefined}
          isObsActive={isTargetObsActive(id)}
          overlayRightOffset={overlayRightOffset}
          overlayLeftOffset={overlayLeftOffset}
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
      render: (fill, compact, overlayRightOffset, overlayLeftOffset) => (
        <VideoTile
          tileId={id}
          stream={stream}
          label={shared?.name ?? `arquivo de ${peer?.name ?? translate("common.someone2")}`}
          accessibleLabel={shared?.name ?? translate("common.file")}
          badge={`${peer?.name ?? translate("common.someone2")} adicionou`}
          badgeClassName={"bg-sky-500/90"}
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
          onVisibilityChange={(visible) => qualityNegotiator.setHidden(slot, peerId, !visible)}
          onStopWatching={() => fileChannels[slot].stopWatchingPeer(peerId)}
          connectionStats={{ channel: slot, originId: peerId }}
          orientation={peerOrientation(peerId, slot)}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          onObsSource={canUseObsSource ? () => void handleObsSource(id) : undefined}
          isObsActive={isTargetObsActive(id)}
          overlayRightOffset={overlayRightOffset}
          overlayLeftOffset={overlayLeftOffset}
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
          onObsSource={canUseObsSource ? () => void handleObsSource(id) : undefined}
          isObsActive={isTargetObsActive(id)}
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
          label={translate("watch.watchRoom.videoFromAddedbyname", { addedByName: videoSource.addedByName })}
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

  // Screen and camera each keep their own dial and their own mute per person
  // (`screen:<id>`, `camera:<id>`), remembered until changed. Both used to share the bare id,
  // so turning somebody's camera down also turned their screen down; that
  // old value is still read as the starting point for either until it is set.
  for (const [peerId, stream] of visibleScreenEntries) {
    const peer = state.peers.find((p) => p.id === peerId);
    const volumeKey = `screen:${peer?.userId ?? peerId}`;
    const id = tileId("screen", peerId);
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset, overlayLeftOffset) => (
        <VideoTile
          tileId={id}
          stream={stream}
          label={
            <DisplayUserName
              name={peer?.name ?? translate("common.someone")}
              isGuest={peer?.isGuest}
              verified={verifiedBadge(peer?.flags)}
              bot={peer?.bot}
              color={peer?.nameColor}
            />
          }
          accessibleLabel={peer?.name ?? translate("common.someone")}
          badge={translate("watch.watchRoom.liveScreen")}
          muted={transmissionMuted[volumeKey] ?? true}
          onMutedChange={(muted) => setTransmissionMuted(volumeKey, muted)}
          volume={transmissionVolumes[volumeKey] ?? transmissionVolumes[peer?.userId ?? peerId] ?? 1}
          onVolumeChange={(volume) => setTransmissionVolume(volumeKey, volume)}
          fill={fill}
          compact={compact}
          onRenderedSizeChange={(w, h) => qualityNegotiator.report("screen", peerId, w, h)}
          onVisibilityChange={(visible) => qualityNegotiator.setHidden("screen", peerId, !visible)}
          onStopWatching={() => stopWatchingPeer(peerId)}
          connectionStats={{ channel: "screen", originId: peerId }}
          orientation={peerOrientation(peerId, "screen")}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          onObsSource={canUseObsSource ? () => void handleObsSource(id) : undefined}
          isObsActive={isTargetObsActive(id)}
          overlayRightOffset={overlayRightOffset}
          overlayLeftOffset={overlayLeftOffset}
          isMicOn={isMicOn}
          onToggleMic={toggleMic}
          micsMuted={micsMuted}
          onToggleMicsMuted={toggleMicsMuted}
        />
      ),
    });
  }

  // Everybody else's second lens. Silent: the mic is its own channel.
  for (const [peerId, stream] of visibleCamera2Entries) {
    const peer = state.peers.find((p) => p.id === peerId);
    const id = tileId("camera2", peerId);
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset, overlayLeftOffset) => (
        <VideoTile
          tileId={id}
          stream={stream}
          label={
            <span className="inline-flex items-center gap-1">
              <DisplayUserName
                name={peer?.name ?? translate("common.someone")}
                isGuest={peer?.isGuest}
                verified={verifiedBadge(peer?.flags)}
                bot={peer?.bot}
                color={peer?.nameColor}
              />
              <span>({translate("watch.watchRoom.secondCamera")})</span>
            </span>
          }
          accessibleLabel={`${peer?.name ?? translate("common.someone")} (${translate("watch.watchRoom.secondCamera")})`}
          badge={translate("watch.watchRoom.liveCamera")}
          muted
          allowUnmute={false}
          fill={fill}
          compact={compact}
          onRenderedSizeChange={(w, h) => qualityNegotiator.report("camera2", peerId, w, h)}
          onVisibilityChange={(visible) => qualityNegotiator.setHidden("camera2", peerId, !visible)}
          onStopWatching={() => dualCamera.stopWatchingPeer(peerId)}
          connectionStats={{ channel: "camera2", originId: peerId }}
          orientation={peerOrientation(peerId, "camera2")}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          overlayRightOffset={overlayRightOffset}
          overlayLeftOffset={overlayLeftOffset}
          isMicOn={isMicOn}
          onToggleMic={toggleMic}
          micsMuted={micsMuted}
          onToggleMicsMuted={toggleMicsMuted}
        />
      ),
    });
  }

  // Everybody else's extra screens. Silent: the first screen carries the
  // system audio (see useExtraScreenChannel).
  for (const { slot, peerId, stream } of visibleExtraScreenEntries) {
    const peer = state.peers.find((p) => p.id === peerId);
    const id = tileId("screen-extra", `${slot}:${peerId}`);
    const number = EXTRA_SCREEN_SLOTS.indexOf(slot) + 2;
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset, overlayLeftOffset) => (
        <VideoTile
          tileId={id}
          stream={stream}
          label={
            <span className="inline-flex items-center gap-1">
              <DisplayUserName
                name={peer?.name ?? translate("common.someone")}
                isGuest={peer?.isGuest}
                verified={verifiedBadge(peer?.flags)}
                bot={peer?.bot}
                color={peer?.nameColor}
              />
              <span>({number})</span>
            </span>
          }
          accessibleLabel={`${peer?.name ?? translate("common.someone")} (${number})`}
          badge={translate("watch.watchRoom.liveScreen")}
          muted
          allowUnmute={false}
          fill={fill}
          compact={compact}
          onRenderedSizeChange={(w, h) => qualityNegotiator.report(slot, peerId, w, h)}
          onVisibilityChange={(visible) => qualityNegotiator.setHidden(slot, peerId, !visible)}
          onStopWatching={() => extraScreens[slot].stopWatchingPeer(peerId)}
          connectionStats={{ channel: slot, originId: peerId }}
          orientation={peerOrientation(peerId, slot)}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          overlayRightOffset={overlayRightOffset}
          overlayLeftOffset={overlayLeftOffset}
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
    const volumeKey = `camera:${peer?.userId ?? peerId}`;
    const id = tileId("camera", peerId);
    tiles.push({
      id,
      render: (fill, compact, overlayRightOffset, overlayLeftOffset) => (
        <VideoTile
          tileId={id}
          stream={stream}
          label={
            <DisplayUserName
              name={peer?.name ?? translate("common.someone")}
              isGuest={peer?.isGuest}
              verified={verifiedBadge(peer?.flags)}
              bot={peer?.bot}
              color={peer?.nameColor}
            />
          }
          accessibleLabel={peer?.name ?? translate("common.someone")}
          badge={translate("watch.watchRoom.liveCamera")}
          muted={transmissionMuted[volumeKey] ?? true}
          onMutedChange={(muted) => setTransmissionMuted(volumeKey, muted)}
          volume={transmissionVolumes[volumeKey] ?? transmissionVolumes[peer?.userId ?? peerId] ?? 1}
          onVolumeChange={(volume) => setTransmissionVolume(volumeKey, volume)}
          fill={fill}
          compact={compact}
          onRenderedSizeChange={(w, h) => qualityNegotiator.report("camera", peerId, w, h)}
          onVisibilityChange={(visible) => qualityNegotiator.setHidden("camera", peerId, !visible)}
          onStopWatching={() => stopWatchingCameraPeer(peerId)}
          connectionStats={{ channel: "camera", originId: peerId }}
          orientation={peerOrientation(peerId, "camera")}
          onDoubleClick={doubleClickFocus ? () => toggleSpotlight(id) : undefined}
          onFocus={() => toggleSpotlight(id)}
          isSpotlighted={spotlightId === id}
          onHyperfocus={() => toggleHyperfocus(id)}
          onNativePip={(ratio) => void enterNativePip(id, ratio)}
          isHyperfocused={activeHyperfocusId === id}
          hasAccount={Boolean(state.account)}
          onObsSource={canUseObsSource ? () => void handleObsSource(id) : undefined}
          isObsActive={isTargetObsActive(id)}
          overlayRightOffset={overlayRightOffset}
          overlayLeftOffset={overlayLeftOffset}
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
          label={<DisplayUserName name={peer.name} isGuest={peer.isGuest} bot={peer.bot} />}
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

  for (const peer of visibleStoppedCamera2Entries) {
    tiles.push({
      id: tileId("camera2", peer.id),
      render: (fill) => (
        <StoppedPeerTile
          label={<DisplayUserName name={peer.name} isGuest={peer.isGuest} bot={peer.bot} />}
          fill={fill}
          onResume={() => dualCamera.resumeWatchingPeer(peer.id)}
        />
      ),
    });
  }

  for (const peer of visibleResumingCamera2Entries) {
    tiles.push({
      id: tileId("camera2", peer.id),
      render: (fill) => <ResumingPeerTile fill={fill} />,
    });
  }

  for (const [slot, peer] of visibleStoppedExtraScreenEntries) {
    tiles.push({
      id: tileId("screen-extra", `${slot}:${peer.id}`),
      render: (fill) => (
        <StoppedPeerTile
          label={<DisplayUserName name={peer.name} isGuest={peer.isGuest} bot={peer.bot} />}
          fill={fill}
          onResume={() => extraScreens[slot].resumeWatchingPeer(peer.id)}
        />
      ),
    });
  }

  for (const [slot, peer] of visibleResumingExtraScreenEntries) {
    tiles.push({
      id: tileId("screen-extra", `${slot}:${peer.id}`),
      render: (fill) => <ResumingPeerTile fill={fill} />,
    });
  }

  for (const peer of visibleStoppedCameraEntries) {
    tiles.push({
      id: tileId("camera", peer.id),
      render: (fill) => (
        <StoppedPeerTile
          label={<DisplayUserName name={peer.name} isGuest={peer.isGuest} bot={peer.bot} />}
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
          label={<DisplayUserName name={peer.name} isGuest={peer.isGuest} bot={peer.bot} />}
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

  // The rooms list's focus request (see focusRequest up top), resolved now
  // that every tile is known. Adjusted during render, React's pattern for
  // state that follows from other state: the handled id changes with it, so
  // it runs once per request, and the next render already draws the stage.
  if (pendingFocus) {
    // Every tile that is this person: our own when it is us, and each device
    // they are in the room on, in FOCUS_KIND_ORDER.
    const devices = state.peers.filter((p) => (p.userId ?? p.id) === pendingFocus.userId);
    const owners = [
      ...(pendingFocus.userId === state.selfUserId ? [SELF_TILE_OWNER] : []),
      ...devices.map((p) => p.id),
    ];
    const candidates = FOCUS_KIND_ORDER.flatMap((kind) =>
      owners.flatMap((owner): { kind: (typeof FOCUS_KIND_ORDER)[number]; id: string }[] =>
        kind === "file"
          ? LOCAL_MEDIA_SLOTS.map((slot) => ({ kind, id: tileId("file", `${slot}:${owner}`) }))
          : [{ kind, id: tileId(kind, owner) }]
      )
    );
    if (activeHyperfocusId) {
      // Hyperfocus hides every other tile and outranks "Focar", so it has to
      // go first — unless it is already on this very person.
      if (candidates.some((c) => c.id === activeHyperfocusId)) setHandledFocusRequestId(pendingFocus.id);
      else setHyperfocusId(null);
    } else {
      // What they say they are transmitting, which is known before the
      // streams arrive: the tile worth waiting for. Our own tiles need no
      // waiting, they are local.
      const announces = (kind: (typeof FOCUS_KIND_ORDER)[number]) =>
        devices.some((p) =>
          kind === "screen"
            ? p.screen === true ||
              (p.screen == null && p.sharing && p.camera !== true && !(p.files?.length ?? 0))
            : kind === "file"
              ? (p.files ?? []).some((f) => f.mode !== "music")
              : p.camera === true
        );
      const preferred = FOCUS_KIND_ORDER.findIndex(announces);
      const tileIds = new Set(tiles.map((tile) => tile.id));
      const best = candidates.find((c) => tileIds.has(c.id));
      if (
        best &&
        (preferred < 0 ||
          FOCUS_KIND_ORDER.indexOf(best.kind) <= preferred ||
          settledFocusRequestId === pendingFocus.id)
      ) {
        setSpotlightId(best.id);
        setHandledFocusRequestId(pendingFocus.id);
      }
    }
  }

  const realMediaTileCount = tiles.length;
  const isFocusMode = spotlightId !== null && tiles.some((t) => t.id === spotlightId);
  shortcutTileIdRef.current =
    activeHyperfocusId ?? (isFocusMode ? spotlightId : null) ?? (tiles.length === 1 ? tiles[0].id : null);

  // When the left sidebar (participants and ad card) is collapsed and not in hyperfocus:
  // - In focus mode (spotlight): ad is shown in the thumbnail strip
  // - In normal grid mode: ad is ONLY shown when there are 3 or more media sources transmitting
  // In a group the same goes for the group's rooms column, which is where its ad lives.
  if (
    leftSidebarCollapsed &&
    isWideLayout &&
    !activeHyperfocusId &&
    (isFocusMode || realMediaTileCount >= 3) &&
    // A call is a pane inside a conversation, not a page: there is no room in
    // it for an advertisement, and the conversation's page carries its own.
    !callLayout &&
    !(group && groupAdHidden)
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

  // ── Where the filmstrip goes, and how much it takes ──
  //
  // The stage is a 16:9 tile drawn to fit, so the *scarcer* of the pane's two
  // dimensions is the one deciding how big it can be — and a strip underneath
  // spends height while a strip down the side spends width. So the strip goes
  // where the pane has room to spare: under a pane taller than 16:9, beside one
  // wider than that.
  //
  // This is what "Focar" used to get wrong on a short pane. The strip was a
  // fixed 112px tall from lg up, keyed off the *window's* width — so in a wide,
  // short box (a call drawn inside a conversation, a window dragged short, both
  // sidebars open) it ate a third of the height the stage was already short of,
  // while the black bars either side of the stage went on being black.
  //
  // Measured rather than a breakpoint, for that same reason: none of the ways
  // this pane ends up short involve crossing one.
  const paneMeasured = videoPaneSize.width > 0 && videoPaneSize.height > 0;
  const stripBeside = paneMeasured && videoPaneSize.width / videoPaneSize.height > 16 / 9;
  // A share of the pane rather than a number of pixels: floored so a thumbnail
  // is still a recognisable picture of somebody, capped so it never grows into
  // a second stage.
  const stripSize = stripBeside
    ? Math.round(Math.min(Math.max(videoPaneSize.width * 0.16, 112), 200))
    : Math.round(Math.min(Math.max(videoPaneSize.height * 0.2, 56), 112));

  // What the corner player can show while the room is off screen (see
  // components/DockedPip, which picks among them). One person's tiles in the
  // order a focus request prefers them — screen, file, camera — everybody
  // else's before ours. Video sources are left out: they are players embedded
  // in the page, not streams a <video> can take.
  const dockedPipSources: DockedPipSource[] = [];
  if (!visible) {
    for (const p of state.peers) {
      const micStream = remoteMicStreams[p.id] ?? null;
      const label = p.name;
      const screen = remoteStreams[p.id];
      if (screen) {
        dockedPipSources.push({ id: tileId("screen", p.id), stream: screen, label, peerId: p.id, micStream, channel: "screen" });
      }
      for (const { slot, peerId, stream, shared } of remoteFileEntries) {
        if (peerId !== p.id) continue;
        dockedPipSources.push({
          id: tileId("file", `${slot}:${p.id}`),
          stream,
          label: shared?.name ?? label,
          peerId: p.id,
          micStream,
          channel: slot,
        });
      }
      const camera = remoteCameraStreams[p.id];
      if (camera) {
        dockedPipSources.push({ id: tileId("camera", p.id), stream: camera, label, peerId: p.id, micStream, channel: "camera" });
      }
    }
    const you = translate("common.you");
    if (isSharing && localStream) {
      dockedPipSources.push({ id: tileId("screen", SELF_TILE_OWNER), stream: localStream, label: you, peerId: null, micStream: null });
    }
    for (const slot of localFileSlots) {
      const stream = fileChannels[slot].localStream;
      if (stream) {
        dockedPipSources.push({ id: tileId("file", `${slot}:${SELF_TILE_OWNER}`), stream, label: you, peerId: null, micStream: null });
      }
    }
    if (localCameraStream) {
      dockedPipSources.push({ id: tileId("camera", SELF_TILE_OWNER), stream: localCameraStream, label: you, peerId: null, micStream: null });
    }
  }

  // Below `sm`, 2 tiles side by side are still each bigger than a single
  // full-width 16:9 tile would end up after the header/aside eat into a
  // phone's height, so they stay stacked — but 3+ was the actual complaint
  // ("não aparece todas, tem que scrollar"): one column per tile meant
  // scrolling through a wall of tiles even though 2-up comfortably fits
  // more of them in view at once.
  const mobileGridCols = tileCount <= 2 ? "grid-cols-1" : "grid-cols-2";
  // From lg up the video pane is a fixed box rather than a page that grows,
  // so the grid is shaped to the box it has: planTileGrid measures the pane
  // and returns the arrangement that makes the tiles largest, which is what
  // decides both how many go across and how wide each one is (see
  // lib/tileGrid.ts for why that beats a lookup on the tile count).
  //
  // Applied as an inline style rather than classes because the answer is a
  // measurement, not one of a handful of breakpoints, and only from lg up
  // (isWideLayout): below that the responsive classes on the grid still
  // decide, and this is `undefined`. Nothing here has to know about "Focar"
  // — that has a layout of its own now instead of a 2x2 span borrowed from
  // this one.
  const tileGridPlan =
    isWideLayout && !isSingleTile
      ? planTileGrid(tileCount, videoPaneSize.width, videoPaneSize.height, TILE_GRID_GAP)
      : null;
  // Still needed by shouldOffsetRight below, which asks "is this tile in the
  // top row" to keep it clear of the floating "mostrar chat" button.
  const tileGridCols = tileGridPlan?.cols ?? (tileCount <= 4 ? 2 : tileCount <= 9 ? 3 : 4);
  // Columns are exactly one tile wide and rows are only as tall as a tile,
  // so the grid ends up the size of its contents and is then centred in the
  // pane. That is what closes the band of dead pane that used to open up
  // between the rows: with `1fr` rows the slack was divided *among* them,
  // under each tile, instead of ending up once around the whole block.
  const tileGridStyle = tileGridPlan
    ? {
      gridTemplateColumns: `repeat(${tileGridPlan.cols}, ${tileGridPlan.tileWidth}px)`,
      gridAutoRows: "auto",
      justifyContent: "center",
      alignContent: "center",
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

  // Takes our own previews off the grid. A focus or hyperfocus on one of them
  // goes with it: a stage built around a tile that is no longer drawn is an
  // empty box, and a hyperfocus on one would leave everybody else hidden with
  // nothing on screen to undo it from.
  const ownPreviewIds = [tileId("screen", SELF_TILE_OWNER), tileId("camera", SELF_TILE_OWNER)];
  function hideOwnPreview() {
    setOwnPreviewHidden(true);
    if (spotlightId && ownPreviewIds.includes(spotlightId)) setSpotlightId(null);
    if (hyperfocusId && ownPreviewIds.includes(hyperfocusId)) setHyperfocusId(null);
  }
  const hasOwnPreview = Boolean((isSharing && localStream) || localCameraStream);
  // The partner-ctr treatment: with nobody transmitting, the ad moves out of
  // the sidebar and into the empty pane, under its "start" buttons — the
  // middle of the screen, at the one moment nothing else is playing there.
  // Not in a group (its ad is the shell's rooms column, see GroupPartnerSlot),
  // not in a call, and not when the pane is empty only because our own
  // previews are hidden (that pane has no buttons to sit under). Never for
  // Pro or above: a subscriber keeps the ad in the sidebar, out of the way.
  const partnerOnStage =
    partnerExperimentOn && !tierAtLeast(accountTierOf(account?.flags), "premium") && nothingToShow && !callLayout && !group && !(ownPreviewHidden && hasOwnPreview);

  // Right-click on the video pane: bring our own previews back, or hide them
  // again. Not over a control (its own click is what that is for), and only
  // while there is something of ours to show or hide.
  function ownPreviewMenu(e: ReactMouseEvent<HTMLElement>) {
    if (!hasOwnPreview) return;
    if ((e.target as Element).closest("button, a, input, textarea, select, iframe, [data-tile-controls]")) return;
    openContextMenu(e, {
      entries: [
        ownPreviewHidden
          ? {
              label: translate("watch.watchRoom.showMyBroadcast"),
              icon: <EyeIcon className="h-4 w-4" />,
              onSelect: () => setOwnPreviewHidden(false),
            }
          : {
              label: translate("watch.watchRoom.hideMyBroadcast"),
              icon: <EyeOffIcon className="h-4 w-4" />,
              onSelect: hideOwnPreview,
            },
      ],
    });
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
    for (const [peerId] of remoteCamera2Entries) {
      if (target?.kind !== "camera2" || target.ownerId !== peerId) dualCamera.stopWatchingPeer(peerId);
    }
    for (const { slot, peerId } of remoteExtraScreenEntries) {
      if (target?.kind !== "screen-extra" || target.ownerId !== `${slot}:${peerId}`) {
        extraScreens[slot].stopWatchingPeer(peerId);
      }
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

  // "Várias telas": the "+" beside the screen button (see ShareControls). Only
  // on a real display capture — a phone has no getDisplayMedia to pick a
  // second surface with. Counts the first screen as one of the items.
  const addScreenControl =
    multiScreenMode.active && screenShareMode === "display" && !isMobileBrowser && !onPhone
      ? {
          count: (localStream ? 1 : 0) + extraScreensActive,
          limit: screenLimit,
          onClick: () => {
            const count = (localStream ? 1 : 0) + extraScreensActive;
            if (count >= screenLimit) {
              trackFeatureEvent(MULTI_SCREEN_EVENTS.limit, { value: screenLimit });
              // The modal rather than the page: leaving would end the call.
              if (screenUpgrade) {
                trackFeatureEvent(MULTI_SCREEN_EVENTS.upgradeClick);
                openProModal(screenUpgrade.planId);
              }
              return;
            }
            trackFeatureEvent(MULTI_SCREEN_EVENTS.add, { value: count + 1 });
            markFeatureUsed("multi-screen-share");
            // The first screen was closed on its own: the "+" brings it back
            // rather than taking another extra slot.
            if (!localStream) void startShare("display");
            else void addExtraScreen();
          },
          tip: multiScreenTip,
          upgrade: screenUpgrade
            ? {
                tier: screenUpgrade.tier,
                limit: screenUpgrade.limit,
                onClick: () => {
                  trackFeatureEvent(MULTI_SCREEN_EVENTS.upgradeClick);
                  openProModal(screenUpgrade.planId);
                },
              }
            : null,
          items: [
            ...(localStream
              ? [{ id: "screen", label: `${translate("watch.watchRoom.screen")} 1`, onStop: stopShare }]
              : []),
            ...EXTRA_SCREEN_SLOTS.filter((slot) => extraScreens[slot].active).map((slot) => ({
              id: slot,
              label: `${translate("watch.watchRoom.screen")} ${EXTRA_SCREEN_SLOTS.indexOf(slot) + 2}`,
              onStop: () => extraScreens[slot].stop(),
            })),
          ],
        }
      : null;
  // The main screen button's "stop": every screen at once. Closing just one
  // is the "+" panel's job (and each tile's).
  const anyScreenSharing = Boolean(localStream) || extraScreensActive > 0;
  function stopAllScreens() {
    stopShare();
    for (const slot of EXTRA_SCREEN_SLOTS) extraScreens[slot].stop();
  }
  // The first extra screen that failed to start, shown like shareError.
  const extraScreenError =
    EXTRA_SCREEN_SLOTS.map((slot) => extraScreens[slot].error).find(Boolean) ?? dualCameraError ?? null;

  // Shared prop bundle for every QualityControls instance on this page (the
  // desktop quick-access popover and the two share-button pickers below) —
  // built once so the three call sites can't quietly drift out of sync.
  const qualityControlsProps = {
    smartQualityEnabled,
    setSmartQualityEnabled,
    nativeVideoOption,
    setNativeVideoOption,
    nativeVideoMethod,
    setNativeVideoMethod,
    screenRestartNeeded,
    restartScreenShare,
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
  // Noise suppression's switch. In the options menu with the rest of the
  // settings, and in the mic's device menu too, under its volume (see
  // mainControls), since the mic is where somebody hearing their own keyboard
  // goes looking.
  // One definition, so the two can never disagree about when it is available.
  const noiseSuppressionToggle = (
    <MenuToggleRow
      label={translate("watch.watchRoom.noiseSuppression")}
      active={noiseSuppressionOn}
      onToggle={toggleNoiseSuppression}
      disabled={isMicOn && !noiseSuppressionAvailable}
      hint={
        isMicOn && !noiseSuppressionAvailable
          ? translate("watch.watchRoom.noiseSuppressionUnavailableWithThisAudio")
          : undefined
      }
      activeIcon={<NoiseSuppressionIcon className="h-4 w-4" />}
      inactiveIcon={<NoiseSuppressionOffIcon className="h-4 w-4" />}
    />
  );

  // "Apertar para falar", the same way: one definition, rendered both in "Mais
  // opções" and in the mic's own panel — the mic button is where somebody
  // wondering why nobody hears them right-clicks first, and the key it waits
  // for is set right under it.
  const pushToTalkToggle = pushToTalk.available && isDesktopApp() && (
    <MenuToggleRow
      label={translate("watch.watchRoom.pushToTalkMode")}
      badge={<NewBadge id={PUSH_TO_TALK_BADGE} />}
      active={pushToTalk.on}
      onToggle={() => setTileExperimentMode("pushToTalk", !pushToTalk.on)}
      // Switched on with no key recorded, the microphone would simply stop
      // being heard with nothing on screen saying why.
      hint={
        pushToTalk.needsKey
          ? translate("watch.watchRoom.pushToTalkNeedsKey")
          : translate("watch.watchRoom.pushToTalkModeHint")
      }
      activeIcon={<MicIcon className="h-4 w-4" />}
      inactiveIcon={<MicIcon className="h-4 w-4 opacity-50" />}
    />
  );

  // The key itself, next to the switch in the mic's panel. Only once the
  // switch is on: a key for a feature that is off is a question nobody asked.
  const pushToTalkKeyRow = pushToTalk.available && isDesktopApp() && pushToTalk.on && (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5">
      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {translate("watch.watchRoom.pushToTalkKey")}
      </span>
      <ShortcutRecorder
        value={pushToTalk.combo}
        onChange={(combo) => {
          setStoredShortcut("pushToTalk", combo);
          // Only when one is actually set: clearing it is the opposite of
          // taking the feature up.
          if (combo) trackPushToTalkKeySet();
        }}
        // The same account gate every other shortcut has (see
        // KeyboardShortcutsModal) — this panel must not be a way around it.
        disabled={!state.account}
        onDisabledClick={() => setAccountModal("create")}
        placeholder={
          state.account
            ? translate("common.clickToRecord")
            : translate("keyboardShortcutsModal.accountRequired")
        }
      />
    </div>
  );

  const menuItems = (
    <>
      {!group && !callLayout && (
        <span
          className={`mb-2 inline-block w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-white sm:hidden ${
            isPrivateRoomHandle(handle) ? "bg-red-600" : "bg-emerald-600"
          }`}
        >
          {isPrivateRoomHandle(handle) ? translate("common.privateRoom") : translate("watch.watchRoom.publicRoom")}
        </span>
      )}

      {/* The room's category and blurb, which sit in the header from lg up
          (see RoomInfoControls there). Skipped entirely for a viewer of a
          room that has neither and who couldn't set one anyway — the
          component renders nothing in that case, and a heading over nothing
          is worse than no heading. */}
      {/* Never in a private room: a category is what puts a room on the public
          list, and a blurb is what it is advertised with — neither means
          anything for a room that is only reachable by its link. */}
      {!isWideLayout &&
        !isPrivateRoomHandle(handle) &&
        !group &&
        (isRoomManager || state.roomDescription || state.roomCategory) && (
        <div className="mb-1">
          <p className="mb-1.5 px-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            {translate("watch.watchRoom.aboutTheRoom")}
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
          has no room for it outside this menu.
          Not in a group (shared by inviting to the group instead), and not in
          a direct call: its room is the two of them, and its link is a way
          for a third person to walk into a private conversation — the same
          rule the desktop copy-link button follows below. */}
      {!group && !callLayout && canShareNatively() && (
        <button
          type="button"
          onClick={() => {
            closeMenu();
            void handleShareLink();
          }}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2.5 text-left text-sm font-semibold text-white transition active:scale-[0.98] sm:hidden"
        >
          <MdShare className="h-4 w-4" />
          {translate("mobile.shareRoom")}
        </button>
      )}

      {!group && !callLayout && (
      <button
        type="button"
        onClick={handleCopyLink}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-sm font-medium transition sm:hidden ${linkCopied
          ? "border-emerald-600 text-emerald-600 dark:border-emerald-500 dark:text-emerald-500"
          : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          }`}
      >
        {linkCopied ? <CheckIcon className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" />}
        {linkCopied
          ? translate("common.linkCopied")
          : canShareNatively()
            ? translate("common.copyLink")
            : translate("watch.watchRoom.shareRoom")}
      </button>
      )}

      {/* The premium offer, which a phone's header has no room for. */}
      {!isDesktopLayout && (
        <button
          type="button"
          onClick={() => {
            closeMenu();
            trackEvent("pro_button_clicked", { offer: proButton.label });
            proButton.onPress();
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <proButton.Icon className={`h-4 w-4 shrink-0 ${proButton.iconClassName}`} />
          {proButton.label}
        </button>
      )}

      <a
        href="https://discord.gg/nemtudo"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg px-2 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:text-red-500 dark:hover:bg-red-950/40"
      >
        {translate("watch.watchRoom.reportABug")}
      </a>

      {/* A keyboard's shortcuts, for the screens that have one. */}
      {isDesktopLayout && (
        <button
          type="button"
          onClick={() => {
            closeMenu();
            setShortcutsModalOpen(true);
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <MdOutlineKeyboard className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
          {translate("watch.watchRoom.keyboardShortcuts")}
        </button>
      )}

      <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />

      {/* Above the toggles rather than among them: it is the only setting in
          here that changes how the whole site looks, and it is three states
          rather than the on/off every MenuToggleRow below is. The same
          control sits in the site header on every page that has one (see
          components/SiteHeader.tsx) — a room has no such header, which is
          exactly why it needs a copy in here. */}
      <div className="mb-1 px-1">
        <p className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{translate("common.theme")}</p>
        <ThemeSegmented />
      </div>

      {/* Directly under the light/dark control, because it is the same
          question one step further out: that one decides how the site looks to
          you, this one decides whether a room is allowed to decide for you.
          Worded as the *permission* rather than as the result — "usar o tema
          da sala" reads as a thing you are turning off, where "sempre usar o
          meu" would read as a second theme picker. */}
      <MenuToggleRow
        label={translate("watch.watchRoom.useTheRoomSTheme")}
        active={!roomThemeOptedOut}
        onToggle={() => setRoomThemeOptedOut(!roomThemeOptedOut)}
        activeIcon={<MdPalette className="h-4 w-4" />}
        inactiveIcon={<MdPalette className="h-4 w-4" />}
        hint={
          roomThemeOptedOut
            ? translate("watch.watchRoom.roomsWillNeverChangeYourTheme")
            : translate("watch.watchRoom.turnItOffToNeverEnd")
        }
      />

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
              {state.music || myMusicSlot ? translate("common.changeTheRoomSMusic") : translate("common.playMusicInTheRoom")}
              <BetaMark />
            </button>
          </Tooltip>

          <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />
        </>
      )}

      {clipsMode.available && (
        <MenuToggleRow
          label={translate("watch.watchRoom.clipsMode")}
          badge={<NewBadge id="room-clips" />}
          active={clipsMode.on}
          onToggle={() => setTileExperimentMode("clips", !clipsMode.on)}
          hint={translate("watch.watchRoom.clipsModeHint")}
          activeIcon={<ClipIcon className="h-4 w-4" />}
          inactiveIcon={<ClipIcon className="h-4 w-4 opacity-50" />}
        />
      )}
      {recordingMode.available && (
        <MenuToggleRow
          label={translate("watch.watchRoom.recordingMode")}
          badge={<NewBadge id="room-recording" />}
          active={recordingMode.on}
          onToggle={() => setTileExperimentMode("recording", !recordingMode.on)}
          hint={translate("watch.watchRoom.recordingModeHint")}
          activeIcon={<RecordIcon className="h-4 w-4" />}
          inactiveIcon={<RecordIcon className="h-4 w-4 opacity-50" />}
        />
      )}
      {orientationMode.available && (
        <MenuToggleRow
          label={translate("watch.watchRoom.orientationMode")}
          badge={<NewBadge id="tile-orientation" />}
          active={orientationMode.on}
          onToggle={() => setTileExperimentMode("orientation", !orientationMode.on)}
          hint={translate("watch.watchRoom.orientationModeHint")}
          activeIcon={<OrientationIcon className="h-4 w-4" />}
          inactiveIcon={<OrientationIcon className="h-4 w-4 opacity-50" />}
        />
      )}
      {multiScreenMode.available && (
        <MenuToggleRow
          label={translate("watch.watchRoom.multiScreenMode")}
          badge={<NewBadge id="multi-screen-share" />}
          active={multiScreenMode.on}
          onToggle={() => setTileExperimentMode("multiScreen", !multiScreenMode.on)}
          hint={translate("watch.watchRoom.multiScreenModeHint", { count: screenLimit })}
          activeIcon={<ScreenIcon className="h-4 w-4" />}
          inactiveIcon={<ScreenIcon className="h-4 w-4 opacity-50" />}
        />
      )}
      <MenuToggleRow
        label={translate("watch.watchRoom.doubleClickToFocus")}
        active={doubleClickFocus}
        onToggle={toggleDoubleClickFocus}
        hint={translate("watch.watchRoom.whenOffFocusingAVideoIs")}
        activeIcon={<FocusIcon className="h-4 w-4" />}
        inactiveIcon={<EyeOffIcon className="h-4 w-4" />}
      />
      <MenuToggleRow
        label={translate("watch.watchRoom.musicOnProfiles")}
        active={profileSongAutoplay}
        onToggle={toggleProfileSongAutoplay}
        hint={translate("watch.watchRoom.whenOffAProfileSMusic")}
        activeIcon={<SpeakerIcon className="h-4 w-4" />}
        inactiveIcon={<SpeakerMuteIcon className="h-4 w-4" />}
      />
      <MenuToggleRow
        label={translate("watch.watchRoom.siteSoundEffects")}
        active={soundEffectsOn}
        onToggle={toggleSoundEffects}
        activeIcon={<SpeakerIcon className="h-4 w-4" />}
        inactiveIcon={<SpeakerMuteIcon className="h-4 w-4" />}
      />
      {noiseSuppressionToggle}
      <MenuToggleRow
        label={translate("watch.watchRoom.joinBroadcastsAutomatically")}
        active={autoJoin}
        onToggle={toggleAutoJoin}
        hint={translate("watch.watchRoom.whenOffANewScreenCamera")}
        activeIcon={<EyeIcon className="h-4 w-4" />}
        inactiveIcon={<EyeOffIcon className="h-4 w-4" />}
      />
      {/* Only outside the desktop app: inside it, asking whether to use the
          app is a question about something already true. Gated on `mounted`
          too, since isDesktopApp() reads a client-only global.

          The stored value doubles as "this browser has the app" — RoomAppGate
          sets it the first time a handoff demonstrably worked, and this row is
          how somebody turns the asking off again, or on if they installed the
          app without ever using the banner. */}
      {mounted && !isDesktopApp() && (
        <MenuToggleRow
          label={translate("watch.watchRoom.askBeforeOpeningRooms")}
          active={openRoomsInApp}
          onToggle={toggleOpenRoomsInApp}
          hint={translate("watch.watchRoom.whenYouOpenARoomLink")}
          activeIcon={<MdOutlineDesktopWindows className="h-4 w-4" />}
          inactiveIcon={<MdOutlineDesktopWindows className="h-4 w-4 opacity-50" />}
        />
      )}
      {/* Pro Max only — see useRoomMedia. Hidden rather than shown locked:
          somebody without the plan has no switch to see, and the stored
          value, if any, already stopped counting. */}
      {forceRelayAllowed && (
      <MenuToggleRow
        label={translate("watch.watchRoom.preventDirectConnections")}
        active={forceRelayIce}
        onToggle={toggleForceRelayIce}
        disabled={!turnConfigured}
        hint={
          turnConfigured
            ? translate("watch.watchRoom.forcesYourConnectionsThroughATurn")
            : translate("watch.watchRoom.unavailableNoTurnServerConfiguredOn")
        }
        activeIcon={<ShieldIcon className="h-4 w-4" />}
        inactiveIcon={<ShieldOffIcon className="h-4 w-4" />}
      />
      )}
      {forceRelayIce && (
        <p className="mb-1 px-2 text-xs text-amber-600 dark:text-amber-500">
          {translate("watch.watchRoom.yourConnectionsAlwaysGoThroughAn")}
        </p>
      )}
      <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />

      <div className="sm:hidden">
        <Tooltip content={translate("watch.watchRoom.broadcastQualityLowerItIfThe")}>
          <button
            type="button"
            onClick={() => setQualityOpen((q) => !q)}
            className="rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {translate("watch.watchRoom.quality")} {shareResolution} · {shareFps}fps
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
            {translate("watch.watchRoom.changeName")}
          </button>
          {renaming && (
            <form
              onSubmit={handleRenameSubmit}
              className="mx-2 mb-1 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                {translate("common.newName")}
              </label>
              <input
                autoFocus
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                maxLength={24}
                placeholder={translate("common.exMaria")}
                className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              />
              {state.nameError && <p className="mt-1 text-xs text-red-500">{state.nameError}</p>}
              <button
                type="submit"
                disabled={!renameInput.trim() || renameInput.trim() === state.name}
                className="mt-2 w-full rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {translate("watch.watchRoom.saveName")}
              </button>
            </form>
          )}
        </>
      )}

      <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />

      {/* At every width now, not just on a phone: it used to have its own
          button in the desktop header, where a once-a-session action was
          taking permanent space from the controls used all call long. */}
      {/* Not in a group: its rooms are one click away in the group's own list.
          Nor in a direct call: it has no other room to switch to — "trocar de
          sala" here would silently drop the call and its `dm` (see
          lib/callSession and components/WatchRoomStage), leaving the other
          person's call hung up with nothing said about it. */}
      <div className={group || callLayout ? "hidden" : undefined}>
        <button
          type="button"
          onClick={() => setSwitching((s) => !s)}
          className="w-full rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {translate("watch.watchRoom.switchRoom")}
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
  // The floating call bar's two sizes (see components/RoomCallHost). Compact is
  // what a call needs every minute — mic, headset, screen, camera and hanging
  // up — and everything else in the row goes through here: left out while the
  // bar is compact, grown in and shrunk back out around its arrow (see the
  // .call-dock-* rules in globals.css). Anywhere but the bar — the room's own
  // header, the group's top bar — it hands the node back untouched.
  const inDock = !visible && !headerSlots?.center;
  const dockCompact = inDock && dockPhase === "compact";
  const dockMotion = !inDock
    ? ""
    : dockPhase === "collapsing"
      ? "call-dock-conceal"
      : "call-dock-reveal";
  function dockExtra(node: ReactNode, innerClassName = "flex items-stretch", outerClassName = ""): ReactNode {
    if (dockCompact || !node) return null;
    if (!dockMotion) return node;
    return (
      <span className={`call-dock-extra ${dockMotion} ${outerClassName}`}>
        <span className={innerClassName}>{node}</span>
      </span>
    );
  }

  // Push to talk turns the mic button into three states instead of two: off
  // (red), on and being heard (green), and on but waiting for the key
  // (amber). Without that third one the button would say "your microphone is
  // on" all call long while nobody could hear a word.
  const micWaitingForKey = pushToTalk.active && isMicOn && !pushToTalk.held;
  const micToneClass = !isMicOn
    ? "bg-red-600 hover:bg-red-700"
    : micWaitingForKey
      ? "bg-amber-500 hover:bg-amber-600"
      : "bg-emerald-600 hover:bg-emerald-700";

  const mainControls = (
    <>
      <div className="flex items-stretch">
        {/* Every setting the mic has, in one panel — which device, its volume,
            noise suppression and its shortcut — opened the same way from the
            arrow and from a right-click on the button. The arrow sits inside
            the panel's anchor, so pressing it again closes the panel instead
            of counting as a click outside that reopens it. Moving the dial
            does not close it: it is adjusted while listening to the result. */}
        <ShortcutQuickPopover
          action="toggleMute"
          open={quickShortcutAction === "toggleMute"}
          onClose={() => setQuickShortcutAction(null)}
          hasAccount={Boolean(state.account)}
          onRequestAccount={() => setAccountModal("create")}
          onOpenAllShortcuts={() => setShortcutsModalOpen(true)}
          extra={
            <div className="w-64 max-w-[calc(100vw-2rem)]">
              <DeviceSubmenuRow
                label={translate("watch.watchRoom.chooseMicrophone")}
                current={
                  micDevices.find((d) => d.deviceId === micDeviceId)?.label ??
                  translate("watch.watchRoom.systemDefault")
                }
              >
                <DeviceMenuOption
                  label={translate("watch.watchRoom.systemDefault")}
                  selected={micDeviceId === null}
                  onClick={() => setMicDevice(null)}
                />
                {micDevices.map((d) => (
                  <DeviceMenuOption
                    key={d.deviceId}
                    label={d.label}
                    selected={micDeviceId === d.deviceId}
                    onClick={() => setMicDevice(d.deviceId)}
                  />
                ))}
              </DeviceSubmenuRow>
              <MicGainRow
                value={micGain}
                onChange={setMicGain}
                disabled={isMicOn && !micGainAvailable}
              />
              {noiseSuppressionToggle}
              {pushToTalkToggle}
              {pushToTalkKeyRow}
            </div>
          }
        >
          <div className="relative flex items-stretch">
          {dockExtra(
            <Tooltip content={translate("watch.watchRoom.microphoneSettings")}>
              <button
                type="button"
                onClick={() => {
                  // Opening this panel while the tip is up is the click it
                  // was counting (see useTileExperimentTip's clicked).
                  pushToTalkTip.clicked();
                  setQuickShortcutAction((current) => (current === "toggleMute" ? null : "toggleMute"));
                }}
                aria-label={translate("watch.watchRoom.microphoneSettings")}
                aria-expanded={quickShortcutAction === "toggleMute"}
                className={`h-full rounded-l-lg border-r border-black/15 px-1 text-white transition ${micToneClass}`}
              >
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
          <MicUsageHint
            open={micHintOpen}
            onDismiss={closeMicHint}
            onEnableMic={enableMicFromHint}
            tooltip={
              isMicOn
                ? pushToTalk.active
                  ? translate("watch.watchRoom.pushToTalkHoldToTalk", { key: pushToTalk.combo })
                  : translate("common.turnOffMicrophone")
                : (micBlockedReason ?? translate("common.turnOnMicrophone"))
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
              aria-label={isMicOn ? translate("common.turnOffMicrophone") : translate("common.turnOnMicrophone")}
              className={`${dockCompact ? "rounded-lg" : "rounded-r-lg"} p-2 text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${micToneClass}`}
            >
              {isMicOn ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5" />}
            </button>
          </MicUsageHint>
          {/* The "novo" tip for "Apertar para falar", on the arrow that opens
              the panel its switch is in — the other experiments' tips hang off
              "Mais opções" for the same reason (see useTileExperimentTip). */}
          {pushToTalkTip.show && quickShortcutAction !== "toggleMute" && (
            <span
              role="status"
              className="absolute left-0 top-full z-50 mt-2 w-60 rounded-lg bg-blue-600 px-3 py-2 text-left text-xs font-medium text-white shadow-lg"
            >
              <span className="absolute -top-1 left-3 h-2 w-2 rotate-45 bg-blue-600" />
              <span className="flex items-start gap-2">
                <span className="flex-1">{translate("watch.watchRoom.pushToTalkTip")}</span>
                <button
                  type="button"
                  onClick={pushToTalkTip.dismiss}
                  aria-label={translate("watch.watchRoom.clipsModeTipDismiss")}
                  className="-m-1 shrink-0 rounded p-1 leading-none text-white/80 hover:text-white"
                >
                  ✕
                </button>
              </span>
            </span>
          )}
          </div>
        </ShortcutQuickPopover>
      </div>

      <div className="flex items-stretch">
        {/* Same panel as the mic's, for what you hear: the output device (where
            the browser lets it be chosen) and the shortcut, from the arrow and
            from a right-click alike. */}
        <ShortcutQuickPopover
          action="toggleDeafen"
          open={quickShortcutAction === "toggleDeafen"}
          onClose={() => setQuickShortcutAction(null)}
          hasAccount={Boolean(state.account)}
          onRequestAccount={() => setAccountModal("create")}
          onOpenAllShortcuts={() => setShortcutsModalOpen(true)}
          extra={
            canSelectSpeaker ? (
              <div className="w-64 max-w-[calc(100vw-2rem)]">
                <DeviceSubmenuRow
                  label={translate("watch.watchRoom.chooseAudioOutput")}
                  current={
                    speakerDevices.find((d) => d.deviceId === speakerDeviceId)?.label ??
                    translate("watch.watchRoom.systemDefault")
                  }
                >
                  <DeviceMenuOption
                    label={translate("watch.watchRoom.systemDefault")}
                    selected={speakerDeviceId === null}
                    onClick={() => setSpeakerDevice(null)}
                  />
                  {speakerDevices.map((d) => (
                    <DeviceMenuOption
                      key={d.deviceId}
                      label={d.label}
                      selected={speakerDeviceId === d.deviceId}
                      onClick={() => setSpeakerDevice(d.deviceId)}
                    />
                  ))}
                </DeviceSubmenuRow>
              </div>
            ) : undefined
          }
        >
          <div className="flex items-stretch">
          {canSelectSpeaker && dockExtra(
            <Tooltip content={translate("watch.watchRoom.audioSettings")}>
              <button
                type="button"
                onClick={() =>
                  setQuickShortcutAction((current) => (current === "toggleDeafen" ? null : "toggleDeafen"))
                }
                aria-label={translate("watch.watchRoom.audioSettings")}
                aria-expanded={quickShortcutAction === "toggleDeafen"}
                className={`h-full rounded-l-lg border-r border-black/15 px-1 text-white transition ${micsMuted ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
              >
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
          <Tooltip content={micsMuted ? translate("common.unmuteMicrophones") : translate("common.muteMicrophones")}>
            <button
              type="button"
              onClick={toggleMicsMuted}
              onContextMenu={(e) => {
                e.preventDefault();
                setQuickShortcutAction("toggleDeafen");
              }}
              aria-label={micsMuted ? translate("common.unmuteMicrophones") : translate("common.muteMicrophones")}
              className={`p-2 text-white transition ${canSelectSpeaker && !dockCompact ? "rounded-r-lg" : "rounded-lg"} ${micsMuted ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
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
        </ShortcutQuickPopover>
      </div>

      {/* A rule between "what everyone hears" and "what everyone sees" —
          a standalone separator rather than a border on the group, so the
          spacing matches the one before the add-video button in the header
          dock that holds all of this. */}
      <span className="mx-0.5 h-6 w-px shrink-0 self-center bg-zinc-300 dark:bg-zinc-700" />

      <div className="flex items-center">
        <ShareControls
          screenSharing={anyScreenSharing}
          cameraSharing={Boolean(localCameraStream)}
          screenSupported={screenShareMode === "display" || isMobileBrowser}
          cameraSupported={screenShareMode !== "unsupported"}
          screenBlockedReason={screenBlockedReason}
          cameraBlockedReason={cameraBlockedReason}
          onToggleScreen={() => {
            if (anyScreenSharing) {
              stopAllScreens();
              return;
            }
            // On a phone browser, screen sharing requires the mobile app (in beta)
            if (isMobileBrowser) {
              setMobileScreenShareModalOpen(true);
              return;
            }
            // On a phone app the quality question is asked here rather than left
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
          open={shareQualityOpen}
          setOpen={setShareQualityOpen}
          quality={qualityControlsProps}
          onOpenShortcutQuick={(action) => setQuickShortcutAction(action)}
          quickShortcutAction={quickShortcutAction}
          onCloseShortcutQuick={() => setQuickShortcutAction(null)}
          onRequestAccount={() => setAccountModal("create")}
          onOpenAllShortcuts={() => setShortcutsModalOpen(true)}
          compact={dockCompact}
          extraMotion={dockMotion}
          addScreen={addScreenControl}
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
    return videoSourceOwners.has(userId);
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

  // ─── Turning the room into a group ─────────────────────────────────────
  //
  // A button after the last participant (see components/RoomToGroup): once
  // there are enough people here for a group to be worth having, the room's owner
  // may make one of it — and everybody else sees the offer too, switched off,
  // so they know whom to ask. The server does the rest and tells every one of
  // us where the group's voice room is (see the effect on roomConverted, up
  // above the early returns).
  const roomToGroupPeople: RoomToGroupPerson[] = [
    { key: "self", name: state.name ?? "", avatarUrl: account?.avatarUrl ?? null },
  ];
  // One face per person, however many devices they have here.
  const roomToGroupSeen = new Set<string>(state.selfUserId ? [state.selfUserId] : []);
  for (const p of visiblePeers) {
    const key = p.userId ?? p.id;
    if (roomToGroupSeen.has(key)) continue;
    roomToGroupSeen.add(key);
    roomToGroupPeople.push({ key, name: p.name, avatarUrl: p.avatarUrl ?? null });
  }
  const roomOwnerName = state.roomOwnerId
    ? isRoomOwner
      ? state.name
      : visiblePeers.find((p) => p.userId === state.roomOwnerId)?.name ?? null
    : null;
  // The browser's memory of a closed button is read last, and after mount
  // only: there is no storage on the server, and a button is not worth a
  // hydration mismatch.
  const showRoomToGroup =
    !group &&
    roomToGroupPeople.length >= ROOM_TO_GROUP_MIN_PEOPLE &&
    !roomToGroupClosed &&
    mounted &&
    !isRoomToGroupDismissed(handle);
  const roomToGroupButton = showRoomToGroup ? (
    <RoomToGroupButton
      canConvert={isRoomOwner && Boolean(account)}
      needsAccount={isRoomOwner && !account}
      ownerName={roomOwnerName}
      onConvert={() =>
        void openPopup("room_to_group", {
          data: { defaultName: privateRoomParts?.name ?? handle, people: roomToGroupPeople },
        })
      }
      onCreateAccount={() => setAccountModal("create")}
      onDismiss={() => {
        dismissRoomToGroup(handle);
        setRoomToGroupClosed(true);
      }}
    />
  ) : null;

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
          {translate("watch.watchRoom.participants")}
        </h2>
        {/* Beside the heading rather than in the room's own controls: this is
            an action on *this list* — it is how somebody gets added to it —
            and a person looking for "quem está aqui, e quem falta" is looking
            here.

            Accounts only, and quietly absent otherwise: a call has to ring
            something that outlives a browser session, so a guest has nobody to
            ring and nobody to be rung by (see the API's callRoutes). The room
            link still works for everyone, which is what this is a shortcut
            for. */}
        {account && (
          <Tooltip content={translate("watch.watchRoom.callAFriendToThisRoom")}>
            <button
              type="button"
              onClick={() => setInviting(true)}
              aria-label={translate("watch.watchRoom.callAFriendToThisRoom")}
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-emerald-600/40 text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
            >
              <MdPersonAddAlt1 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        )}
        {connectingAudioPeers && (
          <Tooltip content={translate("watch.watchRoom.connectingTheAudioOfWhoeverHas")}>
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              {translate("watch.watchRoom.connecting")}
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
              ? translate("watch.watchRoom.peercountOfRoommemberlimitPeopleTheRoom", { peerCount, roomMemberLimit: state.roomMemberLimit })
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

        {obsActiveTargets.size > 0 && (
          <Tooltip
            content={
              obsActiveTargets.size === 1
                ? translate("watch.watchRoom.n1ExternalBroadcastActive")
                : translate("watch.watchRoom.sizeExternalBroadcastsActive", { size: obsActiveTargets.size })
            }
          >
            <span
              className="inline-flex items-center gap-1 rounded-full border border-purple-400/40 bg-purple-950/80 px-1.5 py-0.5 text-xs font-semibold text-purple-200 shadow-sm transition-all"
              aria-label={translate("watch.watchRoom.externalBroadcastActive")}
            >
              <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-purple-400" />
              </span>
              <ObsSourceIcon className="h-3.5 w-3.5 shrink-0 text-purple-300" />
              <span className="hidden 2xl:inline">{translate("common.broadcast")}</span>
            </span>
          </Tooltip>
        )}

        {isWideLayout && hasAnyMedia && (
          <Tooltip content={translate("watch.watchRoom.hideParticipants")}>
            <button
              type="button"
              onClick={toggleLeftSidebar}
              aria-label={translate("watch.watchRoom.hideParticipants")}
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
        avatarUrl={account?.avatarUrl}
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
        // Your own row is you, looking at it — the only question left is which
        // client, and this tab already knows without asking the server.
        presence={{
          state: "online",
          device: mounted
            ? isMobileApp()
              ? "mobile"
              : isDesktopApp()
                ? "app"
                : undefined
            : undefined,
        }}
        verified={verifiedBadge(state.account?.flags)}
        bot={state.account?.bot}
        nameColor={account?.equippedNameColor}
        micOn={isMicOn}
        silenced={selfSilenced}
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
            peerId={p.id}
            name={withDeviceSuffix(p.name, p.userId, p.device, deviceCounts)}
            onOpenProfile={setProfileUserId}
            isGuest={p.isGuest}
            userId={p.userId}
            avatarUrl={p.avatarUrl}
            micsMuted={p.micsMuted}
            // Offered for anyone with an account — "Ver perfil"/"Enviar
            // mensagem"/volume are everyday actions, not the room's business,
            // and the admin buttons inside blend in or out per person on
            // their own (see memberActionsFor's blockedReason). Which of the
            // two shells it gets is the screen's call — see openMemberActions.
            onMenuOpenChange={p.userId && isDesktopLayout ? setParticipantMenuOpen : undefined}
            menuOpen={memberMenuFor === p.id}
            // Drawn only for the row whose menu is open, so only that one
            // redraws with the room while it is.
            menuContent={memberMenuFor === p.id ? renderMemberMenu(p, closeParticipantMenu) : null}
            onContextMenu={p.userId && !isDesktopLayout ? openParticipantActions : undefined}
            isOwner={Boolean(p.userId) && p.userId === state.roomOwnerId}
            isAdmin={p.userId ? adminIds.has(p.userId) : false}
            isApp={p.app}
            isMobileApp={p.mobileApp}
            presence={peerPresence(p)}
            verified={verifiedBadge(p?.flags)}
            bot={p.bot}
            nameColor={p.nameColor}
            micOn={p.mic && !isPeerSilenced(p)}
            silenced={isPeerSilenced(p)}
            sharing={p.sharing}
            screen={p.screen}
            camera={p.camera}
            sharingVideo={peerSharesVideo(p.userId)}
            micStream={remoteMicStreams[p.id]}
            muted={micsMuted || mutedPeerIds.has(p.id) || isPeerSilenced(p)}
            onToggleMute={toggleParticipantMute}
            volume={peerVolumes[volumeKey] ?? 1}
            connectionLost={micConnectionStates[p.id] === "disconnected"}
          />
        );
      })}
      {roomToGroupButton && <li className="mt-1">{roomToGroupButton}</li>}
    </ul>
  );

  // The faces a direct call shows while nobody is sharing anything (see
  // components/CallStage). The same people as the list above, without
  // anything a call does not need to say about them.
  const callStagePeople: CallStagePerson[] = callLayout
    ? [
        {
          key: "self",
          name: state.name,
          avatarUrl: account?.avatarUrl ?? null,
          userId: state.selfUserId,
          isGuest: !state.account,
          micOn: isMicOn,
          silenced: selfSilenced,
          micStream: localMicStream,
        },
        ...visiblePeers.map((p) => ({
          key: p.id,
          name: p.name,
          avatarUrl: p.avatarUrl ?? null,
          userId: p.userId,
          isGuest: p.isGuest,
          micOn: p.mic && !isPeerSilenced(p),
          silenced: isPeerSilenced(p),
          micStream: remoteMicStreams[p.id] ?? null,
        })),
      ]
    : [];

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
      {/* Always drawn now, where it used to appear only for somebody who runs
          the room or for a room that is on the map. The theme button is for
          everyone, so the row it lives in has to be — and what is *in* it is
          decided per button below. With the other two absent it is one control
          filling the width, which is the shape a single button should have
          rather than a third of a row with a gap where its neighbours were. */}
      {/* empty:hidden — in a group, somebody who does not run it has none of
          these three (no map, no theme, no management), and an empty row
          would be a strip of margin above the chat. */}
      <div className="mb-2 flex items-center gap-2 empty:hidden">
        {/* A group's room is on no map. */}
        {!group && (isRoomManager || state.roomLocation) && (
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
              {state.roomLocation || !isRoomManager ? translate("watch.watchRoom.locationOnTheMap") : translate("watch.watchRoom.setOnTheMap")}
            </button>
          </Tooltip>
        )}
        {/* Repainting the room. Shown to everybody, including the people who
            cannot do it — a control nobody can see is a feature nobody finds
            out exists, which is the same rule the room's quality pickers
            follow for their own locked options.
            What differs is what it says on hover and what pressing it does.
            Without the plan it is a way *to* the plan, which is the one
            useful thing a refusal can be; with the plan but with the room's
            switch off it is genuinely dead, and says so rather than opening
            a picker whose every choice the server would reject. */}
        {/* Not in a group: a group's rooms wear the group's theme, which is
            changed from the group itself (its menu and its settings). */}
        {!group && (
        <Tooltip
          content={
            !hasThemePlan
              ? translate("watch.watchRoom.onlyThoseWithProMaxCan")
              : !roomAllowsTheme
                ? translate("watch.watchRoom.theAdministrationHasTurnedOffTheme")
                : translate("watch.watchRoom.changesTheThemeForEveryoneIn")
          }
          wrapperClassName="flex flex-1"
        >
          <button
            type="button"
            // Dead only when the room said no. Without the plan it still
            // does something worth doing.
            disabled={hasThemePlan && !roomAllowsTheme}
            onClick={() => {
              if (!hasThemePlan) {
                // The modal rather than the page: this is a live call, and
                // following a link to read a price would end it.
                openProModal("premium_max");
                return;
              }
              void openPopup("room_theme", {
                data: { currentThemeId: state.roomTheme ?? null },
              });
            }}
            className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
              canSetRoomTheme
                ? "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                : "border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            <MdPalette className="h-4 w-4 shrink-0" />
            {roomTheme.fromRoom ? translate("watch.watchRoom.changeTheme") : translate("common.roomTheme")}
          </button>
        </Tooltip>
        )}
        {isRoomManager && (
          <button
            type="button"
            onClick={openManageRoomPopup}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <BsGearFill className="h-3.5 w-3.5 shrink-0" />
            {translate("common.manageRoom")}
          </button>
        )}
      </div>
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
    replyTo: ChatReplyTo | null,
    attachments: string[]
  ): Promise<{ ok: boolean; error?: string }> {
    // A guest sends with their own guest token — the same identity their
    // connection registered under, which is what the API matches it to.
    const token = uploadAuthToken();
    if (!token) return { ok: false, error: translate("watch.watchRoom.signInWithAnAccountTo") };
    if (!state.selfId) return { ok: false, error: translate("watch.watchRoom.reconnectingTryAgainInAMoment") };

    const result = await sendChatImages({
      handle,
      clientId: state.selfId,
      token,
      text,
      images,
      replyTo,
      attachments,
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
          !imageBlockedReason ? handleSendChatImages : undefined
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
        roomHandle={handle}
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
        canUseStreamerMode={canUseStreamerMode}
        streamerMode={streamerMode}
        onToggleStreamerMode={toggleStreamerMode}
      />
    </>
  );

  // In a group, the room's header does not exist as such: its call controls and
  // its page buttons are rendered into the group's own top bar instead (see
  // WatchRoomGroupMode.headerSlots). The call controls stay there for as long
  // as you are connected — reading a text room included, since sharing a screen
  // or switching on a camera is not something that should need the call on
  // screen first. The page buttons (share, Pro, options) are about the room's
  // page, so they only come along while it is the one shown.
  // Outside a group this hands the node straight back, unchanged.
  //
  // Docked — the call carried around the site with no page of its own on
  // screen (see components/RoomCallHost) — the call controls go to the
  // floating call bar instead, at every width and in every kind of room, and
  // the page buttons go nowhere: there is no room page for them to be about.
  // A group's bar still wins while the group's pages are the ones showing (its
  // slots only exist then), for every call alike: a group's, while somebody
  // reads one of its text rooms, and an ordinary room's carried into /groups —
  // whose controls would otherwise be nowhere at all, since the floating bar
  // stands aside for the group's.
  //
  // "end" is the corner of the group's bar, after its own buttons, and only
  // exists there — outside a group that node stays in the room's own right
  // zone (see moreOptions).
  function inHeaderSlot(slot: "center" | "right" | "end", node: ReactNode): ReactNode {
    const barTarget = headerSlots?.[slot] ?? null;
    if (barTarget) {
      if (slot !== "center" && !visible) return null;
      return createPortal(node, barTarget);
    }
    if (slot === "end") return null;
    if (!visible) return slot === "center" && dockSlot ? createPortal(node, dockSlot) : null;
    return group ? null : node;
  }

  // "Mais opções" — the button and, from sm up, the popover it opens (below
  // that the same menu is a bottom sheet, drawn with the rest of the right zone).
  const moreOptions = (
    <Popover
      open={isDesktopLayout && menuOpen}
      onClose={closeMenu}
      placement="bottom-end"
      tooltip={translate("watch.watchRoom.moreOptions")}
      content={
        <div className="flex max-h-[80vh] w-80 flex-col gap-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
          {menuItems}
        </div>
      }
    >
      <span className="relative inline-flex shrink-0">
        <button
          type="button"
          onClick={() => {
            newFeatureTip?.clicked();
            if (menuOpen) closeMenu();
            else setMenuOpen(true);
          }}
          aria-label={translate("watch.watchRoom.moreOptions")}
          className={`shrink-0 rounded-lg border p-2 transition ${menuOpen
            ? "border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            : newFeatureTip
              ? "border-blue-500 text-zinc-700 ring-2 ring-blue-500/40 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
              : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            }`}
        >
          <MoreIcon className="h-5 w-5" />
        </button>
        {/* The "novo" tip: once, for people who used GoLive before getting
            a tile experiment (see useTileExperimentTip). */}
        {newFeatureTip && !menuOpen && (
          <span
            role="status"
            className="absolute right-0 top-full z-50 mt-2 w-60 rounded-lg bg-blue-600 px-3 py-2 text-left text-xs font-medium text-white shadow-lg"
          >
            <span className="absolute -top-1 right-3 h-2 w-2 rotate-45 bg-blue-600" />
            <span className="flex items-start gap-2">
              <span className="flex-1">{translate(newFeatureTip.text)}</span>
              <button
                type="button"
                onClick={newFeatureTip.dismiss}
                aria-label={translate("watch.watchRoom.clipsModeTipDismiss")}
                className="-m-1 rounded p-1 leading-none text-white/80 hover:text-white"
              >
                ✕
              </button>
            </span>
          </span>
        )}
      </span>
    </Popover>
  );


  // The room's soundtrack from local files — the same strip, the same place,
  // as a YouTube one. Several can be up at once, the same way several people
  // can be sharing a screen.
  const localAndRemoteMusic = (
    <>
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
            peerName={peer?.name ?? translate("common.someone2")}
            file={shared}
            stream={stream}
            isRoomManager={isRoomManager}
          />
        ) : null
      )}
    </>
  );
  // Only a group's own voice room draws its music under the group's header.
  const groupMusicSlot = group ? musicSlot : null;

  return (
    <div
      // Marks this page as an app shell for globals.css, which is what pins
      // it to the viewport actually on screen below lg — see the
      // `[data-room-shell]` rule there.
      // Only while a page is actually showing the room: those rules pin the
      // document to the viewport, and a docked call is a call on somebody
      // else's page, which must go on scrolling like the page it is.
      // Nor in a direct call, which is a pane inside a conversation and not
      // a page at all: pinning it to the viewport would take the messages
      // under it off the screen.
      data-room-shell={visible && !callLayout ? "" : undefined}
      // Read by app/globals.css, which hides the header, both side columns
      // and the bottom bar while Android is floating the window. A React
      // branch would mean unmounting the video element the floating window is
      // showing, which is exactly the thing that must survive.
      data-pip={pipActive ? "true" : undefined}
      // The element that paints the page colour across the viewport. While a
      // theme with a wallpaper or a gradient is worn, globals.css makes this
      // one transparent so those layers (drawn on <html>) can be seen —
      // instead of the page *colour* being painted transparent, which also
      // emptied every `bg-black/60` backdrop on the site.
      data-room-page=""
      className={`flex min-h-0 flex-1 flex-col ${
        // The conversation's own card is what this is drawn on.
        callLayout ? "" : "bg-zinc-50 dark:bg-black"
      }`}
    >
      {/* Above the header so it reads as a property of the page rather than
          of the room's controls. Renders nothing inside the app itself, and
          nothing for anyone who has already answered — or whose installation
          is already known, since RoomAppGate then asks before the room is
          joined at all. */}
      {!group && !callLayout && <OpenInAppBanner />}
      {/* The call's picture in the corner while somebody reads another page —
          portalled to the body, so where this room is parked does not matter.
          Mounted even
          with nothing to show for a moment, so a closed box stays closed and a
          browser picture-in-picture opened from it is not torn down. */}
      {!visible && (
        <DockedPip
          sources={dockedPipSources}
          focusedId={activeHyperfocusId ?? (isFocusMode ? spotlightId : null)}
          onOpen={(id) => {
            // Already hyperfocused on it: that is more focus than asked for.
            if (activeHyperfocusId === id) return;
            // Hyperfocus on something else outranks "Focar" and would hide it.
            if (hyperfocusId) setHyperfocusId(null);
            // Our own preview may have been hidden from the grid.
            if (ownPreviewIds.includes(id)) setOwnPreviewHidden(false);
            setSpotlightId(id);
          }}
        />
      )}
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
      <header
        className={
          // Hidden in a group: what matters in it is portalled into the
          // group's bar (see inHeaderSlot), and the rest is said there already.
          // A direct call has no header of its own either: its controls go
          // to the bar of whatever page is showing it (see inHeaderSlot), and
          // the room's name, its link and its settings are not what a call
          // with one person is about.
          group || callLayout
            ? "hidden"
            : "shrink-0 border-b border-black/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-zinc-950 sm:px-4"
        }
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:flex-nowrap lg:gap-3">
          {/* Where you are. min-w-0 the whole way down, so a long room name
              truncates instead of shoving the middle zone off-centre — and
              the description input inside RoomInfoControls grows into
              whatever this zone has spare (it caps itself), which it can only
              do if the zone claims that room in the first place. */}
          <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
            {group ? (
              // In a group the way out is the group's own navigation, already
              // on screen from lg up; below that this opens it as a drawer.
              <button
                type="button"
                onClick={group.onOpenNav}
                aria-label={translate("watch.watchRoom.groupRooms")}
                className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-lg text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 lg:hidden dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              >
                <MdMenu />
              </button>
            ) : (
              <Tooltip content={translate("common.backToHome")} placement="bottom">
                <Link
                  href="/"
                  aria-label={isWideLayout ? translate("common.home") : translate("common.back")}
                  onClick={(e) => {
                    // A phone's way out is back, to wherever the room was opened
                    // from — the room list, a group, the home screen. Leaving
                    // does not hang up: the call follows (see RoomCallHost).
                    if (isWideLayout || window.history.length <= 1) return;
                    e.preventDefault();
                    router.back();
                  }}
                  className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-lg text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                >
                  {isWideLayout ? <MdHome /> : <MdArrowBack className="h-5 w-5" />}
                </Link>
              </Tooltip>
            )}

            {!group && <span className="hidden h-6 w-px shrink-0 bg-zinc-200 lg:block dark:bg-zinc-800" />}

            {group && (
              <div className="flex min-w-0 items-center gap-2">
                <MdVolumeUp className="h-5 w-5 shrink-0 text-emerald-600" />
                <h1 className="truncate text-base font-semibold text-zinc-950 dark:text-zinc-50 sm:text-lg">
                  {group.channelName}
                </h1>
                <span className="hidden truncate text-sm text-zinc-500 sm:inline dark:text-zinc-400">
                  {group.groupName}
                </span>
              </div>
            )}

            {/* The room's own identity — name, access code, public/private —
                held together in one group, so the description beside it is
                the only thing that gives space up as the window narrows. */}
            <div className={group ? "hidden" : "flex min-w-0 items-center gap-2"}>
              {/* For a private room the code is split out of the handle and
                  shown on its own: it's the room's whole secret now (see
                  roomsApi's toPrivateRoomHandle), so it's the thing someone
                  reads out loud to let a friend in, and picking it out of
                  "priv-familia-123456" by eye is needless work. The tooltip
                  still carries the raw handle for anyone who wants it. */}
              <Tooltip
                content={
                  streamerMode
                    ? (privateRoomParts ? translate("watch.watchRoom.nameCodeHiddenInStreamerMode", { name: privateRoomParts.name }) : translate("watch.watchRoom.streamerModeOn"))
                    : handle
                }
                placement="bottom"
              >
                <h1 className="truncate text-base font-semibold text-zinc-950 dark:text-zinc-50 sm:text-lg">
                  {privateRoomParts ? privateRoomParts.name : (streamerMode && isPrivateRoomHandle(handle) ? translate("watch.watchRoom.privateRoom") : handle)}
                </h1>
              </Tooltip>
              {privateRoomParts && (
                <Tooltip
                  content={
                    streamerMode
                      ? translate("watch.watchRoom.codeHiddenByStreamerMode")
                      : translate("watch.watchRoom.privateRoomCode")
                  }
                  placement="bottom"
                >
                  <span className="shrink-0 rounded-full bg-zinc-200 px-2.5 py-1 font-mono text-xs font-medium tracking-wider text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {streamerMode ? "••••••" : privateRoomParts.code}
                  </span>
                </Tooltip>
              )}
              {/* A dot at every width, the word only where there's room for
                  it. Public-or-private is the single most load-bearing fact
                  about a room, so the badge shrinks rather than disappearing
                  — the tooltip carries the word at the widths that can't. */}
              <Tooltip
                content={isPrivateRoomHandle(handle) ? translate("common.privateRoom") : translate("watch.watchRoom.publicRoom")}
                placement="bottom"
              >
                <span
                  className={`flex shrink-0 items-center gap-1.5 rounded-full text-xs font-medium text-white xl:px-2.5 xl:py-1 ${
                    isPrivateRoomHandle(handle) ? "xl:bg-red-600" : "xl:bg-emerald-600"
                  }`}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full xl:hidden ${
                      isPrivateRoomHandle(handle) ? "bg-red-600" : "bg-emerald-600"
                    }`}
                  />
                  <span className="hidden xl:inline">
                    {isPrivateRoomHandle(handle) ? translate("common.privateRoom") : translate("watch.watchRoom.publicRoom")}
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
            {/* Public rooms only — see the same gate on the phone copy above. */}
            {isWideLayout && !isPrivateRoomHandle(handle) && !group && (
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
              open/closed state for them.

              Docked, at any width: the floating call bar is where they go then
              (see inHeaderSlot), and the bottom bar is not drawn — the one-
              place rule still holds. */}
          {(isWideLayout || !visible) && inHeaderSlot("center", (
            <div className="flex items-center justify-center gap-1.5 justify-self-center rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900">
              {mainControls}

              {/* Everything here past what a call needs every minute goes in
                  one piece, so the compact call bar leaves it out and the
                  expanded one grows it in as one (see dockExtra). The gap
                  variable is the row's own gap-1.5, taken back while closed. */}
              {dockExtra(
              <>
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
                content={videoSourceBlockedReason ?? translate("watch.watchRoom.addVideoSource")}
                wrapperClassName="flex"
              >
                <button
                  type="button"
                  onClick={openAddVideoSourcePopup}
                  disabled={Boolean(videoSourceBlockedReason)}
                  aria-label={translate("watch.watchRoom.addVideoSource")}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <MdOutlineOndemandVideo className="h-5 w-5 shrink-0" />
                  <span data-header-label className="hidden 2xl:inline"><BetaMark /></span>
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
                    ? translate("common.changeTheRoomSMusic")
                    : translate("common.playMusicInTheRoom"))
                }
                wrapperClassName="flex"
              >
                <button
                  type="button"
                  onClick={openAddMusicPopup}
                  disabled={!canManageMusic}
                  aria-label={translate("common.playMusicInTheRoom")}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <MdMusicNote className="h-5 w-5 shrink-0" />
                  <span data-header-label className="hidden 2xl:inline"><BetaMark /></span>
                </button>
              </Tooltip>
              </>,
              "flex items-center gap-1.5",
              translate("watch.watchRoom.callDockGap0375rem")
              )}

              {/* Leaving. Red and last in the row for the same reason every
                  call app puts it there: it is the one control here that ends
                  the thing, and it must never be next to something pressed by
                  reflex. Navigating home is what actually disconnects —
                  unmounting this component is what calls leaveRoom(). */}
              <Tooltip content={translate("common.leaveTheCall")}>
                <button
                  type="button"
                  onClick={() => {
                    // Before navigating, not after: router.push is a client
                    // transition so the AudioContext survives it, but the
                    // button is about to be unmounted and there is no reason
                    // to race that.
                    playHangUpSound();
                    // Ends the session, which unmounts this room and leaves
                    // it — and, from the room's own page, moves off a page
                    // that now has nothing to show (see RoomCallHost).
                    onDisconnect();
                  }}
                  aria-label={translate("common.leaveTheCall")}
                  className="flex items-center rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
                >
                  <MdCallEnd className="h-5 w-5 shrink-0" />
                </button>
              </Tooltip>
            </div>
          ))}

          {/* Who you are, and everything that is about the page rather than
              about the call. Labels drop out before anything else does, so a
              narrow desktop loses words and never buttons. */}
          {inHeaderSlot("right", (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 lg:ml-0 lg:flex-nowrap">
            {/* Still desktop-only: on a phone this lives inside "Mais opções"
                (see menuItems), the only place with room for it. "Trocar de
                sala" moved in there at every width — it is a once-a-session
                action, and next to the mid-call controls it was a wide button
                spending header space on something nobody clicks twice. */}
            {/* Not in a group: a group's room is shared by inviting to the group.
                Nor in a direct call: its room is the two of them, and its link
                is a way for a third person to walk into a private conversation. */}
            {!group && !callLayout && (
            <Tooltip content={linkCopied ? translate("common.linkCopied") : translate("watch.watchRoom.copyThisRoomSLink")}>
              <button
                type="button"
                onClick={handleCopyLink}
                aria-label={translate("watch.watchRoom.shareRoom")}
                className={`hidden shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium transition sm:flex ${linkCopied
                  ? "border-emerald-600 text-emerald-600 dark:border-emerald-500 dark:text-emerald-500"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
              >
                {linkCopied ? <CheckIcon className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" />}
                <span data-header-label className="hidden 2xl:inline">
                  {linkCopied ? translate("common.copied2") : translate("watch.watchRoom.shareRoom")}
                </span>
              </button>
            </Tooltip>
            )}

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
            {/* Not in a group: the group's bar has the account menu. */}
            {isWideLayout || group ? null : account ? (
              <Tooltip content={translate("common.seeYourProfile")} placement="bottom">
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
                  content={translate("common.yourGuestPointsAreSavedOnly")}
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
                page — see app/pro. What it offers climbs with the reader's own
                plan; the three states are decided in `proButton` above. */}
            <Tooltip content={proButton.tooltip} placement="bottom">
              <button
                type="button"
                onClick={() => {
                  // Still one event, with which of the three was on screen —
                  // "the premium button was pressed" is the question, and
                  // three separate names would only have to be added back up.
                  trackEvent("pro_button_clicked", { offer: proButton.label });
                  proButton.onPress();
                }}
                aria-label={proButton.ariaLabel}
                // Not on a phone, where it is a row in "Mais opções" instead.
                className={`hidden shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-2 text-sm font-medium transition sm:flex 2xl:px-3 ${proButton.className}`}
              >
                <proButton.Icon
                  className={`h-5 w-5 shrink-0 ${proButton.iconClassName}`}
                />
                <span data-header-label className="hidden sm:inline lg:hidden 2xl:inline">
                  {proButton.label}
                </span>
              </button>
            </Tooltip>

            {/* Immediately left of "mais opções": the two are the only
                controls in this row that open a panel, and this is the one
                that can be asking for attention. */}
            {/* Only when this row is the room's own. Portalled into a host
                bar (a group's, or the one over the private messages while a
                direct call is drawn in them) this whole zone lands beside that
                bar's own bell — which is how a direct call ended up with two
                of them: the old test was "not a group", and a direct call is
                not a group either. What decides it is whether there is a bar
                lending us its right-hand slot, not what kind of call it is. */}
            {!group && !headerSlots?.right && <NotificationInboxBell />}

            {/* In a group's bar this goes to its far corner instead (see
                inHeaderSlot's "end"), after the group's own buttons. */}
            {!headerSlots?.end && moreOptions}

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
            {!isWideLayout && !account && !group && (
              <Tooltip content={translate("watch.watchRoom.signInOrCreateAnAccount")} placement="bottom">
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
                  <span className="hidden sm:inline">{translate("common.signIn")}</span>
                </button>
              </Tooltip>
            )}

            {!group && <UpdateAppButton />}

            {/* On a phone the same menu is a bottom sheet: fixed to the
                screen rather than hung off the button, closed by a drag, a tap
                outside or Android's back button. */}
            {!isDesktopLayout && (
              <MobileSheet
                open={menuOpen}
                onClose={closeMenu}
                title={translate("watch.watchRoom.moreOptions")}
              >
                <div className="flex flex-col gap-1 pb-2">{menuItems}</div>
              </MobileSheet>
            )}
          </div>
          ))}
          {inHeaderSlot("end", moreOptions)}
        </div>
      </header>

      {/* Under the header: the broadcaster is told that somebody is recording
          their transmission, and who. Stays up for as long as it lasts. */}
      {recordingNotices.length > 0 && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-red-500/30 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 dark:bg-red-950/60 dark:text-red-200 sm:px-4"
        >
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-600" />
          <span className="min-w-0 truncate">
            {translate("watch.watchRoom.beingRecordedBy", {
              names: recordingNotices
                .map((n) => n.name ?? state.peers.find((p) => p.id === n.from)?.name ?? translate("common.someone2"))
                .join(", "),
            })}
          </span>
        </div>
      )}

      {/* Directly under the header, above everything the room is actually
          looking at: it is a strip rather than a tile because music is not
          something you watch, and it must not take a slot away from the
          people and screens that are. */}
      {groupMusicSlot
        ? createPortal(localAndRemoteMusic, groupMusicSlot)
        : localAndRemoteMusic}

      {state.music && (
        <MusicBar
          // A group room's bar goes to the strip under the group's header and
          // its player out of the room altogether, so opening the voice room
          // or moving to another of the group's rooms never restarts the
          // song. An ordinary room's is drawn and played right here, as ever.
          slot={groupMusicSlot}
          keepPlayerInPlace={Boolean(group)}
          music={state.music}
          // Transport follows the music's own control mode, and never the
          // account check that gates *setting* it — this is playback, and a
          // room's owner may well be a guest. Mirrors the server's rule in
          // "music-state" exactly.
          canControl={isRoomManager || state.music.controlMode === "anyone"}
          isRoomManager={isRoomManager}
          isMusicOwner={state.selfUserId !== null && state.music.addedById === state.selfUserId}
          selfUserId={state.selfUserId}
          // Se quem pôs a música saiu, ninguém estava reancorando a posição
          // nem reportando a fila virar de faixa — a sala ia se separando
          // sozinha. Sem essa pessoa, quem pode controlar assume (ver
          // MusicBar's isDriver).
          musicOwnerPresent={
            (state.selfUserId !== null && state.music.addedById === state.selfUserId) ||
            state.peers.some((p) => p.userId && p.userId === state.music?.addedById)
          }
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
            {translate("watch.watchRoom.youAreUsingAGuestName")}{" "}
            <button
              type="button"
              onClick={() => setAccountModal("create")}
              className="font-semibold underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-200"
            >
              {translate("common.createAnAccount")}
            </button>{" "}
            <span className="hidden lg:inline">
              {translate("watch.watchRoom.toReserveYourNameAndKeep")}
            </span>
          </p>
          <Tooltip content={translate("common.closeNotice")}>
            <button
              type="button"
              onClick={() => {
                setGuestBannerDismissed(true);
                setStoredGuestAccountBannerDismissed(true);
              }}
              aria-label={translate("common.closeNotice")}
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
            aria-label={translate("common.closeNotice")}
            className="shrink-0 text-lg leading-none opacity-70 transition hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {(shareError ?? extraScreenError) && (
        <p className="bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {shareError ?? extraScreenError}
        </p>
      )}
      {/* Amber and not red, and only while the share it refers to is still
          running: the transmission is fine, it just has no sound. Saying
          nothing was the worse option — somebody who ticked the box would
          otherwise spend the call wondering why nobody could hear the video
          they were showing. */}
      {shareSystemAudioUnavailable && localStream && (
        <p className="bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-500">
          {shareSystemAudioUnavailable === "blocked"
            ? translate("watch.watchRoom.systemAudioPermissionBlocked")
            : shareSystemAudioUnavailable === "denied"
              ? translate("watch.watchRoom.systemAudioPermissionDenied")
              : translate("watch.watchRoom.systemAudioCouldNotBeCaptured")}
          {/* Android stops showing the prompt after repeated refusals, so
              asking again from here would do nothing — the settings screen
              is the only place left to grant it. */}
          {shareSystemAudioUnavailable === "blocked" && (
            <button
              type="button"
              onClick={() => void openAndroidAppSettings()}
              className="ml-2 font-semibold underline underline-offset-2"
            >
              {translate("watch.watchRoom.openAppSettings")}
            </button>
          )}
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
            aria-label={translate("common.closeNotice")}
            className="shrink-0 text-lg leading-none opacity-70 transition hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {Object.entries(remoteMicStreams).map(([peerId, stream]) => {
        const volumeKey = peersById.get(peerId)?.userId ?? peerId;
        return (
          <RemoteAudio
            key={peerId}
            stream={stream}
            // A silenced person is not played even if their client ignores
            // the room and keeps sending — see the server's "room-silence".
            muted={micsMuted || mutedPeerIds.has(peerId) || isPeerSilenced(peersById.get(peerId))}
            volume={peerVolumes[volumeKey] ?? 1}
            sinkId={speakerDeviceId}
          />
        );
      })}

      {/* Asked at the moment a phone starts transmitting, and nowhere else —
          see MobileQualitySheet for why this is a question rather than a
          setting on this one platform. */}
      {inviting && (
        <InviteToRoomModal
          roomHandle={handle}
          // Everyone the room can see, by account id — the peers plus you.
          // Live, so somebody who walks in while this is open stops being
          // offered as somebody to call.
          presentUserIds={
            new Set(
              [
                ...visiblePeers.map((peer) => peer.userId),
                account?.id,
              ].filter((id): id is string => Boolean(id))
            )
          }
          onClose={() => setInviting(false)}
        />
      )}

      {profileUserId && (
        <UserProfileDialog
          userId={profileUserId}
          // Whether this id belongs to somebody without an account, answered
          // from the participant list rather than by asking the API — for a
          // guest, `userId` is a guest id and GET /users/:id would 404 on it.
          // Looked up here rather than passed through onOpenProfile so the
          // four rows that open a profile keep handing over one string.
          //
          // Yourself is never found here (you are not in your own peer list)
          // and never needs to be: a guest's own row carries no userId at all,
          // so it does not open a profile in the first place.
          guest={(() => {
            const peer = state.peers.find((p) => p.userId === profileUserId);
            if (!peer?.isGuest) return undefined;
            return { name: peer.name, avatarUrl: peer.avatarUrl };
          })()}
          onClose={() => setProfileUserId(null)}
        />
      )}

      {qualityPrompt === "screen" && (
        <MobileQualitySheet
          currentResolution={shareResolution}
          onChoose={(choice: MobileQualityChoice, systemAudio: boolean) => {
            // Applied before starting, not after: the capture reads these
            // through refs when it opens (see useRoomMedia's capture
            // closures), so setting them afterwards would leave this
            // transmission on the previous quality and only move the next one.
            setShareResolution(choice.resolution);
            setShareFps(choice.fps);
            // Set every time, including when it is false: this is the only
            // thing that writes the flag, so leaving it alone on an unticked
            // box would carry the previous share's answer into this one.
            setShareSystemAudio(systemAudio);
            setQualityPrompt(null);
            void startShare("display");
          }}
          onCancel={() => setQualityPrompt(null)}
        />
      )}

      {/* In a group the shell around this already pads it (see GroupAppShell). */}
      <div className={`flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-3 ${group || callLayout ? "" : "lg:p-3"}`}>
        {/* From lg up, participants get this dedicated full-height column
            instead of sharing a pane with chat — see isWideLayout. A card of
            its own rather than loose text on the page background: the room is
            three panes side by side up here, and each needs an edge for the
            video in the middle to read as the thing you came for. Narrower
            than it was, too, and growing again only where there is width to
            spare — the names in it are one line each.

            The ad card lives here (below the list) rather than in the chat
            column, so chat gets the full column to itself. */}
        {/* Not in a group: who is in the call is already on the group's room
            card, and the ad lives in the group's rooms column. */}
        {/* Nor while docked — same reason as the bottom bar below: the ad
            in it would be counting impressions nobody saw. */}
        {isWideLayout && visible && !leftSidebarCollapsed && !group && !callLayout && (
          <aside className="flex h-full w-[300px] shrink-0 flex-col gap-3">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <div className="shrink-0 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
                {participantsHeader}
              </div>
              {/* Barely any padding of its own: the rows carry theirs, and
                  every pixel spent here comes off a name that has to fit
                  beside up to five status icons. */}
              <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">{participantsList}</div>
            </div>
            {!partnerOnStage && <PartnerCard partner={rawActivePartner} loaded={partnerLoaded} />}
          </aside>
        )}

        <main className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2 lg:p-0">
          {/* Floating expand buttons when sidebars are collapsed on wide screens */}
          {/* In a group, what comes back is the group's rail and rooms column. */}
          {isWideLayout && leftSidebarCollapsed && !callLayout && (
            <div className="absolute left-2 top-2 z-20">
              <Tooltip
                content={translate(group ? "watch.watchRoom.showGroupsAndRooms" : "watch.watchRoom.showParticipants")}
                placement="right"
              >
                <button
                  type="button"
                  onClick={toggleLeftSidebar}
                  aria-label={translate(group ? "watch.watchRoom.showGroupsAndRooms" : "watch.watchRoom.showParticipants")}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-zinc-700 shadow-md backdrop-blur-xs transition hover:bg-white hover:text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white"
                >
                  <LuPanelLeftOpen className="h-4 w-4" />
                  {/* <span className="hidden sm:inline">Participantes</span> */}
                </button>
              </Tooltip>
            </div>
          )}

          {isWideLayout && rightSidebarCollapsed && !callLayout && (
            <div className="absolute right-2 top-2 z-20">
              <Tooltip content={translate("watch.watchRoom.showChatAndProfile")} placement="left">
                <button
                  type="button"
                  onClick={toggleRightSidebar}
                  aria-label={translate("watch.watchRoom.showChatAndProfile")}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-zinc-700 shadow-md backdrop-blur-xs transition hover:bg-white hover:text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white"
                >
                  <LuPanelRightOpen className="h-4 w-4" />
                  {/* <span className="hidden sm:inline">Chat</span> */}
                </button>
              </Tooltip>
            </div>
          )}

          {nothingToShow ? (
            callLayout ? (
              // A call with nobody sharing anything is not an empty room: it
              // is two people talking. See components/CallStage.
              <div onContextMenu={ownPreviewMenu} className="flex min-h-0 flex-1 flex-col">
                <CallStage
                  people={callStagePeople}
                  footer={
                    ownPreviewHidden && hasOwnPreview ? (
                      <button
                        type="button"
                        onClick={() => setOwnPreviewHidden(false)}
                        className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      >
                        <EyeIcon className="h-4 w-4" />
                        {translate("watch.watchRoom.showMyBroadcast")}
                      </button>
                    ) : null
                  }
                />
              </div>
            ) : (
            // Wrapped the same way the tile grid is: `main` doesn't scroll,
            // so the one thing in it that has a minimum height of its own
            // needs a box that can.
            <div onContextMenu={ownPreviewMenu} className="min-h-0 flex-1 overflow-y-auto">
              {/* min-h rather than h while the ad is in here: centred content
                  taller than a fixed-height box spills off its top, where no
                  scrolling reaches it. */}
              <div className={`flex ${partnerOnStage ? "min-h-full py-6" : "h-full"} min-h-75 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white/50 px-4 text-center dark:border-zinc-800 dark:bg-zinc-950/40`}>
                {/* Empty only because our own previews are hidden: saying nobody
                    is broadcasting, and offering to start, would be wrong about
                    the share that is going out right now. */}
                {ownPreviewHidden && hasOwnPreview ? (
                  <>
                    <p className="text-zinc-600 dark:text-zinc-400">
                      {translate("watch.watchRoom.yourBroadcastIsHidden")}
                    </p>
                    <button
                      type="button"
                      onClick={() => setOwnPreviewHidden(false)}
                      className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                    >
                      <EyeIcon className="h-5 w-5" />
                      {translate("watch.watchRoom.showMyBroadcast")}
                    </button>
                  </>
                ) : (
                <>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {translate("watch.watchRoom.nobodyIsBroadcastingYet")}
                </p>
                {/* The empty pane is the one place with room for the labelled
                    version of the header's icon toggles, and the one moment
                    when starting a share is the only thing anyone can do here.
                    Pointing at the header instead ("clique no ícone lá em
                    cima") asked the person to go find a control while standing
                    on the space where it fits. Only ever shown while nobody —
                    including us — is transmitting, so these are always "start",
                    never "stop": see nothingToShow. */}
                {screenShareMode === "unsupported" && !isMobileBrowser && (
                  <p className="text-sm text-zinc-500 dark:text-zinc-500">
                    {translate("watch.watchRoom.yourBrowserDoesNotAllowSharing2")}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  {/* Each is hidden outright rather than disabled here (unlike
                      the header's copies, which stay put so the row doesn't
                      reflow): this pane exists to offer what can be done right
                      now, and a wall of dead buttons is not that. The note
                      below says why, once, for whatever ends up missing. */}
                  {(screenShareMode === "display" || isMobileBrowser) && !screenBlockedReason && (
                    <button
                      type="button"
                      onClick={() => {
                        if (isMobileBrowser) {
                          setMobileScreenShareModalOpen(true);
                          return;
                        }
                        startShare("display");
                      }}
                      className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                    >
                      <ScreenIcon className="h-5 w-5" />
                      {translate("watch.watchRoom.shareScreen")}
                    </button>
                  )}

                  {screenShareMode !== "unsupported" && !cameraBlockedReason && (
                    <button
                      type="button"
                      onClick={() => startCameraShare()}
                      className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                    >
                      <CameraIcon className="h-5 w-5" />
                      {translate("watch.watchRoom.shareCamera")}
                    </button>
                  )}

                  {videoSourceBlockedReason ? (
                    <p className="basis-full text-center text-sm text-zinc-500 dark:text-zinc-500">
                      {translate("watch.watchRoom.theRoomSOwnerHasLimited")}
                    </p>
                  ) : (
                    <div className="basis-full flex justify-center">
                      <button
                        type="button"
                        onClick={openAddVideoSourcePopup}
                        className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                      >
                        <MdOutlineOndemandVideo className="h-5 w-5 shrink-0" />
                        {translate("watch.watchRoom.addVideoSource")}
                        <BetaMark />
                      </button>
                    </div>
                  )}
                </div>
                {partnerOnStage && (
                  <div className="mt-4 flex w-full justify-center">
                    <PartnerCard layout="stage" partner={rawActivePartner} loaded={partnerLoaded} />
                  </div>
                )}
                </>
                )}
              </div>
            </div>
            )
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
                    {translate("common.removeHighlight")}
                  </button>
                </div>
              )}
              {/* Nothing scrolls the page: from lg up `main` is a
                  fixed-height pane, so whichever layout is on below scrolls
                  inside this box or not at all. */}
              <div ref={videoPaneRef} onContextMenu={ownPreviewMenu} className="min-h-0 flex-1 overflow-y-auto">
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
                  <div
                    className={`flex h-full min-h-0 gap-2 sm:gap-3 ${
                      stripBeside ? "flex-row" : "flex-col"
                    }`}
                  >
                    {/* `min-h-0 flex-1` is what gives the tile inside a real
                        height to fill: `h-full` against a box sized by its own
                        content is circular, and the tile is the side that
                        gives up and collapses. `min-w-0` says the same thing
                        about width, which is what the strip takes when it is
                        standing beside the stage rather than under it. */}
                    <div className="min-h-0 min-w-0 flex-1">
                      {stageTile.render(
                        true,
                        false,
                        isWideLayout && rightSidebarCollapsed,
                        isWideLayout && leftSidebarCollapsed
                      )}
                    </div>
                    {stripTiles.length > 0 && (
                      /* Scrolls rather than wrapping onto a second line: the
                         whole point of the strip is to cost the stage a small,
                         fixed amount of one dimension however many people are
                         in the room. Which dimension is stripBeside's answer. */
                      <div
                        style={paneMeasured ? (stripBeside ? { width: stripSize } : { height: stripSize }) : undefined}
                        className={`shrink-0 ${
                          stripBeside ? "overflow-y-auto overflow-x-hidden" : "overflow-x-auto overflow-y-hidden"
                        }`}
                      >
                        <div
                          className={`flex gap-2 sm:gap-3 ${
                            stripBeside
                              ? "w-full flex-col"
                              : paneMeasured
                                ? "h-full"
                                : "h-20 sm:h-24 lg:h-28"
                          }`}
                        >
                          {stripTiles.map((tile) => (
                            <div
                              key={tile.id}
                              className={`relative aspect-video shrink-0 ${stripBeside ? "w-full" : "h-full"}`}
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
                                  aria-label={translate("watch.watchRoom.highlightThisBroadcast")}
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
                      // The tile in the top-right corner, which is where the
                      // floating "mostrar chat" button sits. One rule for
                      // every count now: with the arrangement measured
                      // rather than looked up, two tiles are as often one
                      // column as two, and "index 1" stopped meaning
                      // "top right" the moment they could be stacked.
                      const shouldOffsetRight =
                        isWideLayout &&
                        rightSidebarCollapsed &&
                        (isSingleTile ||
                          ((index + 1) % tileGridCols === 0 && index < tileGridCols));
                      // The top-left tile, under the floating "mostrar
                      // participantes" button (in a group, "mostrar grupos e salas").
                      const shouldOffsetLeft =
                        isWideLayout && leftSidebarCollapsed && index === 0;
                      return (
                        <Fragment key={tile.id}>
                          {isSingleTile && tile.id === "sponsored-partner-tile" ? (
                            <div className="flex h-full w-full items-center justify-center p-4">
                              {tile.render(true, false, shouldOffsetRight, shouldOffsetLeft)}
                            </div>
                          ) : (
                            tile.render(isSingleTile, false, shouldOffsetRight, shouldOffsetLeft)
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
        {isWideLayout && !rightSidebarCollapsed && !callLayout && (
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
              title={translate("watch.watchRoom.dragToResizeTheChatDouble")}
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
            tab strip floating under the video.

            Not while docked: nobody is looking at the room then, its controls
            are in the floating call bar (see inHeaderSlot), and an ad drawn
            where nobody can see it would be an impression counted for nothing. */}
        {!isWideLayout && visible && (
          <>
            {/* Out here rather than inside a sheet: this is the ad that pays
                for the room, and below lg the partner card collapses itself
                to a single slim line (see PartnerCard) — small enough to
                leave on screen, one tap from the whole card. Above the sheet
                rather than below it, so the sheet always comes up off the bar
                that opened it.

                Below lg the room is a fixed-height shell, which makes this
                band the one slot on the site that costs somebody video area
                rather than page. */}
            {!callLayout && !partnerOnStage && <PartnerCard partner={rawActivePartner} loaded={partnerLoaded} />}

            {mobilePanel && (
              <section
                ref={mobilePanelRef}
                onTouchStart={handlePanelTouchStart}
                onTouchMove={handlePanelTouchMove}
                onTouchEnd={handlePanelTouchEnd}
                onTouchCancel={handlePanelTouchEnd}
                // Mounted only while open, which is also what keeps the chat
                // opening on the newest message: ChatPanel jumps to the
                // bottom of the log on mount (see its initializedRef), and a
                // panel kept alive behind `display: none` cannot scroll
                // itself, so it would come back holding whatever position it
                // had when it was put away.
                className="relative z-10 flex h-[55dvh] min-h-72 shrink-0 flex-col border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 will-change-transform"
              >
                {/* The usual sheet grab bar, and a second way out: a sheet
                    whose only exit is the control that opened it is the kind
                    of thing people get stuck inside. */}
                <button
                  type="button"
                  data-panel-grab-handle
                  onClick={() => closeMobilePanel()}
                  aria-label={translate("common.close")}
                  className="group flex w-full shrink-0 cursor-pointer flex-col items-center justify-center py-2.5 touch-none select-none"
                >
                  <span className="h-1.5 w-12 rounded-full bg-zinc-300 transition-colors group-hover:bg-zinc-400 group-active:bg-zinc-500 dark:bg-zinc-700 dark:group-hover:bg-zinc-600 dark:group-active:bg-zinc-500" />
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
              <p className="relative z-20 flex shrink-0 items-center justify-center gap-1.5 border-t border-amber-200 bg-amber-50 py-1 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                {translate("common.connecting")}
              </p>
            )}

            {/* The bar itself: what you do *in* the room on the left (the
                controls that were wrapping into three rows up in the header,
                as far from the thumb as a phone can put them), what you open
                *over* it on the right. One row, thumb-sized targets, never
                scrolls, never moves. */}
            <div
              className="relative z-20 flex shrink-0 flex-col border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
              onTouchStart={handleDrawerTouchStart}
              onTouchEnd={handleDrawerTouchEnd}
            >
              {/* O Puxador: arrastar ou tocar para expandir menu com mais opções */}
              <button
                type="button"
                onClick={toggleMobileExtraMenu}
                aria-label={mobileExtraMenuOpen ? translate("watch.watchRoom.collapseOptions") : translate("watch.watchRoom.moreOptionsPullUp")}
                aria-expanded={mobileExtraMenuOpen}
                className="group flex w-full cursor-pointer flex-col items-center justify-center pt-1.5 pb-0.5 text-zinc-400 transition hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 select-none"
              >
                <span className="h-1 w-9 rounded-full bg-zinc-300 group-hover:bg-zinc-400 dark:bg-zinc-700 dark:group-hover:bg-zinc-600 transition-colors" />
                <div className="flex items-center gap-1 text-[10px] font-medium text-zinc-500 dark:text-zinc-400 mt-0.5">
                  <MdKeyboardArrowUp
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${
                      mobileExtraMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                  <span>{mobileExtraMenuOpen ? translate("watch.watchRoom.collapseOptions") : translate("watch.watchRoom.pullForMoreOptions")}</span>
                </div>
              </button>

              {/* O Menu Expandido: [fonte de video] [musica] [stream] */}
              {mobileExtraMenuOpen && (
                <div className="border-b border-zinc-200 bg-zinc-50/90 px-3 py-2.5 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/90 transition-all">
                  <div className="grid grid-cols-3 gap-2">
                    {/* [fonte de video] */}
                    <button
                      type="button"
                      onClick={() => {
                        openAddVideoSourcePopup();
                        setMobileExtraMenuOpen(false);
                      }}
                      disabled={Boolean(videoSourceBlockedReason)}
                      aria-label={translate("watch.watchRoom.addVideoSource")}
                      className="flex h-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white p-2 text-zinc-700 shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-400">
                        <MdOutlineOndemandVideo className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1">
                          <span className="text-center text-[11px] font-semibold leading-tight">
                            {translate("watch.watchRoom.video")}
                          </span>
                          <span className="text-[9px] font-bold leading-none"><BetaMark /></span>
                        </div>
                        <span className="text-[9px] font-medium leading-none text-zinc-400 dark:text-zinc-500 mt-0.5">
                          {translate("common.media")}
                        </span>
                      </div>
                    </button>

                    {/* [musica] */}
                    <button
                      type="button"
                      onClick={() => {
                        openAddMusicPopup();
                        setMobileExtraMenuOpen(false);
                      }}
                      disabled={!canManageMusic}
                      aria-label={state.music || myMusicSlot ? translate("common.changeTheRoomSMusic") : translate("common.playMusicInTheRoom")}
                      className="flex h-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white p-2 text-zinc-700 shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-400">
                        <MdMusicNote className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1">
                          <span className="text-center text-[11px] font-semibold leading-tight">
                            {translate("common.music")}
                          </span>
                          <span className="text-[9px] font-bold leading-none"><BetaMark /></span>
                        </div>
                        <span className="text-[9px] font-medium leading-none text-zinc-400 dark:text-zinc-500 mt-0.5">
                          {state.music || myMusicSlot ? translate("watch.watchRoom.playing") : translate("watch.watchRoom.stopped")}
                        </span>
                      </div>
                    </button>

                    {/* [stream] */}
                    <button
                      type="button"
                      onClick={() => {
                        if (!canUseStreamerMode) {
                          if (!state.account) setAccountModal("create");
                          return;
                        }
                        toggleStreamerMode();
                      }}
                      aria-label={streamerMode ? translate("watch.watchRoom.turnOffStreamerMode") : translate("watch.watchRoom.turnOnStreamerMode")}
                      className={`flex h-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-xl border p-2 shadow-sm transition active:scale-95 ${
                        streamerMode
                          ? "border-purple-500/60 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300"
                          : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                      }`}
                    >
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                          streamerMode
                            ? "bg-purple-600 text-white"
                            : "bg-purple-100 text-purple-600 dark:bg-purple-950/70 dark:text-purple-400"
                        }`}
                      >
                        <ObsSourceIcon className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1">
                          <span className="text-center text-[11px] font-semibold leading-tight">
                            {translate("watch.watchRoom.stream")}
                          </span>
                        </div>
                        <span
                          className={`text-[9px] font-bold leading-none mt-0.5 ${
                            streamerMode ? "text-purple-600 dark:text-purple-400" : "text-zinc-400 dark:text-zinc-500"
                          }`}
                        >
                          {streamerMode ? translate("common.on") : translate("common.off")}
                        </span>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Layout da barra de baixo: [mic] [escutar] [camera] [tela] [sair] | Chat Pessoas */}
              <nav className="flex shrink-0 items-center gap-1 px-1.5 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
                {/* 5 botões de chamada rigorosamente do mesmo tamanho: mic, mute, camera, tela, sair */}
                <div className="flex flex-1 min-w-0 items-center gap-1">
                  {/* 1. [mic] */}
                  <MicUsageHint
                    open={micHintOpen}
                    onDismiss={closeMicHint}
                    onEnableMic={enableMicFromHint}
                    tooltip={isMicOn ? translate("common.turnOffMicrophone") : (micBlockedReason ?? translate("common.turnOnMicrophone"))}
                    wrapperClassName={DOCK_SLOT}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        haptic(isMicOn ? "tap" : "confirm");
                        handleToggleMic();
                      }}
                      disabled={!isMicOn && Boolean(micBlockedReason)}
                      aria-pressed={isMicOn}
                      aria-label={isMicOn ? translate("common.turnOffMicrophone") : translate("common.turnOnMicrophone")}
                      className={`${DOCK_BUTTON} ${isMicOn ? DOCK_ON : DOCK_OFF}`}
                    >
                      {isMicOn ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5" />}
                    </button>
                  </MicUsageHint>

                  {/* 2. [escutar] */}
                  <Tooltip
                    content={micsMuted ? translate("common.unmuteMicrophones") : translate("common.muteMicrophones")}
                    wrapperClassName={DOCK_SLOT}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        haptic("tap");
                        toggleMicsMuted();
                      }}
                      aria-pressed={!micsMuted}
                      aria-label={micsMuted ? translate("common.unmuteMicrophones") : translate("common.muteMicrophones")}
                      className={`${DOCK_BUTTON} ${micsMuted ? DOCK_OFF : DOCK_ON}`}
                    >
                      {micsMuted ? (
                        <HeadphonesOffIcon className="h-5 w-5" />
                      ) : (
                        <HeadphonesIcon className="h-5 w-5" />
                      )}
                    </button>
                  </Tooltip>

                  {/* 3. [camera] do mesmo tamanho dos demais, e ao lado o pequeno junto para virar */}
                  {/* (and, with "Várias telas", the second-lens button between them) */}
                  {screenShareMode !== "unsupported" && (
                    <div
                      className="flex min-w-0 items-stretch"
                      style={{
                        flex: showDualCameraButton ? "1 1 4rem" : canSwitchCamera ? "1 1 1.5rem" : "1 1 0%",
                      }}
                    >
                      <Tooltip
                        content={
                          localCameraStream
                            ? translate("watch.watchRoom.stopCamera")
                            : (cameraBlockedReason ?? translate("watch.watchRoom.shareCamera"))
                        }
                        wrapperClassName="flex min-w-0 flex-1 items-center justify-center"
                      >
                        <button
                          type="button"
                          onClick={() => (localCameraStream ? stopCameraShare() : startCameraShare())}
                          disabled={!localCameraStream && Boolean(cameraBlockedReason)}
                          aria-pressed={Boolean(localCameraStream)}
                          aria-label={localCameraStream ? translate("watch.watchRoom.stopCamera") : translate("watch.watchRoom.shareCamera")}
                          className={`${DOCK_BUTTON_BASE} ${
                            canSwitchCamera ? "rounded-r-none" : ""
                          } ${localCameraStream ? DOCK_LIVE : DOCK_ON}`}
                        >
                          <CameraIcon className="h-5 w-5" />
                        </button>
                      </Tooltip>
                      {/* Front and rear at once — part of "Várias telas". */}
                      {showDualCameraButton && (
                        // The "novo" tip on a phone, where the desktop's "+" for
                        // screens does not exist: pinned over this button, once.
                        <Tippy
                          visible={dualCameraTip.show}
                          placement="top"
                          interactive
                          theme="golive-panel"
                          appendTo={() => document.body}
                          content={
                            <span
                              role="status"
                              className="relative block w-60 rounded-lg bg-blue-600 px-3 py-2 text-left text-xs font-medium text-white shadow-lg"
                            >
                              <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-blue-600" />
                              <span className="flex items-start gap-2">
                                <span className="flex-1">{translate("watch.watchRoom.dualCameraTip")}</span>
                                <button
                                  type="button"
                                  onClick={dualCameraTip.dismiss}
                                  aria-label={translate("watch.watchRoom.clipsModeTipDismiss")}
                                  className="-m-1 rounded p-1 leading-none text-white/80 hover:text-white"
                                >
                                  ✕
                                </button>
                              </span>
                            </span>
                          }
                        >
                        <span className="flex shrink-0">
                        <Tooltip
                          content={
                            <span className="inline-flex items-center gap-1.5">
                              {dualCamera.active
                                ? translate("watch.watchRoom.dualCameraOff")
                                : translate("watch.watchRoom.dualCameraOn")}
                              <NewBadge id="dual-camera" />
                            </span>
                          }
                          wrapperClassName="flex shrink-0"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              haptic("tap");
                              if (dualCameraTip.show) dualCameraTip.clicked();
                              if (dualCamera.active) {
                                dualCamera.stop();
                                return;
                              }
                              markFeatureUsed("dual-camera");
                              trackFeatureEvent(MULTI_SCREEN_EVENTS.dualCamera);
                              void startDualCamera();
                            }}
                            aria-pressed={dualCamera.active}
                            aria-label={
                              dualCamera.active
                                ? translate("watch.watchRoom.dualCameraOff")
                                : translate("watch.watchRoom.dualCameraOn")
                            }
                            className={`relative flex h-11 w-10 shrink-0 items-center justify-center border-l border-white/20 text-white transition active:scale-95 ${
                              dualCamera.active ? DOCK_LIVE : DOCK_ON
                            }`}
                          >
                            <CameraIcon className="h-5 w-5" />
                            {/* The "+" as a small badge on the camera, not a
                                second glyph beside it — two glyphs did not fit. */}
                            <span className="absolute top-1.5 right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-zinc-900 shadow">
                              {dualCamera.active ? (
                                <MdClose className="h-2.5 w-2.5" />
                              ) : (
                                <MdAdd className="h-2.5 w-2.5" />
                              )}
                            </span>
                          </button>
                        </Tooltip>
                        </span>
                        </Tippy>
                      )}
                      {canSwitchCamera && (
                        <Tooltip content={switchCameraLabel} wrapperClassName="flex shrink-0">
                          <button
                            type="button"
                            onClick={switchCamera}
                            disabled={!localCameraStream && Boolean(cameraBlockedReason)}
                            aria-label={switchCameraLabel}
                            className={`flex h-11 w-6 shrink-0 items-center justify-center rounded-r-xl border-l border-white/20 text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                              localCameraStream ? DOCK_LIVE : DOCK_ON
                            }`}
                          >
                            <MdCameraswitch className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  )}

                  {/* 4. [tela] */}
                  <Tooltip
                    content={
                      isMobileBrowser
                        ? (screenBlockedReason ?? translate("watch.watchRoom.shareScreen"))
                        : screenShareMode !== "display"
                          ? translate("watch.watchRoom.screenSharingNotSupportedInThis")
                          : localStream
                            ? translate("watch.watchRoom.stopSharingTheScreen")
                            : (screenBlockedReason ?? translate("watch.watchRoom.shareScreen"))
                    }
                    wrapperClassName={DOCK_SLOT}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (isMobileBrowser) {
                          setMobileScreenShareModalOpen(true);
                          return;
                        }
                        if (screenShareMode !== "display") return;
                        if (anyScreenSharing) stopAllScreens();
                        else if (onPhone) setQualityPrompt("screen");
                        else startShare("display");
                      }}
                      disabled={
                        isMobileBrowser
                          ? Boolean(screenBlockedReason)
                          : screenShareMode !== "display" || (!localStream && Boolean(screenBlockedReason))
                      }
                      aria-pressed={Boolean(localStream)}
                      aria-label={localStream ? translate("watch.watchRoom.stopSharingTheScreen") : translate("watch.watchRoom.shareScreen")}
                      className={`${DOCK_BUTTON} ${
                        !isMobileBrowser && screenShareMode !== "display"
                          ? "bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
                          : localStream
                            ? DOCK_LIVE
                            : DOCK_ON
                      }`}
                    >
                      <ScreenIcon className="h-5 w-5" />
                    </button>
                  </Tooltip>

                  {/* 5. [sair] */}
                  <Tooltip content={translate("common.leaveTheCall")} wrapperClassName={DOCK_SLOT}>
                    <button
                      type="button"
                      onClick={() => {
                        haptic("reject");
                        playHangUpSound();
                        onDisconnect();
                      }}
                      aria-label={translate("common.leaveTheCall")}
                      className={`${DOCK_BUTTON} bg-red-600 hover:bg-red-700 active:bg-red-800 text-white`}
                    >
                      <MdCallEnd className="h-5 w-5" />
                    </button>
                  </Tooltip>
                </div>

                {/* Divisor | */}
                {!callLayout && (
                  <span className="mx-0.5 sm:mx-1 h-8 w-px shrink-0 bg-zinc-200 dark:bg-zinc-800" />
                )}

                {/* 6. Chat e 7. Pessoas — a direct call has neither: the
                    conversation is right under it, and it says who is in it
                    (see components/CallStage). */}
                {!callLayout && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      haptic("tap");
                      toggleMobilePanel("chat");
                    }}
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
                    <span className="text-[10px] font-medium leading-none truncate max-w-full">{translate("common.chat")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      haptic("tap");
                      toggleMobilePanel("participants");
                    }}
                    aria-pressed={mobilePanel === "participants"}
                    className={`${DOCK_TAB} ${mobilePanel === "participants" ? DOCK_TAB_ACTIVE : DOCK_TAB_IDLE}`}
                  >
                    <span className="relative">
                      <MdOutlinePeople className="h-5 w-5" />
                      <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-zinc-600 dark:bg-zinc-700 px-1 text-center text-[10px] font-bold leading-4 text-white">
                        {peerCount}
                      </span>
                    </span>
                    <span className="text-[10px] font-medium leading-none truncate max-w-full">{translate("watch.watchRoom.people")}</span>
                  </button>
                </div>
                )}
              </nav>
            </div>
          </>
        )}
      </div>

      <AccountModal
        mode={accountModal}
        onModeChange={setAccountModal}
        initialDisplayName={state.name ?? ""}
      />

      {/* Hidden while the account dialog is up, rather than closed: "Criar
          conta grátis" opens that one *over* this, and someone who backs out
          of registering should find the explanation still there instead of
          having silently spent it. */}
      <GuestBroadcastLimitModal
        open={Boolean(state.guestBroadcastLimit) && accountModal === null}
        ended={state.guestBroadcastLimit?.ended ?? false}
        limitSeconds={state.guestBroadcastLimit?.limitSeconds ?? 0}
        onCreateAccount={() => setAccountModal("create")}
        onClose={() => signalingClient.clearGuestBroadcastLimit()}
      />

      {/* "A transmissao por GPU ficou melhor?", after a long one. Decides for
          itself whether there is anything to ask and whether this person is
          on the experiment — see lib/gpuShareSurvey.ts. */}
      <GpuShareSurveyModal />

      <KeyboardShortcutsModal
        open={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
        hasAccount={Boolean(state.account)}
        onRequestAccount={() => setAccountModal("create")}
      />

      <StreamerModeModal open={streamerModeIntroOpen} onClose={() => setStreamerModeIntroOpen(false)} />

      <ObsBrowserSourceModal
        open={Boolean(obsModalUrl)}
        url={obsModalUrl ?? ""}
        onClose={() => setObsModalUrl(null)}
      />

      <MobileScreenShareModal
        open={mobileScreenShareModalOpen}
        onClose={() => setMobileScreenShareModalOpen(false)}
      />
    </div>
  );
}

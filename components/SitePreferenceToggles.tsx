"use client";

import { useSyncExternalStore } from "react";
import { MdOutlineDesktopWindows, MdPalette } from "react-icons/md";
import { EyeOffIcon, FocusIcon, SpeakerIcon, SpeakerMuteIcon } from "@/components/icons";
import { MenuToggleRow } from "@/components/MenuToggleRow";
import { trackEvent } from "@/lib/analytics";
import { isDesktopApp } from "@/lib/desktop";
import {
  setStoredDoubleClickFocus,
  setStoredOpenInAppDismissed,
  setStoredOpenRoomsInApp,
} from "@/lib/mediaPreferences";
import { setProfileSongAutoplay, useProfileSongAutoplay } from "@/lib/profileSong";
import {
  isRoomThemeOptedOut,
  isRoomThemeOptedOutServer,
  setRoomThemeOptedOut,
  subscribeRoomThemeOptOut,
} from "@/lib/roomThemes";
import { setSoundEffectsEnabled, useSoundEffectsEnabled } from "@/lib/soundEffects";
import { useT } from "@/lib/useI18n";
import { useStoredDoubleClickFocus, useStoredOpenRoomsInApp } from "@/lib/usePreferences";

// The switches about this browser rather than about a call. One definition of
// each, drawn by the room's "Mais opções", the group bar's and the "Configurações"
// dialog, so they can never disagree about what they do or what they show.

export function RoomThemeToggle() {
  const t = useT();
  const optedOut = useSyncExternalStore(
    subscribeRoomThemeOptOut,
    isRoomThemeOptedOut,
    isRoomThemeOptedOutServer
  );
  // Worded as the *permission* rather than as the result — "usar o tema da
  // sala" reads as a thing you are turning off, where "sempre usar o meu" would
  // read as a second theme picker.
  return (
    <MenuToggleRow
      label={t("watch.watchRoom.useTheRoomSTheme")}
      active={!optedOut}
      onToggle={() => setRoomThemeOptedOut(!optedOut)}
      activeIcon={<MdPalette className="h-4 w-4" />}
      inactiveIcon={<MdPalette className="h-4 w-4" />}
      hint={optedOut ? t("watch.watchRoom.roomsWillNeverChangeYourTheme") : t("watch.watchRoom.turnItOffToNeverEnd")}
    />
  );
}

export function DoubleClickFocusToggle() {
  const t = useT();
  const on = useStoredDoubleClickFocus();
  return (
    <MenuToggleRow
      label={t("watch.watchRoom.doubleClickToFocus")}
      active={on}
      onToggle={() => setStoredDoubleClickFocus(!on)}
      hint={t("watch.watchRoom.whenOffFocusingAVideoIs")}
      activeIcon={<FocusIcon className="h-4 w-4" />}
      inactiveIcon={<EyeOffIcon className="h-4 w-4" />}
    />
  );
}

export function ProfileSongToggle() {
  const t = useT();
  const on = useProfileSongAutoplay();
  return (
    <MenuToggleRow
      label={t("watch.watchRoom.musicOnProfiles")}
      active={on}
      onToggle={() => setProfileSongAutoplay(!on)}
      hint={t("watch.watchRoom.whenOffAProfileSMusic")}
      activeIcon={<SpeakerIcon className="h-4 w-4" />}
      inactiveIcon={<SpeakerMuteIcon className="h-4 w-4" />}
    />
  );
}

export function SoundEffectsToggle() {
  const t = useT();
  const on = useSoundEffectsEnabled();
  return (
    <MenuToggleRow
      label={t("watch.watchRoom.siteSoundEffects")}
      active={on}
      onToggle={() => {
        const next = !on;
        setSoundEffectsEnabled(next);
        trackEvent(next ? "sound_effects_on" : "sound_effects_off");
      }}
      activeIcon={<SpeakerIcon className="h-4 w-4" />}
      inactiveIcon={<SpeakerMuteIcon className="h-4 w-4" />}
    />
  );
}

function noopSubscribe() {
  return () => {};
}

/**
 * Only outside the desktop app: inside it, asking whether to use the app is a
 * question about something already true. True on the server, so the row only
 * ever appears once the client has said otherwise.
 *
 * The stored value doubles as "this browser has the app" — RoomAppGate sets it
 * the first time a handoff demonstrably worked, and this row is how somebody
 * turns the asking off again, or on if they installed the app without ever
 * using the banner.
 */
export function OpenRoomsInAppToggle() {
  const t = useT();
  const on = useStoredOpenRoomsInApp();
  const inDesktopApp = useSyncExternalStore(noopSubscribe, isDesktopApp, () => true);
  if (inDesktopApp) return null;
  return (
    <MenuToggleRow
      label={t("watch.watchRoom.askBeforeOpeningRooms")}
      active={on}
      onToggle={() => {
        const next = !on;
        setStoredOpenRoomsInApp(next);
        // Turning it on also clears any earlier "agora não", so the two
        // controls cannot end up disagreeing about what was decided.
        if (next) setStoredOpenInAppDismissed(false);
        trackEvent(next ? "open_rooms_in_app_on" : "open_rooms_in_app_off");
      }}
      hint={t("watch.watchRoom.whenYouOpenARoomLink")}
      activeIcon={<MdOutlineDesktopWindows className="h-4 w-4" />}
      inactiveIcon={<MdOutlineDesktopWindows className="h-4 w-4 opacity-50" />}
    />
  );
}

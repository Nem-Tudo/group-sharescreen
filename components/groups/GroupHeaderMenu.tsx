"use client";

import { useState, useSyncExternalStore } from "react";
import { MdOutlineDesktopWindows, MdPalette } from "react-icons/md";
import { EyeOffIcon, FocusIcon, MoreIcon, SpeakerIcon, SpeakerMuteIcon } from "@/components/icons";
import { MenuToggleRow } from "@/components/MenuToggleRow";
import { MobileSheet } from "@/components/MobileSheet";
import { useRoomProOffer } from "@/components/RoomProOffer";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { Popover } from "@/components/Tooltip";
import { trackEvent } from "@/lib/analytics";
import { isDesktopApp } from "@/lib/desktop";
import {
  getStoredDoubleClickFocus,
  getStoredOpenRoomsInApp,
  setStoredDoubleClickFocus,
  setStoredOpenInAppDismissed,
  setStoredOpenRoomsInApp,
} from "@/lib/mediaPreferences";
import { getProfileSongAutoplay, setProfileSongAutoplay } from "@/lib/profileSong";
import {
  isRoomThemeOptedOut,
  isRoomThemeOptedOutServer,
  setRoomThemeOptedOut,
  subscribeRoomThemeOptOut,
} from "@/lib/roomThemes";
import { getSoundEffectsEnabled, setSoundEffectsEnabled } from "@/lib/soundEffects";
import { SM_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { useT } from "@/lib/useI18n";

// The room's "Mais opções", for the group's bar while no voice room is on
// screen to put its own there (see WatchRoom's inHeaderSlot, which portals the
// room's into the same corner while it is). The Pro button beside it is
// components/RoomProOffer's, placed by the bar.
//
// The menu carries the settings that are about this browser rather than about
// a call — the look of the site, its sounds, how focusing and profiles behave.
// The call's own (noise suppression, joining broadcasts, direct connections,
// quality) stay in the room's menu: they change a call that is running, which
// a menu drawn with no call in reach cannot do.

function noopSubscribe() {
  return () => {};
}

export function GroupHeaderMenu() {
  const t = useT();
  const isDesktopLayout = useMediaQuery(SM_BREAKPOINT_QUERY);
  const offer = useRoomProOffer();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const roomThemeOptedOut = useSyncExternalStore(
    subscribeRoomThemeOptOut,
    isRoomThemeOptedOut,
    isRoomThemeOptedOutServer
  );
  // The desktop app never asks whether to open rooms in the app. True on the
  // server, so the row only ever appears once the client has said otherwise.
  const inDesktopApp = useSyncExternalStore(noopSubscribe, isDesktopApp, () => true);
  const [doubleClickFocus, setDoubleClickFocus] = useState(getStoredDoubleClickFocus);
  const [profileSongAutoplay, setProfileSongAutoplayState] = useState(getProfileSongAutoplay);
  const [soundEffectsOn, setSoundEffectsOn] = useState(getSoundEffectsEnabled);
  const [openRoomsInApp, setOpenRoomsInApp] = useState(getStoredOpenRoomsInApp);

  const items = (
    <>
      {/* The premium offer, which a phone's bar has no room for. */}
      {!isDesktopLayout && (
        <button
          type="button"
          onClick={() => {
            close();
            trackEvent("pro_button_clicked", { offer: offer.label });
            offer.onPress();
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <offer.Icon className={`h-4 w-4 shrink-0 ${offer.iconClassName}`} />
          {offer.label}
        </button>
      )}

      <a
        href="https://discord.gg/nemtudo"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg px-2 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:text-red-500 dark:hover:bg-red-950/40"
      >
        {t("watch.watchRoom.reportABug")}
      </a>

      <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />

      <div className="mb-1 px-1">
        <p className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{t("common.theme")}</p>
        <ThemeSegmented />
      </div>
      <MenuToggleRow
        label={t("watch.watchRoom.useTheRoomSTheme")}
        active={!roomThemeOptedOut}
        onToggle={() => setRoomThemeOptedOut(!roomThemeOptedOut)}
        activeIcon={<MdPalette className="h-4 w-4" />}
        inactiveIcon={<MdPalette className="h-4 w-4" />}
        hint={
          roomThemeOptedOut
            ? t("watch.watchRoom.roomsWillNeverChangeYourTheme")
            : t("watch.watchRoom.turnItOffToNeverEnd")
        }
      />

      <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />

      <MenuToggleRow
        label={t("watch.watchRoom.doubleClickToFocus")}
        active={doubleClickFocus}
        onToggle={() => {
          const next = !doubleClickFocus;
          setDoubleClickFocus(next);
          setStoredDoubleClickFocus(next);
        }}
        hint={t("watch.watchRoom.whenOffFocusingAVideoIs")}
        activeIcon={<FocusIcon className="h-4 w-4" />}
        inactiveIcon={<EyeOffIcon className="h-4 w-4" />}
      />
      <MenuToggleRow
        label={t("watch.watchRoom.musicOnProfiles")}
        active={profileSongAutoplay}
        onToggle={() => {
          const next = !profileSongAutoplay;
          setProfileSongAutoplayState(next);
          setProfileSongAutoplay(next);
        }}
        hint={t("watch.watchRoom.whenOffAProfileSMusic")}
        activeIcon={<SpeakerIcon className="h-4 w-4" />}
        inactiveIcon={<SpeakerMuteIcon className="h-4 w-4" />}
      />
      <MenuToggleRow
        label={t("watch.watchRoom.siteSoundEffects")}
        active={soundEffectsOn}
        onToggle={() => {
          const next = !soundEffectsOn;
          setSoundEffectsOn(next);
          setSoundEffectsEnabled(next);
          trackEvent(next ? "sound_effects_on" : "sound_effects_off");
        }}
        activeIcon={<SpeakerIcon className="h-4 w-4" />}
        inactiveIcon={<SpeakerMuteIcon className="h-4 w-4" />}
      />
      {!inDesktopApp && (
        <MenuToggleRow
          label={t("watch.watchRoom.askBeforeOpeningRooms")}
          active={openRoomsInApp}
          onToggle={() => {
            const next = !openRoomsInApp;
            setOpenRoomsInApp(next);
            setStoredOpenRoomsInApp(next);
            // Same as the room's row: turning it on clears an earlier "agora não".
            if (next) setStoredOpenInAppDismissed(false);
            trackEvent(next ? "open_rooms_in_app_on" : "open_rooms_in_app_off");
          }}
          hint={t("watch.watchRoom.whenYouOpenARoomLink")}
          activeIcon={<MdOutlineDesktopWindows className="h-4 w-4" />}
          inactiveIcon={<MdOutlineDesktopWindows className="h-4 w-4 opacity-50" />}
        />
      )}
    </>
  );

  return (
    <>
      <Popover
        open={isDesktopLayout && open}
        onClose={close}
        placement="bottom-end"
        tooltip={t("watch.watchRoom.moreOptions")}
        content={
          <div className="flex max-h-[80vh] w-80 flex-col gap-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
            {items}
          </div>
        }
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={t("watch.watchRoom.moreOptions")}
          className={`shrink-0 rounded-lg border p-2 transition ${open
            ? "border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            }`}
        >
          <MoreIcon className="h-5 w-5" />
        </button>
      </Popover>
      {!isDesktopLayout && (
        <MobileSheet open={open} onClose={close} title={t("watch.watchRoom.moreOptions")}>
          <div className="flex flex-col gap-1 pb-2">{items}</div>
        </MobileSheet>
      )}
    </>
  );
}

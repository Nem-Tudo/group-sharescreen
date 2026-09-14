"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { MdGroups } from "react-icons/md";
import {
  fetchPublicRoomDirectory,
  roomActivity,
  type PublicGroupRoom,
  type PublicRoom,
} from "@/lib/roomsApi";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupName } from "@/components/groups/GroupName";
import { groupPath } from "@/lib/groupLinks";
import { Tooltip } from "@/components/Tooltip";
import { ThemeMenuButton } from "@/components/ThemeToggle";
import { UpdateAppButton } from "@/components/UpdateAppButton";
import { CameraIcon, MicIcon, ScreenIcon, VideoSourceIcon } from "@/components/icons";
import { roomCategory } from "@/lib/roomCategories";
import { AdsterraNative } from "@/components/AdsterraNative";
import { useI18n } from "@/lib/useI18n";
import { translate, translateCount } from "@/lib/i18n";
import { RoomsViewSwitch } from "@/components/RoomsViewSwitch";
import { useTabBarEnabled } from "@/lib/mobileShell";

const POLL_INTERVAL_MS = 8000;

// How the list is ordered. The default is microphones rather than head count
// on purpose: a room where people are actually talking is the one worth
// walking into, and a big idle room full of parked tabs is not — head count
// alone can't tell those apart, so it's the tiebreaker instead of the key.
const SORT_OPTIONS = [
  { value: "mic", get label() { return translate("rooms.roomsPageClient.mostActiveMicrophones"); } },
  { value: "people", get label() { return translate("rooms.roomsPageClient.mostPeopleConnected"); } },
  // Screens only — a room full of cameras is a different room, and the
  // server counts the two channels apart for exactly that reason.
  { value: "screen", get label() { return translate("rooms.roomsPageClient.mostScreenSharing"); } },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]["value"];

// One entry of the list: a public room, or a public group's call — the second
// carries its group and room, and is opened through the group (see the
// server's /rooms `groupRooms`). Both share every counter the list sorts on,
// so they sort together rather than in two lists.
type ListedRoom = PublicRoom & {
  group?: PublicGroupRoom["group"];
  channel?: PublicGroupRoom["channel"];
};

const DEFAULT_SORT: SortValue = "mic";

function sortRooms(rooms: ListedRoom[], sort: SortValue): ListedRoom[] {
  // Every ordering falls back to people, then to the older room first — the
  // same last resort the server's own /rooms ordering uses, so a list of
  // rooms sitting at zero doesn't reshuffle itself on every poll.
  const primary = (room: ListedRoom): number => {
    if (sort === "mic") return roomActivity(room, "micCount");
    if (sort === "screen") return roomActivity(room, "screenCount");
    return room.peopleCount;
  };
  return [...rooms].sort(
    (a, b) =>
      primary(b) - primary(a) ||
      b.peopleCount - a.peopleCount ||
      a.createdAt - b.createdAt
  );
}

function formatActiveFor(createdAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (seconds < 60) return translate("rooms.roomsPageClient.aFewSecondsAgo");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return translate("rooms.roomsPageClient.minutesValueAgo", { minutes, value: translateCount("common.minuteNoun", minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translate("rooms.roomsPageClient.hoursValueAgo", { hours, value: translateCount("common.hourNoun", hours) });
  const days = Math.floor(hours / 24);
  return translate("rooms.roomsPageClient.daysValueAgo", { days, value: translateCount("common.dayNoun", days) });
}

// One counter on a room's card. Dimmed at zero rather than hidden: the three
// always sit in the same order in the same place, so cards stay comparable at
// a glance instead of each having a layout of its own.
function RoomStat({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: number;
  label: string;
}) {
  return (
    <Tooltip content={label}>
      <span
        className={`flex items-center gap-1 tabular-nums ${
          value > 0
            ? "text-zinc-700 dark:text-zinc-200"
            : "text-zinc-400 dark:text-zinc-600"
        }`}
      >
        {icon}
        {value}
        <span className="sr-only">{label}</span>
      </span>
    </Tooltip>
  );
}

export function RoomsPageClient() {
  const { t, tc } = useI18n();
  const [rooms, setRooms] = useState<ListedRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortValue>(DEFAULT_SORT);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const data = await fetchPublicRoomDirectory(controller.signal);
        if (cancelled) return;
        setRooms([...data.rooms, ...data.groupRooms]);
        setError(null);
      } catch {
        if (!cancelled) setError(t("common.couldNotLoadThePublicRooms"));
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [t]);

  // Sorted before filtering so the order is a property of the list itself and
  // not of whatever happens to be typed in the search box.
  const filtered = useMemo(
    () =>
      sortRooms(rooms ?? [], sort).filter((r) => {
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        // A group's call is found by its room's name or its group's, never
        // by the internal handle nobody sees.
        if (r.group && r.channel) {
          return r.channel.name.toLowerCase().includes(needle) || r.group.name.toLowerCase().includes(needle);
        }
        return r.handle.toLowerCase().includes(needle);
      }),
    [rooms, sort, search]
  );

  const tabBar = useTabBarEnabled();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 px-4 pt-5 pb-6 sm:py-10 dark:bg-black">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {t("common.publicRooms")}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t("rooms.roomsPageClient.roomsWithAtLeastOnePerson")}
            </p>
          </div>
          {/* This page has no SiteHeader to hang the theme switch off, and
              it's a page people leave open — so it gets its own copy next to
              the way out. The setting itself is one global preference (see
              lib/theme.ts); this is just another place to reach it. */}
          <div className="flex shrink-0 items-center gap-1.5">
            <RoomsViewSwitch current="list" />
            {/* On a phone the tabs already lead home and the Você tab holds
                the theme — see lib/mobileShell. */}
            <span className={tabBar ? "hidden lg:contents" : "contents"}>
            <ThemeMenuButton />
            {/* Same reasoning as the theme switch beside it: no SiteHeader
                here to carry it, and this is a page people leave open. */}
            <UpdateAppButton />
            <Link
              href="/"
              className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {t("common.home")}
            </Link>
            </span>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("rooms.roomsPageClient.searchRoomByName")}
            className="w-full min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <label className="flex shrink-0 items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <span className="shrink-0">{t("rooms.roomsPageClient.sortBy")}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortValue)}
              className="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 sm:w-auto dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-6">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          {!error && rooms === null && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading2")}</p>
          )}

          {!error && rooms !== null && filtered.length === 0 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {rooms.length === 0
                ? t("rooms.roomsPageClient.noPublicRoomActiveAtThe")
                : t("rooms.roomsPageClient.noRoomFoundForThatSearch")}
            </p>
          )}

          {/* Above the list rather than after it, and outside the <ul> rather
              than as a row in it: a native unit is built to look like the
              content around it, so one dropped between two rooms would read
              as a room. It takes no space at all until it has an ad — see
              AdsterraNative's placeholder — so an empty one leaves the list
              exactly where it was. */}
          <AdsterraNative className="mb-4" />

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filtered.map((room) => {
              const category = roomCategory(room.category);
              const title = room.channel?.name ?? room.handle;
              const href = room.group && room.channel ? groupPath(room.group.id, room.channel.id) : `/watch/${room.handle}`;
              return (
              <li
                key={room.handle}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {/* The name is truncated to keep the card one line wide —
                        the tooltip is what makes a long one readable at all. */}
                    <Tooltip content={title}>
                      <p className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                        {title}
                      </p>
                    </Tooltip>
                    {/* A call in a group — said on the card, because walking
                        into it is also joining the group. */}
                    {room.group && (
                      <Tooltip content={t("rooms.roomsPageClient.groupCallHint", { group: room.group.name })}>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                          <MdGroups className="h-3.5 w-3.5" />
                          {t("rooms.roomsPageClient.groupBadge")}
                        </span>
                      </Tooltip>
                    )}
                    {category && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${category.className}`}
                      >
                        {category.label}
                      </span>
                    )}
                  </div>
                  {room.group && (
                    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                      <GroupIcon
                        name={room.group.name}
                        iconUrl={room.group.iconUrl}
                        seed={room.group.id}
                        size={16}
                        className="shrink-0 rounded"
                      />
                      <GroupName name={room.group.name} flags={room.group.flags} className="min-w-0" badgeClassName="h-3.5 w-3.5" />
                    </p>
                  )}
                  {/* Only when there is one — an empty line here would push
                      every other card's layout around for nothing. */}
                  {room.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-300">
                      {room.description}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {tc("common.personCount", room.peopleCount)} {t("rooms.roomsPageClient.active")}{" "}
                    {formatActiveFor(room.createdAt)}
                  </p>
                  {/* Microfones, telas, câmeras e vídeos. Screens and cameras
                      sit side by side rather than rolled into one "sharing"
                      number: they say different things about what is going on
                      in there, and the sort menu orders on the screen half. */}
                  <div className="mt-1.5 flex items-center gap-2.5 text-xs">
                    <RoomStat
                      icon={<MicIcon className="h-3.5 w-3.5" />}
                      value={roomActivity(room, "micCount")}
                      label={t("rooms.roomsPageClient.activeMicrophones")}
                    />
                    <RoomStat
                      icon={<ScreenIcon className="h-3.5 w-3.5" />}
                      value={roomActivity(room, "screenCount")}
                      label={t("rooms.roomsPageClient.screensBroadcast")}
                    />
                    <RoomStat
                      icon={<CameraIcon className="h-3.5 w-3.5" />}
                      value={roomActivity(room, "cameraCount")}
                      label={t("rooms.roomsPageClient.camerasOn")}
                    />
                    <RoomStat
                      icon={<VideoSourceIcon className="h-3.5 w-3.5" />}
                      value={roomActivity(room, "videoSourceCount")}
                      label={t("rooms.roomsPageClient.videoSources")}
                    />
                  </div>
                </div>
                <Link
                  href={href}
                  className="shrink-0 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  {t("common.signIn")}
                </Link>
              </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

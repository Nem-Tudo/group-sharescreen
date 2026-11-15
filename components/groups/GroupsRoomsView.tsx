"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MdClose, MdGroups, MdOutlineMap, MdPeopleOutline, MdSearch } from "react-icons/md";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { markFeatureUsed } from "@/components/NewBadge";
import { Tooltip } from "@/components/Tooltip";
import { CameraIcon, MicIcon, ScreenIcon } from "@/components/icons";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupLink } from "@/components/groups/GroupLink";
import { GroupName } from "@/components/groups/GroupName";
import { GroupsHome } from "@/components/groups/GroupsHome";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { groupPath } from "@/lib/groupLinks";
import { GROUPS_ROOMS_EVENTS, GROUPS_ROOMS_FEATURE, takeGroupsRoomsSource } from "@/lib/groupsRooms";
import { roomCategory } from "@/lib/roomCategories";
import { roomMatches, sortRooms, type ListedRoom, type RoomSort } from "@/lib/roomDirectory";
import { fetchPublicRoomDirectory, roomActivity } from "@/lib/roomsApi";
import { useI18n } from "@/lib/useI18n";

// /groups/rooms — every public room open right now (the same list as /rooms),
// drawn in the middle of the group shell, so the rail of groups and the
// conversations stay where they are around it. Denser than /rooms: one small
// card per room, as many columns as the middle has width for, and only the
// counters that are not zero.
//
// Behind the experiment "groups-rooms" (see lib/groupsRooms). Somebody outside
// it who opens the address gets /groups, as before.

const POLL_INTERVAL_MS = 8000;
const SORTS: { value: RoomSort; event: number; icon: ReactNode; label: string; hint: string }[] = [
  {
    value: "mic",
    event: 1,
    icon: <MicIcon className="h-4 w-4" />,
    label: "groups.roomsTab.sortMic",
    hint: "rooms.roomsPageClient.mostActiveMicrophones",
  },
  {
    value: "people",
    event: 2,
    icon: <MdPeopleOutline className="h-4 w-4" />,
    label: "groups.roomsTab.sortPeople",
    hint: "rooms.roomsPageClient.mostPeopleConnected",
  },
  {
    value: "screen",
    event: 3,
    icon: <ScreenIcon className="h-4 w-4" />,
    label: "groups.roomsTab.sortScreen",
    hint: "rooms.roomsPageClient.mostScreenSharing",
  },
];

/** The list, or /groups for somebody the experiment does not include. */
export function GroupsRoomsPage() {
  const { enabled, ready } = useFeature(GROUPS_ROOMS_FEATURE, { track: false });
  if (!ready) return <div className="min-h-0 flex-1" />;
  return enabled ? <GroupsRoomsView /> : <GroupsHome />;
}

function GroupsRoomsView() {
  const { t, tc } = useI18n();
  const [rooms, setRooms] = useState<ListedRoom[] | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<RoomSort>("mic");
  const [opening, setOpening] = useState<string | null>(null);
  const searchedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    trackFeatureEvent(GROUPS_ROOMS_EVENTS.open, { value: takeGroupsRoomsSource(), feature: GROUPS_ROOMS_FEATURE });
    markFeatureUsed(GROUPS_ROOMS_FEATURE);
  }, []);

  // Polled while the list is on screen, and only while the tab is visible:
  // a backgrounded /groups is the norm, and nobody is reading it then.
  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;
    async function load() {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      controller = new AbortController();
      try {
        const data = await fetchPublicRoomDirectory(controller.signal);
        if (cancelled) return;
        setRooms([...data.rooms, ...data.groupRooms]);
        setError(false);
      } catch {
        if (!cancelled && !controller.signal.aborted) setError(true);
      }
    }
    void load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // "/" puts the cursor in the search, as on /groups.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const sorted = useMemo(() => sortRooms(rooms ?? [], sort), [rooms, sort]);
  const shown = useMemo(() => sorted.filter((r) => roomMatches(r, search)), [sorted, search]);
  const people = useMemo(() => (rooms ?? []).reduce((n, r) => n + r.peopleCount, 0), [rooms]);

  function changeSearch(value: string) {
    setSearch(value);
    if (value.trim() && !searchedRef.current) {
      searchedRef.current = true;
      trackFeatureEvent(GROUPS_ROOMS_EVENTS.search, { feature: GROUPS_ROOMS_FEATURE });
    }
  }

  function changeSort(next: (typeof SORTS)[number]) {
    if (next.value === sort) return;
    setSort(next.value);
    trackFeatureEvent(GROUPS_ROOMS_EVENTS.sort, { value: next.event, feature: GROUPS_ROOMS_FEATURE });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 pt-3 pb-8 sm:px-4 lg:px-1 lg:pt-1">
        {/* The title and the totals. A phone's bar already says the title (see GroupMobile). */}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="hidden items-center gap-2 text-xl font-semibold tracking-tight text-zinc-950 lg:flex dark:text-zinc-50">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
              {t("groups.roomsTab.title")}
            </h1>
            <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
              {rooms === null
                ? t("common.loading")
                : `${tc("groups.roomsTab.roomCount", rooms.length)} · ${tc("common.personCount", people)}`}
            </p>
          </div>
          <Tooltip content={t("mobile.map")} placement="bottom">
            <Link
              href="/worldmap"
              aria-label={t("mobile.map")}
              onClick={() => trackFeatureEvent(GROUPS_ROOMS_EVENTS.map, { feature: GROUPS_ROOMS_FEATURE })}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <MdOutlineMap className="h-4 w-4" />
              <span className="hidden sm:inline">{t("mobile.map")}</span>
            </Link>
          </Tooltip>
        </div>

        {/* Search, and the order. The order's labels give way to its icons on a phone. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <MdSearch className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
            <input
              ref={inputRef}
              type="search"
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && search) {
                  e.preventDefault();
                  setSearch("");
                }
              }}
              placeholder={t("groups.roomsTab.search")}
              aria-label={t("groups.roomsTab.search")}
              maxLength={100}
              enterKeyHint="search"
              className="h-10 w-full rounded-xl border border-zinc-300 bg-white pl-10 pr-9 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-4 focus:ring-zinc-500/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 [&::-webkit-search-cancel-button]:hidden"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  inputRef.current?.focus();
                }}
                aria-label={t("groups.groupsHome.clearSearch")}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <MdClose className="h-4 w-4" />
              </button>
            )}
          </div>
          <div role="radiogroup" aria-label={t("rooms.roomsPageClient.sortBy")} className="flex shrink-0 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900">
            {SORTS.map((option) => {
              const active = option.value === sort;
              return (
                <Tooltip key={option.value} content={t(option.hint)} placement="bottom">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={t(option.hint)}
                    onClick={() => changeSort(option)}
                    className={`flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition sm:flex-none ${
                      active
                        ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                        : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
                    }`}
                  >
                    {option.icon}
                    <span>{t(option.label)}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>

        {error && rooms === null ? (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {t("common.couldNotLoadThePublicRooms")}
          </p>
        ) : rooms === null ? (
          <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} className="h-[76px] animate-pulse rounded-xl bg-zinc-200/60 dark:bg-zinc-900" />
            ))}
          </ul>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            {rooms.length === 0
              ? t("rooms.roomsPageClient.noPublicRoomActiveAtThe")
              : t("rooms.roomsPageClient.noRoomFoundForThatSearch")}
          </p>
        ) : (
          <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]">
            {shown.map((room, index) => (
              <li key={room.handle} className="min-w-0">
                <RoomCard
                  room={room}
                  opening={opening === room.handle}
                  onOpen={() => {
                    setOpening(room.group ? null : room.handle);
                    trackFeatureEvent(room.group ? GROUPS_ROOMS_EVENTS.joinGroup : GROUPS_ROOMS_EVENTS.join, {
                      value: index + 1,
                      feature: GROUPS_ROOMS_FEATURE,
                    });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const cardClass =
  "flex h-full min-h-[76px] w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left transition hover:border-zinc-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600";

/**
 * One room. A group's call opens through its group, without leaving the shell;
 * an ordinary room is its own page (/watch), and says it is on its way there.
 */
function RoomCard({ room, opening, onOpen }: { room: ListedRoom; opening: boolean; onOpen: () => void }) {
  const { t, tc } = useI18n();
  const category = roomCategory(room.category);
  const title = room.channel?.name ?? room.handle;
  const mic = roomActivity(room, "micCount");
  const screen = roomActivity(room, "screenCount");
  const camera = roomActivity(room, "cameraCount");
  const label = room.group
    ? t("rooms.roomsPageClient.groupCallHint", { group: room.group.name })
    : `${title} — ${tc("common.personCount", room.peopleCount)}`;

  const body = (
    <>
      <span className="relative shrink-0">
        <GroupIcon
          name={room.group?.name ?? title}
          iconUrl={room.group?.iconUrl ?? null}
          seed={room.group?.id ?? room.handle}
          size={44}
          className="rounded-xl"
        />
        {room.group && (
          <span className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-indigo-600 text-white ring-2 ring-white dark:ring-zinc-950">
            <MdGroups className="h-3 w-3" />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</span>
          {category && (
            <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${category.className}`}>
              {category.label}
            </span>
          )}
        </span>
        {room.group ? (
          <GroupName
            name={room.group.name}
            flags={room.group.flags}
            className="min-w-0 text-xs text-zinc-500 dark:text-zinc-400"
            badgeClassName="h-3.5 w-3.5"
          />
        ) : room.description ? (
          <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{room.description}</span>
        ) : null}
        {/* Only the counters that say something: people always, the rest when not zero. */}
        <span className="flex items-center gap-2.5 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
          <Stat icon={<MdPeopleOutline className="h-3.5 w-3.5" />} value={room.peopleCount} label={tc("common.personCount", room.peopleCount)} />
          {mic > 0 && <Stat icon={<MicIcon className="h-3.5 w-3.5" />} value={mic} label={t("rooms.roomsPageClient.activeMicrophones")} />}
          {screen > 0 && (
            <Stat icon={<ScreenIcon className="h-3.5 w-3.5 text-red-500" />} value={screen} label={t("rooms.roomsPageClient.screensBroadcast")} />
          )}
          {camera > 0 && <Stat icon={<CameraIcon className="h-3.5 w-3.5" />} value={camera} label={t("rooms.roomsPageClient.camerasOn")} />}
        </span>
      </span>
      {opening && <ButtonSpinner className="shrink-0 text-zinc-400 dark:text-zinc-500" />}
    </>
  );

  return room.group && room.channel ? (
    <GroupLink href={groupPath(room.group.id, room.channel.id)} onClick={onOpen} aria-label={`${title} — ${label}`} className={cardClass}>
      {body}
    </GroupLink>
  ) : (
    <Link href={`/watch/${room.handle}`} onClick={onOpen} aria-label={label} className={cardClass}>
      {body}
    </Link>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <span className="flex items-center gap-1" title={label}>
      {icon}
      {value}
    </span>
  );
}

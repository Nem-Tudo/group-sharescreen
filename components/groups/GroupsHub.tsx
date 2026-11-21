"use client";

import { useEffect, useMemo, useRef } from "react";
import useNtPopups from "ntpopups";
import {
  MdAdd,
  MdChevronRight,
  MdClose,
  MdLink,
  MdLiveTv,
  MdOutlineMap,
  MdScreenShare,
  MdSearch,
  MdVideocam,
  MdVolumeUp,
} from "react-icons/md";
import { GlobeIcon } from "@/components/icons";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupLink } from "@/components/groups/GroupLink";
import { GroupName } from "@/components/groups/GroupName";
import { PublicGroupsDirectory } from "@/components/groups/PublicGroupsDirectory";
import { ExploreMap } from "@/components/groups/ExploreMap";
import { useExploreMap } from "@/lib/exploreMap";
import { setGroupsHomeQuery, useGroupsHomeQuery } from "@/components/groups/groupSearch";
import { RoomStartForm } from "@/components/RoomStartForm";
import { useAuth } from "@/lib/AuthContext";
import { useFeature } from "@/lib/features";
import { GROUPS_EXPLORE_PATH, GROUPS_ROOMS_PATH, groupPath } from "@/lib/groupLinks";
import { GROUPS_ROOMS_FEATURE, noteGroupsRoomsSource } from "@/lib/groupsRooms";
import { GROUPS_HUB_EVENTS, noteExploreVisit, trackGroupsHub } from "@/lib/groupsHub";
import type { GroupSummary } from "@/lib/groupsApi";
import { prefetchGroup, useMyGroups } from "@/lib/useGroups";
import { useT } from "@/lib/useI18n";
import { HubCentralHome, type HubCentralLink } from "@/components/groups/HubCentral";
import { HUB_CENTRAL_EVENTS, trackHubCentral, useHubCentral } from "@/lib/hubCentral";

// The two pages of the experiment groups-hub (see lib/groupsHub):
//
//   GroupsHubHome  /groups on a desktop — the home inside the groups layout:
//                  start or join a room, what is going on in your groups right
//                  now, and the ways to everything else. What the site's home
//                  is for, without leaving the layout for it.
//   GroupsExplore  /groups/explore — public groups to find and join, and only
//                  that: the groups somebody is in are the rail's.

const card = "rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950";
const cardTitle = "text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50";
const cardHint = "mt-0.5 text-sm text-zinc-500 dark:text-zinc-400";
const secondaryButton =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const primaryButton =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";

const ROOM_MODE_VALUE = { public: 1, "private-create": 2, "private-join": 3 } as const;

export function GroupsHubHome() {
  const t = useT();
  const { openPopup } = useNtPopups();
  const { account } = useAuth();
  const { groups } = useMyGroups();
  const roomsTab = useFeature(GROUPS_ROOMS_FEATURE, { track: false }).enabled;
  // The central (friends, messages, notifications) is for accounts: a guest
  // has none of the three, so only accounts count as exposed.
  const centralLayout = useHubCentral({ track: Boolean(account) });
  const central = account ? centralLayout : null;

  // Calls going on right now in the groups this person keeps on their list —
  // the one thing about their groups worth putting on a home: somebody is
  // there, now. Screens first, then cameras, then voices.
  const live = useMemo(() => {
    const rank = { screen: 0, camera: 1, voice: 2 } as const;
    return (groups ?? [])
      .filter((g) => !g.archived && !g.suspended && g.voiceActivity)
      .sort((a, b) => rank[a.voiceActivity!] - rank[b.voiceActivity!])
      .slice(0, 6);
  }, [groups]);

  const startRoomForm = (
    <RoomStartForm
      onStart={(mode) => {
        trackGroupsHub(GROUPS_HUB_EVENTS.roomStart, ROOM_MODE_VALUE[mode]);
        if (account) trackHubCentral(HUB_CENTRAL_EVENTS.roomStart, { value: ROOM_MODE_VALUE[mode] });
      }}
    />
  );

  if (central) {
    const links: HubCentralLink[] = [
      { key: "explore", href: GROUPS_EXPLORE_PATH, icon: <GlobeIcon />, label: t("groups.groupDialogs.exploreGroups") },
      {
        key: "rooms",
        href: roomsTab ? GROUPS_ROOMS_PATH : "/rooms",
        onClick: () => roomsTab && noteGroupsRoomsSource("hub"),
        icon: <MdLiveTv />,
        label: t("groups.roomsTab.title"),
      },
      { key: "map", href: "/worldmap", icon: <MdOutlineMap />, label: t("groups.hub.map") },
      { key: "invite", onClick: () => void openPopup("join_group", { data: {} }), icon: <MdLink />, label: t("common.joinWithAnInvite") },
      {
        key: "new_group",
        onClick: () => void openPopup("create_group", { data: {} }),
        icon: <MdAdd />,
        label: t("common.newGroup"),
      },
    ];
    return <HubCentralHome layout={central} startRoomForm={startRoomForm} liveGroups={groups === null ? null : live} links={links} />;
  }

  const startRoom = (
        <section className={card}>
          <h1 className={cardTitle}>{t("groups.hub.startRoom")}</h1>
          <p className={cardHint}>{t("groups.hub.startRoomHint")}</p>
          <div className="mt-4">{startRoomForm}</div>
        </section>
  );

  const happening = (
          <section className={card}>
            <h2 className={cardTitle}>{t("groups.hub.happening")}</h2>
            {groups === null ? (
              <div className="mt-3 flex flex-col gap-2">
                {[0, 1].map((i) => (
                  <span key={i} className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
                ))}
              </div>
            ) : live.length === 0 ? (
              <p className={cardHint}>{t("groups.hub.nothingHappening")}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-1.5">
                {live.map((group) => (
                  <LiveGroupRow key={group.id} group={group} />
                ))}
              </ul>
            )}
          </section>
  );

  const discover = (
          <section className={card}>
            <h2 className={cardTitle}>{t("groups.hub.discover")}</h2>
            <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <HubLink href={GROUPS_EXPLORE_PATH} icon={<GlobeIcon className="h-5 w-5" />} label={t("groups.groupDialogs.exploreGroups")} />
              <HubLink
                href={roomsTab ? GROUPS_ROOMS_PATH : "/rooms"}
                onClick={() => roomsTab && noteGroupsRoomsSource("hub")}
                icon={<MdLiveTv className="h-5 w-5" />}
                label={t("groups.roomsTab.title")}
              />
              <HubLink href="/worldmap" icon={<MdOutlineMap className="h-5 w-5" />} label={t("groups.hub.map")} />
              <li>
                <button
                  type="button"
                  onClick={() => void openPopup("join_group", { data: {} })}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                    <MdLink className="h-5 w-5" />
                  </span>
                  {t("common.joinWithAnInvite")}
                </button>
              </li>
            </ul>
            <button
              type="button"
              onClick={() => void openPopup("create_group", { data: {} })}
              disabled={!account}
              title={account ? undefined : t("common.createAnAccountToCreateGroups")}
              className={`${primaryButton} mt-3 w-full justify-center`}
            >
              <MdAdd className="h-4 w-4" />
              {t("common.newGroup")}
            </button>
          </section>
  );

  return (
    // On a tall, wide screen the cards sit in the middle of the space (my-auto
    // in a min-h-full column) instead of hugging the top with the rest of the
    // screen empty below; when they don't fit, it scrolls from the top as usual.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-6 lg:my-auto lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:py-10 2xl:max-w-6xl 2xl:gap-6">
        {startRoom}
        <div className="flex min-w-0 flex-col gap-4">
          {happening}
          {discover}
        </div>
      </div>
    </div>
  );
}

function HubLink({
  href,
  icon,
  label,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <li>
      <GroupLink
        href={href}
        onClick={onClick}
        className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <MdChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
      </GroupLink>
    </li>
  );
}

function LiveGroupRow({ group }: { group: GroupSummary }) {
  const t = useT();
  const activity = group.voiceActivity;
  const label =
    activity === "screen"
      ? t("groups.groupRail.callScreen")
      : activity === "camera"
        ? t("groups.groupRail.callCamera")
        : t("groups.groupRail.callVoice");
  const Icon = activity === "screen" ? MdScreenShare : activity === "camera" ? MdVideocam : MdVolumeUp;
  return (
    <li>
      <GroupLink
        href={groupPath(group.id)}
        onMouseEnter={() => prefetchGroup(group.id)}
        className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={36} className="rounded-lg" />
        <span className="min-w-0 flex-1">
          <GroupName name={group.name} flags={group.flags} className="flex w-full text-sm font-medium text-zinc-900 dark:text-zinc-100" />
          <span
            className={`flex items-center gap-1 text-xs ${
              activity === "voice" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </span>
        </span>
        <MdChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
      </GroupLink>
    </li>
  );
}

/** /groups/explore — every public group, to find one to join. */
export function GroupsExplore() {
  const t = useT();
  const { openPopup } = useNtPopups();
  const { account } = useAuth();
  const { groups } = useMyGroups();
  const query = useGroupsHomeQuery();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const myIds = useMemo(() => new Set((groups ?? []).map((g) => g.id)), [groups]);
  // The rooms-and-groups map on top (experiment explore-map). Exposure: this
  // page open, on both sides.
  const exploreMap = useExploreMap({ track: true });

  useEffect(() => {
    trackGroupsHub(GROUPS_HUB_EVENTS.exploreOpen);
  }, []);

  // "/" anywhere on the page puts the cursor in the search bar, as on /groups.
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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto w-full max-w-4xl px-4 pt-4 pb-8 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            {/* A phone's bar already says it (see GroupMobile). */}
            <h1 className="hidden text-2xl font-semibold tracking-tight text-zinc-950 lg:block dark:text-zinc-50">
              {t("groups.groupDialogs.exploreGroups")}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("groups.hub.exploreHint")}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void openPopup("join_group", { data: {} })} className={secondaryButton}>
              {t("common.joinWithAnInvite")}
            </button>
            <button
              type="button"
              onClick={() => void openPopup("create_group", { data: {} })}
              disabled={!account}
              title={account ? undefined : t("common.createAnAccountToCreateGroups")}
              className={primaryButton}
            >
              <MdAdd className="h-4 w-4" />
              {t("common.newGroup")}
            </button>
          </div>
        </div>

        {exploreMap && <ExploreMap />}

        <div className="relative mt-6">
          <MdSearch className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setGroupsHomeQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setGroupsHomeQuery("");
              }
            }}
            placeholder={t("groups.hub.explorePlaceholder")}
            aria-label={t("groups.hub.explorePlaceholder")}
            maxLength={100}
            enterKeyHint="search"
            className="w-full rounded-xl border border-zinc-300 bg-white py-2.5 pl-10 pr-10 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-4 focus:ring-zinc-500/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setGroupsHomeQuery("");
                inputRef.current?.focus();
              }}
              aria-label={t("groups.groupsHome.clearSearch")}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <MdClose className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-zinc-300 px-1.5 text-[11px] font-medium text-zinc-400 sm:block dark:border-zinc-700">
              /
            </kbd>
          )}
        </div>

        <section className="mt-6">
          <PublicGroupsDirectory query={query} myGroupIds={myIds} onOpenGroup={noteExploreVisit} />
        </section>
      </div>
    </div>
  );
}

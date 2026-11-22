"use client";

import { useMemo, useState, type ReactNode } from "react";
import { MdCall, MdChatBubbleOutline, MdChevronRight, MdMoreVert, MdPalette, MdPeople, MdPersonOutline, MdSearch } from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { UserProfileDialog } from "@/components/UserProfileDialog";
import { Tooltip } from "@/components/Tooltip";
import { AddFriendDialog } from "@/components/AddFriendDialog";
import { FriendRequestsModal } from "@/components/FriendRequestsModal";
import { NotificationKindIcon, relativeTime } from "@/components/NotificationInboxBell";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupLink } from "@/components/groups/GroupLink";
import { GroupName } from "@/components/groups/GroupName";
import { HubGreeting } from "@/components/groups/HubGreeting";
import { useAuth } from "@/lib/AuthContext";
import { startCall } from "@/lib/callsApi";
import { useDmLive } from "@/lib/dmLive";
import { messageSummary } from "@/lib/dmThread";
import { openDirectMessages } from "@/lib/dmWindow";
import { verifiedBadge } from "@/lib/entitlements";
import type { GroupSummary } from "@/lib/groupsApi";
import { groupPath } from "@/lib/groupLinks";
import { HUB_CENTRAL_EVENTS, trackHubCentral, type HubCentralLayout } from "@/lib/hubCentral";
import { markAllRead, useNotificationInbox, type InboxNotification } from "@/lib/notificationInbox";
import { usePresenceMap } from "@/lib/presence";
import type { PresenceInfo } from "@/lib/signalingClient";
import type { SocialUser } from "@/lib/socialApi";
import { prefetchGroup } from "@/lib/useGroups";
import { useRecentConversations } from "@/lib/useRecentConversations";
import { useSocialGraph } from "@/lib/useSocialGraph";
import { useT } from "@/lib/useI18n";

// The home inside the groups layout as the app's central (experiment
// hub-central, see lib/hubCentral). Three layouts of the same parts, one per
// variant, because the first try — six equal cards — had every fault a
// dashboard can have at once: nothing led, the room form (used once a visit)
// was the biggest thing on the page, a message showed up twice (its
// conversation and its notification), every friend row carried two coloured
// buttons, and the columns ended at three different heights.
//
// What all three keep from that lesson:
//   - one thing leads, and size says which: who is around now ("now",
//     "bento") or what is waiting for you ("inbox");
//   - one inbox, not two lists: conversations and the bell's notifications
//     merged, unread first (an inbox to clear, not a feed to scroll — the
//     same turn Slack's Activity took), and a DM never listed twice;
//   - actions show on hover, statuses are short, and secondary blocks are
//     tone, not bordered boxes;
//   - starting a room is the one solid button, opening the form in place.
//
//   now    Discord's "Ativo agora" / Steam's friends: a strip of who is
//          online and which groups are in a call, then the inbox beside the
//          full friends list.
//   inbox  One reading column, like a mail client: quick actions as chips,
//          who is online as a row of faces, then the inbox as the page.
//   bento  Tiles of different sizes: "Agora" big, the inbox tall, the room
//          form, friends and the ways out small.

export interface HubCentralLink {
  key: string;
  label: string;
  icon: ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}

// ─── Data ─────────────────────────────────────────────────────────────────

function connected(presence: PresenceInfo | undefined): boolean {
  return presence !== undefined && presence.state !== "offline";
}

type InboxEntry =
  | { type: "dm"; id: string; ts: number; unread: number; user: SocialUser; line: string }
  | { type: "notification"; id: string; ts: number; unread: number; notification: InboxNotification };

function useCentralData(inboxSize: number) {
  const t = useT();
  const { account } = useAuth();
  const { graph, loading: graphLoading } = useSocialGraph();
  const presence = usePresenceMap(graph.friends.map((user) => user.id));
  const recent = useRecentConversations(inboxSize);
  const notifications = useNotificationInbox();

  // Online first, in the server's order otherwise, so the list only moves
  // when somebody's presence does.
  const friends = useMemo(
    () => [...graph.friends].sort((a, b) => Number(connected(presence[b.id])) - Number(connected(presence[a.id]))),
    [graph.friends, presence]
  );
  const online = useMemo(() => friends.filter((user) => connected(presence[user.id])), [friends, presence]);

  const inbox = useMemo(() => {
    const entries: InboxEntry[] = recent.rows.map(({ user, lastMessage, unread }) => ({
      type: "dm",
      id: `dm:${user.id}`,
      ts: lastMessage.ts,
      unread,
      user,
      line:
        lastMessage.from === account?.id
          ? t("directMessagesModal.youLine", { line: messageSummary(lastMessage) })
          : messageSummary(lastMessage),
    }));
    // The bell's "Mensagem de …" rows are the conversations above, again.
    for (const notification of notifications) {
      if (notification.kind === "dm") continue;
      entries.push({
        type: "notification",
        id: notification.id,
        ts: notification.ts,
        unread: notification.read ? 0 : 1,
        notification,
      });
    }
    return entries
      .sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || b.ts - a.ts)
      .slice(0, inboxSize);
  }, [recent.rows, notifications, account?.id, t, inboxSize]);

  const unreadNotifications = notifications.some((item) => !item.read && item.kind !== "dm");

  return {
    account,
    friends,
    online,
    presence,
    incoming: graph.incoming.length,
    friendsLoading: graphLoading && graph.friends.length === 0,
    inbox,
    inboxLoaded: recent.loaded,
    totalUnread: recent.totalUnread,
    unreadNotifications,
  };
}

type CentralData = ReturnType<typeof useCentralData>;

// ─── The page ─────────────────────────────────────────────────────────────

export function HubCentralHome({
  layout,
  startRoomForm,
  liveGroups,
  links,
}: {
  layout: HubCentralLayout;
  /** The room form (RoomStartForm with its tracking), drawn where the layout puts it. */
  startRoomForm: ReactNode;
  /** Groups of this person's with a call going on, or null while loading. */
  liveGroups: GroupSummary[] | null;
  links: HubCentralLink[];
}) {
  const data = useCentralData(30);
  const [adding, setAdding] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const actions: FriendActions = {
    openProfile: setProfileId,
    addFriend: () => {
      trackHubCentral(HUB_CENTRAL_EVENTS.friendAdd);
      setAdding(true);
    },
    openRequests: () => {
      trackHubCentral(HUB_CENTRAL_EVENTS.requests);
      setRequestsOpen(true);
    },
  };

  const content =
    layout === "inbox" ? (
      <InboxLayout data={data} actions={actions} startRoomForm={startRoomForm} liveGroups={liveGroups} links={links} />
    ) : layout === "bento" ? (
      <BentoLayout data={data} actions={actions} startRoomForm={startRoomForm} liveGroups={liveGroups} links={links} />
    ) : (
      <NowLayout data={data} actions={actions} startRoomForm={startRoomForm} liveGroups={liveGroups} links={links} />
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {content}
      {adding && <AddFriendDialog onClose={() => setAdding(false)} />}
      <FriendRequestsModal open={requestsOpen} onClose={() => setRequestsOpen(false)} />
      {profileId && <UserProfileDialog userId={profileId} onClose={() => setProfileId(null)} />}
    </div>
  );
}

interface FriendActions {
  openProfile: (userId: string) => void;
  addFriend: () => void;
  openRequests: () => void;
}

interface LayoutProps {
  data: CentralData;
  actions: FriendActions;
  startRoomForm: ReactNode;
  liveGroups: GroupSummary[] | null;
  links: HubCentralLink[];
}

// ─── Layout: now ──────────────────────────────────────────────────────────

// Discord's friends page, reshaped: the friends are the page (a list with
// tabs, a search and the actions on each row), and what is waiting for you —
// messages and the bell, one inbox — is the card in the top-right corner,
// where Discord keeps "Ativo agora". The ways out (explore, rooms, map,
// invite, new group) are not repeated here: the rail and the shell's bar
// already have every one of them.
function NowLayout({ data, actions, startRoomForm, liveGroups }: LayoutProps) {
  const t = useT();
  const live = liveGroups ?? [];
  return (
    <div className={`${page("max-w-6xl 2xl:max-w-7xl")} lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6 2xl:grid-cols-[minmax(0,1fr)_24rem]`}>
      <div className="flex min-h-0 min-w-0 flex-col">
        <Greeting data={data} />

        <StartStrip form={startRoomForm} className="mt-5" />

        {live.length > 0 && (
          <section className="mt-4 shrink-0">
            <SectionTitle>{t("groups.hub.happening")}</SectionTitle>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {live.slice(0, 6).map((group) => (
                <LiveGroupBanner key={group.id} group={group} />
              ))}
            </ul>
          </section>
        )}

        <FriendsPanel data={data} actions={actions} className="mt-4 min-h-[22rem] flex-1" />
      </div>

      <aside className="mt-4 flex min-h-0 flex-col gap-4 lg:mt-0">
        <section className={`${tile} flex min-h-[18rem] flex-1 flex-col`}>
          <InboxHeader data={data} compact />
          <Scroll>
            <InboxList data={data} grouped />
          </Scroll>
        </section>
        <ThemesCard />
      </aside>
    </div>
  );
}

/** The friends, as Discord lists them: tabs, a search, then one row per person with the actions on the right. */
function FriendsPanel({ data, actions, className = "" }: { data: CentralData; actions: FriendActions; className?: string }) {
  const t = useT();
  const [tab, setTab] = useState<"online" | "all">("online");
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const { busyId, error, call } = useCall();

  const pool = tab === "online" ? data.online : data.friends;
  const q = query.trim().toLowerCase();
  const shown = q
    ? pool.filter((user) => user.displayName.toLowerCase().includes(q) || user.username.toLowerCase().includes(q))
    : pool;

  function choose(next: "online" | "all") {
    if (next === tab) return;
    trackHubCentral(HUB_CENTRAL_EVENTS.friendsTab, { tags: { tab: next } });
    setTab(next);
  }

  const tabClass = (active: boolean) =>
    `cursor-pointer rounded-md px-2.5 py-1 text-sm font-medium transition ${
      active
        ? "bg-zinc-100 text-zinc-950 dark:bg-zinc-900 dark:text-zinc-50"
        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
    }`;

  return (
    <section className={`${tile} flex min-h-0 flex-col !p-0 ${className}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="mr-2 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <MdPeople className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
          {t("common.friends")}
        </h2>
        <span className="mr-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" aria-hidden />
        <button type="button" onClick={() => choose("online")} className={tabClass(tab === "online")}>
          {t("common.online")}
        </button>
        <button type="button" onClick={() => choose("all")} className={tabClass(tab === "all")}>
          {t("groups.central.tabAll")}
        </button>
        <button type="button" onClick={actions.openRequests} className={`${tabClass(false)} inline-flex items-center gap-1.5`}>
          {t("groups.central.tabPending")}
          {data.incoming > 0 && <span className={`${unreadBadge} !bg-red-500 !text-white`}>{data.incoming > 99 ? "99+" : data.incoming}</span>}
        </button>
        <button
          type="button"
          onClick={actions.addFriend}
          className="hub-accent ml-1 cursor-pointer rounded-md px-2.5 py-1 text-sm font-medium transition hover:brightness-110"
        >
          {t("common.addFriend")}
        </button>
      </div>

      <div className="shrink-0 px-4 pt-3">
        <div className="relative">
          <MdSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!searched && e.target.value) {
                setSearched(true);
                trackHubCentral(HUB_CENTRAL_EVENTS.friendsSearch);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            placeholder={t("groups.central.searchFriends")}
            aria-label={t("groups.central.searchFriends")}
            maxLength={60}
            className="w-full rounded-lg bg-zinc-100 py-2 pl-8 pr-3 text-sm text-zinc-950 outline-none ring-1 ring-transparent transition placeholder:text-zinc-400 focus:ring-zinc-300 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-700 [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {tab === "online"
            ? t("groups.central.onlineSection", { count: shown.length })
            : t("groups.central.allSection", { count: shown.length })}
        </p>
        {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <div className="mt-1 min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {data.friendsLoading ? (
          <ul aria-hidden className="mt-2 flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
            ))}
          </ul>
        ) : data.friends.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            {t("common.youDonTHaveAnyFriends")}{" "}
            <button
              type="button"
              onClick={actions.addFriend}
              className="cursor-pointer font-medium underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              {t("homeFriendsPanel.addSomeone")}
            </button>
          </p>
        ) : shown.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            {q ? t("groups.central.noMatch") : t("groups.central.nobodyNow")}
          </p>
        ) : (
          <ul className="flex flex-col">
            {shown.slice(0, 300).map((user) => (
              <FriendRow
                key={user.id}
                user={user}
                presence={data.presence[user.id]}
                busy={busyId === user.id}
                onCall={() => void call(user)}
                onProfile={() => actions.openProfile(user.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** "Temas": the way to the workshop, where the site's look is chosen. */
function ThemesCard() {
  const t = useT();
  return (
    <GroupLink
      href="/workshop"
      onClick={() => trackHubCentral(HUB_CENTRAL_EVENTS.link, { tags: { to: "themes" } })}
      className={`${tile} group flex shrink-0 items-center gap-3 !py-4 transition hover:ring-zinc-300 dark:hover:ring-zinc-700`}
    >
      <span className="hub-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
        <MdPalette className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t("groups.central.themesTitle")}</span>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t("groups.central.themesHint")}</span>
      </span>
      <MdChevronRight className="h-5 w-5 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5 dark:text-zinc-500" />
    </GroupLink>
  );
}

// ─── Layout: inbox ────────────────────────────────────────────────────────

function InboxLayout({ data, actions, startRoomForm, liveGroups, links }: LayoutProps) {
  const t = useT();
  const live = (liveGroups ?? []).slice(0, 2);
  return (
    <div className={page("max-w-3xl")}>
      <Greeting data={data} />

      <StartStrip form={startRoomForm} className="mt-5" />

      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
        {links.map((link) => (
          <LinkChip key={link.key} link={link} />
        ))}
      </div>

      <section className="mt-6 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>{t("groups.central.now")}</SectionTitle>
          <button type="button" onClick={actions.addFriend} className={quietLink}>
            {t("common.addFriend")}
          </button>
        </div>
        {data.online.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("groups.central.nobodyNow")}</p>
        ) : (
          <div className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1 pb-1">
            {data.online.map((user) => (
              <FaceButton key={user.id} user={user} />
            ))}
          </div>
        )}
        {data.incoming > 0 && <RequestsLine count={data.incoming} onOpen={actions.openRequests} />}
      </section>

      {live.length > 0 && (
        <ul className="mt-4 grid shrink-0 gap-2 sm:grid-cols-2">
          {live.map((group) => (
            <LiveGroupBanner key={group.id} group={group} />
          ))}
        </ul>
      )}

      <section className="mt-6 flex min-h-0 flex-1 flex-col">
        <InboxHeader data={data} />
        <Scroll>
          <InboxList data={data} grouped />
        </Scroll>
      </section>
    </div>
  );
}

// ─── Layout: bento ────────────────────────────────────────────────────────

function BentoLayout({ data, actions, startRoomForm, liveGroups, links }: LayoutProps) {
  const t = useT();
  const live = liveGroups ?? [];
  return (
    <div className={page("max-w-6xl 2xl:max-w-7xl")}>
      <Greeting data={data} />
      <div className="mt-5 grid min-h-0 flex-1 gap-4 lg:grid-cols-6 lg:grid-rows-[auto_minmax(0,1fr)_auto]">
        <StartStrip form={startRoomForm} className="lg:col-span-4" />

        {/* Tall, the whole right side: what is waiting. */}
        <section className={`${tile} flex min-h-0 flex-col lg:col-span-2 lg:row-span-3`}>
          <InboxHeader data={data} compact />
          <Scroll>
            <InboxList data={data} />
          </Scroll>
        </section>

        {/* The big one: who is around, groups and people together. */}
        <section className={`${tile} flex min-h-0 flex-col lg:col-span-4`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("groups.central.now")}
              {data.online.length > 0 && (
                <span className="hub-accent-text text-xs font-medium">
                  {t("groups.central.onlineCount", { count: data.online.length })}
                </span>
              )}
            </h2>
            <span className="flex items-center gap-3">
              <GroupLink href="/friends" className={quietLink}>
                {t("common.seeAll")}
              </GroupLink>
              <button type="button" onClick={actions.addFriend} className={quietLink}>
                {t("common.addFriend")}
              </button>
            </span>
          </div>
          {data.incoming > 0 && <RequestsLine count={data.incoming} onOpen={actions.openRequests} />}
          <Scroll>
            {live.length > 0 && (
              <ul className="mt-1 grid gap-2 sm:grid-cols-2">
                {live.map((group) => (
                  <LiveGroupBanner key={group.id} group={group} />
                ))}
              </ul>
            )}
            {data.online.length === 0 && live.length === 0 ? (
              <NobodyNow onAdd={actions.addFriend} />
            ) : (
              <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1">
                {data.online.map((user) => (
                  <FriendTile key={user.id} user={user} presence={data.presence[user.id]} actions={actions} fluid />
                ))}
              </div>
            )}
          </Scroll>
        </section>

        <section className={`${tile} !py-3 lg:col-span-4`}>
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-5">
            {links.map((link) => (
              <li key={link.key}>
                <LinkTile link={link} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

// ─── Shared pieces ────────────────────────────────────────────────────────

/** The page's frame: the screen's height and never more — the lists scroll inside their blocks, the page never does. */
function page(width: string): string {
  return `mx-auto flex min-h-0 w-full flex-1 flex-col px-6 pb-6 pt-7 ${width}`;
}

/** Where a block's list scrolls when it is longer than the block. */
function Scroll({ children }: { children: ReactNode }) {
  return <div className="-mr-2 mt-1 min-h-0 flex-1 overflow-y-auto pr-2">{children}</div>;
}

/** The room form, always on screen, as one bar (RoomStartForm's `bar` layout). */
function StartStrip({ form, className = "" }: { form: ReactNode; className?: string }) {
  const t = useT();
  return (
    <section className={`${tile} shrink-0 !py-4 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t("groups.hub.startRoom")}</h2>
      {form}
    </section>
  );
}


// A block is drawn with the panel tokens every theme defines (surface + border:
// white/zinc-950, zinc-200/zinc-800), and its rows hover to the raised one
// (zinc-100/zinc-900), so a theme repaints the page as it repaints a room.
const tile = "rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800";
const quietLink =
  "shrink-0 cursor-pointer text-xs font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";
const unreadBadge =
  "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold hub-accent";

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{children}</h2>;
}

function Greeting({ data }: { data: CentralData }) {
  const t = useT();
  const summary = [
    data.online.length > 0 &&
      (data.online.length === 1
        ? t("groups.central.friendOnline")
        : t("groups.central.friendsOnline", { count: data.online.length })),
    data.totalUnread > 0 &&
      (data.totalUnread === 1
        ? t("groups.central.unreadMessage")
        : t("groups.central.unreadMessages", { count: data.totalUnread })),
  ].filter((line): line is string => typeof line === "string");
  return <HubGreeting name={data.account?.displayName ?? ""} summary={summary} />;
}

function LinkWrap({ link, className, children }: { link: HubCentralLink; className: string; children: ReactNode }) {
  const onClick = () => {
    trackHubCentral(HUB_CENTRAL_EVENTS.link, { tags: { to: link.key } });
    link.onClick?.();
  };
  if (link.href) {
    return (
      <GroupLink href={link.href} onClick={onClick} className={className}>
        {children}
      </GroupLink>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={link.disabled} title={link.title} className={className}>
      {children}
    </button>
  );
}

function LinkChip({ link }: { link: HubCentralLink }) {
  return (
    <LinkWrap
      link={link}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 [&_svg]:h-4 [&_svg]:w-4"
    >
      {link.icon}
      {link.label}
    </LinkWrap>
  );
}

function LinkTile({ link }: { link: HubCentralLink }) {
  return (
    <LinkWrap
      link={link}
      className="flex h-full w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-900 [&_svg]:h-5 [&_svg]:w-5"
    >
      <span className="text-zinc-500 dark:text-zinc-400">{link.icon}</span>
      <span className="min-w-0 truncate">{link.label}</span>
    </LinkWrap>
  );
}

function NobodyNow({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  return (
    <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
      {t("groups.central.nobodyNow")}{" "}
      <button
        type="button"
        onClick={onAdd}
        className="cursor-pointer font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
      >
        {t("common.addFriend")}
      </button>
    </p>
  );
}

function RequestsLine({ count, onOpen }: { count: number; onOpen: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-3 flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium hub-accent-text transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
    >
      {count === 1 ? t("groups.central.request") : t("groups.central.requests", { count })}
      <MdChevronRight className="h-4 w-4 shrink-0" />
    </button>
  );
}

function shortStatus(presence: PresenceInfo | undefined, t: ReturnType<typeof useT>): string {
  if (!presence || presence.state === "offline") return t("common.offline");
  if (presence.state === "away") return t("groups.central.statusAway");
  if (presence.state === "background") return t("groups.central.statusBackground");
  return t("common.online");
}

// ─── Friends ──────────────────────────────────────────────────────────────

function useCall() {
  const t = useT();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function call(user: SocialUser) {
    if (busyId) return;
    trackHubCentral(HUB_CENTRAL_EVENTS.call);
    setBusyId(user.id);
    setError(null);
    const result = await startCall(user.id);
    if (!result.ok) setError(result.error ?? t("common.couldNotCall"));
    setBusyId(null);
  }
  return { busyId, error, call };
}

function chat(user: SocialUser) {
  trackHubCentral(HUB_CENTRAL_EVENTS.chat);
  openDirectMessages(user.id);
}

/** A big face for "Agora": click talks, the call button shows on hover. */
function FriendTile({
  user,
  presence,
  actions,
  fluid = false,
}: {
  user: SocialUser;
  presence: PresenceInfo | undefined;
  actions: FriendActions;
  fluid?: boolean;
}) {
  const t = useT();
  const { busyId, call } = useCall();
  return (
    <div
      className={`group relative flex shrink-0 flex-col items-center rounded-xl px-2 pb-2.5 pt-3 text-center transition hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
        fluid ? "w-full" : "w-28"
      }`}
    >
      <button
        type="button"
        onClick={() => chat(user)}
        aria-label={t("common.chatWithDisplayname", { displayName: user.displayName })}
        className="flex w-full cursor-pointer flex-col items-center"
      >
        <UserAvatar src={user.avatarUrl} name={user.displayName} size={56} userId={user.id} />
        <DisplayUserName
          name={user.displayName}
          verified={verifiedBadge(user.flags)}
          flags={user.flags}
          bot={user.bot}
          color={user.nameColor}
          className="mt-2 flex max-w-full justify-center truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
        />
        <span className="block max-w-full truncate text-[11px] text-zinc-500 dark:text-zinc-400">
          {shortStatus(presence, t)}
        </span>
      </button>
      <span className="pointer-events-none absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <Tooltip content={t("common.callDisplayname", { displayName: user.displayName })}>
          <button
            type="button"
            disabled={busyId === user.id}
            onClick={() => void call(user)}
            aria-label={t("common.callDisplayname", { displayName: user.displayName })}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-white text-emerald-700 shadow-sm transition hover:bg-emerald-50 disabled:opacity-50 dark:bg-zinc-800 dark:text-emerald-400 dark:hover:bg-zinc-700"
          >
            <MdCall className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip content={t("common.viewProfile")}>
          <button
            type="button"
            onClick={() => actions.openProfile(user.id)}
            aria-label={t("common.viewProfile")}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-white text-zinc-600 shadow-sm transition hover:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <MdPersonOutline className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </span>
    </div>
  );
}

/** A small face with the first name under it — the inbox layout's "Agora". */
function FaceButton({ user }: { user: SocialUser }) {
  const t = useT();
  return (
    <Tooltip content={t("common.chatWithDisplayname", { displayName: user.displayName })}>
      <button
        type="button"
        onClick={() => chat(user)}
        className="flex w-16 shrink-0 cursor-pointer flex-col items-center gap-1 rounded-xl py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        <UserAvatar src={user.avatarUrl} name={user.displayName} size={44} userId={user.id} />
        <span className="max-w-full truncate px-1 text-[11px] text-zinc-600 dark:text-zinc-400">
          {user.displayName.split(" ")[0]}
        </span>
      </button>
    </Tooltip>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{children}</p>
  );
}

/**
 * One friend in the list, Discord's way: a line between rows, the face with
 * its status dot, the name and a short status, and the actions always on the
 * right as round buttons (they light up with the row on hover). Clicking the
 * row talks, as Discord's does.
 */
function FriendRow({
  user,
  presence,
  busy,
  onCall,
  onProfile,
}: {
  user: SocialUser;
  presence: PresenceInfo | undefined;
  busy: boolean;
  onCall: () => void;
  onProfile: () => void;
}) {
  const t = useT();
  const on = connected(presence);
  const action =
    "flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition hover:text-zinc-950 disabled:opacity-50 group-hover:bg-white dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 dark:group-hover:bg-zinc-950";
  return (
    <li className="group -mx-2 border-t border-zinc-200 first:border-t-0 hover:border-transparent dark:border-zinc-800 [&:hover+li]:border-transparent">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2 transition group-hover:bg-zinc-100 dark:group-hover:bg-zinc-900">
        <button
          type="button"
          onClick={() => chat(user)}
          aria-label={t("common.chatWithDisplayname", { displayName: user.displayName })}
          className={`flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left ${on ? "" : "opacity-70 group-hover:opacity-100"}`}
        >
          <UserAvatar src={user.avatarUrl} name={user.displayName} size={36} userId={user.id} presenceSurface="page" className="shrink-0" />
          <span className="min-w-0 flex-1">
            <DisplayUserName
              name={user.displayName}
              verified={verifiedBadge(user.flags)}
              flags={user.flags}
              bot={user.bot}
              color={user.nameColor}
              className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"
            />
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{shortStatus(presence, t)}</span>
          </span>
        </button>
        <span className="flex shrink-0 gap-2">
          <Tooltip content={t("common.chatWithDisplayname", { displayName: user.displayName })}>
            <button type="button" onClick={() => chat(user)} aria-label={t("common.chatWithDisplayname", { displayName: user.displayName })} className={action}>
              <MdChatBubbleOutline className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content={t("common.callDisplayname", { displayName: user.displayName })}>
            <button type="button" disabled={busy} onClick={onCall} aria-label={t("common.callDisplayname", { displayName: user.displayName })} className={action}>
              <MdCall className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content={t("common.viewProfile")}>
            <button type="button" onClick={onProfile} aria-label={t("common.viewProfile")} className={action}>
              <MdMoreVert className="h-4 w-4" />
            </button>
          </Tooltip>
        </span>
      </div>
    </li>
  );
}

// ─── Groups in a call ─────────────────────────────────────────────────────

function activityLabel(group: GroupSummary, t: ReturnType<typeof useT>): string {
  return group.voiceActivity === "screen"
    ? t("groups.groupRail.callScreen")
    : group.voiceActivity === "camera"
      ? t("groups.groupRail.callCamera")
      : t("groups.groupRail.callVoice");
}

function LiveDot({ group }: { group: GroupSummary }) {
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${group.voiceActivity === "voice" ? "bg-emerald-500" : "bg-red-500"}`}
      aria-hidden
    />
  );
}

/** A group in a call, as a line with a way in. */
function LiveGroupBanner({ group }: { group: GroupSummary }) {
  const t = useT();
  return (
    <li>
      <GroupLink
        href={groupPath(group.id)}
        onMouseEnter={() => prefetchGroup(group.id)}
        className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 ring-1 ring-zinc-200 transition hover:ring-zinc-300 dark:bg-zinc-950 dark:ring-zinc-800 dark:hover:ring-zinc-700"
      >
        <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={36} className="rounded-lg" />
        <span className="min-w-0 flex-1">
          <GroupName name={group.name} flags={group.flags} className="flex w-full text-sm font-medium text-zinc-900 dark:text-zinc-100" />
          <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <LiveDot group={group} />
            <span className="truncate">{activityLabel(group, t)}</span>
          </span>
        </span>
        <span className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-300 dark:text-zinc-200 dark:ring-zinc-700">
          {t("groups.central.join")}
        </span>
      </GroupLink>
    </li>
  );
}

// ─── Inbox ────────────────────────────────────────────────────────────────

function InboxHeader({ data, compact = false }: { data: CentralData; compact?: boolean }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {t("groups.central.inbox")}
        {data.totalUnread > 0 && <span className={unreadBadge}>{data.totalUnread > 99 ? "99+" : data.totalUnread}</span>}
      </h2>
      <span className="flex items-center gap-3">
        {data.unreadNotifications && !compact && (
          <button type="button" onClick={markAllRead} className={quietLink}>
            {t("groups.central.markRead")}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            trackHubCentral(HUB_CENTRAL_EVENTS.dmAll);
            openDirectMessages(null, { expanded: true });
          }}
          className={quietLink}
        >
          {t("dmRecentStrip.allMessages")}
        </button>
      </span>
    </div>
  );
}

function InboxList({ data, grouped = false }: { data: CentralData; grouped?: boolean }) {
  const t = useT();
  const live = useDmLive();
  const { account } = useAuth();
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [ownProfileOpen, setOwnProfileOpen] = useState(false);

  // Same destinations as the bell's list (see NotificationInboxBell).
  function open(entry: InboxEntry) {
    if (entry.type === "dm") {
      trackHubCentral(HUB_CENTRAL_EVENTS.dmOpen);
      openDirectMessages(entry.user.id);
      return;
    }
    const { notification } = entry;
    trackHubCentral(HUB_CENTRAL_EVENTS.notifOpen, { tags: { kind: notification.kind } });
    if (notification.kind === "friend-request") setRequestsOpen(true);
    else if (notification.kind === "profile-comment") setOwnProfileOpen(true);
    else if (notification.kind === "call-missed" || notification.kind === "friend-accepted") {
      openDirectMessages(notification.userId);
    }
  }

  if (!data.inboxLoaded && data.inbox.length === 0) {
    return (
      <ul aria-hidden className="mt-3 flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
        ))}
      </ul>
    );
  }
  if (data.inbox.length === 0) {
    return <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t("groups.central.inboxEmpty")}</p>;
  }

  const unread = data.inbox.filter((entry) => entry.unread > 0);
  const read = data.inbox.filter((entry) => entry.unread === 0);
  const rows = (entries: InboxEntry[]) => (
    <ul className="-mx-2 flex flex-col">
      {entries.map((entry) => (
        <InboxRow key={entry.id} entry={entry} typing={entry.type === "dm" && Boolean(live.typing[entry.user.id])} onOpen={() => open(entry)} />
      ))}
    </ul>
  );

  return (
    <>
      {grouped && unread.length > 0 && read.length > 0 ? (
        <>
          <SubTitle>{t("groups.central.unread")}</SubTitle>
          {rows(unread)}
          <SubTitle>{t("groups.central.earlier")}</SubTitle>
          {rows(read)}
        </>
      ) : (
        <div className="mt-2">{rows(data.inbox)}</div>
      )}
      <FriendRequestsModal open={requestsOpen} onClose={() => setRequestsOpen(false)} />
      {ownProfileOpen && account && <UserProfileDialog userId={account.id} onClose={() => setOwnProfileOpen(false)} />}
    </>
  );
}

function InboxRow({ entry, typing, onOpen }: { entry: InboxEntry; typing: boolean; onOpen: () => void }) {
  const t = useT();
  const unread = entry.unread > 0;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="relative flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        {entry.type === "dm" ? (
          <UserAvatar
            src={entry.user.avatarUrl}
            name={entry.user.displayName}
            size={36}
            userId={entry.user.id}
            presenceSurface="page"
            className="shrink-0"
          />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <NotificationKindIcon kind={entry.notification.kind} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          {entry.type === "dm" ? (
            <DisplayUserName
              name={entry.user.displayName}
              verified={verifiedBadge(entry.user.flags)}
              flags={entry.user.flags}
              bot={entry.user.bot}
              color={entry.user.nameColor}
              className={`block truncate text-sm text-zinc-900 dark:text-zinc-100 ${unread ? "font-semibold" : "font-medium"}`}
            />
          ) : (
            <span className={`block truncate text-sm text-zinc-900 dark:text-zinc-100 ${unread ? "font-semibold" : "font-medium"}`}>
              {entry.notification.title}
            </span>
          )}
          {typing ? (
            <span className="hub-accent-text block truncate text-xs font-medium">
              {t("directMessagesModal.typing")}
            </span>
          ) : (
            <span
              className={`block truncate text-xs ${unread ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-500 dark:text-zinc-400"}`}
            >
              {entry.type === "dm" ? entry.line : entry.notification.body}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{relativeTime(entry.ts)}</span>
          {entry.type === "dm" && unread ? (
            <span className={unreadBadge}>{entry.unread > 99 ? "99+" : entry.unread}</span>
          ) : unread ? (
            <span className="hub-accent h-2 w-2 rounded-full" aria-hidden />
          ) : null}
        </span>
      </button>
    </li>
  );
}

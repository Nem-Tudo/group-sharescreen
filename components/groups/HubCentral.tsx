"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { MdCall, MdChatBubbleOutline, MdCheck, MdChevronRight, MdClose, MdPalette, MdPersonAdd, MdPersonOutline, MdSearch } from "react-icons/md";
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
import { usePeopleOnline } from "@/lib/peopleOnline";
import { formatLocale } from "@/lib/i18n";
import { ChamadosPanel } from "@/components/chamados/Chamados";
import { fetchPublicRoomDirectory, type PublicRoom } from "@/lib/roomsApi";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { startCall } from "@/lib/callsApi";
import { useDmLive } from "@/lib/dmLive";
import { messageSummary } from "@/lib/dmThread";
import { openDirectMessages } from "@/lib/dmWindow";
import { verifiedBadge } from "@/lib/entitlements";
import type { GroupSummary } from "@/lib/groupsApi";
import { GROUPS_EXPLORE_PATH, groupPath } from "@/lib/groupLinks";
import { HUB_CENTRAL_EVENTS, trackHubCentral, type HubCentralLayout } from "@/lib/hubCentral";
import { markAllRead, useNotificationInbox, type InboxNotification } from "@/lib/notificationInbox";
import { usePresenceMap } from "@/lib/presence";
import type { PresenceInfo } from "@/lib/signalingClient";
import { acceptFriend, removeFriend, type SocialUser } from "@/lib/socialApi";
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
  | { type: "notification"; id: string; ts: number; unread: number; notification: InboxNotification }
  | { type: "bundle"; kind: "friend-request" | "theme-like" | "gift"; id: string; ts: number; unread: number; title: string; body: string };

function useCentralData(inboxSize: number) {
  const t = useT();
  const { account } = useAuth();
  const { graph, loading: graphLoading, refresh: refreshGraph } = useSocialGraph();
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
    // Bundled instead of one row each: a dozen "Novo pedido de amizade" rows
    // drowned the messages. The requests are one line (the graph's pending
    // list is the truth: answered ones drop out), and the likes on this
    // person's themes and effects are one line once there is more than one.
    const requests = notifications.filter((n) => n.kind === "friend-request");
    if (graph.incoming.length > 0) {
      const names = graph.incoming.slice(0, 2).map((user) => user.displayName);
      const rest = graph.incoming.length - names.length;
      entries.push({
        type: "bundle",
        kind: "friend-request",
        id: "bundle:friend-request",
        // 0 when the bell has no row for them (cleared): no time is shown then.
        ts: requests.reduce((max, n) => Math.max(max, n.ts), 0),
        unread: requests.some((n) => !n.read) ? 1 : 0,
        title:
          graph.incoming.length === 1
            ? t("groups.central.request")
            : t("groups.central.requests", { count: graph.incoming.length }),
        body: rest > 0 ? t("groups.central.namesAndMore", { names: names.join(", "), count: rest }) : names.join(", "),
      });
    }
    const likes = notifications.filter((n) => n.kind === "theme-like" || n.kind === "camera-effect-like");
    if (likes.length > 1) {
      const latest = likes.reduce((a, b) => (b.ts > a.ts ? b : a));
      entries.push({
        type: "bundle",
        kind: "theme-like",
        id: "bundle:likes",
        ts: latest.ts,
        unread: likes.some((n) => !n.read) ? 1 : 0,
        title: t("groups.central.likesBundle", { count: likes.length }),
        body: latest.title,
      });
    }
    const gifts = notifications.filter((n) => n.kind === "gift");
    if (gifts.length > 1) {
      const latest = gifts.reduce((a, b) => (b.ts > a.ts ? b : a));
      entries.push({
        type: "bundle",
        kind: "gift",
        id: "bundle:gifts",
        ts: latest.ts,
        unread: gifts.some((n) => !n.read) ? 1 : 0,
        title: t("groups.central.giftsBundle", { count: gifts.length }),
        body: latest.title,
      });
    }
    const bundled = new Set<InboxNotification["kind"]>([
      "friend-request",
      ...(likes.length > 1 ? (["theme-like", "camera-effect-like"] as const) : []),
      ...(gifts.length > 1 ? (["gift"] as const) : []),
    ]);
    // The bell's "Mensagem de …" rows are the conversations above, again.
    for (const notification of notifications) {
      if (notification.kind === "dm" || bundled.has(notification.kind)) continue;
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
  }, [recent.rows, notifications, graph.incoming, account?.id, t, inboxSize]);

  const unreadNotifications = notifications.some((item) => !item.read && item.kind !== "dm");

  return {
    account,
    friends,
    online,
    presence,
    incoming: graph.incoming.length,
    incomingUsers: graph.incoming,
    outgoingUsers: graph.outgoing,
    refreshGraph,
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
  chamados = false,
}: {
  layout: HubCentralLayout;
  /** The room form (RoomStartForm with its tracking), drawn where the layout puts it. */
  startRoomForm: ReactNode;
  /** Groups of this person's with a call going on, or null while loading. */
  liveGroups: GroupSummary[] | null;
  links: HubCentralLink[];
  /** The chamados feed is on (experiment chamados): the "now" layout draws it under the room form. */
  chamados?: boolean;
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
      <NowLayout data={data} actions={actions} startRoomForm={startRoomForm} liveGroups={liveGroups} links={links} chamados={chamados} />
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
  chamados?: boolean;
}

// ─── Layout: now ──────────────────────────────────────────────────────────

// A centred composition, checked in screenshots at 2560, 1920 and 1366
// before it was written: the room card on the page's axis with the greeting
// over it, flanked by two panels of the same width and the card's exact height
// (what is live in your groups on one side; chamados, or the public rooms
// live, on the other), and the friends across the full width under that band,
// running to the bottom. The symmetry is what lets a centred card belong to
// the page instead of floating in it. Below 2xl the card keeps the axis on its
// own row and the two panels sit side by side under it.
//
// What is waiting for you (messages and the bell, one inbox) is the column
// glued to the right edge, with the way to the themes at its foot. The ways
// out (explore, rooms, map, invite, new group) are not repeated here: the
// rail and the shell's bar already have every one of them.
function NowLayout({ data, actions, startRoomForm, liveGroups, links, chamados = false }: LayoutProps) {
  const live = liveGroups ?? [];
  const roomsHref = links.find((link) => link.key === "rooms")?.href ?? "/rooms";
  // Lifted so the inbox's requests line can open the Pendentes tab. "Todos"
  // first (online on top, the rest dimmed): an Online tab with five people
  // left the panel a band of nothing.
  const [friendsTab, setFriendsTab] = useState<FriendsTab>("all");
  const friendsRef = useRef<HTMLElement | null>(null);
  function showPending() {
    setFriendsTab("pending");
    friendsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // The side panels take the card's height, not their own: `h-0 min-h-full`
  // inside the grid row makes the card the row's measure, and their lists
  // scroll inside. Stacked (below 2xl) they are capped instead.
  const side = "max-h-72 2xl:h-0 2xl:max-h-none 2xl:min-h-full";
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-5 xl:px-6 2xl:px-8">
        <div className="mx-auto flex w-full max-w-2xl shrink-0 flex-col items-center text-center">
          <Greeting data={data} />
          <GoliveOnline className="mt-3" />
        </div>

        <div className="mt-5 grid shrink-0 grid-cols-2 gap-4 2xl:grid-cols-[minmax(0,1fr)_30rem_minmax(0,1fr)]">
          <StartStrip
            form={startRoomForm}
            hero
            className="col-span-2 mx-auto max-w-xl 2xl:col-span-1 2xl:col-start-2 2xl:row-start-1 2xl:max-w-none"
          />
          <LivePanel live={live} loading={liveGroups === null} className={`2xl:col-start-1 2xl:row-start-1 ${side}`} />
          {chamados ? (
            <ChamadosPanel className={`2xl:col-start-3 2xl:row-start-1 ${side}`} />
          ) : (
            <PublicRoomsPanel href={roomsHref} className={`2xl:col-start-3 2xl:row-start-1 ${side}`} />
          )}
        </div>

        <FriendsSection data={data} actions={actions} tab={friendsTab} setTab={setFriendsTab} sectionRef={friendsRef} />
      </div>

      {/* Cards, like the rest of the page, held to the right edge by the
          same small gutter the rail keeps on the left, full height. */}
      <aside className="flex min-h-[24rem] shrink-0 flex-col gap-3 px-6 pb-6 lg:min-h-0 lg:w-[19rem] lg:py-4 lg:pl-0 lg:pr-3 xl:w-[22rem] xl:pr-4 2xl:w-[25rem]">
        <section className={`${tile} flex min-h-0 flex-1 flex-col !px-3 !pb-2 !pt-4`}>
          <div className="px-2">
            <InboxHeader data={data} compact />
          </div>
          <Scroll>
            <InboxList data={data} onPending={showPending} focused />
          </Scroll>
        </section>
        <ThemesLink />
      </aside>
    </div>
  );
}

type FriendsTab = "online" | "all" | "pending";

/**
 * The friends, in the site's own look: a segmented switch like the room
 * form's Pública/Privada, a search, and the people as cards that fill the
 * width. "Pendentes" is a tab of the same list, with accept and decline on
 * each request, not a popup.
 */
function FriendsSection({
  data,
  actions,
  tab,
  setTab,
  sectionRef,
}: {
  data: CentralData;
  actions: FriendActions;
  tab: FriendsTab;
  setTab: (tab: FriendsTab) => void;
  sectionRef: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const { busyId, error, call } = useCall();
  const [requestBusy, setRequestBusy] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const matches = (user: SocialUser) =>
    !q || user.displayName.toLowerCase().includes(q) || user.username.toLowerCase().includes(q);

  function choose(next: FriendsTab) {
    if (next === tab) return;
    trackHubCentral(next === "pending" ? HUB_CENTRAL_EVENTS.requests : HUB_CENTRAL_EVENTS.friendsTab, { tags: { tab: next } });
    setTab(next);
  }

  async function answer(userId: string, accept: boolean, action: "accept" | "decline" | "cancel") {
    if (requestBusy) return;
    trackHubCentral(HUB_CENTRAL_EVENTS.requestReply, { tags: { action } });
    setRequestBusy(userId);
    await (accept ? acceptFriend(userId) : removeFriend(userId));
    data.refreshGraph();
    setRequestBusy(null);
  }

  const pendingCount = data.incomingUsers.length;
  const tabs: { key: FriendsTab; label: string; count?: number }[] = [
    { key: "online", label: t("common.online"), count: data.online.length },
    { key: "all", label: t("groups.central.tabAll"), count: data.friends.length },
    { key: "pending", label: t("groups.central.tabPending") },
  ];

  const grid = "grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2";
  const card = (user: SocialUser, presence: PresenceInfo | undefined, side: ReactNode) => (
    <li
      key={user.id}
      className="group flex items-center gap-3 rounded-xl bg-zinc-100/70 p-3 transition hover:bg-zinc-100 dark:bg-zinc-900/60 dark:hover:bg-zinc-900"
    >
      <button
        type="button"
        onClick={() => actions.openProfile(user.id)}
        aria-label={t("common.seeDisplaynameSProfile", { displayName: user.displayName })}
        className={`flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left ${
          tab === "pending" || connected(presence) ? "" : "opacity-60 group-hover:opacity-100"
        }`}
      >
        <UserAvatar src={user.avatarUrl} name={user.displayName} size={40} userId={user.id} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <DisplayUserName
            name={user.displayName}
            verified={verifiedBadge(user.flags)}
            flags={user.flags}
            bot={user.bot}
            color={user.nameColor}
            className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
          />
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
            {tab === "pending" ? `@${user.username}` : shortStatus(presence, t)}
          </span>
        </span>
      </button>
      {side}
    </li>
  );

  const iconButton =
    "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";
  const friendActions = (user: SocialUser) => (
    <span className="flex shrink-0 gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
      <Tooltip content={t("common.chatWithDisplayname", { displayName: user.displayName })}>
        <button type="button" onClick={() => chat(user)} aria-label={t("common.chatWithDisplayname", { displayName: user.displayName })} className={iconButton}>
          <MdChatBubbleOutline className="h-4 w-4" />
        </button>
      </Tooltip>
      <Tooltip content={t("common.callDisplayname", { displayName: user.displayName })}>
        <button
          type="button"
          disabled={busyId === user.id}
          onClick={() => void call(user)}
          aria-label={t("common.callDisplayname", { displayName: user.displayName })}
          className={iconButton}
        >
          <MdCall className="h-4 w-4" />
        </button>
      </Tooltip>
    </span>
  );

  let body: ReactNode;
  if (data.friendsLoading) {
    body = (
      <ul aria-hidden className={grid}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="h-16 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
        ))}
      </ul>
    );
  } else if (tab === "pending") {
    const incoming = data.incomingUsers.filter(matches);
    const outgoing = data.outgoingUsers.filter(matches);
    body =
      incoming.length === 0 && outgoing.length === 0 ? (
        <Empty>{q ? t("groups.central.noMatch") : t("groups.central.noPending")}</Empty>
      ) : (
        <>
          {incoming.length > 0 && (
            <>
              <SubTitle>{t("groups.central.receivedSection", { count: incoming.length })}</SubTitle>
              <ul className={grid}>
                {incoming.map((user) =>
                  card(
                    user,
                    undefined,
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        disabled={requestBusy === user.id}
                        onClick={() => void answer(user.id, true, "accept")}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-zinc-950 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                      >
                        <MdCheck className="h-3.5 w-3.5" />
                        {t("common.accept")}
                      </button>
                      <Tooltip content={t("common.decline")}>
                        <button
                          type="button"
                          disabled={requestBusy === user.id}
                          onClick={() => void answer(user.id, false, "decline")}
                          aria-label={t("common.decline")}
                          className={iconButton}
                        >
                          <MdClose className="h-4 w-4" />
                        </button>
                      </Tooltip>
                    </span>
                  )
                )}
              </ul>
            </>
          )}
          {outgoing.length > 0 && (
            <>
              <SubTitle>{t("groups.central.sentSection", { count: outgoing.length })}</SubTitle>
              <ul className={grid}>
                {outgoing.map((user) =>
                  card(
                    user,
                    undefined,
                    <button
                      type="button"
                      disabled={requestBusy === user.id}
                      onClick={() => void answer(user.id, false, "cancel")}
                      className="shrink-0 cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-50 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                    >
                      {t("groups.central.cancelRequest")}
                    </button>
                  )
                )}
              </ul>
            </>
          )}
        </>
      );
  } else if (data.friends.length === 0) {
    body = (
      <Empty>
        {t("common.youDonTHaveAnyFriends")}{" "}
        <button
          type="button"
          onClick={actions.addFriend}
          className="cursor-pointer font-medium underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {t("homeFriendsPanel.addSomeone")}
        </button>
      </Empty>
    );
  } else {
    const shown = (tab === "online" ? data.online : data.friends).filter(matches);
    body =
      shown.length === 0 ? (
        <Empty>{q ? t("groups.central.noMatch") : t("groups.central.nobodyNow")}</Empty>
      ) : (
        <ul className={grid}>
          {shown.slice(0, 300).map((user) => card(user, data.presence[user.id], friendActions(user)))}
        </ul>
      );
  }

  return (
    <section ref={sectionRef} className={`${tile} mt-4 flex min-h-[16rem] flex-1 shrink-0 scroll-mt-4 flex-col !p-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <SectionTitle>{t("common.friends")}</SectionTitle>
        <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900" role="tablist">
          {tabs.map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => choose(key)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition ${
                tab === key
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {label}
              {key === "pending" && pendingCount > 0 ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">
                  {pendingCount > 99 ? "99+" : pendingCount}
                </span>
              ) : count !== undefined ? (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{count}</span>
              ) : null}
            </button>
          ))}
        </div>
        {/* The search right after the tabs (it filters what they show); the
            button at the far end. */}
        <div className="flex min-w-[12rem] flex-1 items-center gap-2">
          <div className="relative min-w-0 max-w-56 flex-1">
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
              className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-500 [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          <button
            type="button"
            onClick={actions.addFriend}
            aria-label={t("common.addFriend")}
            title={t("common.addFriend")}
            className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-950 px-2.5 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 xl:px-3 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <MdPersonAdd className="h-4 w-4" />
            <span className="hidden xl:inline">{t("common.addFriend")}</span>
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-3">{body}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      {children}
    </p>
  );
}

/** "Temas", at the foot of the right column: the way to the workshop. */
function ThemesLink() {
  const t = useT();
  return (
    <GroupLink
      href="/workshop"
      onClick={() => trackHubCentral(HUB_CENTRAL_EVENTS.link, { tags: { to: "themes" } })}
      className={`${tile} group flex shrink-0 items-center gap-3 !p-3.5 transition hover:ring-zinc-300 dark:hover:ring-zinc-700`}
    >
      <span className="hub-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
        <MdPalette className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t("groups.central.themesTitle")}</span>
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{t("groups.central.themesHint")}</span>
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
function StartStrip({ form, className = "", hero = false }: { form: ReactNode; className?: string; hero?: boolean }) {
  const t = useT();
  if (hero) {
    // The page's main action, drawn the way the site's home draws it: a card
    // of its own, centred, with the form standing up inside (RoomStartForm's
    // `stack`). No glow, no icon tile: a title, a line, the form.
    return (
      <section className={`${tile} hub-ring w-full shrink-0 !p-6 ${className}`}>
        <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{t("groups.hub.startRoom")}</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("groups.hub.startRoomHint")}</p>
        <div className="mt-5">{form}</div>
      </section>
    );
  }
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

/**
 * Everybody on Go Live right now, as its own pill with a live dot: the number
 * the site's home shows, and the one that says the place is alive even when
 * no friend is around. Nothing until the first count arrives (no "0").
 */
export function GoliveOnline({ className = "" }: { className?: string }) {
  const t = useT();
  const everyone = usePeopleOnline();
  if (everyone === null || everyone <= 0) return null;
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 ${className}`}
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      {everyone === 1
        ? t("groups.central.goliveOnlineOne")
        : t("groups.central.goliveOnlineMany", { count: everyone.toLocaleString(formatLocale()) })}
    </span>
  );
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

/**
 * "Acontecendo nos seus grupos" as the left pane's second panel: under the
 * room card, filling the rest of the column, the groups with a call going on
 * as plain rows. With none, it says so and offers the way to find more —
 * an empty state with somewhere to go, not a blank box.
 */
function LivePanel({ live, loading, className = "" }: { live: GroupSummary[]; loading: boolean; className?: string }) {
  const t = useT();
  return (
    <section className={`${tile} flex min-h-[10rem] flex-col !p-4 ${className}`}>
      <SectionTitle>{t("groups.hub.happening")}</SectionTitle>
      <div className="-mr-2 mt-2 min-h-0 flex-1 overflow-y-auto pr-2">
        {loading ? (
          <ul aria-hidden className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <li key={i} className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
            ))}
          </ul>
        ) : live.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("groups.hub.nothingHappening")}{" "}
            <GroupLink href={GROUPS_EXPLORE_PATH} className="font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50">
              {t("groups.groupDialogs.exploreGroups")}
            </GroupLink>
          </p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {live.map((group) => (
              <li key={group.id}>
                <GroupLink
                  href={groupPath(group.id)}
                  onMouseEnter={() => prefetchGroup(group.id)}
                  className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={36} className="rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <GroupName name={group.name} flags={group.flags} className="flex w-full text-sm font-medium text-zinc-900 dark:text-zinc-100" />
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                      <LiveDot group={group} />
                      <span className="truncate">{activityLabel(group, t)}</span>
                    </span>
                  </span>
                  <span className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-300 transition group-hover:bg-white dark:text-zinc-200 dark:ring-zinc-700 dark:group-hover:bg-zinc-950">
                    {t("groups.central.join")}
                  </span>
                </GroupLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * "Salas ao vivo": the public rooms with people in them, busiest first — the
 * site-wide twin of "Acontecendo nos seus grupos", and the panel across from
 * it when the chamados are not on. Read on arrival and every 30 s.
 */
function PublicRoomsPanel({ href, className = "" }: { href: string; className?: string }) {
  const t = useT();
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { rooms: list } = await fetchPublicRoomDirectory();
        if (alive) setRooms(list.filter((room) => room.peopleCount > 0).slice(0, 12));
      } catch {
        if (alive) setRooms((current) => current ?? []);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className={`${tile} flex min-h-[10rem] flex-col !p-4 ${className}`}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <SectionTitle>{t("groups.central.liveRooms")}</SectionTitle>
        <GroupLink href={href} className={quietLink}>
          {t("common.seeAll")}
        </GroupLink>
      </div>
      <div className="-mr-2 mt-2 min-h-0 flex-1 overflow-y-auto pr-2">
        {rooms === null ? (
          <ul aria-hidden className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <li key={i} className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
            ))}
          </ul>
        ) : rooms.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("groups.central.noLiveRooms")}</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {rooms.map((room) => (
              <li key={room.handle}>
                <GroupLink
                  href={`/watch/${encodeURIComponent(room.handle)}`}
                  onClick={() => trackHubCentral(HUB_CENTRAL_EVENTS.link, { tags: { to: "live_room" } })}
                  className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-sm font-semibold uppercase text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    {room.handle.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{room.handle}</span>
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${(room.screenCount ?? 0) > 0 ? "bg-red-500" : "bg-emerald-500"}`} aria-hidden />
                      <span className="truncate">
                        {room.peopleCount === 1
                          ? t("groups.central.inRoomOne")
                          : t("groups.central.inRoomMany", { count: room.peopleCount })}
                        {room.description ? ` · ${room.description}` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-300 transition group-hover:bg-white dark:text-zinc-200 dark:ring-zinc-700 dark:group-hover:bg-zinc-950">
                    {t("groups.central.join")}
                  </span>
                </GroupLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
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

function InboxList({
  data,
  grouped = false,
  onPending,
  focused = false,
}: {
  data: CentralData;
  grouped?: boolean;
  /** Where the friend requests line leads: the friends list's Pendentes tab (now layout), else the requests popup. */
  onPending?: () => void;
  /**
   * Only what asks for attention: the unread as full rows, then a few recent
   * ones as single compact lines, and the rest behind "Ver tudo" — the whole
   * list at one weight was a wall nobody reads (now layout).
   */
  focused?: boolean;
}) {
  const t = useT();
  const live = useDmLive();
  const router = useRouter();
  const { account } = useAuth();
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [ownProfileOpen, setOwnProfileOpen] = useState(false);
  // A conversation's face or name opens that person's profile, not the chat.
  const [profileId, setProfileId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Same destinations as the bell's list (see NotificationInboxBell).
  function open(entry: InboxEntry) {
    if (entry.type === "dm") {
      trackHubCentral(HUB_CENTRAL_EVENTS.dmOpen);
      openDirectMessages(entry.user.id);
      return;
    }
    if (entry.type === "bundle") {
      trackHubCentral(HUB_CENTRAL_EVENTS.notifOpen, { tags: { kind: entry.kind } });
      if (entry.kind === "friend-request") {
        if (onPending) onPending();
        else setRequestsOpen(true);
      }
      return;
    }
    const { notification } = entry;
    trackHubCentral(HUB_CENTRAL_EVENTS.notifOpen, { tags: { kind: notification.kind } });
    if (notification.kind === "friend-request") setRequestsOpen(true);
    else if (notification.kind === "profile-comment") setOwnProfileOpen(true);
    else if (notification.kind === "chamado-going" && notification.href) router.push(notification.href);
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
        <InboxRow
          key={entry.id}
          entry={entry}
          typing={entry.type === "dm" && Boolean(live.typing[entry.user.id])}
          onOpen={() => open(entry)}
          onProfile={entry.type === "dm" ? () => setProfileId(entry.user.id) : undefined}
        />
      ))}
    </ul>
  );

  const modals = (
    <>
      <FriendRequestsModal open={requestsOpen} onClose={() => setRequestsOpen(false)} />
      {ownProfileOpen && account && <UserProfileDialog userId={account.id} onClose={() => setOwnProfileOpen(false)} />}
      {profileId && <UserProfileDialog userId={profileId} onClose={() => setProfileId(null)} />}
    </>
  );

  if (focused) {
    const recentCount = unread.length > 0 ? FOCUSED_RECENT : FOCUSED_RECENT_CALM;
    const readShown = showAll ? read : read.slice(0, recentCount);
    const hidden = read.length - readShown.length;
    return (
      <>
        {unread.length > 0 ? (
          <div className="mt-2">{rows(unread)}</div>
        ) : (
          <p className="mt-3 flex items-center gap-2 px-2 text-sm text-zinc-500 dark:text-zinc-400">
            <MdCheck className="hub-accent-text h-4 w-4 shrink-0" />
            {t("groups.central.allCaughtUp")}
          </p>
        )}
        {readShown.length > 0 && (
          <>
            <p className="mb-1 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              {t("groups.central.recent")}
            </p>
            <ul className="-mx-2 flex flex-col">
              {readShown.map((entry) => (
                <CompactInboxRow
                  key={entry.id}
                  entry={entry}
                  onOpen={() => open(entry)}
                  onProfile={entry.type === "dm" ? () => setProfileId(entry.user.id) : undefined}
                />
              ))}
            </ul>
          </>
        )}
        {(hidden > 0 || showAll) && read.length > recentCount && (
          <button
            type="button"
            onClick={() => {
              if (!showAll) trackHubCentral(HUB_CENTRAL_EVENTS.inboxMore);
              setShowAll(!showAll);
            }}
            className={`${quietLink} mt-1 px-2 py-1.5`}
          >
            {showAll ? t("groups.central.showLess") : t("groups.central.seeAllCount", { count: hidden })}
          </button>
        )}
        {modals}
      </>
    );
  }

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
      {modals}
    </>
  );
}

/** How many read rows the focused inbox shows under the unread ones, and when there is nothing unread. */
const FOCUSED_RECENT = 5;
const FOCUSED_RECENT_CALM = 3;

/**
 * A read entry in the focused inbox: one line, small face or icon, the name
 * plain (no colour, no badges) and the preview beside it in grey. The time
 * only when it is from today; older than that, it does not matter here.
 */
function CompactInboxRow({ entry, onOpen, onProfile }: { entry: InboxEntry; onOpen: () => void; onProfile?: () => void }) {
  const t = useT();
  const name =
    entry.type === "dm" ? entry.user.displayName : entry.type === "bundle" ? entry.title : entry.notification.title;
  const line = entry.type === "dm" ? entry.line : entry.type === "bundle" ? entry.body : entry.notification.body ?? "";
  const today = isFromToday(entry.ts);
  return (
    <li>
      <RowShell onOpen={onOpen} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900">
        {entry.type === "dm" ? (
          <ProfileHit onProfile={onProfile} label={t("common.seeDisplaynameSProfile", { displayName: entry.user.displayName })} className="shrink-0 rounded-full">
            <UserAvatar src={entry.user.avatarUrl} name={entry.user.displayName} size={24} userId={entry.user.id} className="shrink-0" />
          </ProfileHit>
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400 [&_svg]:h-3.5 [&_svg]:w-3.5">
            <NotificationKindIcon kind={entry.type === "bundle" ? entry.kind : entry.notification.kind} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {entry.type === "dm" ? (
            <ProfileHit onProfile={onProfile} className="font-medium text-zinc-700 hover:underline dark:text-zinc-300">
              {name}
            </ProfileHit>
          ) : (
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{name}</span>
          )}
          {line && <span className="text-zinc-400 dark:text-zinc-500"> · {line}</span>}
        </span>
        {today && <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">{relativeTime(entry.ts)}</span>}
      </RowShell>
    </li>
  );
}

function InboxRow({
  entry,
  typing,
  onOpen,
  onProfile,
}: {
  entry: InboxEntry;
  typing: boolean;
  onOpen: () => void;
  onProfile?: () => void;
}) {
  const t = useT();
  const unread = entry.unread > 0;
  return (
    <li>
      <RowShell
        onOpen={onOpen}
        className="relative flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        {entry.type === "dm" ? (
          <ProfileHit onProfile={onProfile} label={t("common.seeDisplaynameSProfile", { displayName: entry.user.displayName })} className="shrink-0 rounded-full">
            <UserAvatar
              src={entry.user.avatarUrl}
              name={entry.user.displayName}
              size={36}
              userId={entry.user.id}
              presenceSurface="page"
              className="shrink-0"
            />
          </ProfileHit>
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <NotificationKindIcon kind={entry.type === "bundle" ? entry.kind : entry.notification.kind} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          {entry.type === "dm" ? (
            <ProfileHit onProfile={onProfile} className="flex max-w-full hover:underline">
              <DisplayUserName
                name={entry.user.displayName}
                verified={verifiedBadge(entry.user.flags)}
                flags={entry.user.flags}
                bot={entry.user.bot}
                color={entry.user.nameColor}
                className={`block truncate text-sm text-zinc-900 dark:text-zinc-100 ${unread ? "font-semibold" : "font-medium"}`}
              />
            </ProfileHit>
          ) : (
            <span className={`block truncate text-sm text-zinc-900 dark:text-zinc-100 ${unread ? "font-semibold" : "font-medium"}`}>
              {entry.type === "bundle" ? entry.title : entry.notification.title}
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
              {entry.type === "dm" ? entry.line : entry.type === "bundle" ? entry.body : entry.notification.body}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {entry.ts > 0 && <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{relativeTime(entry.ts)}</span>}
          {entry.type === "dm" && unread ? (
            <span className={unreadBadge}>{entry.unread > 99 ? "99+" : entry.unread}</span>
          ) : unread ? (
            <span className="hub-accent h-2 w-2 rounded-full" aria-hidden />
          ) : null}
        </span>
      </RowShell>
    </li>
  );
}

/**
 * An inbox row: the whole of it opens the entry (the conversation, the
 * notification's place). A div acting as the button rather than a <button>,
 * because the face and the name inside it are buttons of their own (the
 * person's profile), and a button cannot hold another.
 */
function RowShell({ onOpen, className, children }: { onOpen: () => void; className: string; children: ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={className}
    >
      {children}
    </div>
  );
}

/** The face or the name of a conversation: opens the person's profile instead of the row's own action. */
function ProfileHit({
  onProfile,
  label,
  className = "",
  children,
}: {
  onProfile?: () => void;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  if (!onProfile) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onProfile();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`cursor-pointer text-left ${className}`}
    >
      {children}
    </button>
  );
}

/** Within the last 24 hours. Outside the component: reading the clock is not render work. */
function isFromToday(ts: number): boolean {
  return ts > 0 && Date.now() - ts < 24 * 60 * 60 * 1000;
}

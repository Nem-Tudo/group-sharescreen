"use client";

import { useMemo, useState, type ReactNode } from "react";
import { MdCall, MdChatBubbleOutline, MdPersonAdd } from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { UserProfileDialog } from "@/components/UserProfileDialog";
import { Tooltip } from "@/components/Tooltip";
import { AddFriendDialog } from "@/components/AddFriendDialog";
import { FriendRequestsModal } from "@/components/FriendRequestsModal";
import { NotificationKindIcon, relativeTime } from "@/components/NotificationInboxBell";
import { SkeletonRows } from "@/components/HomeSkeletons";
import { useAuth } from "@/lib/AuthContext";
import { startCall } from "@/lib/callsApi";
import { useDmLive } from "@/lib/dmLive";
import { messageSummary } from "@/lib/dmThread";
import { openDirectMessages } from "@/lib/dmWindow";
import { verifiedBadge } from "@/lib/entitlements";
import { HUB_CENTRAL_EVENTS, trackHubCentral } from "@/lib/hubCentral";
import { markAllRead, useNotificationInbox, type InboxNotification } from "@/lib/notificationInbox";
import { presenceLabel, usePresenceMap } from "@/lib/presence";
import type { PresenceInfo } from "@/lib/signalingClient";
import type { SocialUser } from "@/lib/socialApi";
import { useRecentConversations } from "@/lib/useRecentConversations";
import { useSocialGraph } from "@/lib/useSocialGraph";
import { useT } from "@/lib/useI18n";

// The home inside the groups layout as the app's central (experiment
// hub-central, see lib/hubCentral): the room form, the groups' live calls and
// the ways out that GroupsHubHome already had, plus friends, messages and
// notifications — three columns on a wide screen, one under the other below.
//
// The data is the same the rest of the app reads (the social graph, the
// recent conversations store the header's faces share, the bell's inbox), so
// nothing here keeps a copy that could disagree with the header above it.

const card = "rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950";
const cardTitle = "flex items-center gap-1.5 text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50";
const cardHint = "mt-0.5 text-sm text-zinc-500 dark:text-zinc-400";
const headerLink =
  "shrink-0 cursor-pointer text-xs font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";
const row =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900";
const countBadge =
  "flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold text-white";

const MESSAGE_ROWS = 5;
const NOTIFICATION_ROWS = 5;

function connected(presence: PresenceInfo | undefined): boolean {
  return presence !== undefined && presence.state !== "offline";
}

export function HubCentralHome({
  startRoom,
  happening,
  discover,
}: {
  startRoom: ReactNode;
  happening: ReactNode;
  discover: ReactNode;
}) {
  const t = useT();
  const { account } = useAuth();
  const { graph, loading: graphLoading } = useSocialGraph();
  // One subscription for the whole page: the greeting's count and the
  // friends card's order both come from it (see lib/presence's ref-counting).
  const presence = usePresenceMap(graph.friends.map((user) => user.id));
  const onlineCount = graph.friends.filter((user) => connected(presence[user.id])).length;
  const recent = useRecentConversations(MESSAGE_ROWS);

  const hour = new Date().getHours();
  const greetingKey =
    hour < 5 ? "groups.central.evening" : hour < 12 ? "groups.central.morning" : hour < 18 ? "groups.central.afternoon" : "groups.central.evening";
  const summary = [
    onlineCount > 0 &&
      (onlineCount === 1 ? t("groups.central.friendOnline") : t("groups.central.friendsOnline", { count: onlineCount })),
    recent.totalUnread > 0 &&
      (recent.totalUnread === 1
        ? t("groups.central.unreadMessage")
        : t("groups.central.unreadMessages", { count: recent.totalUnread })),
  ].filter(Boolean);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 lg:my-auto lg:py-10 xl:max-w-7xl">
        <header className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {t(greetingKey, { name: account?.displayName ?? "" })}
          </h1>
          {summary.length > 0 && <p className={cardHint}>{summary.join(" · ")}</p>}
        </header>
        <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] 2xl:gap-6">
          <div className="flex min-w-0 flex-col gap-4 2xl:gap-6">
            {startRoom}
            {discover}
          </div>
          <div className="flex min-w-0 flex-col gap-4 2xl:gap-6">
            <MessagesCard recent={recent} />
            {happening}
          </div>
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2 lg:grid lg:grid-cols-2 xl:col-span-1 xl:flex 2xl:gap-6">
            <FriendsCard
              friends={graph.friends}
              incoming={graph.incoming.length}
              loading={graphLoading}
              presence={presence}
              onlineCount={onlineCount}
            />
            <NotificationsCard />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Friends ──────────────────────────────────────────────────────────────

function FriendsCard({
  friends,
  incoming,
  loading,
  presence,
  onlineCount,
}: {
  friends: SocialUser[];
  incoming: number;
  loading: boolean;
  presence: Record<string, PresenceInfo>;
  onlineCount: number;
}) {
  const t = useT();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Whoever can answer right now first; a stable sort, so the list only moves
  // when somebody's presence does (same rule as the site home's panel).
  const sorted = useMemo(
    () => [...friends].sort((a, b) => Number(connected(presence[b.id])) - Number(connected(presence[a.id]))),
    [friends, presence]
  );

  async function call(user: SocialUser) {
    if (busyId) return;
    trackHubCentral(HUB_CENTRAL_EVENTS.call);
    setBusyId(user.id);
    setError(null);
    const result = await startCall(user.id);
    if (!result.ok) setError(result.error ?? t("common.couldNotCall"));
    setBusyId(null);
  }

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={cardTitle}>
          {t("common.friends")}
          {onlineCount > 0 && (
            <span className="text-sm font-normal text-emerald-600 dark:text-emerald-400">
              {t("groups.central.onlineCount", { count: onlineCount })}
            </span>
          )}
        </h2>
        <Tooltip content={t("common.addFriend")}>
          <button
            type="button"
            onClick={() => {
              trackHubCentral(HUB_CENTRAL_EVENTS.friendAdd);
              setAdding(true);
            }}
            aria-label={t("common.addFriend")}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <MdPersonAdd className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>

      {incoming > 0 && (
        <button
          type="button"
          onClick={() => {
            trackHubCentral(HUB_CENTRAL_EVENTS.requests);
            setRequestsOpen(true);
          }}
          className="mt-3 block w-full cursor-pointer rounded-lg bg-emerald-50 px-2.5 py-2 text-left text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/60"
        >
          {incoming === 1 ? t("groups.central.request") : t("groups.central.requests", { count: incoming })}
        </button>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {loading && friends.length === 0 ? (
        <SkeletonRows count={4} trailing="icons" />
      ) : sorted.length === 0 ? (
        <p className={cardHint}>
          {t("common.youDonTHaveAnyFriends")}{" "}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="cursor-pointer font-medium underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {t("homeFriendsPanel.addSomeone")}
          </button>
        </p>
      ) : (
        <ul className="-mx-2 mt-2 flex max-h-80 flex-col overflow-y-auto">
          {sorted.map((user) => {
            const info = presence[user.id];
            return (
              <li key={user.id} className="group flex items-center gap-1 rounded-xl px-2 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => setProfileId(user.id)}
                  aria-label={t("common.seeDisplaynameSProfile", { displayName: user.displayName })}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
                >
                  <UserAvatar src={user.avatarUrl} name={user.displayName} size={32} userId={user.id} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    <DisplayUserName
                      name={user.displayName}
                      verified={verifiedBadge(user.flags)}
                      flags={user.flags}
                      bot={user.bot}
                      color={user.nameColor}
                      className={`block truncate text-sm font-medium ${
                        connected(info) ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400"
                      }`}
                    />
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {connected(info) ? presenceLabel(info!) : `@${user.username}`}
                    </span>
                  </span>
                </button>
                <Tooltip content={t("common.callDisplayname", { displayName: user.displayName })}>
                  <button
                    type="button"
                    disabled={busyId === user.id}
                    onClick={() => void call(user)}
                    aria-label={t("common.callDisplayname", { displayName: user.displayName })}
                    className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950/60"
                  >
                    <MdCall className="h-4 w-4" />
                  </button>
                </Tooltip>
                <Tooltip content={t("common.chatWithDisplayname", { displayName: user.displayName })}>
                  <button
                    type="button"
                    onClick={() => {
                      trackHubCentral(HUB_CENTRAL_EVENTS.chat);
                      openDirectMessages(user.id);
                    }}
                    aria-label={t("common.chatWithDisplayname", { displayName: user.displayName })}
                    className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  >
                    <MdChatBubbleOutline className="h-4 w-4" />
                  </button>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}

      {adding && <AddFriendDialog onClose={() => setAdding(false)} />}
      <FriendRequestsModal open={requestsOpen} onClose={() => setRequestsOpen(false)} />
      {profileId && <UserProfileDialog userId={profileId} onClose={() => setProfileId(null)} />}
    </section>
  );
}

// ─── Messages ─────────────────────────────────────────────────────────────

function MessagesCard({ recent }: { recent: ReturnType<typeof useRecentConversations> }) {
  const t = useT();
  const { account } = useAuth();
  const live = useDmLive();

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={cardTitle}>
          {t("common.messages")}
          {recent.totalUnread > 0 && (
            <span className={countBadge}>{recent.totalUnread > 99 ? "99+" : recent.totalUnread}</span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => {
            trackHubCentral(HUB_CENTRAL_EVENTS.dmAll);
            openDirectMessages(null, { expanded: true });
          }}
          className={headerLink}
        >
          {t("dmRecentStrip.allMessages")}
        </button>
      </div>

      {!recent.loaded ? (
        <SkeletonRows count={3} />
      ) : recent.rows.length === 0 ? (
        <p className={cardHint}>{t("groups.central.noConversations")}</p>
      ) : (
        <ul className="-mx-2 mt-2 flex flex-col">
          {recent.rows.map(({ user, lastMessage, unread }) => {
            const line =
              lastMessage.from === account?.id
                ? t("directMessagesModal.youLine", { line: messageSummary(lastMessage) })
                : messageSummary(lastMessage);
            return (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => {
                    trackHubCentral(HUB_CENTRAL_EVENTS.dmOpen);
                    openDirectMessages(user.id);
                  }}
                  aria-label={t("common.chatWithDisplayname", { displayName: user.displayName })}
                  className={row}
                >
                  <UserAvatar
                    src={user.avatarUrl}
                    name={user.displayName}
                    size={32}
                    userId={user.id}
                    presenceSurface="page"
                    className="shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <DisplayUserName
                      name={user.displayName}
                      verified={verifiedBadge(user.flags)}
                      flags={user.flags}
                      bot={user.bot}
                      color={user.nameColor}
                      className={`block truncate text-sm text-zinc-900 dark:text-zinc-100 ${unread > 0 ? "font-semibold" : "font-medium"}`}
                    />
                    {live.typing[user.id] ? (
                      <span className="block truncate text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        {t("directMessagesModal.typing")}
                      </span>
                    ) : (
                      <span
                        className={`block truncate text-xs ${
                          unread > 0 ? "font-medium text-zinc-800 dark:text-zinc-200" : "text-zinc-500 dark:text-zinc-400"
                        }`}
                      >
                        {line}
                      </span>
                    )}
                  </span>
                  {unread > 0 ? (
                    <span className={`${countBadge} shrink-0`}>{unread > 99 ? "99+" : unread}</span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-600">
                      {relativeTime(lastMessage.ts)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Notifications ────────────────────────────────────────────────────────

function NotificationsCard() {
  const t = useT();
  const { account } = useAuth();
  const items = useNotificationInbox();
  const unread = items.filter((item) => !item.read).length;
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [ownProfileOpen, setOwnProfileOpen] = useState(false);

  // Same destinations as the bell's list (see NotificationInboxBell).
  function open(notification: InboxNotification) {
    trackHubCentral(HUB_CENTRAL_EVENTS.notifOpen, { tags: { kind: notification.kind } });
    if (notification.kind === "friend-request") setRequestsOpen(true);
    else if (notification.kind === "profile-comment") setOwnProfileOpen(true);
    else if (notification.kind === "dm" || notification.kind === "call-missed" || notification.kind === "friend-accepted") {
      openDirectMessages(notification.userId);
    }
  }

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={cardTitle}>
          {t("common.notifications")}
          {unread > 0 && <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />}
        </h2>
        {unread > 0 && (
          <button type="button" onClick={markAllRead} className={headerLink}>
            {t("groups.central.markRead")}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className={cardHint}>{t("notificationInboxBell.nothingHereYet")}</p>
      ) : (
        <ul className="-mx-2 mt-2 flex flex-col">
          {items.slice(0, NOTIFICATION_ROWS).map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => open(item)} className={`${row} items-start`}>
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                  <NotificationKindIcon kind={item.kind} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm text-zinc-900 dark:text-zinc-100 ${item.read ? "font-normal" : "font-semibold"}`}
                  >
                    {item.title}
                  </span>
                  {item.body && (
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{item.body}</span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-600">{relativeTime(item.ts)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <FriendRequestsModal open={requestsOpen} onClose={() => setRequestsOpen(false)} />
      {ownProfileOpen && account && <UserProfileDialog userId={account.id} onClose={() => setOwnProfileOpen(false)} />}
    </section>
  );
}

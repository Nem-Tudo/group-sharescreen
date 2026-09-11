"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import useNtPopups from "ntpopups";
import { MdHome, MdViewList } from "react-icons/md";
import { WatchRoom } from "@/app/watch/[handle]/WatchRoom";
import { AccountMenu } from "@/components/AccountMenu";
import { AccountModal } from "@/components/AccountModal";
import { NotificationInboxBell } from "@/components/NotificationInboxBell";
import { RoomAccountCard } from "@/components/RoomAccountCard";
import { Tooltip } from "@/components/Tooltip";
import { UpdateAppButton } from "@/components/UpdateAppButton";
import { GroupNavContext } from "@/components/groups/groupNav";
import { GroupMembersPanel } from "@/components/groups/GroupMembersPanel";
import { GroupPartnerSlot } from "@/components/groups/GroupPartnerSlot";
import { GroupProfileHost, openGroupProfile } from "@/components/groups/groupProfile";
import { GroupSwitcher } from "@/components/groups/GroupSwitcher";
import { GroupIndex, GroupRoom } from "@/components/groups/GroupPages";
import { GroupsHome } from "@/components/groups/GroupsHome";
import {
  GroupActions,
  GroupRoomsPanel,
  VoiceCallLink,
  VoiceControls,
} from "@/components/groups/GroupSidebar";
import { useAccountToken } from "@/lib/accountApi";
import { useGuestToken } from "@/lib/guestToken";
import { groupPath, groupVoiceHandle, parseGroupsPath, type GroupsRoute } from "@/lib/groupLinks";
import { prefetchChannel } from "@/lib/groupCache";
import { GroupShellContext, registerGroupShell, useGroupNavigation } from "@/lib/groupNavigation";
import { canInChannel } from "@/lib/groupPermissions";
import {
  getGroupVoiceSession,
  setGroupVoiceSession,
  useGroupVoiceSession,
  type GroupVoiceSession,
} from "@/lib/groupVoiceSession";
import { signalingClient } from "@/lib/signalingClient";
import { playConnectSound } from "@/lib/soundEffects";
import { onGroupRemoved, refreshGroups, resetGroups, useGroupDetail } from "@/lib/useGroups";
import { LG_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { useRoomTheme } from "@/lib/useRoomTheme";
import { useSignaling } from "@/lib/useSignaling";

// The whole of /groups/*, laid out like a room: a top bar, and three columns of
// cards on grey — the group's rooms (with the ad square under them) on the
// left, the conversation or the call in the middle, and the group's members
// (with your own card under them) on the right.
//
// While a call is on screen it brings its own right-hand column (the room's
// chat and your card), so the members column steps aside; and the call's own
// header is folded into this bar — its controls in the middle, its page
// buttons on the right (see WatchRoom's inHeaderSlot) — so there is one bar,
// not two.
//
// It stays mounted for as long as the address stays under /groups, and that
// is what keeps the voice call alive: a single WatchRoom for the connected
// voice room, shown when that room is the one on screen and merely hidden when
// it is not. Leaving /groups altogether does unmount it, and hangs up.
//
// And it is what draws the page, too: the view in the middle is picked from
// the address here (GroupsView), not handed down by the route. Moving between
// rooms and groups is a pushState (see lib/groupNavigation), which changes the
// address without a server round trip — the pages under app/groups render
// nothing, and exist so that a reload or a shared link resolves.

export function GroupAppShell({ children }: { children: ReactNode }) {
  // Off the path, never useParams: after a shallow navigation the params still
  // describe whichever page the server last rendered.
  const route = parseGroupsPath(usePathname());
  const groupId = route && route.kind !== "home" ? route.groupId : null;
  const roomId = route?.kind === "room" ? route.roomId : null;
  const navigation = useGroupNavigation();
  useEffect(() => registerGroupShell(), []);
  const { openPopup } = useNtPopups();
  const { detail } = useGroupDetail(groupId);
  // The group's look, painted here once for every page of it: the group's own
  // theme when an admin set one, otherwise each person's own — the room rule,
  // at the scale of the group (the call inside paints nothing of its own; see
  // WatchRoom). Undefined while the group loads, so the viewer's colours do not
  // flash first. On /groups itself there is no group: your own theme.
  useRoomTheme(groupId ? (detail ? detail.group.theme ?? null : undefined) : null);
  const session = useGroupVoiceSession();
  const isWide = useMediaQuery(LG_BREAKPOINT_QUERY);
  const [navOpen, setNavOpen] = useState(false);
  const [accountModal, setAccountModal] = useState<"login" | "create" | null>(null);
  // Where the call's header controls are portalled to — see WatchRoom's
  // headerSlots. State rather than refs, so the room re-renders once they exist.
  const [centerSlot, setCenterSlot] = useState<HTMLDivElement | null>(null);
  const [rightSlot, setRightSlot] = useState<HTMLDivElement | null>(null);

  // A different person — logging in, out, or into another account — is a
  // different set of groups. Skipped on the first render, which is not a change.
  const accountToken = useAccountToken();
  const guestToken = useGuestToken();
  const identity = accountToken ?? guestToken;
  const previousIdentity = useRef(identity);
  useEffect(() => {
    if (previousIdentity.current === identity) return;
    previousIdentity.current = identity;
    setGroupVoiceSession(null);
    resetGroups();
    void refreshGroups();
  }, [identity]);

  // Opening a voice room's address is joining it — unless it is locked to this
  // person (no "Conectar", see lib/groupPermissions), in which case the page
  // says so instead (GroupPages' GroupRoom). Also keeps the call's labels
  // current when the room or the group is renamed while connected.
  const routeChannel = detail?.channels.find((c) => c.id === roomId) ?? null;
  useEffect(() => {
    if (!detail || !groupId) return;
    const current = getGroupVoiceSession();
    if (routeChannel?.kind === "voice" && canInChannel(detail, routeChannel, "connect")) {
      setGroupVoiceSession({
        groupId,
        channelId: routeChannel.id,
        handle: groupVoiceHandle(routeChannel.id),
        channelName: routeChannel.name,
        groupName: detail.group.name,
      });
      return;
    }
    if (current?.groupId === groupId) {
      const channel = detail.channels.find((c) => c.id === current.channelId);
      if (!channel) setGroupVoiceSession(null);
      else setGroupVoiceSession({ ...current, channelName: channel.name, groupName: detail.group.name });
    }
  }, [detail, groupId, routeChannel]);

  // Taken out of a group: hang up if the call was in it, and leave its pages.
  useEffect(
    () =>
      onGroupRemoved(({ groupId: removedId, reason }) => {
        if (getGroupVoiceSession()?.groupId === removedId) setGroupVoiceSession(null);
        if (removedId !== groupId || reason === "left") return;
        navigation.replace("/groups");
        const message =
          reason === "deleted"
            ? "Este grupo foi apagado pelo dono."
            : reason === "banned"
              ? "Você foi banido deste grupo."
              : "Você foi removido deste grupo.";
        void openPopup("generic", { data: { title: "Você saiu do grupo", message } });
      }),
    [groupId, navigation, openPopup]
  );

  // Leaving /groups entirely hangs up — the WatchRoom goes with this shell, and
  // a session left behind would silently rejoin the call on the way back in.
  useEffect(() => () => setGroupVoiceSession(null), []);

  // Every text room of the open group, warmed once the group is known, so the
  // next one clicked opens on its messages instead of on a spinner (see
  // lib/groupCache — a room already fresh costs nothing). After a beat, so the
  // room on screen gets the network first; and only a dozen, for a group that
  // has made a hobby of rooms.
  const textRoomIds =
    detail?.chatAvailable && groupId
      ? detail.channels
          .filter((c) => c.kind === "text")
          .slice(0, 12)
          .map((c) => c.id)
          .join(",")
      : "";
  useEffect(() => {
    if (!groupId || !textRoomIds) return;
    const timer = setTimeout(() => {
      for (const channelId of textRoomIds.split(",")) prefetchChannel(groupId, channelId);
    }, 600);
    return () => clearTimeout(timer);
  }, [groupId, textRoomIds]);

  const voiceVisible = Boolean(session && session.groupId === groupId && session.channelId === roomId);
  const closeNav = () => setNavOpen(false);

  return (
    <GroupNavContext.Provider value={{ openNav: () => setNavOpen(true) }}>
      <div data-group-shell className="flex min-h-0 flex-1 flex-col bg-zinc-50 dark:bg-black">
        <header className="shrink-0 border-b border-black/10 bg-white px-3 py-2 sm:px-4 dark:border-white/10 dark:bg-zinc-950">
          <div className="flex items-center gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Tooltip content="Voltar ao início" placement="bottom">
                <Link
                  href="/"
                  aria-label="Início"
                  className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-lg text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                >
                  <MdHome />
                </Link>
              </Tooltip>
              <span className="hidden h-6 w-px shrink-0 bg-zinc-200 sm:block dark:bg-zinc-800" />
              <GroupSwitcher
                activeGroupId={groupId}
                fallbackName={detail?.group.name}
                fallbackIconUrl={detail?.group.iconUrl}
                fallbackFlags={detail?.group.flags}
              />
            </div>

            {/* The middle: the call's own controls — mic, sound, screen,
                camera, sources, music, hang up — for as long as you are
                connected, portalled in by the room whether or not it is the
                page on screen. Beside them, while it is not, the way back to it. */}
            <div className="hidden items-center gap-2 justify-self-center lg:flex">
              {session && !voiceVisible && <VoiceCallLink />}
              <div ref={setCenterSlot} className="contents" />
            </div>

            <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5 lg:ml-0">
              {/* The call's page buttons (share, Pro, its options), portalled
                  in by the room while it is on screen. */}
              <div ref={setRightSlot} className="contents" />
              {groupId && (
                <button
                  type="button"
                  onClick={() => setNavOpen(true)}
                  className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 lg:hidden dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  <MdViewList className="h-4 w-4" />
                  <span className="hidden sm:inline">Salas</span>
                </button>
              )}
              {detail && <GroupActions detail={detail} />}
              <NotificationInboxBell />
              <AccountMenu />
              <UpdateAppButton />
            </div>
          </div>
        </header>

        {/* Below lg the call gets a strip of its own under the bar. */}
        {session && !voiceVisible && (
          <div className="shrink-0 border-b border-black/10 bg-white px-3 py-1.5 lg:hidden dark:border-white/10 dark:bg-zinc-950">
            <VoiceControls className="w-full" />
          </div>
        )}

        <div className="flex min-h-0 flex-1 lg:gap-3 lg:p-3">
          {groupId && (
            <aside className="hidden w-[300px] shrink-0 flex-col gap-3 lg:flex">
              <div className="flex min-h-0 flex-1 flex-col">
                {detail ? (
                  <GroupRoomsPanel detail={detail} activeChannelId={roomId} />
                ) : (
                  <div className="flex h-full flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
                    ))}
                  </div>
                )}
              </div>
              {/* Always here, call or no call — see GroupPartnerSlot. */}
              {isWide && <GroupPartnerSlot />}
            </aside>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className={voiceVisible ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
              {/* Marked as inside the shell, so what it draws navigates shallowly
                  even from an effect that runs before the shell has registered
                  (see lib/groupNavigation's GroupShellContext). */}
              <GroupShellContext.Provider value={true}>
                <GroupsView route={route} />
              </GroupShellContext.Provider>
              {/* The route's own page: empty (see app/groups), kept in the
                  tree so anything Next hangs off it still has its place. */}
              {children}
            </div>
            {session && (
              <VoiceHost
                session={session}
                visible={voiceVisible}
                headerSlots={{ center: centerSlot, right: rightSlot }}
                onOpenNav={() => setNavOpen(true)}
                onDisconnect={() => {
                  setGroupVoiceSession(null);
                  if (voiceVisible) navigation.push(groupPath(session.groupId));
                }}
              />
            )}
          </div>

          {/* The group's people, like a room's participant column. Not while
              the call is on screen: it brings its own column (chat and your
              card), and the people in it are on its room card already. */}
          {groupId && detail && !voiceVisible && (
            <aside className="hidden w-[300px] shrink-0 flex-col gap-3 lg:flex">
              <div className="flex min-h-0 flex-1 flex-col">
                <GroupMembersPanel detail={detail} channel={routeChannel?.kind === "text" ? routeChannel : null} />
              </div>
              <RoomAccountCard
                onCreateAccount={() => setAccountModal("create")}
                // Your own profile in the same dialog as everybody else in the
                // group (see groupProfile), instead of a new tab. Only ever
                // called for an account, whose profile is read by its id.
                onOpenProfile={(id) => openGroupProfile({ id, name: "", avatarUrl: null, guest: false })}
              />
            </aside>
          )}
        </div>

        {/* Below lg the rooms come up as a sheet from the bottom, the way the
            room's own "Mais opções" does on a phone. */}
        {navOpen && groupId && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button type="button" aria-label="Fechar" onClick={closeNav} className="absolute inset-0 bg-black/40" />
            <div className="absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-2xl bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-zinc-950">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Salas</p>
                <button
                  type="button"
                  onClick={closeNav}
                  aria-label="Fechar"
                  className="cursor-pointer text-xl leading-none text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  ×
                </button>
              </div>
              <div className="min-h-0 overflow-y-auto">
                {detail ? (
                  <GroupRoomsPanel bare detail={detail} activeChannelId={roomId} onNavigate={closeNav} />
                ) : (
                  <p className="py-4 text-center text-sm text-zinc-500">Carregando…</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* The one profile dialog for everything in the group — see groupProfile. */}
        <GroupProfileHost />

        {/* For your card's "criar conta" — the call has its own for its own card. */}
        <AccountModal
          mode={accountModal}
          onModeChange={setAccountModal}
          initialDisplayName={accountModal ? signalingClient.getSnapshot().name ?? "" : ""}
        />
      </div>
    </GroupNavContext.Provider>
  );
}

/**
 * The call. Mounted for as long as there is a session, visible only while its
 * room is the page being looked at — see the shell's header comment.
 */
/**
 * The middle of the screen, for whatever the address names. Keyed by the room,
 * so each one starts fresh — the text room's own state (scroll, the reply
 * being written) belongs to that room.
 */
function GroupsView({ route }: { route: GroupsRoute | null }) {
  if (!route || route.kind === "home") return <GroupsHome />;
  if (route.kind === "group") return <GroupIndex key={route.groupId} groupId={route.groupId} />;
  return <GroupRoom key={`${route.groupId}/${route.roomId}`} groupId={route.groupId} roomId={route.roomId} />;
}

function VoiceHost({
  session,
  visible,
  headerSlots,
  onOpenNav,
  onDisconnect,
}: {
  session: GroupVoiceSession;
  visible: boolean;
  headerSlots: { center: HTMLElement | null; right: HTMLElement | null };
  onOpenNav: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div
      className={
        visible
          ? "flex min-h-0 flex-1 flex-col"
          : // Collapsed rather than display:none. The call's controls stay in
            // the top bar while this is out of sight, and what they open —
            // the screen-share quality picker, the guest broadcast limit —
            // is drawn fixed to the viewport from inside the room: under
            // display:none it would be invisible, collapsed it still shows.
            "h-0 shrink-0 overflow-hidden"
      }
    >
      <RemovalGuard onRemoved={onDisconnect} />
      {/* Keyed by the room, so moving to another voice room is a new "you
          are in" — and a reconnect into the same call is not. Prefixed,
          because the WatchRoom beside it is keyed by the bare handle and
          siblings may not share a key, whatever their component. */}
      <ConnectSound key={`connect:${session.handle}`} handle={session.handle} />
      <WatchRoom
        key={session.handle}
        handle={session.handle}
        group={{
          groupId: session.groupId,
          channelId: session.channelId,
          channelName: session.channelName,
          groupName: session.groupName,
          onDisconnect,
          onOpenNav,
          visible,
          headerSlots,
        }}
      />
    </div>
  );
}

/**
 * The sound of having got in: played once, the first time the room this
 * session is for actually answers the join (not when the click happened — a
 * join that is refused should not sound like one that worked). A new instance
 * per room (see its key), so switching rooms plays it again; a reconnect that
 * rejoins the same room does not, because this instance already played.
 */
function ConnectSound({ handle }: { handle: string }) {
  const { room } = useSignaling();
  const played = useRef(false);
  useEffect(() => {
    if (played.current || room !== handle) return;
    played.current = true;
    playConnectSound();
  }, [room, handle]);
  return null;
}

/**
 * Hangs up when the room throws this connection out (a kick from inside the
 * call, or the group removing them). Reacts to the *transition* only: a
 * removal left in state from some earlier room must not end a call that has
 * only just started.
 */
function RemovalGuard({ onRemoved }: { onRemoved: () => void }) {
  const { roomRemoval } = useSignaling();
  const previous = useRef(roomRemoval);
  const onRemovedRef = useRef(onRemoved);
  useEffect(() => {
    onRemovedRef.current = onRemoved;
  }, [onRemoved]);
  useEffect(() => {
    if (roomRemoval && !previous.current) onRemovedRef.current();
    previous.current = roomRemoval;
  }, [roomRemoval]);
  return null;
}

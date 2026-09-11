"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GroupNavContext } from "@/components/groups/groupNav";
import { useParams, useRouter } from "next/navigation";
import useNtPopups from "ntpopups";
import { WatchRoom } from "@/app/watch/[handle]/WatchRoom";
import { GroupRail } from "@/components/groups/GroupRail";
import { GroupSidebar } from "@/components/groups/GroupSidebar";
import { useAccountToken } from "@/lib/accountApi";
import { useGuestToken } from "@/lib/guestToken";
import { groupPath, groupVoiceHandle } from "@/lib/groupLinks";
import {
  getGroupVoiceSession,
  setGroupVoiceSession,
  useGroupVoiceSession,
  type GroupVoiceSession,
} from "@/lib/groupVoiceSession";
import { onGroupRemoved, refreshGroups, resetGroups, useGroupDetail } from "@/lib/useGroups";
import { useSignaling } from "@/lib/useSignaling";

// The whole of /groups/*: the rail of groups, the open group's rooms, and the
// content — laid out as one app shell that stays mounted for as long as the
// address stays under /groups.
//
// That it stays mounted is the feature. The voice call lives *here*, not in
// the page: a single WatchRoom for the connected voice room, shown when that
// room is the one on screen and merely hidden when it is not. Reading a text
// room, or hopping to another group entirely, therefore never unmounts the
// call — which is what "the voice keeps going while I browse" means. Leaving
// /groups altogether does unmount it, and hangs up.

export function GroupAppShell({ children }: { children: ReactNode }) {
  const params = useParams<{ groupId?: string; roomId?: string }>();
  const groupId = typeof params.groupId === "string" ? params.groupId : null;
  const roomId = typeof params.roomId === "string" ? params.roomId : null;
  const router = useRouter();
  const { openPopup } = useNtPopups();
  const { detail } = useGroupDetail(groupId);
  const session = useGroupVoiceSession();
  const [navOpen, setNavOpen] = useState(false);

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

  // Opening a voice room's address is joining it. Also keeps the dock's names
  // current when the room or the group is renamed while connected.
  const routeChannel = detail?.channels.find((c) => c.id === roomId) ?? null;
  useEffect(() => {
    if (!detail || !groupId) return;
    const current = getGroupVoiceSession();
    if (routeChannel?.kind === "voice") {
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
        router.replace("/groups");
        const message =
          reason === "deleted"
            ? "Este grupo foi apagado pelo dono."
            : reason === "banned"
              ? "Você foi banido deste grupo."
              : "Você foi removido deste grupo.";
        void openPopup("generic", { data: { title: "Você saiu do grupo", message, icon: "🚪" } });
      }),
    [groupId, router, openPopup]
  );

  // Leaving /groups entirely hangs up — the WatchRoom goes with this shell, and
  // a session left behind would silently rejoin the call on the way back in.
  useEffect(() => () => setGroupVoiceSession(null), []);

  const voiceVisible = Boolean(session && session.groupId === groupId && session.channelId === roomId);
  const closeNav = () => setNavOpen(false);

  const sidebar = groupId ? (
    <div className="h-full w-60 shrink-0 border-r border-black/5 dark:border-white/5">
      {detail ? (
        <GroupSidebar detail={detail} activeChannelId={roomId} onNavigate={closeNav} />
      ) : (
        <div className="flex h-full flex-col gap-2 bg-zinc-50 p-3 dark:bg-zinc-900">
          <span className="h-6 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-5 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          ))}
        </div>
      )}
    </div>
  ) : null;

  return (
    <GroupNavContext.Provider value={{ openNav: () => setNavOpen(true) }}>
      <div data-group-shell className="flex min-h-0 flex-1 overflow-hidden bg-white dark:bg-zinc-950">
        {/* Rail and rooms side by side from lg up. */}
        <div className="hidden h-full lg:flex">
          <GroupRail activeGroupId={groupId} />
          {sidebar}
        </div>

        {/* Below lg the same two columns become a drawer over the content. */}
        {navOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div className="flex h-full max-w-[calc(100vw-3rem)] shadow-2xl">
              <GroupRail activeGroupId={groupId} onNavigate={closeNav} />
              {sidebar}
            </div>
            <button
              type="button"
              aria-label="Fechar menu"
              onClick={closeNav}
              className="flex-1 bg-black/50"
            />
          </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className={voiceVisible ? "hidden" : "flex min-h-0 flex-1 flex-col"}>{children}</div>
          {session && (
            <VoiceHost
              session={session}
              visible={voiceVisible}
              onOpenNav={() => setNavOpen(true)}
              onDisconnect={() => {
                setGroupVoiceSession(null);
                if (voiceVisible) router.push(groupPath(session.groupId));
              }}
            />
          )}
        </div>
      </div>
    </GroupNavContext.Provider>
  );
}

/**
 * The call. Mounted for as long as there is a session, visible only while its
 * room is the page being looked at — see the shell's header comment.
 */
function VoiceHost({
  session,
  visible,
  onOpenNav,
  onDisconnect,
}: {
  session: GroupVoiceSession;
  visible: boolean;
  onOpenNav: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className={visible ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
      <RemovalGuard onRemoved={onDisconnect} />
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
        }}
      />
    </div>
  );
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

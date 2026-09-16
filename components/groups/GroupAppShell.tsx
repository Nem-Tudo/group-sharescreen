"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import useNtPopups from "ntpopups";
import { MdHome } from "react-icons/md";
import { AccountMenu } from "@/components/AccountMenu";
import { CallOutlet } from "@/components/CallOutlet";
import { GroupHeaderMenu } from "@/components/groups/GroupHeaderMenu";
import { RoomProOfferButton } from "@/components/RoomProOffer";
import { ColumnResizeHandle, useColumnWidth, type ColumnWidthSpec } from "@/components/ColumnResize";
import { DmRecentStrip } from "@/components/DmRecentStrip";
import { useBlockNativeContextMenu } from "@/components/ContextMenuHost";
import { AccountModal } from "@/components/AccountModal";
import { NotificationInboxBell } from "@/components/NotificationInboxBell";
import { MIN_CARD_HEIGHT_PX } from "@/components/PartnerCard";
import { RoomAccountCard } from "@/components/RoomAccountCard";
import { Tooltip } from "@/components/Tooltip";
import { UpdateAppButton } from "@/components/UpdateAppButton";
import { GroupNavContext } from "@/components/groups/groupNav";
import { GroupMobileBar } from "@/components/groups/GroupMobile";
import { MobileSheet } from "@/components/MobileSheet";
import { GroupMembersPanel } from "@/components/groups/GroupMembersPanel";
import { GroupPartnerSlot } from "@/components/groups/GroupPartnerSlot";
import { openGroupProfile } from "@/components/groups/groupProfile";
import { GroupMemberMenuHost, GroupProfileHost } from "@/components/groups/GroupMemberActions";
import { GroupRail } from "@/components/groups/GroupRail";
import { GroupIndex, GroupRoom } from "@/components/groups/GroupPages";
import { GroupsHome } from "@/components/groups/GroupsHome";
import {
  GroupActions,
  GroupRoomsPanel,
  VoiceCallLink,
  VoiceControls,
} from "@/components/groups/GroupSidebar";
import { useAccountToken } from "@/lib/accountApi";
import { setCallChrome, useCallSession } from "@/lib/callSession";
import { useGuestToken } from "@/lib/guestToken";
import { groupVoiceHandle, parseGroupsPath, type GroupsRoute } from "@/lib/groupLinks";
import { prefetchChannel } from "@/lib/groupCache";
import { GroupShellContext, registerGroupShell, useGroupNavigation } from "@/lib/groupNavigation";
import { canInChannel } from "@/lib/groupPermissions";
import { setDirectMessagesOutlet } from "@/lib/dmWindow";
import { useDmCallColumnsCollapsed } from "@/lib/dmCallColumns";
import {
  getGroupVoiceSession,
  setGroupVoiceSession,
  useGroupVoiceColumns,
  useGroupVoiceSession,
} from "@/lib/groupVoiceSession";
import { signalingClient } from "@/lib/signalingClient";
import { onGroupRemoved, refreshGroups, resetGroups, useGroupDetail } from "@/lib/useGroups";
import { LG_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { useHeaderFit } from "@/lib/headerFit";
import { useRoomTheme } from "@/lib/useRoomTheme";
import { useT } from "@/lib/useI18n";

// The rooms column's gap-3, between the rooms and the ad under them.
const ASIDE_GAP_PX = 12;

// The two side columns, each dragged wider or narrower from its inner edge (see
// components/ColumnResize). 300px is the width they always had, and what a
// double-click on the grip restores; neither takes more than 30% of the row,
// which on a 1024px screen is exactly that 300px.
const ROOMS_COLUMN: ColumnWidthSpec = {
  storageKey: "groups:roomsColumnWidth",
  defaultWidth: 300,
  min: 240,
  max: 480,
  maxShare: 0.3,
  side: "left",
};
const MEMBERS_COLUMN: ColumnWidthSpec = {
  storageKey: "groups:membersColumnWidth",
  defaultWidth: 300,
  min: 240,
  max: 480,
  maxShare: 0.3,
  side: "right",
};

// The whole of /groups/*, laid out like a room: a top bar, and columns of cards
// on grey — your groups down the far left (see GroupRail), the group's rooms (with the ad square under them) on the
// left, the conversation or the call in the middle, and the group's members
// (with your own card under them) on the right.
//
// While a call is on screen it brings its own right-hand column (the room's
// chat and your card), so the members column steps aside; and the call's own
// header is folded into this bar — its controls in the middle, its page
// buttons on the right (see WatchRoom's inHeaderSlot) — so there is one bar,
// not two.
//
// The call itself is not this shell's any more: it is mounted at the root of
// the app and merely drawn here, in the middle, while its own room is the page
// on screen (see components/RoomCallHost and lib/callSession). This shell
// lends it the top bar's slots and says when to draw it; leaving /groups
// altogether now carries the call along instead of hanging it up.
//
// And it is what draws the page, too: the view in the middle is picked from
// the address here (GroupsView), not handed down by the route. Moving between
// rooms and groups is a pushState (see lib/groupNavigation), which changes the
// address without a server round trip — the pages under app/groups render
// nothing, and exist so that a reload or a shared link resolves.

export function GroupAppShell({ children }: { children: ReactNode }) {
  const t = useT();
  // Off the path, never useParams: after a shallow navigation the params still
  // describe whichever page the server last rendered.
  const pathname = usePathname();
  const route = parseGroupsPath(pathname);
  // The expanded private messages are a page of their own: no group behind them.
  const groupId = route && (route.kind === "group" || route.kind === "room") ? route.groupId : null;
  const roomId = route?.kind === "room" ? route.roomId : null;
  const navigation = useGroupNavigation();
  useEffect(() => registerGroupShell(), []);
  // An app, not a document: the right button is ours everywhere on the group
  // pages (see ContextMenuHost's stand-in for the browser's menu), and text
  // only selects where there is something worth copying — the messages, and
  // whatever is typed (see the select-text on those, and globals.css).
  useBlockNativeContextMenu();
  const { openPopup } = useNtPopups();
  const { detail } = useGroupDetail(groupId);
  // The group's look, painted here once for every page of it: the group's own
  // theme when an admin set one, otherwise each person's own — the room rule,
  // at the scale of the group (the call inside paints nothing of its own; see
  // WatchRoom). Undefined while the group loads, so the viewer's colours do not
  // flash first. On /groups itself there is no group: your own theme.
  useRoomTheme(groupId ? (detail ? detail.group.theme ?? null : undefined) : null);
  const session = useGroupVoiceSession();
  // Any call this tab is in — a group's, or an ordinary room's carried in from
  // elsewhere on the site. Both get the same place in this bar.
  const call = useCallSession();
  const isWide = useMediaQuery(LG_BREAKPOINT_QUERY);
  const [navOpen, setNavOpen] = useState(false);
  // The group's people as a sheet, below lg — see GroupNavContext.openMembers.
  const [membersOpen, setMembersOpen] = useState(false);
  const [accountModal, setAccountModal] = useState<"login" | "create" | null>(null);
  // What the rooms column keeps from the ad under it — see GroupRoomsPanel's
  // onMinHeight. 0 until the rooms have been measured.
  const [roomsMinHeight, setRoomsMinHeight] = useState(0);
  // Where the call's header controls are portalled to — see WatchRoom's
  // headerSlots. State rather than refs, so the room re-renders once they exist.
  const [centerSlot, setCenterSlot] = useState<HTMLDivElement | null>(null);
  const [rightSlot, setRightSlot] = useState<HTMLDivElement | null>(null);
  const [endSlot, setEndSlot] = useState<HTMLDivElement | null>(null);
  // Where a group voice room's music bars are drawn — see CallChrome.musicSlot.
  const [musicSlot, setMusicSlot] = useState<HTMLDivElement | null>(null);
  // The bar's row and the two clusters that grow as a call fills them, for
  // measuring what fits (see lib/headerFit). State, like the slots, so the
  // measuring starts once they exist.
  const [headerRow, setHeaderRow] = useState<HTMLDivElement | null>(null);
  const [headerCenter, setHeaderCenter] = useState<HTMLDivElement | null>(null);
  const [headerRight, setHeaderRight] = useState<HTMLDivElement | null>(null);
  // Where the private messages draw themselves when expanded — beside the
  // groups, in place of the group's own columns (see lib/dmWindow's outlet).
  const [dmSlot, setDmSlot] = useState<HTMLDivElement | null>(null);
  const dmDocked = isWide && route?.kind === "dms";
  useEffect(() => {
    if (!dmSlot) return;
    setDirectMessagesOutlet(dmSlot);
    return () => setDirectMessagesOutlet(null, dmSlot);
  }, [dmSlot]);
  // Leaving that page — a group picked on the rail, the back button — closes
  // them: see DirectMessagesHost, which keeps the window and the address in step.

  // What the call borrows from the group while the group's pages are the ones
  // on screen: this bar's two slots for the room's own controls, and the way
  // to open the rooms drawer on a phone. Published rather than handed down,
  // because the room is no longer mounted below this — it lives at the root of
  // the app now (see components/RoomCallHost). Its presence is also what tells
  // the host not to draw its floating call bar: from lg up this bar already
  // carries one (see GroupSidebar's VoiceCallLink and VoiceControls).
  const openNav = useCallback(() => setNavOpen(true), []);
  useEffect(() => {
    setCallChrome({
      headerSlots: { center: centerSlot, right: rightSlot, end: endSlot },
      musicSlot,
      onOpenNav: openNav,
    });
    return () => setCallChrome(null);
  }, [centerSlot, rightSlot, endSlot, musicSlot, openNav]);

  // A different person — logging in, out, or into another account — is a
  // different set of groups. Skipped on the first render, which is not a change.
  const accountToken = useAccountToken();
  const guestToken = useGuestToken();
  const identity = accountToken ?? guestToken;
  const previousIdentity = useRef(identity);
  // The voice room address last joined from — see the join effect below.
  const joinedRouteRef = useRef<string | null>(null);
  useEffect(() => {
    if (previousIdentity.current === identity) return;
    previousIdentity.current = identity;
    // The new person has joined nothing yet: an open voice room's address
    // should put *them* in it once their groups load, as it always did.
    joinedRouteRef.current = null;
    setGroupVoiceSession(null);
    resetGroups();
    void refreshGroups();
  }, [identity]);

  // Opening a voice room's address is joining it — unless it is locked to this
  // person (no "Conectar", see lib/groupPermissions), in which case the page
  // says so instead (GroupPages' GroupRoom). Also keeps the call's labels
  // current when the room or the group is renamed while connected.
  //
  // Once per arrival at that address, not on every run of this effect. It runs
  // again whenever the group's detail changes, and leaving a voice room is
  // itself such a change (who is in which room). Hanging up clears the session
  // and *then* navigates to the group's page, so when that update landed first
  // the address still named the voice room and this joined it straight back —
  // the "left and it put me back in" bug, which never happened from a text
  // room because there the address named no voice room to rejoin.
  //
  // Recorded only when a join actually happens, so an address opened before
  // the group loaded, or before this person was allowed to connect, still
  // joins the moment it can. Cleared on arriving anywhere else, so coming back
  // to the room joins it again.
  const routeChannel = detail?.channels.find((c) => c.id === roomId) ?? null;
  useEffect(() => {
    if (!detail || !groupId) return;
    const current = getGroupVoiceSession();
    if (routeChannel?.kind === "voice" && canInChannel(detail, routeChannel, "connect")) {
      const routeKey = `${groupId}/${routeChannel.id}`;
      const inThisRoom = current?.groupId === groupId && current.channelId === routeChannel.id;
      if (joinedRouteRef.current !== routeKey || inThisRoom) {
        joinedRouteRef.current = routeKey;
        setGroupVoiceSession({
          groupId,
          channelId: routeChannel.id,
          handle: groupVoiceHandle(routeChannel.id),
          channelName: routeChannel.name,
          groupName: detail.group.name,
        });
      }
      return;
    }
    joinedRouteRef.current = null;
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
            ? t("groups.groupAppShell.thisGroupWasDeletedByIts")
            : reason === "banned"
              ? t("groups.groupAppShell.youHaveBeenBannedFromThis")
              : t("groups.groupAppShell.youHaveBeenRemovedFromThis");
        void openPopup("generic", { data: { title: t("groups.groupAppShell.youLeftTheGroup"), message } });
      }),
    [groupId, navigation, openPopup, t]
  );

  // Leaving /groups does *not* hang up any more. The room is mounted at the
  // root of the app now (see components/RoomCallHost), so a call carries on
  // while its group's pages are not the ones on screen — the same way it
  // already carried on while a text room of the group was.
  //
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
  // The rail of groups and the rooms column, folded away by the call on screen
  // to give it their width — the group's "ocultar participantes" (see
  // lib/groupVoiceSession's GroupVoiceColumns). Only while that call is the
  // page: every other page of the group has them as always.
  // A direct call is drawn inside the private messages, on the thread of the
  // person it is with (see DirectMessagesModal) — so while that is the page,
  // the call is on screen just as a group's voice room is, and this bar must
  // not offer the way back to a call already in front of you, nor repeat the
  // buttons the room itself is putting in it.
  const dmCallVisible = Boolean(
    route?.kind === "dms" && call?.dm && call.dm.userId === route.withUserId
  );
  const callOnScreen = voiceVisible || dmCallVisible;
  const voiceColumns = useGroupVoiceColumns();
  const columnsCollapsed = voiceVisible && isWide && Boolean(voiceColumns?.collapsed);
  const collapseColumns = voiceVisible && voiceColumns?.canCollapse ? voiceColumns.toggle : undefined;
  // The same fold, for a direct call: it is drawn inside the private messages,
  // which already have a list column of their own, so what a call there folds
  // away is this rail and that list together (see lib/dmCallColumns, which is
  // also what puts them back when the call ends).
  const dmColumnsCollapsed = useDmCallColumnsCollapsed();
  const railHidden = columnsCollapsed || (dmCallVisible && isWide && dmColumnsCollapsed);
  const { setElement: setRoomsColumn, style: roomsColumnStyle, handle: roomsColumnHandle } =
    useColumnWidth(ROOMS_COLUMN);
  const { setElement: setMembersColumn, style: membersColumnStyle, handle: membersColumnHandle } =
    useColumnWidth(MEMBERS_COLUMN);
  const closeNav = () => setNavOpen(false);
  // Only a call puts controls in the middle of the bar, and only from lg up —
  // anywhere else the bar is what it always was.
  const headerFit = useHeaderFit(headerRow, [headerCenter, headerRight], Boolean(call) && isWide);

  return (
    <GroupNavContext.Provider value={{ openNav: () => setNavOpen(true), openMembers: () => setMembersOpen(true) }}>
      <div data-group-shell className="flex min-h-0 flex-1 select-none flex-col bg-zinc-50 dark:bg-black">
        <header
          data-header-compact={headerFit >= 1 ? "" : undefined}
          className={`shrink-0 border-b border-black/10 bg-white dark:border-white/10 dark:bg-zinc-950 ${
            isWide ? "px-3 py-2 sm:px-4" : "px-2"
          }`}
        >
          {/* A phone's bar is its own thing: a back arrow and where you are,
              a screen per level (see GroupMobile). */}
          {!isWide && (
            <GroupMobileBar
              route={route?.kind === "dms" ? { kind: "home" } : route}
              detail={detail}
              channel={routeChannel}
              setRightSlot={setRightSlot}
              setEndSlot={setEndSlot}
              voiceVisible={callOnScreen}
              setCenterSlot={setCenterSlot}
              onOpenMembers={() => setMembersOpen(true)}
            />
          )}
          {/* The call's controls stay in the middle while there is room for
              them there. The right column never gives up any of its own width
              (max-content) — it used to be able to shrink to nothing, which is
              how its buttons ended up drawn over the controls — and the left,
              where the group's name truncates, gives way first. When even that
              is not enough the bar steps down (see lib/headerFit). */}
          {isWide && (
          <div
            ref={setHeaderRow}
            className={
              headerFit === 2
                ? "flex items-center gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_max-content] lg:gap-x-3 lg:gap-y-2"
                : "flex items-center gap-2 lg:grid lg:grid-cols-[minmax(10rem,1fr)_auto_minmax(max-content,1fr)] lg:gap-3"
            }
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Tooltip content={t("common.backToHome")} placement="bottom">
                <Link
                  href="/"
                  aria-label={t("common.home")}
                  className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-lg text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                >
                  <MdHome />
                </Link>
              </Tooltip>
              <span className="hidden h-6 w-px shrink-0 bg-zinc-200 sm:block dark:bg-zinc-800" />
              {/* The groups are the column down the left (see GroupRail), so
                  the switcher would only repeat it: its place goes to the
                  private conversations. A phone has its own bar (GroupMobile). */}
              <DmRecentStrip leading compact={headerFit >= 1} />
            </div>

            {/* The middle: the call's own controls — mic, sound, screen,
                camera, sources, music, hang up — for as long as you are
                connected, portalled in by the room whether or not it is the
                page on screen. Beside them, while it is not, the way back to it. */}
            <div
              ref={setHeaderCenter}
              className={`hidden items-center gap-2 justify-self-center lg:flex ${
                headerFit === 2 ? "lg:col-span-2 lg:row-start-2" : ""
              }`}
            >
              {call && !callOnScreen && <VoiceCallLink />}
              <div ref={setCenterSlot} className="contents" />
            </div>

            <div
              ref={setHeaderRight}
              className={`ml-auto flex shrink-0 items-center justify-end gap-1.5 lg:ml-0 ${
                headerFit === 2 ? "lg:col-start-2 lg:row-start-1" : ""
              }`}
            >
              {/* The call's page buttons (Pro and the like), portalled in by
                  the room while it is on screen. */}
              <div ref={setRightSlot} className="contents" />
              {/* With no voice room on screen, the bar's own copy — the room
                  puts its Pro button in the slot above while it is. */}
              {!callOnScreen && <RoomProOfferButton />}
              {detail && <GroupActions detail={detail} />}
              {/* Private conversations, as faces. From lg up they sit on the
                  left instead, where the switcher was. */}
              <NotificationInboxBell />
              <AccountMenu />
              <UpdateAppButton />
              {/* Last in the bar: "more options", in the corner — the voice
                  room's while it is on screen, the group bar's own otherwise. */}
              <div ref={setEndSlot} className="contents" />
              {!callOnScreen && <GroupHeaderMenu />}
            </div>
          </div>
          )}
        </header>

        {/* The music of the voice room you are in, as one blue strip right
            under the group's bar — the same place whichever of the group's
            rooms is open, so the song never jumps around the page or out of
            view as you move between them. Empty, and so no height at all,
            when nothing is playing. Filled by the room (see WatchRoom). */}
        <div ref={setMusicSlot} className="flex shrink-0 flex-col" />

        {/* Below lg the call gets a strip of its own under the bar. */}
        {call && !callOnScreen && (
          <div className="shrink-0 border-b border-black/10 bg-white px-3 py-1.5 lg:hidden dark:border-white/10 dark:bg-zinc-950">
            <VoiceControls className="w-full" />
          </div>
        )}

        <div className="flex min-h-0 flex-1 lg:gap-3 lg:p-3">
          {/* Every group, down the left edge — from lg up; below that the
              switcher in the bar is the way between them. Hidden rather than
              unmounted while a call folds it away, so it comes back as it was
              left, scrolled and all. */}
          {isWide && (
            <div className={railHidden ? "hidden" : "contents"}>
              <GroupRail activeGroupId={groupId} />
            </div>
          )}
          {/* The expanded messages, beside the groups. Always there from lg
              up — empty and hidden until used — so the window has somewhere
              to go the moment it expands, with no frame drawn over the whole
              screen first. The group's own columns step aside meanwhile but
              stay mounted: the text room keeps its scroll and its draft, and
              a call its picture. */}
          {isWide && <div ref={setDmSlot} className={dmDocked ? "flex min-h-0 min-w-0 flex-1" : "hidden"} />}
          {/* Folded away with the rail by a call on screen: hidden, so the
              rooms keep their scroll and a half-typed new room's name. */}
          {groupId && (
            <aside
              ref={setRoomsColumn}
              style={roomsColumnStyle}
              className={`${dmDocked || columnsCollapsed ? "hidden" : "hidden lg:flex"} relative shrink-0 flex-col gap-3`}
            >
              <ColumnResizeHandle {...roomsColumnHandle} label={t("groups.groupAppShell.dragToResizeColumn")} />
              {/* Never shorter than its first five rooms (see GroupRoomsPanel's
                  onMinHeight): the ad under it gives way instead, and scrolls.
                  Down to the floor an ad keeps in any column (PartnerCard's
                  MIN_CARD_HEIGHT_PX) — a column shorter than that plus five
                  rooms is too short for both, and the rooms scroll too. */}
              <div
                className="flex min-h-0 flex-1 flex-col"
                style={
                  roomsMinHeight
                    ? { minHeight: `min(${roomsMinHeight}px, calc(100% - ${MIN_CARD_HEIGHT_PX + ASIDE_GAP_PX}px))` }
                    : undefined
                }
              >
                {detail ? (
                  <GroupRoomsPanel
                    detail={detail}
                    activeChannelId={roomId}
                    onMinHeight={setRoomsMinHeight}
                    onCollapse={collapseColumns}
                  />
                ) : (
                  <div className="flex h-full flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
                    ))}
                  </div>
                )}
              </div>
              {/* Always here, call or no call — see GroupPartnerSlot. But
                  unmounted, not merely hidden, with the column folded away: a
                  hidden ad would go on counting impressions, and the call puts
                  it in its grid instead (see WatchRoom's sponsored tile). */}
              {isWide && !columnsCollapsed && (
                <GroupPartnerSlot reservedAbove={roomsMinHeight ? roomsMinHeight + ASIDE_GAP_PX : undefined} />
              )}
            </aside>
          )}

          <div className={dmDocked ? "hidden" : "flex min-h-0 min-w-0 flex-1 flex-col"}>
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
            {/* Where the call is drawn while its own room is the page being
                looked at. The room is mounted at the root of the app and moved
                in here (see components/RoomCallHost); on every other page of
                the group it is simply not drawn, and goes on regardless. */}
            {voiceVisible && <CallOutlet />}
          </div>

          {/* The group's people, like a room's participant column. Not while
              the call is on screen: it brings its own column (chat and your
              card), and the people in it are on its room card already. */}
          {groupId && detail && !voiceVisible && (
            <aside
              ref={setMembersColumn}
              style={membersColumnStyle}
              className={`${dmDocked ? "hidden" : "hidden lg:flex"} relative shrink-0 flex-col gap-3`}
            >
              <ColumnResizeHandle {...membersColumnHandle} label={t("groups.groupAppShell.dragToResizeColumn")} />
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
        {!isWide && groupId && (
          <MobileSheet open={navOpen} onClose={closeNav} title={t("common.rooms")}>
            {detail ? (
              <GroupRoomsPanel bare detail={detail} activeChannelId={roomId} onNavigate={closeNav} />
            ) : (
              <p className="py-4 text-center text-sm text-zinc-500">{t("common.loading")}</p>
            )}
          </MobileSheet>
        )}

        {/* And its people — the column on the right from lg up. Sized rather
            than left to its content: the list inside is windowed, and a
            window needs a height to fill. */}
        {!isWide && detail && (
          <MobileSheet open={membersOpen} onClose={() => setMembersOpen(false)} className="h-[80dvh]" maxHeight="80dvh">
            <div className="flex h-full min-h-0 flex-col pb-2">
              <GroupMembersPanel bare detail={detail} channel={routeChannel?.kind === "text" ? routeChannel : null} />
            </div>
          </MobileSheet>
        )}

        {/* The one profile dialog for everything in the group — see groupProfile. */}
        <GroupProfileHost detail={detail ?? null} />
        {/* And the one right-click menu on a person — see GroupMemberActions. */}
        <GroupMemberMenuHost detail={detail ?? null} />

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
 * The middle of the screen, for whatever the address names. Keyed by the room,
 * so each one starts fresh — the text room's own state (scroll, the reply
 * being written) belongs to that room.
 */
function GroupsView({ route }: { route: GroupsRoute | null }) {
  if (!route || route.kind === "home" || route.kind === "dms") return <GroupsHome />;
  if (route.kind === "group") return <GroupIndex key={route.groupId} groupId={route.groupId} />;
  return <GroupRoom key={`${route.groupId}/${route.roomId}`} groupId={route.groupId} roomId={route.roomId} />;
}

// The call's own pieces — the room, the sound of getting in, and hanging up
// when the room throws somebody out — moved to components/RoomCallHost, which
// is where the room lives now.

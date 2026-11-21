"use client";

import { groupEntryPath } from "@/components/groups/lastChannel";
import Tippy from "@tippyjs/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import useNtPopups from "ntpopups";
import {
  MdAdd,
  MdAlternateEmail,
  MdArchive,
  MdArrowDownward,
  MdArrowUpward,
  MdClose,
  MdContentCopy,
  MdCreateNewFolder,
  MdDoneAll,
  MdDriveFileMove,
  MdFolder,
  MdFolderOff,
  MdGroups,
  MdHeadsetMic,
  MdKeyboardArrowDown,
  MdKeyboardArrowUp,
  MdKeyboardDoubleArrowLeft,
  MdKeyboardDoubleArrowRight,
  MdLink,
  MdLiveTv,
  MdOutlineFolderOpen,
  MdScreenShare,
  MdSearch,
  MdUnarchive,
  MdVerticalAlignBottom,
  MdVerticalAlignTop,
  MdVideocam,
  MdVolumeUp,
} from "react-icons/md";
import { NewBadge } from "@/components/NewBadge";
import { GlobeIcon } from "@/components/icons";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupLink } from "@/components/groups/GroupLink";
import { GroupName } from "@/components/groups/GroupName";
import { nameMatches, searchWords, setGroupsHomeQuery } from "@/components/groups/groupSearch";
import { copyText } from "@/lib/clipboard";
import { GROUPS_EXPLORE_PATH, GROUPS_ROOMS_PATH, groupPath } from "@/lib/groupLinks";
import { GROUPS_ROOMS_FEATURE, noteGroupsRoomsSource } from "@/lib/groupsRooms";
import { useFeature } from "@/lib/features";
import { useGroupNavigation } from "@/lib/groupNavigation";
import type { GroupFolder, GroupSummary } from "@/lib/groupsApi";
import { useGroupVoiceSession } from "@/lib/groupVoiceSession";
import { callNameFor, callPathFor, useCallSession } from "@/lib/callSession";
import { recentRoomPresentation } from "@/lib/recentRooms";
import { usePathname } from "next/navigation";
import {
  FOLDER_COLORS,
  FOLDER_SWATCH,
  FOLDER_TINT,
  addToFolder,
  archivedGroups,
  countedGroups,
  createFolder,
  dissolveFolder,
  flatIds,
  folderColor,
  folderNews,
  layoutOf,
  moveEntry,
  moveInFolder,
  railEntries,
  removeFromFolder,
  updateFolder,
  type FolderColor,
  type RailEntry,
} from "@/lib/groupRailLayout";
import { GROUP_ORGANIZE_EVENTS, trackGroupOrganize, useGroupOrganize } from "@/lib/groupOrganize";
import { useGroupsHub } from "@/lib/groupsHub";
import { setFolderOpen, useOpenFolders } from "@/lib/openFolders";
import { useDragSort } from "@/lib/useDragSort";
import {
  archiveGroup,
  markGroupRead,
  prefetchGroup,
  reorderGroups,
  saveLayout,
  useGroupRailLayout,
  useMyGroups,
} from "@/lib/useGroups";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useT, useTCount } from "@/lib/useI18n";

// Every group this person is in, down the left edge of /groups — a dock
// rather than a strip: a card like the columns beside it, icons only while it
// is out of the way, and the names sliding out over the rooms once the pointer
// has stood still on it for a moment — passing over it on the way somewhere
// else opens nothing (or kept out for good on a wide screen). A search field
// at its top narrows it to the groups whose names match, and hands the same
// words over to /groups to look among public groups too.
//
// What it says about each group, at a glance:
//   - which one is open: its tile is lit, with a bar on the side facing its rooms;
//   - something new: a dot on the icon's corner;
//   - you were mentioned: a count on the icon — and the "@" tile at the top
//     jumps to the next group holding one, with hints at the list's edges when
//     one is scrolled out of sight;
//   - you are in a call there: a headset on the icon.
//
// The order is the person's own, saved on the server, so every list of groups
// on the site follows it. Rearranged by dragging a tile (a long press on a
// touchscreen), by Alt+↑/↓ on a focused tile, or from the tile's right-click
// menu. A group joined since lands on top.
//
// Experiment group-organize (lib/groupOrganize): folders — a tile of their
// own holding several groups, opened in place — and a shelf at the end of the
// list for groups put away ("Arquivados"). The order then lives in the
// layout (lib/groupRailLayout), and each level is rearranged on its own: the
// top level among itself, a folder's groups inside the folder. Moving a group
// into or out of a folder is the menu's.

const EXPANDED_KEY = "golive:groups:railExpanded";
const XL_QUERY = "(min-width: 80rem)";
/** How long the pointer has to stand still on the dock before the names slide out. */
const REST_DELAY_MS = 650;

function mentionLabel(t: ReturnType<typeof useT>, mentions: number): string {
  return mentions === 1
    ? t("groups.homeGroupsPanel.n1Mention")
    : t("groups.homeGroupsPanel.mentionsMentions", { mentions });
}

/** Scrolls a group's tile into view once it is drawn (a folder may have just opened around it). */
function revealGroup(groupId: string) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-rail-group="${CSS.escape(groupId)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    })
  );
}

type MenuTarget = { kind: "group" | "folder"; id: string; x: number; y: number; rename?: boolean };

export function GroupRail({
  activeGroupId,
  roomsActive = false,
  exploreActive = false,
  elsewhere = false,
}: {
  activeGroupId: string | null;
  /** The public rooms are the page (experiment "groups-rooms") — their tile is the lit one. */
  roomsActive?: boolean;
  /** Explorar grupos is the page (experiment "groups-hub") — its tile is the lit one. */
  exploreActive?: boolean;
  /**
   * The page is none of the rail's own — an ordinary room's, or another page
   * of the site framed by the group shell (experiment "room-shell", see
   * lib/roomShell) — so no tile is lit.
   */
  elsewhere?: boolean;
}) {
  const t = useT();
  const tc = useTCount();
  // The tile is where the experiment shows itself, so this is the exposure.
  const roomsTab = useFeature(GROUPS_ROOMS_FEATURE).enabled;
  // An ordinary room this tab is in (not a group's voice room, not a direct
  // call): a tile of its own under "Salas ao vivo", the way back to it from
  // anywhere in the layout — and lit while it is the page on screen.
  const call = useCallSession();
  const pathname = usePathname();
  const roomCall = call && !call.group && !call.dm ? call : null;
  // Folders and the shelf: the rail is where they are drawn.
  const organize = useGroupOrganize({ track: true });
  // Explorar in the top tiles, and the live rooms' new icon.
  const hub = useGroupsHub({ track: true });
  const { groups } = useMyGroups();
  const layout = useGroupRailLayout();
  const navigation = useGroupNavigation();
  const voice = useGroupVoiceSession();
  const isXl = useMediaQuery(XL_QUERY);
  const openFolders = useOpenFolders();

  // ── Names out or in ────────────────────────────────────────────────────
  // Read straight from storage: the dock is only ever drawn in the browser
  // (the shell waits on the lg media query), so there is no server render
  // for this to disagree with.
  const [pinnedOpen, setPinnedOpen] = useState(() => {
    try {
      return window.localStorage.getItem(EXPANDED_KEY) === "1";
    } catch {
      return false;
    }
  });
  function togglePinned() {
    const next = !pinnedOpen;
    setPinnedOpen(next);
    setPeek(false);
    try {
      window.localStorage.setItem(EXPANDED_KEY, next ? "1" : "0");
    } catch {
      // ignored - localStorage may be unavailable
    }
  }
  // Kept out only where there is width to spare for it; on a narrower screen
  // the dock goes back to peeking, whatever was chosen.
  const expanded = pinnedOpen && isXl;
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Searching ──────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const words = searchWords(search);
  const filtering = words.length > 0;
  // The names stay out for as long as there is a search going on: a list of
  // matches is no use as a column of initials.
  const searchActive = searchFocused || filtering;
  const showNames = expanded || peek || searchActive;

  // ── The list ───────────────────────────────────────────────────────────
  const list = useMemo(() => groups ?? [], [groups]);
  // Outside the experiment every group is a line of its own, in the order the
  // server sent — which is already the person's, archived ones included.
  const entries: RailEntry[] = useMemo(
    () => (organize ? railEntries(list, layout) : list.map((g) => ({ kind: "group", id: g.id, group: g }))),
    [organize, list, layout]
  );
  const shelf = useMemo(() => (organize ? archivedGroups(list) : []), [organize, list]);
  const entryIds = useMemo(() => entries.map((e) => e.id), [entries]);
  // The layout as drawn — what every change below starts from.
  const drawn = useMemo(() => layoutOf(entries), [entries]);
  // What a search draws: every group whose name matches, shelf included, flat.
  const matches = filtering ? list.filter((g) => nameMatches(g.name, words)) : [];

  const counted = countedGroups(list, organize);
  const mentioned = counted.filter((g) => !g.suspended && g.mentions > 0);
  const totalMentions = mentioned.reduce((n, g) => n + g.mentions, 0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // ── Hints at the edges ─────────────────────────────────────────────────
  // Read off the page: tiles are of more than one height now (a folder open
  // is tall), so where a mention sits is a question for the layout.
  const [hints, setHints] = useState({ above: false, below: false });
  const updateHints = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    let above = false;
    let below = false;
    for (const tile of el.querySelectorAll<HTMLElement>("[data-rail-mention]")) {
      const r = tile.getBoundingClientRect();
      if (r.height === 0) continue;
      if (r.bottom <= box.top + 4) above = true;
      if (r.top >= box.bottom - 4) below = true;
    }
    setHints((h) => (h.above === above && h.below === below ? h : { above, below }));
  }, []);
  const mentionKey = mentioned.map((g) => g.id).join(",");
  useLayoutEffect(() => {
    updateHints();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHints);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateHints, mentionKey, entries, openFolders, filtering]);

  function scrollToHint(direction: "above" | "below") {
    const el = scrollRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const tiles = [...el.querySelectorAll<HTMLElement>("[data-rail-mention]")];
    const target =
      direction === "above"
        ? tiles.reverse().find((tile) => tile.getBoundingClientRect().bottom <= box.top + 4)
        : tiles.find((tile) => tile.getBoundingClientRect().top >= box.bottom - 4);
    target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /** The folder a group is in, from the layout as drawn. */
  const folderOf = useCallback(
    (groupId: string) => drawn.folders.find((f) => f.groupIds.includes(groupId)) ?? null,
    [drawn]
  );

  /** Opens whatever folder holds a group, and brings its tile into view. */
  function reveal(groupId: string) {
    const folder = folderOf(groupId);
    if (folder) setFolderOpen(folder.id, true);
    revealGroup(groupId);
  }

  /** The next group after the open one that holds a mention, round the end. */
  function jumpToNextMention() {
    if (mentioned.length === 0) return;
    const order = organize ? flatIds(drawn) : list.map((g) => g.id);
    const byId = new Map(counted.map((g) => [g.id, g]));
    const activeIndex = activeGroupId ? order.indexOf(activeGroupId) : -1;
    const holds = (id: string) => {
      const g = byId.get(id);
      return Boolean(g && !g.suspended && g.mentions > 0);
    };
    const next = order.find((id, i) => i > activeIndex && holds(id)) ?? order.find(holds);
    if (!next) return;
    if (filtering) setSearch("");
    reveal(next);
    navigation.push(groupPath(next));
  }

  /** Out of the search: the field emptied and let go, so the dock can fold away. */
  function endSearch() {
    setSearch("");
    searchRef.current?.blur();
  }

  function openFirstMatch() {
    const first = matches[0];
    if (!first) return;
    endSearch();
    reveal(first.id);
    navigation.push(groupPath(first.id));
  }

  /** The same words, looked for among public groups on /groups (or Explorar). */
  function searchPublicGroups() {
    const text = search.trim();
    endSearch();
    setGroupsHomeQuery(text);
    navigation.push(hub ? GROUPS_EXPLORE_PATH : "/groups");
  }

  // ── Rearranging ────────────────────────────────────────────────────────
  const [announcement, setAnnouncement] = useState("");
  const refocusId = useRef<string | null>(null);
  useEffect(() => {
    const id = refocusId.current;
    if (!id) return;
    refocusId.current = null;
    scrollRef.current?.querySelector<HTMLElement>(`[data-rail-focus="${CSS.escape(id)}"]`)?.focus();
  });

  /** A line of the top level from one place to another. */
  const moveTop = useCallback(
    (from: number, to: number) => {
      if (organize) saveLayout(moveEntry(drawn, from, to));
      else {
        const next = [...entryIds];
        const [id] = next.splice(from, 1);
        next.splice(to, 0, id);
        reorderGroups(next);
      }
    },
    [organize, drawn, entryIds]
  );

  /** A group inside a folder, from one place to another. */
  const moveChild = useCallback(
    (folderId: string, from: number, to: number) => saveLayout(moveInFolder(drawn, folderId, from, to)),
    [drawn]
  );

  function announceMove(name: string, position: number, total: number) {
    setAnnouncement(t("groups.groupRail.movedToPosition", { name, position, total }));
  }

  /** Moves a line (top level, or inside its folder) to `to`, from the keyboard or the menu. */
  function moveLine(kind: "group" | "folder", id: string, to: number) {
    const folder = kind === "group" ? folderOf(id) : null;
    const siblings = folder ? folder.groupIds : entryIds;
    const from = siblings.indexOf(id);
    const target = Math.max(0, Math.min(siblings.length - 1, to));
    if (from < 0 || from === target) return;
    if (folder) moveChild(folder.id, from, target);
    else moveTop(from, target);
    const name =
      kind === "folder"
        ? drawn.folders.find((f) => f.id === id)?.name || t("groups.organize.folder")
        : list.find((g) => g.id === id)?.name ?? "";
    announceMove(name, target + 1, siblings.length);
    revealGroup(id);
  }

  function onLineKeyDown(e: ReactKeyboardEvent<HTMLElement>, kind: "group" | "folder", id: string) {
    if (!e.altKey || filtering || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    e.stopPropagation();
    const folder = kind === "group" ? folderOf(id) : null;
    const siblings = folder ? folder.groupIds : entryIds;
    refocusId.current = id;
    moveLine(kind, id, siblings.indexOf(id) + (e.key === "ArrowUp" ? -1 : 1));
  }

  const topDrag = useDragSort({
    ids: entryIds,
    listRef,
    scrollRef,
    onMove: moveTop,
    disabled: filtering,
  });

  // ── Folders and the shelf ──────────────────────────────────────────────
  function newFolderWith(groupId: string, at: { x: number; y: number }) {
    const { layout: next, folderId } = createFolder(drawn, [groupId]);
    saveLayout(next);
    setFolderOpen(folderId, true);
    trackGroupOrganize(GROUP_ORGANIZE_EVENTS.folderCreate);
    // Straight into naming it, where the menu was.
    setMenu({ kind: "folder", id: folderId, x: at.x, y: at.y, rename: true });
  }

  function putInFolder(groupId: string, folderId: string) {
    saveLayout(addToFolder(drawn, groupId, folderId));
    setFolderOpen(folderId, true);
    trackGroupOrganize(GROUP_ORGANIZE_EVENTS.folderAdd);
    revealGroup(groupId);
  }

  function takeOutOfFolder(groupId: string) {
    saveLayout(removeFromFolder(drawn, groupId));
    revealGroup(groupId);
  }

  function ungroup(folderId: string) {
    saveLayout(dissolveFolder(drawn, folderId));
    trackGroupOrganize(GROUP_ORGANIZE_EVENTS.folderUngroup);
  }

  function setArchived(group: GroupSummary, archived: boolean) {
    archiveGroup(group.id, archived);
    trackGroupOrganize(archived ? GROUP_ORGANIZE_EVENTS.archive : GROUP_ORGANIZE_EVENTS.unarchive);
    setAnnouncement(
      archived ? t("groups.organize.archivedName", { name: group.name }) : t("groups.organize.unarchivedName", { name: group.name })
    );
    if (!archived) revealGroup(group.id);
  }

  const [shelfOpen, setShelfOpen] = useState(false);
  const shelfMentions = shelf.reduce((n, g) => n + (g.suspended ? 0 : g.mentions), 0);
  const shelfUnread = shelf.some((g) => !g.suspended && g.unread);

  // ── The right-click menu ───────────────────────────────────────────────
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu, closeMenu]);
  const menuGroup = menu?.kind === "group" ? list.find((g) => g.id === menu.id) ?? null : null;
  const menuFolderEntry =
    menu?.kind === "folder"
      ? (entries.find((e) => e.kind === "folder" && e.id === menu.id) as Extract<RailEntry, { kind: "folder" }> | undefined) ??
        null
      : null;

  function openMenu(e: ReactMouseEvent, kind: "group" | "folder", id: string) {
    e.preventDefault();
    e.stopPropagation();
    // A long press on a touchscreen is the start of a drag.
    if (topDrag.touchPressing()) return;
    setMenu({ kind, id, x: e.clientX, y: e.clientY });
  }

  // Every move starts the wait over, so only a pointer that stops on the dock
  // opens it; once open, moving about inside it keeps it open.
  function onDockMove() {
    if (expanded || peek || topDrag.drag) return;
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(true), REST_DELAY_MS);
  }
  function onDockLeave() {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    // Not while a tile is being carried, nor while a menu of the dock is
    // open: the names folding away under it would be the dock moving under
    // the pointer, and a menu that points at nothing.
    if (!topDrag.drag && !menu) setPeek(false);
  }
  useEffect(() => {
    if (!topDrag.drag && !menu && peek && panel && !panel.matches(":hover")) setPeek(false);
  }, [topDrag.drag, menu, peek, panel]);
  useEffect(
    () => () => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
    },
    []
  );

  const railWidth = expanded ? "w-60" : "w-[70px]";

  const groupTile = (group: GroupSummary, extra?: { dragging?: boolean; nested?: boolean; shelved?: boolean }) => (
    <GroupTile
      group={group}
      active={group.id === activeGroupId}
      inCall={voice?.groupId === group.id}
      showName={showNames}
      dragging={Boolean(extra?.dragging)}
      shelved={Boolean(extra?.shelved)}
      onKeyDown={(e) => onLineKeyDown(e, "group", group.id)}
      onClick={() => {
        if (filtering) endSearch();
      }}
      onContextMenu={(e) => openMenu(e, "group", group.id)}
    />
  );

  return (
    <nav aria-label={t("common.yourGroups")} className={`relative hidden shrink-0 lg:block ${railWidth}`}>
      <div
        ref={setPanel}
        onMouseMove={onDockMove}
        onMouseLeave={onDockLeave}
        className={`absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white transition-[width,box-shadow] duration-200 ease-out dark:border-zinc-800 dark:bg-zinc-950 ${
          showNames ? "w-60" : "w-[70px]"
        } ${showNames && !expanded ? "shadow-2xl shadow-black/20" : ""}`}
      >
        {/* The fixed tiles: the search, the ways to new things, and the way to the next mention. */}
        <div className="flex shrink-0 flex-col gap-1.5 px-[7px] pb-2 pt-[7px]">
          <RailSearch
            inputRef={searchRef}
            value={search}
            open={showNames}
            active={searchActive}
            onChange={setSearch}
            onFocusChange={setSearchFocused}
            onEnter={openFirstMatch}
            onEscape={() => (search ? setSearch("") : searchRef.current?.blur())}
            onArrowDown={() => scrollRef.current?.querySelector<HTMLElement>("[data-rail-focus]")?.focus()}
          />
          {hub ? (
            // Where new groups are found — the groups somebody is in are the
            // list below, so this tile is for the ones they are not in yet.
            <RailTile
              active={exploreActive}
              showName={showNames}
              label={t("groups.groupDialogs.exploreGroups")}
              href={GROUPS_EXPLORE_PATH}
              face={
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  <GlobeIcon className="h-5 w-5" />
                </span>
              }
            />
          ) : (
            <RailTile
              active={activeGroupId === null && !roomsActive && !exploreActive && !elsewhere}
              showName={showNames}
              label={t("groups.groupSwitcher.allGroups")}
              href="/groups"
              face={
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-xl text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  <MdGroups />
                </span>
              }
            />
          )}
          {/* Every public room open right now — see GroupsRoomsView. */}
          {roomsTab && (
            <RailTile
              active={roomsActive}
              showName={showNames}
              label={t("groups.roomsTab.title")}
              href={GROUPS_ROOMS_PATH}
              onClick={() => noteGroupsRoomsSource("rail")}
              badge={<NewBadge id={GROUPS_ROOMS_FEATURE} />}
              face={
                <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {hub ? <MdLiveTv className="h-5 w-5" /> : <GlobeIcon className="h-5 w-5" />}
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-zinc-950" />
                </span>
              }
            />
          )}
          {roomCall && (
            <RailTile
              active={pathname === callPathFor(roomCall)}
              showName={showNames}
              label={callNameFor(roomCall)}
              sublabel={t("groups.groupRail.inThisRoom")}
              sublabelTone="muted"
              href={callPathFor(roomCall)}
              face={
                <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-base font-semibold text-white">
                  {recentRoomPresentation(roomCall.handle).name.charAt(0).toUpperCase() || <MdVolumeUp className="h-5 w-5" />}
                  <span className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white text-emerald-600 ring-2 ring-white dark:bg-zinc-950 dark:text-emerald-400 dark:ring-zinc-950">
                    <MdVolumeUp className="h-3 w-3" />
                  </span>
                </span>
              }
            />
          )}
          {totalMentions > 0 && (
            <RailTile
              showName={showNames}
              label={t("groups.groupRail.nextMention")}
              sublabel={mentionLabel(t, totalMentions)}
              onClick={jumpToNextMention}
              face={
                <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 text-white">
                  <MdAlternateEmail className="h-5 w-5" />
                  <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold leading-none text-red-600 ring-2 ring-white dark:bg-zinc-950 dark:ring-zinc-950">
                    {totalMentions > 99 ? "99+" : totalMentions}
                  </span>
                </span>
              }
            />
          )}
        </div>
        <div className="mx-3 h-px shrink-0 bg-zinc-200 dark:bg-zinc-800" />

        {/* The groups, in this person's order. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            onScroll={updateHints}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-[7px] py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {groups === null ? (
              <div className="flex flex-col gap-1.5">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="mx-1 h-10 w-10 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
                ))}
              </div>
            ) : filtering ? (
              <>
                <ul className="flex flex-col gap-1.5">
                  {matches.map((group) => (
                    <li key={group.id}>{groupTile(group, { shelved: Boolean(organize && group.archived) })}</li>
                  ))}
                </ul>
                <div className={`flex flex-col gap-2 px-1 ${matches.length > 0 ? "pt-3" : ""}`}>
                  {matches.length === 0 && (
                    <p className="whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">{t("groups.groupRail.noMatches")}</p>
                  )}
                  <button
                    type="button"
                    onClick={searchPublicGroups}
                    className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-dashed border-zinc-300 px-2.5 py-2 text-left text-xs font-medium text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                  >
                    <MdSearch className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t("groups.groupRail.searchPublicGroups")}</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <ul ref={listRef} className="flex flex-col gap-1.5">
                  {entries.map((entry) => {
                    const props = topDrag.itemProps(entry.id);
                    const dragging = topDrag.drag?.id === entry.id;
                    return (
                      <li key={`${entry.kind}:${entry.id}`} {...props}>
                        {entry.kind === "group" ? (
                          groupTile(entry.group, { dragging })
                        ) : (
                          <FolderBlock
                            folder={entry.folder}
                            groups={entry.groups}
                            open={openFolders.has(entry.id) && !dragging}
                            dragging={dragging}
                            showName={showNames}
                            activeGroupId={activeGroupId}
                            scrollRef={scrollRef}
                            onToggle={() => setFolderOpen(entry.id, !openFolders.has(entry.id))}
                            onKeyDown={(e) => onLineKeyDown(e, "folder", entry.id)}
                            onContextMenu={(e) => openMenu(e, "folder", entry.id)}
                            onMoveChild={(from, to) => moveChild(entry.id, from, to)}
                            renderGroup={(group, childDragging) => groupTile(group, { dragging: childDragging, nested: true })}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>

                {/* The shelf: the groups put away, folded up at the end of the list. */}
                {shelf.length > 0 && (
                  <div className="mt-1.5 flex flex-col gap-1.5 border-t border-zinc-200 pt-1.5 dark:border-zinc-800">
                    <RailTile
                      showName={showNames}
                      active={false}
                      label={t("groups.organize.archived")}
                      sublabel={tc("common.groupCount", shelf.length)}
                      sublabelTone="muted"
                      expanded={shelfOpen}
                      onClick={() => {
                        if (!shelfOpen) trackGroupOrganize(GROUP_ORGANIZE_EVENTS.archiveOpen);
                        setShelfOpen(!shelfOpen);
                      }}
                      face={
                        <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                          <MdArchive className="h-5 w-5" />
                          {shelfMentions > 0 ? (
                            <span className="absolute -bottom-1 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-zinc-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-zinc-950">
                              {shelfMentions > 99 ? "99+" : shelfMentions}
                            </span>
                          ) : shelfUnread ? (
                            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-zinc-400 ring-2 ring-white dark:ring-zinc-950" />
                          ) : null}
                        </span>
                      }
                    />
                    {shelfOpen && (
                      <ul className="flex flex-col gap-1.5">
                        {shelf.map((group) => (
                          <li key={group.id}>{groupTile(group, { shelved: true })}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* A mention scrolled out of sight says which way it is. */}
          {hints.above && (
            <EdgeHint direction="above" label={t("groups.groupRail.mentionsAbove")} onClick={() => scrollToHint("above")} />
          )}
          {hints.below && (
            <EdgeHint direction="below" label={t("groups.groupRail.mentionsBelow")} onClick={() => scrollToHint("below")} />
          )}
        </div>

        <div className="mx-3 h-px shrink-0 bg-zinc-200 dark:bg-zinc-800" />
        <div className="flex shrink-0 flex-col gap-1.5 p-[7px]">
          <AddGroupTile showName={showNames} />
          {isXl && (
            <button
              type="button"
              onClick={togglePinned}
              aria-pressed={expanded}
              aria-label={expanded ? t("groups.groupRail.collapse") : t("groups.groupRail.keepOpen")}
              className="flex h-8 cursor-pointer items-center gap-3 rounded-lg px-3 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              {expanded ? (
                <MdKeyboardDoubleArrowLeft className="h-4 w-4 shrink-0" />
              ) : (
                <MdKeyboardDoubleArrowRight className="h-4 w-4 shrink-0" />
              )}
              <span className={`truncate whitespace-nowrap transition-opacity ${showNames ? "opacity-100" : "opacity-0"}`}>
                {expanded ? t("groups.groupRail.collapse") : t("groups.groupRail.keepOpen")}
              </span>
            </button>
          )}
        </div>

        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>

      {panel && (
        <Tippy
          reference={panel}
          visible={Boolean(menuGroup || menuFolderEntry)}
          getReferenceClientRect={() => new DOMRect(menu?.x ?? 0, menu?.y ?? 0, 0, 0)}
          onClickOutside={closeMenu}
          interactive
          placement="right-start"
          offset={[0, 4]}
          theme="golive-panel"
          animation="shift-away"
          duration={[150, 100]}
          maxWidth="none"
          content={
            menuGroup ? (
              <GroupMenu
                group={menuGroup}
                siblings={folderOf(menuGroup.id)?.groupIds ?? entryIds}
                organize={organize}
                folders={drawn.folders}
                currentFolder={folderOf(menuGroup.id)}
                onMove={(to) => moveLine("group", menuGroup.id, to)}
                onNewFolder={() => menu && newFolderWith(menuGroup.id, menu)}
                onAddTo={(folderId) => putInFolder(menuGroup.id, folderId)}
                onRemoveFromFolder={() => takeOutOfFolder(menuGroup.id)}
                onArchive={(archived) => setArchived(menuGroup, archived)}
                onClose={closeMenu}
              />
            ) : menuFolderEntry ? (
              <FolderMenu
                key={menuFolderEntry.id}
                folder={menuFolderEntry.folder}
                groups={menuFolderEntry.groups}
                index={entryIds.indexOf(menuFolderEntry.id)}
                total={entryIds.length}
                startRenaming={Boolean(menu?.rename)}
                onMove={(to) => moveLine("folder", menuFolderEntry.id, to)}
                onRename={(name) => saveLayout(updateFolder(drawn, menuFolderEntry.id, { name }))}
                onColor={(color) => saveLayout(updateFolder(drawn, menuFolderEntry.id, { color }))}
                onUngroup={() => ungroup(menuFolderEntry.id)}
                onClose={closeMenu}
              />
            ) : null
          }
        />
      )}
    </nav>
  );
}

// ─── Tiles ──────────────────────────────────────────────────────────────

const tileBase =
  "relative flex h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500";

/** The name beside a tile's face, which only shows while the dock is open. */
function TileText({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden={!show}
      className={`flex min-w-0 flex-1 flex-col whitespace-nowrap transition-opacity duration-150 ${
        show ? "opacity-100 delay-75" : "pointer-events-none opacity-0"
      }`}
    >
      {children}
    </span>
  );
}

/** The bar on the side of the open tile that faces its rooms. */
function ActiveBar({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={`absolute -right-[7px] top-1/2 w-1 -translate-y-1/2 rounded-l-full bg-emerald-500 transition-all duration-200 ${
        active ? "h-7 opacity-100" : "h-0 opacity-0"
      }`}
    />
  );
}

function RailTile({
  face,
  label,
  sublabel,
  sublabelTone = "red",
  showName,
  active = false,
  expanded,
  href,
  onClick,
  badge,
}: {
  face: ReactNode;
  label: string;
  sublabel?: string;
  sublabelTone?: "red" | "muted";
  showName: boolean;
  active?: boolean;
  /** For a tile that opens something in place (the shelf): whether it is open. */
  expanded?: boolean;
  href?: string;
  /** With `href`, runs before the navigation. */
  onClick?: () => void;
  /** Beside the name, e.g. a NewBadge. */
  badge?: ReactNode;
}) {
  const className = `${tileBase} ${
    active ? "bg-zinc-100 dark:bg-zinc-900" : "hover:bg-zinc-100/70 dark:hover:bg-zinc-900/70"
  }`;
  const body = (
    <>
      <span className="shrink-0">{face}</span>
      <TileText show={showName}>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
          {badge}
        </span>
        {sublabel && (
          <span
            className={`truncate text-xs ${
              sublabelTone === "muted" ? "text-zinc-500 dark:text-zinc-400" : "text-red-600 dark:text-red-400"
            }`}
          >
            {sublabel}
          </span>
        )}
      </TileText>
      {expanded !== undefined && showName && (
        <MdKeyboardArrowDown
          aria-hidden
          className={`mr-1 h-4 w-4 shrink-0 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      )}
      <ActiveBar active={active} />
    </>
  );
  const tile = href ? (
    <GroupLink
      href={href}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={className}
    >
      {body}
    </GroupLink>
  ) : (
    <button
      type="button"
      onClick={onClick}
      aria-label={sublabel ? `${label} — ${sublabel}` : label}
      aria-expanded={expanded}
      className={className}
    >
      {body}
    </button>
  );
  return tile;
}

function GroupTile({
  group,
  active,
  inCall,
  showName,
  dragging,
  shelved,
  onKeyDown,
  onClick,
  onContextMenu,
}: {
  group: GroupSummary;
  active: boolean;
  inCall: boolean;
  showName: boolean;
  dragging: boolean;
  /** On the shelf: drawn quieter, and its marks are not the totals'. */
  shelved: boolean;
  onKeyDown: (e: ReactKeyboardEvent<HTMLAnchorElement>) => void;
  onClick: (e: ReactMouseEvent<HTMLAnchorElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLAnchorElement>) => void;
}) {
  const t = useT();
  const mentions = group.suspended ? 0 : group.mentions;
  const unread = !group.suspended && group.unread;
  const status = group.suspended
    ? t("common.suspended")
    : mentions > 0
      ? mentionLabel(t, mentions)
      : unread
        ? t("common.newMessages")
        : group.onlineCount
          ? t("groups.groupRail.onlineCount", { count: group.onlineCount })
          : null;
  const voiceActivity = group.suspended || shelved ? undefined : group.voiceActivity;
  const activityLabel =
    voiceActivity === "screen"
      ? t("groups.groupRail.callScreen")
      : voiceActivity === "camera"
        ? t("groups.groupRail.callCamera")
        : voiceActivity === "voice"
          ? t("groups.groupRail.callVoice")
          : null;
  const label = [group.name, activityLabel, status].filter(Boolean).join(" — ");

  return (
    <GroupLink
      href={groupEntryPath(group.id)}
      data-rail-group={group.id}
      data-rail-focus={group.id}
      // A shelved group's mention is the shelf's to show, not a hint's.
      data-rail-mention={mentions > 0 && !shelved ? "" : undefined}
      draggable={false}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onKeyDown={onKeyDown}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => prefetchGroup(group.id)}
      onFocus={() => prefetchGroup(group.id)}
      className={`${tileBase} touch-manipulation select-none ${
        dragging
          ? "cursor-grabbing bg-white shadow-lg shadow-black/15 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700"
          : active
            ? "bg-zinc-100 dark:bg-zinc-900"
            : "hover:bg-zinc-100/70 dark:hover:bg-zinc-900/70"
      } ${shelved ? "opacity-70" : ""}`}
    >
      <span className={`relative shrink-0 transition-transform ${dragging ? "scale-105" : ""}`}>
        <GroupIcon
          name={group.name}
          iconUrl={group.iconUrl}
          seed={group.id}
          size={40}
          className={`rounded-xl ${group.suspended ? "opacity-50 grayscale" : ""}`}
        />
        {mentions > 0 ? (
          <span
            className={`absolute -bottom-1 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-zinc-950 ${
              shelved ? "bg-zinc-500" : "bg-red-600"
            }`}
          >
            {mentions > 99 ? "99+" : mentions}
          </span>
        ) : unread ? (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-zinc-950 ring-2 ring-white dark:bg-zinc-50 dark:ring-zinc-950" />
        ) : null}
        {inCall && (
          <span className="absolute -bottom-1 -left-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-emerald-600 text-white ring-2 ring-white dark:ring-zinc-950">
            <MdHeadsetMic className="h-3 w-3" />
          </span>
        )}
        {/* What is on in its calls, in the one corner nothing else uses: a
            speaker while people are talking, a screen once somebody shares
            one, a camera once somebody turns one on (a screen wins). Red for
            the two that are something to watch, like the "ao vivo" badge. */}
        {voiceActivity && (
          <span
            title={activityLabel ?? undefined}
            className={`absolute -left-1 -top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full text-white ring-2 ring-white dark:ring-zinc-950 ${
              voiceActivity === "voice" ? "bg-emerald-600" : "bg-red-600"
            }`}
          >
            {voiceActivity === "screen" ? (
              <MdScreenShare className="h-3 w-3" />
            ) : voiceActivity === "camera" ? (
              <MdVideocam className="h-3 w-3" />
            ) : (
              <MdVolumeUp className="h-3 w-3" />
            )}
          </span>
        )}
      </span>
      <TileText show={showName}>
        <GroupName
          name={group.name}
          flags={group.flags}
          className={`w-full text-sm ${
            unread || active
              ? "font-semibold text-zinc-950 dark:text-zinc-50"
              : "font-medium text-zinc-700 dark:text-zinc-300"
          }`}
        />
        {status && (
          <span
            className={`truncate text-xs ${
              group.suspended
                ? "text-amber-600 dark:text-amber-400"
                : mentions > 0 && !shelved
                  ? "font-medium text-red-600 dark:text-red-400"
                  : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {status}
          </span>
        )}
      </TileText>
      <ActiveBar active={active && !dragging} />
    </GroupLink>
  );
}

/**
 * A folder on the rail: its tile — the faces of its first four groups on a
 * tint of its colour while closed, an open folder while open — and, open, its
 * groups under it, along a line of its colour. Its groups are rearranged among
 * themselves here; the folder itself moves with the top level.
 */
function FolderBlock({
  folder,
  groups,
  open,
  dragging,
  showName,
  activeGroupId,
  scrollRef,
  onToggle,
  onKeyDown,
  onContextMenu,
  onMoveChild,
  renderGroup,
}: {
  folder: GroupFolder;
  groups: GroupSummary[];
  open: boolean;
  dragging: boolean;
  showName: boolean;
  activeGroupId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onContextMenu: (e: ReactMouseEvent) => void;
  onMoveChild: (from: number, to: number) => void;
  renderGroup: (group: GroupSummary, dragging: boolean) => ReactNode;
}) {
  const t = useT();
  const tc = useTCount();
  const color = folderColor(folder.color);
  const name = folder.name || t("groups.organize.folder");
  const news = folderNews(groups);
  const holdsActive = groups.some((g) => g.id === activeGroupId);
  const listRef = useRef<HTMLUListElement | null>(null);
  const ids = useMemo(() => groups.map((g) => g.id), [groups]);
  const childDrag = useDragSort({ ids, listRef, scrollRef, onMove: onMoveChild, disabled: !open });

  return (
    <div
      className={`flex flex-col rounded-xl ${open ? FOLDER_TINT[color].split(" ")[0] : ""} ${
        dragging ? "shadow-lg shadow-black/15 ring-1 ring-zinc-200 dark:ring-zinc-700" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        data-rail-focus={`folder:${folder.id}`}
        // Closed, its groups' mentions are its own to show.
        data-rail-mention={!open && news.mentions > 0 ? "" : undefined}
        aria-expanded={open}
        aria-label={`${name} — ${tc("groups.organize.folderCount", groups.length)}${
          news.mentions > 0 ? ` — ${mentionLabel(t, news.mentions)}` : ""
        }`}
        className={`${tileBase} touch-manipulation select-none ${
          dragging ? "cursor-grabbing bg-white dark:bg-zinc-900" : "hover:bg-zinc-100/70 dark:hover:bg-zinc-900/70"
        }`}
      >
        <span className="relative shrink-0">
          {open ? (
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${FOLDER_TINT[color]}`}>
              <MdOutlineFolderOpen className="h-5 w-5" />
            </span>
          ) : (
            <span className={`grid h-10 w-10 grid-cols-2 gap-0.5 rounded-xl p-1 ${FOLDER_TINT[color]}`}>
              {groups.slice(0, 4).map((g) => (
                <GroupIcon key={g.id} name={g.name} iconUrl={g.iconUrl} seed={g.id} size={15} className="rounded-[5px]" />
              ))}
            </span>
          )}
          {!open &&
            (news.mentions > 0 ? (
              <span className="absolute -bottom-1 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-zinc-950">
                {news.mentions > 99 ? "99+" : news.mentions}
              </span>
            ) : news.unread ? (
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-zinc-950 ring-2 ring-white dark:bg-zinc-50 dark:ring-zinc-950" />
            ) : null)}
        </span>
        <TileText show={showName}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${FOLDER_SWATCH[color]}`} />
            <span
              className={`truncate text-sm ${
                news.unread && !open ? "font-semibold text-zinc-950 dark:text-zinc-50" : "font-medium text-zinc-700 dark:text-zinc-300"
              }`}
            >
              {name}
            </span>
          </span>
          <span
            className={`truncate text-xs ${
              !open && news.mentions > 0 ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {!open && news.mentions > 0 ? mentionLabel(t, news.mentions) : tc("groups.organize.folderCount", groups.length)}
          </span>
        </TileText>
        {/* Closed over the group that is open: the folder is where you are. */}
        <ActiveBar active={!open && holdsActive && !dragging} />
      </button>
      {open && (
        <ul ref={listRef} className="flex flex-col gap-1.5 pb-1">
          {groups.map((group) => (
            <li key={group.id} {...childDrag.itemProps(group.id)}>
              {renderGroup(group, childDrag.drag?.id === group.id)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The search at the top of the dock. Folded away it is one more tile — a
 * magnifier — and a click or a Tab into it opens the dock around the field.
 */
function RailSearch({
  inputRef,
  value,
  open,
  active,
  onChange,
  onFocusChange,
  onEnter,
  onEscape,
  onArrowDown,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  open: boolean;
  active: boolean;
  onChange: (value: string) => void;
  onFocusChange: (focused: boolean) => void;
  onEnter: () => void;
  onEscape: () => void;
  onArrowDown: () => void;
}) {
  const t = useT();
  return (
    <div
      className={`relative flex h-12 items-center gap-3 rounded-xl px-1 transition-colors ${
        active ? "bg-zinc-100 ring-1 ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-700" : ""
      }`}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.focus()}
        className={`flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-xl transition-colors ${
          active
            ? "text-zinc-900 dark:text-zinc-100"
            : "bg-zinc-100 text-zinc-600 hover:text-zinc-900 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        }`}
      >
        <MdSearch />
      </button>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onEscape();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onArrowDown();
          }
        }}
        placeholder={t("groups.groupRail.searchPlaceholder")}
        aria-label={t("groups.groupRail.searchPlaceholder")}
        maxLength={100}
        autoComplete="off"
        spellCheck={false}
        className={`min-w-0 flex-1 bg-transparent text-sm text-zinc-950 outline-none transition-opacity duration-150 placeholder:text-zinc-400 dark:text-zinc-50 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {value && open && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange("")}
          aria-label={t("groups.groupsHome.clearSearch")}
          className="mr-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <MdClose className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function EdgeHint({
  direction,
  label,
  onClick,
}: {
  direction: "above" | "below";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`absolute left-1/2 z-20 flex h-5 -translate-x-1/2 cursor-pointer items-center gap-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white shadow-md transition hover:bg-red-500 ${
        direction === "above" ? "top-1" : "bottom-1"
      }`}
    >
      {direction === "above" ? <MdKeyboardArrowUp className="h-3.5 w-3.5" /> : <MdKeyboardArrowDown className="h-3.5 w-3.5" />}@
    </button>
  );
}

/** The "+" at the foot of the dock — asks whether to join a group or create one (see AddGroupDialog). */
function AddGroupTile({ showName }: { showName: boolean }) {
  const t = useT();
  const { openPopup } = useNtPopups();

  return (
    <button
      type="button"
      onClick={() => void openPopup("add_group", { data: {} })}
      aria-label={t("groups.homeGroupsPanel.addGroup")}
      aria-haspopup="dialog"
      className={`${tileBase} group/add hover:bg-zinc-100/70 dark:hover:bg-zinc-900/70`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-xl text-emerald-600 transition group-hover/add:border-emerald-500 group-hover/add:bg-emerald-50 dark:border-zinc-700 dark:group-hover/add:bg-emerald-950/40">
        <MdAdd />
      </span>
      <TileText show={showName}>
        <span className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t("groups.homeGroupsPanel.addGroup")}
        </span>
      </TileText>
    </button>
  );
}

// ─── The right-click menus ──────────────────────────────────────────────

const menuItem =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-900";
const menuCard =
  "flex w-60 flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950";
const menuDivider = <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />;

/** Top, up, down, bottom — for a line among its siblings. */
function MoveItems({ index, total, onMove, act }: { index: number; total: number; onMove: (to: number) => void; act: (fn: () => void) => () => void }) {
  const t = useT();
  return (
    <>
      <button type="button" disabled={index <= 0} onClick={act(() => onMove(0))} className={menuItem}>
        <MdVerticalAlignTop className="h-4 w-4 shrink-0 opacity-70" />
        {t("groups.groupRail.moveToTop")}
      </button>
      <button type="button" disabled={index <= 0} onClick={act(() => onMove(index - 1))} className={menuItem}>
        <MdArrowUpward className="h-4 w-4 shrink-0 opacity-70" />
        {t("groups.groupRail.moveUp")}
        <kbd className="ml-auto text-[10px] text-zinc-400">Alt+↑</kbd>
      </button>
      <button type="button" disabled={index >= total - 1} onClick={act(() => onMove(index + 1))} className={menuItem}>
        <MdArrowDownward className="h-4 w-4 shrink-0 opacity-70" />
        {t("groups.groupRail.moveDown")}
        <kbd className="ml-auto text-[10px] text-zinc-400">Alt+↓</kbd>
      </button>
      <button type="button" disabled={index >= total - 1} onClick={act(() => onMove(total - 1))} className={menuItem}>
        <MdVerticalAlignBottom className="h-4 w-4 shrink-0 opacity-70" />
        {t("groups.groupRail.moveToBottom")}
      </button>
    </>
  );
}

function GroupMenu({
  group,
  siblings,
  organize,
  folders,
  currentFolder,
  onMove,
  onNewFolder,
  onAddTo,
  onRemoveFromFolder,
  onArchive,
  onClose,
}: {
  group: GroupSummary;
  /** The line's level: the top level, or its folder's groups. */
  siblings: readonly string[];
  organize: boolean;
  folders: GroupFolder[];
  currentFolder: GroupFolder | null;
  onMove: (to: number) => void;
  onNewFolder: () => void;
  onAddTo: (folderId: string) => void;
  onRemoveFromFolder: () => void;
  onArchive: (archived: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  // Which of the two copy items has just been used, so only its own label says so.
  const [copied, setCopied] = useState<"link" | "id" | null>(null);
  const [picking, setPicking] = useState(false);
  const hasNews = !group.suspended && (group.unread || group.mentions > 0);
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const shelved = organize && Boolean(group.archived);
  const index = siblings.indexOf(group.id);
  const otherFolders = folders.filter((f) => f.id !== currentFolder?.id);

  return (
    <div className={menuCard}>
      <p className="truncate px-2 pb-1 pt-0.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{group.name}</p>
      <button type="button" disabled={!hasNews} onClick={act(() => void markGroupRead(group.id))} className={menuItem}>
        <MdDoneAll className="h-4 w-4 shrink-0 opacity-70" />
        {t("groups.groupRail.markAsRead")}
      </button>
      <button
        type="button"
        onClick={() => {
          const url = `${window.location.origin}${groupPath(group.id)}`;
          void copyText(url).then((ok) => {
            if (!ok) return;
            setCopied("link");
            setTimeout(onClose, 700);
          });
        }}
        className={menuItem}
      >
        <MdLink className="h-4 w-4 shrink-0 opacity-70" />
        {copied === "link" ? t("common.linkCopied") : t("groups.groupRail.copyLink")}
      </button>
      <button
        type="button"
        onClick={() => {
          void copyText(group.id).then((ok) => {
            if (!ok) return;
            setCopied("id");
            setTimeout(onClose, 700);
          });
        }}
        className={menuItem}
      >
        <MdContentCopy className="h-4 w-4 shrink-0 opacity-70" />
        {copied === "id" ? t("groups.memberMenu.copied") : t("groups.memberMenu.copyId")}
      </button>

      {organize && !shelved && (
        <>
          {menuDivider}
          {picking ? (
            <>
              <p className="px-2 pb-0.5 pt-0.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                {t("groups.organize.moveToFolder")}
              </p>
              {otherFolders.map((folder) => (
                <button key={folder.id} type="button" onClick={act(() => onAddTo(folder.id))} className={menuItem}>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${FOLDER_SWATCH[folderColor(folder.color)]}`} />
                  <span className="truncate">{folder.name || t("groups.organize.folder")}</span>
                </button>
              ))}
              {/* Not act(): the menu stays, turned into the new folder's, to name it. */}
              <button type="button" onClick={onNewFolder} className={menuItem}>
                <MdCreateNewFolder className="h-4 w-4 shrink-0 opacity-70" />
                {t("groups.organize.newFolder")}
              </button>
            </>
          ) : (
            <>
              {otherFolders.length > 0 ? (
                <button type="button" onClick={() => setPicking(true)} className={menuItem}>
                  <MdDriveFileMove className="h-4 w-4 shrink-0 opacity-70" />
                  {t("groups.organize.moveToFolder")}
                  <MdKeyboardArrowDown className="ml-auto h-4 w-4 -rotate-90 opacity-60" />
                </button>
              ) : (
                // Keeps the menu open: the new folder is named right here (see newFolderWith).
                <button type="button" onClick={onNewFolder} className={menuItem}>
                  <MdCreateNewFolder className="h-4 w-4 shrink-0 opacity-70" />
                  {t("groups.organize.newFolder")}
                </button>
              )}
              {currentFolder && (
                <button type="button" onClick={act(onRemoveFromFolder)} className={menuItem}>
                  <MdFolderOff className="h-4 w-4 shrink-0 opacity-70" />
                  {t("groups.organize.removeFromFolder")}
                </button>
              )}
            </>
          )}
        </>
      )}

      {!shelved && (
        <>
          {menuDivider}
          <MoveItems index={index} total={siblings.length} onMove={onMove} act={act} />
        </>
      )}

      {organize && (
        <>
          {menuDivider}
          <button type="button" onClick={act(() => onArchive(!shelved))} className={menuItem}>
            {shelved ? (
              <MdUnarchive className="h-4 w-4 shrink-0 opacity-70" />
            ) : (
              <MdArchive className="h-4 w-4 shrink-0 opacity-70" />
            )}
            {shelved ? t("groups.organize.unarchive") : t("groups.organize.archive")}
          </button>
          {!shelved && (
            <p className="px-2 pt-0.5 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
              {t("groups.organize.archiveHint")}
            </p>
          )}
        </>
      )}

      {!organize && <p className="px-2 pt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{t("groups.groupRail.dragHint")}</p>}
    </div>
  );
}

function FolderMenu({
  folder,
  groups,
  index,
  total,
  startRenaming,
  onMove,
  onRename,
  onColor,
  onUngroup,
  onClose,
}: {
  folder: GroupFolder;
  groups: GroupSummary[];
  index: number;
  total: number;
  startRenaming: boolean;
  onMove: (to: number) => void;
  onRename: (name: string) => void;
  onColor: (color: FolderColor) => void;
  onUngroup: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!startRenaming) return;
    // After the menu's own entrance, or the focus lands on a box still moving.
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 60);
    return () => clearTimeout(timer);
  }, [startRenaming]);
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const commitName = () => {
    if (name.trim() !== folder.name) onRename(name);
  };
  const hasNews = groups.some((g) => !g.suspended && (g.unread || g.mentions > 0));
  const current = folderColor(folder.color);

  return (
    <div className={menuCard}>
      <label className="px-2 pt-0.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400" htmlFor={`folder-name-${folder.id}`}>
        {t("groups.organize.folderName")}
      </label>
      <input
        id={`folder-name-${folder.id}`}
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitName();
            onClose();
          }
        }}
        maxLength={32}
        placeholder={t("groups.organize.folder")}
        className="mx-1 mb-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />
      <div role="radiogroup" aria-label={t("groups.organize.folderColor")} className="flex flex-wrap gap-1.5 px-2 pb-1.5">
        {FOLDER_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={color === current}
            aria-label={color}
            onClick={() => onColor(color)}
            className={`h-5 w-5 cursor-pointer rounded-full ${FOLDER_SWATCH[color]} transition ${
              color === current ? "ring-2 ring-zinc-950 ring-offset-2 ring-offset-white dark:ring-zinc-50 dark:ring-offset-zinc-950" : "hover:scale-110"
            }`}
          />
        ))}
      </div>
      {menuDivider}
      <button
        type="button"
        disabled={!hasNews}
        onClick={act(() => {
          for (const g of groups) if (g.unread || g.mentions > 0) void markGroupRead(g.id);
        })}
        className={menuItem}
      >
        <MdDoneAll className="h-4 w-4 shrink-0 opacity-70" />
        {t("groups.organize.markFolderRead")}
      </button>
      <button type="button" onClick={act(onUngroup)} className={menuItem}>
        <MdFolder className="h-4 w-4 shrink-0 opacity-70" />
        {t("groups.organize.ungroup")}
      </button>
      {menuDivider}
      <MoveItems index={index} total={total} onMove={onMove} act={act} />
    </div>
  );
}

"use client";

import Tippy from "@tippyjs/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import useNtPopups from "ntpopups";
import {
  MdAdd,
  MdAlternateEmail,
  MdArrowDownward,
  MdArrowUpward,
  MdClose,
  MdContentCopy,
  MdDoneAll,
  MdGroups,
  MdHeadsetMic,
  MdKeyboardArrowDown,
  MdKeyboardArrowUp,
  MdKeyboardDoubleArrowLeft,
  MdKeyboardDoubleArrowRight,
  MdSearch,
  MdVerticalAlignBottom,
  MdVerticalAlignTop,
} from "react-icons/md";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupLink } from "@/components/groups/GroupLink";
import { GroupName } from "@/components/groups/GroupName";
import { nameMatches, searchWords, setGroupsHomeQuery } from "@/components/groups/groupSearch";
import { groupPath } from "@/lib/groupLinks";
import { useGroupNavigation } from "@/lib/groupNavigation";
import type { GroupSummary } from "@/lib/groupsApi";
import { useGroupVoiceSession } from "@/lib/groupVoiceSession";
import { markGroupRead, prefetchGroup, reorderGroups, useMyGroups } from "@/lib/useGroups";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useT } from "@/lib/useI18n";

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
//   - you were mentioned: an "@n" tag on the icon — and the "@" tile at the top
//     jumps to the next group holding one, with hints at the list's edges when
//     one is scrolled out of sight;
//   - you are in a call there: a headset on the icon.
//
// The order is the person's own, saved on the server (see lib/useGroups'
// reorderGroups), so every list of groups on the site follows it. Rearranged
// by dragging a tile (a long press on a touchscreen), by Alt+↑/↓ on a focused
// tile, or from the tile's right-click menu.

/** A tile's height, and the step from one tile to the next. */
const TILE_PX = 48;
const PITCH_PX = 54;
/** The list's own padding above its first tile. */
const LIST_PAD_PX = 8;
/** How far the pointer moves before a press becomes a drag. */
const DRAG_SLOP_PX = 4;
/** How long a finger holds a tile before it can be dragged. */
const TOUCH_HOLD_MS = 380;
/** How long the pointer has to stand still on the dock before the names slide out. */
const REST_DELAY_MS = 650;
const EXPANDED_KEY = "golive:groups:railExpanded";
const XL_QUERY = "(min-width: 80rem)";

type Drag = { id: string; from: number; to: number; top: number };

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function mentionLabel(t: ReturnType<typeof useT>, mentions: number): string {
  return mentions === 1
    ? t("groups.homeGroupsPanel.n1Mention")
    : t("groups.homeGroupsPanel.mentionsMentions", { mentions });
}

export function GroupRail({ activeGroupId }: { activeGroupId: string | null }) {
  const t = useT();
  const { groups } = useMyGroups();
  const navigation = useGroupNavigation();
  const voice = useGroupVoiceSession();
  const isXl = useMediaQuery(XL_QUERY);

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

  // ── The list, and where the mentions are in it ─────────────────────────
  const [drag, setDragState] = useState<Drag | null>(null);
  // The same, readable from the window's listeners without waiting on a render.
  const dragRef = useRef<Drag | null>(null);
  const setDrag = useCallback((next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  }, []);
  const list = groups ?? [];
  const ids = list.map((g) => g.id);
  // What is drawn: every group, or the ones the search matches. Rearranging
  // is off while searching — "one place up" means nothing in a filtered list.
  const visible = filtering ? list.filter((g) => nameMatches(g.name, words)) : list;
  const shownIds = drag ? moved(ids, drag.from, drag.to) : visible.map((g) => g.id);
  const slotOf = new Map(shownIds.map((id, i) => [id, i]));

  const mentioned = list.filter((g) => !g.suspended && g.mentions > 0);
  const totalMentions = mentioned.reduce((n, g) => n + g.mentions, 0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [hints, setHints] = useState({ above: false, below: false });
  const mentionIndexes = visible
    .map((g, i) => (!g.suspended && g.mentions > 0 ? i : -1))
    .filter((i) => i >= 0)
    .join(",");
  const updateHints = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const indexes = mentionIndexes ? mentionIndexes.split(",").map(Number) : [];
    const above = indexes.some((i) => LIST_PAD_PX + i * PITCH_PX + TILE_PX <= el.scrollTop + 4);
    const below = indexes.some((i) => LIST_PAD_PX + i * PITCH_PX >= el.scrollTop + el.clientHeight - 4);
    setHints((h) => (h.above === above && h.below === below ? h : { above, below }));
  }, [mentionIndexes]);
  useLayoutEffect(() => {
    updateHints();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHints);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateHints]);

  function scrollToIndex(index: number) {
    const el = scrollRef.current;
    if (!el) return;
    const top = LIST_PAD_PX + index * PITCH_PX;
    if (top < el.scrollTop) el.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
    else if (top + TILE_PX > el.scrollTop + el.clientHeight)
      el.scrollTo({ top: top + TILE_PX - el.clientHeight + 8, behavior: "smooth" });
  }

  function scrollToHint(direction: "above" | "below") {
    const el = scrollRef.current;
    if (!el) return;
    const indexes = mentionIndexes.split(",").map(Number);
    const target =
      direction === "above"
        ? [...indexes].reverse().find((i) => LIST_PAD_PX + i * PITCH_PX + TILE_PX <= el.scrollTop + 4)
        : indexes.find((i) => LIST_PAD_PX + i * PITCH_PX >= el.scrollTop + el.clientHeight - 4);
    if (target !== undefined) scrollToIndex(target);
  }

  /** The next group after the open one that holds a mention, round the end. */
  function jumpToNextMention() {
    if (mentioned.length === 0) return;
    const activeIndex = list.findIndex((g) => g.id === activeGroupId);
    const next =
      list.find((g, i) => i > activeIndex && !g.suspended && g.mentions > 0) ?? mentioned[0];
    if (filtering) setSearch("");
    else scrollToIndex(list.indexOf(next));
    navigation.push(groupPath(next.id));
  }

  /** Out of the search: the field emptied and let go, so the dock can fold away. */
  function endSearch() {
    setSearch("");
    searchRef.current?.blur();
  }

  function openFirstMatch() {
    const first = visible[0];
    if (!first) return;
    endSearch();
    navigation.push(groupPath(first.id));
  }

  /** The same words, looked for among public groups on /groups. */
  function searchPublicGroups() {
    const text = search.trim();
    endSearch();
    setGroupsHomeQuery(text);
    navigation.push("/groups");
  }

  // ── Rearranging ────────────────────────────────────────────────────────
  const [announcement, setAnnouncement] = useState("");
  const refocusId = useRef<string | null>(null);
  useEffect(() => {
    const id = refocusId.current;
    if (!id) return;
    refocusId.current = null;
    scrollRef.current?.querySelector<HTMLElement>(`[data-rail-group="${CSS.escape(id)}"]`)?.focus();
  });

  function moveGroup(id: string, to: number) {
    const from = ids.indexOf(id);
    const target = Math.max(0, Math.min(ids.length - 1, to));
    if (from < 0 || from === target) return;
    reorderGroups(moved(ids, from, target));
    const group = list[from];
    setAnnouncement(
      t("groups.groupRail.movedToPosition", { name: group.name, position: target + 1, total: ids.length })
    );
    scrollToIndex(target);
  }

  const press = useRef<{
    id: string;
    pointerId: number;
    touch: boolean;
    startY: number;
    startScroll: number;
    lastY: number;
    started: boolean;
    holdTimer: ReturnType<typeof setTimeout> | null;
    frame: number | null;
  } | null>(null);
  const suppressClick = useRef(false);
  // The handlers the window listens to while a press is on, kept in a ref so
  // the very functions added are the ones removed.
  const handlers = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    key: (e: KeyboardEvent) => void;
    touchMove: (e: TouchEvent) => void;
  } | null>(null);
  const idsRef = useRef(ids);
  useLayoutEffect(() => {
    idsRef.current = ids;
  });

  const place = useCallback(() => {
    const p = press.current;
    const el = scrollRef.current;
    if (!p || !p.started || !el) return;
    const count = idsRef.current.length;
    // Looked up again each time: the list can change under a drag (a group
    // joined or left on another device).
    const from = idsRef.current.indexOf(p.id);
    if (from < 0) return;
    const raw = from * PITCH_PX + (p.lastY - p.startY) + (el.scrollTop - p.startScroll);
    const top = Math.max(0, Math.min((count - 1) * PITCH_PX, raw));
    const to = Math.round(top / PITCH_PX);
    setDrag({ id: p.id, from, to, top });
  }, [setDrag]);

  const endPress = useCallback((commit: boolean) => {
    const p = press.current;
    if (!p) return;
    if (p.holdTimer) clearTimeout(p.holdTimer);
    if (p.frame !== null) cancelAnimationFrame(p.frame);
    const h = handlers.current;
    if (h) {
      window.removeEventListener("pointermove", h.move);
      window.removeEventListener("pointerup", h.up);
      window.removeEventListener("pointercancel", h.up);
      window.removeEventListener("keydown", h.key, true);
      window.removeEventListener("touchmove", h.touchMove);
    }
    press.current = null;
    if (!p.started) return;
    document.body.style.userSelect = "";
    // The click that follows the release is the end of the drag, not a visit.
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    const current = dragRef.current;
    setDrag(null);
    if (commit && current && current.from !== current.to) {
      reorderGroups(moved(idsRef.current, current.from, current.to));
    }
  }, [setDrag]);

  const startDrag = useCallback(() => {
    const p = press.current;
    if (!p || p.started) return;
    p.started = true;
    p.startScroll = scrollRef.current?.scrollTop ?? 0;
    document.body.style.userSelect = "none";
    // Near an edge of the list, it scrolls under the tile being carried.
    const tick = () => {
      const current = press.current;
      const el = scrollRef.current;
      if (!current || !el) return;
      const rect = el.getBoundingClientRect();
      const edge = 36;
      let delta = 0;
      if (current.lastY < rect.top + edge) delta = -Math.ceil((rect.top + edge - current.lastY) / 5);
      else if (current.lastY > rect.bottom - edge) delta = Math.ceil((current.lastY - rect.bottom + edge) / 5);
      if (delta !== 0) el.scrollTop += delta;
      place();
      current.frame = requestAnimationFrame(tick);
    };
    p.frame = requestAnimationFrame(tick);
    place();
  }, [place]);

  function onTilePointerDown(e: ReactPointerEvent<HTMLAnchorElement>, id: string) {
    if (e.button !== 0 || press.current || filtering) return;
    const touch = e.pointerType !== "mouse";
    press.current = {
      id,
      pointerId: e.pointerId,
      touch,
      startY: e.clientY,
      startScroll: scrollRef.current?.scrollTop ?? 0,
      lastY: e.clientY,
      started: false,
      holdTimer: touch ? setTimeout(startDrag, TOUCH_HOLD_MS) : null,
      frame: null,
    };
    const move = (ev: PointerEvent) => {
      const p = press.current;
      if (!p || ev.pointerId !== p.pointerId) return;
      p.lastY = ev.clientY;
      if (p.started) return;
      const distance = Math.abs(ev.clientY - p.startY);
      if (!p.touch && distance > DRAG_SLOP_PX) startDrag();
      // A finger that moves before the hold is up is scrolling, not dragging.
      else if (p.touch && distance > 8) endPress(false);
    };
    const up = (ev: PointerEvent) => {
      if (press.current && ev.pointerId === press.current.pointerId) endPress(ev.type === "pointerup");
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && press.current?.started) {
        ev.preventDefault();
        ev.stopPropagation();
        endPress(false);
      }
    };
    const touchMove = (ev: TouchEvent) => {
      if (press.current?.started) ev.preventDefault();
    };
    handlers.current = { move, up, key, touchMove };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key, true);
    window.addEventListener("touchmove", touchMove, { passive: false });
  }

  useEffect(() => () => endPress(false), [endPress]);

  function onTileKeyDown(e: ReactKeyboardEvent<HTMLAnchorElement>, id: string, index: number) {
    if (!e.altKey || filtering || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    refocusId.current = id;
    moveGroup(id, index + (e.key === "ArrowUp" ? -1 : 1));
  }

  // ── The right-click menu ───────────────────────────────────────────────
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
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
  const menuGroup = menu ? list.find((g) => g.id === menu.id) ?? null : null;

  // Every move starts the wait over, so only a pointer that stops on the dock
  // opens it; once open, moving about inside it keeps it open.
  function onDockMove() {
    if (expanded || peek || press.current) return;
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(true), REST_DELAY_MS);
  }
  function onDockLeave() {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    // Not while a tile is being carried: the names folding away under it
    // would be the dock moving under the pointer.
    if (!press.current?.started) setPeek(false);
  }
  useEffect(() => {
    if (!drag && peek && panel && !panel.matches(":hover")) setPeek(false);
  }, [drag, peek, panel]);
  useEffect(() => () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
  }, []);

  const railWidth = expanded ? "w-60" : "w-[70px]";

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
        {/* The fixed tiles: the search, every group, and the way to the next mention. */}
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
            onArrowDown={() => scrollRef.current?.querySelector<HTMLElement>("[data-rail-group]")?.focus()}
          />
          <RailTile
            active={activeGroupId === null}
            showName={showNames}
            label={t("groups.groupSwitcher.allGroups")}
            href="/groups"
            face={
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-xl text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <MdGroups />
              </span>
            }
          />
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
            ) : (
              <ul
                className="relative"
                style={{ height: visible.length ? (visible.length - 1) * PITCH_PX + TILE_PX : 0 }}
              >
                {visible.map((group, index) => {
                  const dragging = drag?.id === group.id;
                  const y = dragging ? drag.top : (slotOf.get(group.id) ?? index) * PITCH_PX;
                  return (
                    <li
                      key={group.id}
                      className={`absolute inset-x-0 top-0 ${dragging ? "z-10" : "transition-transform duration-150 ease-out"}`}
                      style={{ height: TILE_PX, transform: `translateY(${y}px)` }}
                    >
                      <GroupTile
                        group={group}
                        active={group.id === activeGroupId}
                        inCall={voice?.groupId === group.id}
                        showName={showNames}
                        dragging={dragging}
                        onPointerDown={(e) => onTilePointerDown(e, group.id)}
                        onKeyDown={(e) => onTileKeyDown(e, group.id, index)}
                        onClick={(e) => {
                          if (suppressClick.current) e.preventDefault();
                          else if (filtering) endSearch();
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          // A long press on a touchscreen is the start of a drag.
                          if (press.current?.touch) return;
                          setMenu({ id: group.id, x: e.clientX, y: e.clientY });
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            {filtering && groups !== null && (
              <div className={`flex flex-col gap-2 px-1 ${visible.length > 0 ? "pt-3" : ""}`}>
                {visible.length === 0 && (
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
          visible={Boolean(menuGroup)}
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
                index={ids.indexOf(menuGroup.id)}
                total={ids.length}
                onMove={(to) => moveGroup(menuGroup.id, to)}
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
  showName,
  active = false,
  href,
  onClick,
}: {
  face: ReactNode;
  label: string;
  sublabel?: string;
  showName: boolean;
  active?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const className = `${tileBase} ${
    active ? "bg-zinc-100 dark:bg-zinc-900" : "hover:bg-zinc-100/70 dark:hover:bg-zinc-900/70"
  }`;
  const body = (
    <>
      <span className="shrink-0">{face}</span>
      <TileText show={showName}>
        <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
        {sublabel && <span className="truncate text-xs text-red-600 dark:text-red-400">{sublabel}</span>}
      </TileText>
      <ActiveBar active={active} />
    </>
  );
  const tile = href ? (
    <GroupLink href={href} aria-label={label} aria-current={active ? "page" : undefined} className={className}>
      {body}
    </GroupLink>
  ) : (
    <button type="button" onClick={onClick} aria-label={sublabel ? `${label} — ${sublabel}` : label} className={className}>
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
  onPointerDown,
  onKeyDown,
  onClick,
  onContextMenu,
}: {
  group: GroupSummary;
  active: boolean;
  inCall: boolean;
  showName: boolean;
  dragging: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLAnchorElement>) => void;
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
  const label = [group.name, status].filter(Boolean).join(" — ");

  return (
    <GroupLink
      href={groupPath(group.id)}
      data-rail-group={group.id}
      draggable={false}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onPointerDown={onPointerDown}
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
      }`}
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
          <span className="absolute -bottom-1 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center gap-px rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-zinc-950">
            <span className="opacity-80">@</span>
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
                : mentions > 0
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

// ─── The right-click menu ───────────────────────────────────────────────

function GroupMenu({
  group,
  index,
  total,
  onMove,
  onClose,
}: {
  group: GroupSummary;
  index: number;
  total: number;
  onMove: (to: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const item =
    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-900";
  const hasNews = !group.suspended && (group.unread || group.mentions > 0);
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div className="flex w-56 flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
      <p className="truncate px-2 pb-1 pt-0.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{group.name}</p>
      <button type="button" disabled={!hasNews} onClick={act(() => void markGroupRead(group.id))} className={item}>
        <MdDoneAll className="h-4 w-4 shrink-0 opacity-70" />
        {t("groups.groupRail.markAsRead")}
      </button>
      <button
        type="button"
        onClick={() => {
          const url = `${window.location.origin}${groupPath(group.id)}`;
          void navigator.clipboard?.writeText(url).then(() => {
            setCopied(true);
            setTimeout(onClose, 700);
          });
        }}
        className={item}
      >
        <MdContentCopy className="h-4 w-4 shrink-0 opacity-70" />
        {copied ? t("common.linkCopied") : t("groups.groupRail.copyLink")}
      </button>
      <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
      <button type="button" disabled={index <= 0} onClick={act(() => onMove(0))} className={item}>
        <MdVerticalAlignTop className="h-4 w-4 shrink-0 opacity-70" />
        {t("groups.groupRail.moveToTop")}
      </button>
      <button type="button" disabled={index <= 0} onClick={act(() => onMove(index - 1))} className={item}>
        <MdArrowUpward className="h-4 w-4 shrink-0 opacity-70" />
        {t("groups.groupRail.moveUp")}
        <kbd className="ml-auto text-[10px] text-zinc-400">Alt+↑</kbd>
      </button>
      <button type="button" disabled={index >= total - 1} onClick={act(() => onMove(index + 1))} className={item}>
        <MdArrowDownward className="h-4 w-4 shrink-0 opacity-70" />
        {t("groups.groupRail.moveDown")}
        <kbd className="ml-auto text-[10px] text-zinc-400">Alt+↓</kbd>
      </button>
      <button type="button" disabled={index >= total - 1} onClick={act(() => onMove(total - 1))} className={item}>
        <MdVerticalAlignBottom className="h-4 w-4 shrink-0 opacity-70" />
        {t("groups.groupRail.moveToBottom")}
      </button>
      <p className="px-2 pt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{t("groups.groupRail.dragHint")}</p>
    </div>
  );
}

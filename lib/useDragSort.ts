"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

// Rearranging a vertical list by dragging one of its lines — the rail's
// groups and folders, the groups inside a folder, the home page's panel, the
// phone's list of groups.
//
// The lines are measured from the page when the drag starts, so they can be of
// any height (a folder open with its groups is one tall line among short ones).
// While the drag is on, the line being carried follows the pointer and the
// others step out of its way by its height; nothing in the list's own order
// changes until it is dropped, when `onMove(from, to)` is the whole answer.
//
// How a drag starts, from the rail where this was first worked out:
//   - a mouse: pressing and moving past a few pixels;
//   - a finger: holding still on the line for a moment (moving first is
//     scrolling, and the drag never starts);
// Escape puts it back. The click that ends a drag is swallowed, so dropping a
// link where it was is not also a visit. Near the top or bottom of `scrollRef`
// the list scrolls under the line being carried.
//
// Lists inside lists (a folder's groups inside the rail): the innermost list
// whose line was pressed takes the press, and the lists around it let it be.

const MOUSE_SLOP_PX = 4;
const TOUCH_SLOP_PX = 8;
const TOUCH_HOLD_MS = 380;
const EDGE_PX = 36;

/** Marks a native event as already taken by an inner list. */
const CLAIMED = Symbol("dragSortClaimed");

export interface DragState {
  id: string;
  from: number;
  to: number;
  /** How far the line has travelled from where it was, in px. */
  dy: number;
  /** How far the others step aside: the carried line's height and the gap after it. */
  step: number;
}

interface Press {
  id: string;
  pointerId: number;
  touch: boolean;
  startY: number;
  lastY: number;
  startScroll: number;
  started: boolean;
  holdTimer: ReturnType<typeof setTimeout> | null;
  frame: number | null;
  /** Each line's top and height when the drag began, relative to the list, in list order. */
  tops: number[];
  heights: number[];
  gap: number;
}

export interface DragSort {
  drag: DragState | null;
  /** Spread on each line's own element. */
  itemProps: (id: string) => {
    "data-sort-id": string;
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onClickCapture: (e: ReactMouseEvent<HTMLElement>) => void;
    style: CSSProperties;
  };
  /** Whether the press on now is a finger's — a long press there is a drag, not a menu. */
  touchPressing: () => boolean;
}

export function useDragSort({
  ids,
  listRef,
  scrollRef,
  onMove,
  disabled = false,
}: {
  ids: readonly string[];
  /** The element whose direct children carry `data-sort-id`. */
  listRef: RefObject<HTMLElement | null>;
  /** What scrolls, if anything does — for scrolling under the line and keeping up with it. */
  scrollRef?: RefObject<HTMLElement | null>;
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
}): DragSort {
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const setDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  }, []);
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);
  const idsRef = useRef(ids);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    idsRef.current = ids;
    onMoveRef.current = onMove;
  });
  const handlers = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    key: (e: KeyboardEvent) => void;
    touchMove: (e: TouchEvent) => void;
  } | null>(null);

  const scrollTop = () => scrollRef?.current?.scrollTop ?? 0;

  const place = useCallback(() => {
    const p = press.current;
    if (!p || !p.started) return;
    const from = idsRef.current.indexOf(p.id);
    if (from < 0) return;
    const dy = p.lastY - p.startY + (scrollTop() - p.startScroll);
    const mid = p.tops[from] + p.heights[from] / 2 + dy;
    let to = from;
    for (let j = 0; j < p.tops.length; j += 1) {
      if (j === from) continue;
      const otherMid = p.tops[j] + p.heights[j] / 2;
      if (j < from && mid < otherMid) to = Math.min(to, j);
      if (j > from && mid > otherMid) to = Math.max(to, j);
    }
    // Kept inside the list: the carried line goes no further than the first
    // or last place there is.
    const first = p.tops[0] ?? 0;
    const last = (p.tops[p.tops.length - 1] ?? 0) + (p.heights[p.heights.length - 1] ?? 0) - p.heights[from];
    const clamped = Math.max(first - p.tops[from], Math.min(last - p.tops[from], dy));
    setDrag({ id: p.id, from, to, dy: clamped, step: p.heights[from] + p.gap });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollRef is a ref
  }, [setDrag]);

  const endPress = useCallback(
    (commit: boolean) => {
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
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      const current = dragRef.current;
      setDrag(null);
      if (commit && current && current.from !== current.to) onMoveRef.current(current.from, current.to);
    },
    [setDrag]
  );

  const startDrag = useCallback(() => {
    const p = press.current;
    const list = listRef.current;
    if (!p || p.started || !list) return;
    // Measured now, in list order, relative to the list — scroll included, so
    // scrolling mid-drag is a matter of adding the difference.
    const base = list.getBoundingClientRect().top;
    const lines = idsRef.current.map((id) =>
      list.querySelector<HTMLElement>(`:scope > [data-sort-id="${CSS.escape(id)}"]`)
    );
    if (lines.some((el) => !el)) return;
    p.tops = lines.map((el) => el!.getBoundingClientRect().top - base);
    p.heights = lines.map((el) => el!.getBoundingClientRect().height);
    p.gap = p.tops.length > 1 ? Math.max(0, p.tops[1] - p.tops[0] - p.heights[0]) : 0;
    p.started = true;
    p.startScroll = scrollTop();
    document.body.style.userSelect = "none";
    const tick = () => {
      const current = press.current;
      if (!current) return;
      const scroller = scrollRef?.current;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        let delta = 0;
        if (current.lastY < rect.top + EDGE_PX) delta = -Math.ceil((rect.top + EDGE_PX - current.lastY) / 5);
        else if (current.lastY > rect.bottom - EDGE_PX) delta = Math.ceil((current.lastY - rect.bottom + EDGE_PX) / 5);
        if (delta !== 0) scroller.scrollTop += delta;
      }
      place();
      current.frame = requestAnimationFrame(tick);
    };
    p.frame = requestAnimationFrame(tick);
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs
  }, [place]);

  useEffect(() => () => endPress(false), [endPress]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, id: string) => {
      const native = e.nativeEvent as PointerEvent & { [CLAIMED]?: boolean };
      if (native[CLAIMED]) return;
      // Inside a field or a button that is not the line itself, the press is that control's.
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [data-no-drag]")) return;
      // Taken before anything else is decided: a press on a line of an inner
      // list belongs to that list even when it cannot move (one group alone in
      // a folder), and must not become a drag of the folder around it.
      native[CLAIMED] = true;
      if (disabled || e.button !== 0 || press.current || idsRef.current.length < 2) return;
      const touch = e.pointerType !== "mouse";
      press.current = {
        id,
        pointerId: e.pointerId,
        touch,
        startY: e.clientY,
        lastY: e.clientY,
        startScroll: scrollTop(),
        started: false,
        holdTimer: touch ? setTimeout(startDrag, TOUCH_HOLD_MS) : null,
        frame: null,
        tops: [],
        heights: [],
        gap: 0,
      };
      const move = (ev: PointerEvent) => {
        const p = press.current;
        if (!p || ev.pointerId !== p.pointerId) return;
        p.lastY = ev.clientY;
        if (p.started) return;
        const distance = Math.abs(ev.clientY - p.startY);
        if (!p.touch && distance > MOUSE_SLOP_PX) startDrag();
        else if (p.touch && distance > TOUCH_SLOP_PX) endPress(false);
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs
    [disabled, startDrag, endPress]
  );

  const styleFor = (id: string): CSSProperties => {
    const d = drag;
    if (!d) return {};
    const index = ids.indexOf(id);
    if (id === d.id) {
      return { transform: `translateY(${d.dy}px)`, zIndex: 20, position: "relative" };
    }
    let shift = 0;
    if (d.from < d.to && index > d.from && index <= d.to) shift = -d.step;
    if (d.from > d.to && index >= d.to && index < d.from) shift = d.step;
    return {
      transform: shift ? `translateY(${shift}px)` : undefined,
      transition: "transform 150ms ease-out",
      position: "relative",
    };
  };

  return {
    drag,
    itemProps: (id: string) => ({
      "data-sort-id": id,
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => onPointerDown(e, id),
      onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
        if (suppressClick.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      style: styleFor(id),
    }),
    touchPressing: () => Boolean(press.current?.touch),
  };
}

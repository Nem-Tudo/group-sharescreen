"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { haptic } from "@/lib/nativeApp";

// The two gestures a phone expects from a chat, in one place: drag a message
// to the left to answer it, hold it to open its menu.
//
// Both chats — the messages window and a group's text channel — drew their
// actions as small icons that appear on hover, which is a pointer a phone
// does not have. Answering a message there meant hitting a 14px arrow that
// only shows up while a finger is already on the message, and the menu behind
// the right button had no way in at all. So the row itself becomes the
// control: the same two gestures every phone chat has trained people to try.
//
// Touch only. A mouse keeps the hover actions and the right button, which are
// better than either of these, and a trackpad's inertia would otherwise fire
// "responder" on an ordinary two-finger scroll.
//
// Scrolling is left to the browser: the row is `touch-action: pan-y`, so the
// vertical drag that scrolls the thread never reaches us and the horizontal
// one never scrolls it. That is also why nothing here calls preventDefault on
// the move — React's touchmove listener is passive and could not anyway.

/** How long a finger has to rest before the menu opens. */
const LONG_PRESS_MS = 450;

/** How far it may drift in that time and still count as held still. */
const HOLD_TOLERANCE = 10;

/** Past this, the drag has a direction and the press is off. */
const DIRECTION_LOCK = 8;

/** Drag at least this far to answer. */
const REPLY_THRESHOLD = 56;

/** The row never moves further than this, however far the finger goes. */
const MAX_PULL = 84;

/**
 * A long press on Android raises `contextmenu` a moment after our own timer
 * has already opened the menu. Module-level, because the row the second event
 * lands on is not always the one that opened it.
 */
let swallowContextMenuUntil = 0;

export interface MessageGestures {
  /** Spread on the message row — it replaces the row's own onContextMenu. */
  handlers: {
    onTouchStart: (e: ReactTouchEvent) => void;
    onTouchMove: (e: ReactTouchEvent) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
    onContextMenu: (e: ReactMouseEvent) => void;
  };
  /** Everything the row needs to follow the finger, ready to spread. */
  style: CSSProperties;
  /** 0 to 1, how close letting go is to answering — for the arrow behind. */
  progress: number;
  /** How far the row is pulled, in px, so the arrow can stay put as it goes. */
  pull: number;
  /** Past the threshold: letting go now answers. */
  armed: boolean;
  /** Whether any of this is on, so a row can skip drawing the arrow at all. */
  touch: boolean;
}

/** The query itself, made once: every message row in the log subscribes to it. */
let coarseQuery: MediaQueryList | null = null;

function pointerQuery(): MediaQueryList | null {
  if (typeof window === "undefined") return null;
  coarseQuery ??= window.matchMedia?.("(pointer: coarse)") ?? null;
  return coarseQuery;
}

function subscribeCoarse(onChange: () => void): () => void {
  const query = pointerQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** Whether this is a finger rather than a mouse, kept live for a tablet with both. */
function useCoarsePointer(): boolean {
  // False on the server and on the first client render, so the markup matches
  // and only then picks up the real answer.
  return useSyncExternalStore(
    subscribeCoarse,
    () => pointerQuery()?.matches ?? false,
    () => false
  );
}

export function useMessageGestures({
  onReply,
  onMenu,
}: {
  /** Left off where there is nothing to answer — a message still sending. */
  onReply?: () => void;
  /** The row's own menu. Also what the right button opens on a desktop. */
  onMenu?: (event: ReactMouseEvent) => void;
}): MessageGestures {
  const touch = useCoarsePointer();
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const armedRef = useRef(false);
  const gesture = useRef<{
    x: number;
    y: number;
    axis: "none" | "x" | "y";
    timer: number | null;
  } | null>(null);

  // A row can leave while a finger is on it (a message deleted from the other
  // side), and a timer that outlives it would open a menu for nothing.
  useEffect(() => {
    return () => {
      const timer = gesture.current?.timer;
      if (timer !== null && timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  function cancelPress() {
    const current = gesture.current;
    if (!current) return;
    if (current.timer !== null) {
      window.clearTimeout(current.timer);
      current.timer = null;
    }
  }

  function reset() {
    cancelPress();
    gesture.current = null;
    armedRef.current = false;
    setDragging(false);
    setPull(0);
  }

  function openMenuAt(target: EventTarget | null, clientX: number, clientY: number) {
    // What openContextMenu reads off an event, and nothing more — the menus
    // in both chats look at `target` (a link, a picture) and at the point.
    onMenu?.({
      target,
      clientX,
      clientY,
      preventDefault: () => {},
      stopPropagation: () => {},
    } as unknown as ReactMouseEvent);
  }

  function onTouchStart(e: ReactTouchEvent) {
    // A second finger is a pinch or a scroll, not either of these.
    if (e.touches.length !== 1) {
      reset();
      return;
    }
    const point = e.touches[0];
    const target = e.target;
    const timer = onMenu
      ? window.setTimeout(() => {
          const current = gesture.current;
          if (!current || current.axis === "x") return;
          current.timer = null;
          // Nothing else happens on this finger once the menu is up.
          current.axis = "y";
          swallowContextMenuUntil = Date.now() + 1000;
          haptic("confirm");
          openMenuAt(target, point.clientX, point.clientY);
        }, LONG_PRESS_MS)
      : null;
    gesture.current = { x: point.clientX, y: point.clientY, axis: "none", timer };
  }

  function onTouchMove(e: ReactTouchEvent) {
    const current = gesture.current;
    if (!current || e.touches.length !== 1) return;
    const point = e.touches[0];
    const dx = point.clientX - current.x;
    const dy = point.clientY - current.y;

    if (current.axis === "none") {
      if (Math.abs(dx) > HOLD_TOLERANCE || Math.abs(dy) > HOLD_TOLERANCE) cancelPress();
      // Which way this drag is going is decided once and then kept: a thumb
      // travelling up the thread wobbles sideways, and a row that answered
      // because of the wobble would be a scroll that opened the composer.
      if (Math.abs(dy) > DIRECTION_LOCK && Math.abs(dy) >= Math.abs(dx)) {
        current.axis = "y";
        return;
      }
      if (onReply && dx < -DIRECTION_LOCK && Math.abs(dx) > Math.abs(dy)) {
        current.axis = "x";
        setDragging(true);
      } else {
        return;
      }
    }
    if (current.axis !== "x") return;

    // Left only, and heavier past the threshold: the row stops keeping up
    // with the finger, which says far enough without a word.
    const travelled = Math.max(0, -dx);
    const next =
      travelled <= REPLY_THRESHOLD
        ? travelled
        : Math.min(MAX_PULL, REPLY_THRESHOLD + (travelled - REPLY_THRESHOLD) * 0.35);
    const armed = travelled >= REPLY_THRESHOLD;
    // Once, as it crosses — the same tick a phone keyboard gives.
    if (armed && !armedRef.current) haptic("tap");
    armedRef.current = armed;
    setPull(next);
  }

  function onTouchEnd() {
    const armed = armedRef.current && gesture.current?.axis === "x";
    reset();
    if (armed) onReply?.();
  }

  function onContextMenu(e: ReactMouseEvent) {
    // The one the long press already answered.
    if (Date.now() < swallowContextMenuUntil) {
      e.preventDefault();
      return;
    }
    onMenu?.(e);
  }

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: reset, onContextMenu },
    style: touch
      ? {
          transform: pull > 0 ? `translateX(-${pull}px)` : undefined,
          transition: dragging ? "none" : "transform 160ms ease-out",
          touchAction: "pan-y",
          // No magnifier and no "copiar" bubble over a message being held:
          // the menu the hold opens has copying in it.
          WebkitTouchCallout: "none",
        }
      : {},
    progress: Math.min(1, pull / REPLY_THRESHOLD),
    pull,
    // The dampening past the threshold means the pull itself says this, and
    // a ref would be a value read during a render it cannot cause.
    armed: pull >= REPLY_THRESHOLD,
    touch,
  };
}

"use client";

import { useEffect, useRef } from "react";

// A drag from left to right across the page opens what lives to its left — on
// a phone in a group, the group's rooms (see GroupAppShell). The gesture every
// chat app with a channel list has trained people to try.
//
// Native, passive listeners on the element: nothing here ever blocks the
// page's own scroll. The decision is made when the finger lifts, so a vertical
// scroll that wanders sideways a little never opens anything.
//
// Left alone, so the gesture never steals a drag that belongs to something else:
// - a second finger (a pinch);
// - what is typed into (moving the caret, selecting text);
// - anything that scrolls sideways and is not already at its left edge (a
//   strip of faces, a wide code block) — at the left edge a drag to the right
//   has nothing left to reveal there, so it is ours;
// - anything marked `data-no-swipe-nav`.

/** Past this the drag has a direction. */
const DIRECTION_LOCK = 10;
/** A slow drag has to travel this far to count. */
const OPEN_DISTANCE = 70;
/** A flick counts from this far... */
const FLICK_DISTANCE = 35;
/** ...when it moves at least this fast (px/ms). */
const FLICK_SPEED = 0.45;

function startsOnSomethingElse(target: EventTarget | null, root: HTMLElement): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== root) {
    if (el instanceof HTMLElement) {
      if (el.dataset.noSwipeNav !== undefined) return true;
      if (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
        return true;
      }
      if (el.scrollWidth > el.clientWidth + 1 && el.scrollLeft > 0) {
        const overflowX = getComputedStyle(el).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

export function useSwipeToOpen(
  element: HTMLElement | null,
  enabled: boolean,
  onOpen: () => void
): void {
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  useEffect(() => {
    if (!element || !enabled) return;
    let gesture: { x: number; y: number; t: number; dx: number; dy: number; axis: "none" | "x" } | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || startsOnSomethingElse(e.target, element)) {
        gesture = null;
        return;
      }
      const touch = e.touches[0];
      gesture = { x: touch.clientX, y: touch.clientY, t: performance.now(), dx: 0, dy: 0, axis: "none" };
    };
    const onMove = (e: TouchEvent) => {
      if (!gesture) return;
      if (e.touches.length !== 1) {
        gesture = null;
        return;
      }
      const touch = e.touches[0];
      gesture.dx = touch.clientX - gesture.x;
      gesture.dy = touch.clientY - gesture.y;
      if (gesture.axis === "none" && Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) > DIRECTION_LOCK) {
        // Up, down or to the left: somebody else's gesture (a scroll, a reply).
        if (gesture.dx <= 0 || Math.abs(gesture.dy) >= gesture.dx) {
          gesture = null;
          return;
        }
        gesture.axis = "x";
      }
    };
    const onEnd = () => {
      const g = gesture;
      gesture = null;
      if (!g || g.axis !== "x") return;
      // Stayed mostly sideways the whole way.
      if (Math.abs(g.dy) > g.dx * 0.6) return;
      // A long press that went on to select text in a message.
      if (window.getSelection()?.isCollapsed === false) return;
      const speed = g.dx / Math.max(1, performance.now() - g.t);
      if (g.dx >= OPEN_DISTANCE || (g.dx >= FLICK_DISTANCE && speed >= FLICK_SPEED)) onOpenRef.current();
    };
    const onCancel = () => {
      gesture = null;
    };

    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: true });
    element.addEventListener("touchend", onEnd, { passive: true });
    element.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onCancel);
    };
  }, [element, enabled]);
}

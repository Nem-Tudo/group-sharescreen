"use client";

// Renders only the rows a scrolling list actually has on screen.
//
// The participant list and a group's member column both build one DOM
// subtree per person, unconditionally. That is fine at a dozen and is not at
// six hundred: every re-render walks the whole list, and every row carries
// its own avatar, badges, menu trigger and — until the shared detector took
// it over — its own audio metering. What is off screen costs exactly as much
// as what is in front of you.
//
// Written here rather than pulled in as a dependency for the reasons the rest
// of lib/ is: two call sites, near-uniform row heights, and the index
// arithmetic is small enough to pin with a test (see useWindowedList.test.mts).
// If sticky section headers and variable heights ever outgrow this,
// @tanstack/react-virtual is the headless one to reach for.

import { useCallback, useEffect, useRef, useState } from "react";

export type WindowPlan = {
  /** First row to render, inclusive. */
  start: number;
  /** Last row to render, exclusive. */
  end: number;
  /** Spacer above, in px, so the scrollbar behaves as if all rows were there. */
  topPad: number;
  /** Spacer below, in px. */
  bottomPad: number;
  /** False when the whole list is being rendered, which is the small case. */
  windowed: boolean;
};

/**
 * Row heights, either uniform or as a prefix sum.
 *
 * The prefix-sum form is an array of `count + 1` offsets where `offsets[i]` is
 * the y of row i and the last entry is the total height — which is exactly
 * what a list of two or three known row shapes can build in one pass.
 */
export type RowMetrics = number | Float64Array;

// Rows kept rendered beyond each edge, so scrolling does not expose a gap
// before the next frame fills it.
const DEFAULT_OVERSCAN = 6;

// Below this many rows the arithmetic is pure overhead and the whole list is
// rendered, byte for byte as it was before. Small rooms change in no way.
const DEFAULT_THRESHOLD = 60;

// Used only until a ResizeObserver has measured the real container. Picking
// something plausible rather than zero means the first paint shows a sensible
// window instead of one row or the entire list.
const ASSUMED_VIEWPORT = 600;

/** Index of the last offset that is <= `y`, by binary search. */
function rowAt(offsets: Float64Array, y: number, count: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Which rows to render for a given scroll position.
 *
 * Pure, so the arithmetic can be tested without a DOM — which is the whole
 * reason it is split out from the hook below.
 */
export function planWindow(opts: {
  count: number;
  rowHeight: RowMetrics;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
  threshold?: number;
}): WindowPlan {
  const { count, rowHeight, scrollTop } = opts;
  const overscan = opts.overscan ?? DEFAULT_OVERSCAN;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;

  if (count <= 0) {
    return { start: 0, end: 0, topPad: 0, bottomPad: 0, windowed: false };
  }
  if (count <= threshold) {
    return { start: 0, end: count, topPad: 0, bottomPad: 0, windowed: false };
  }

  const viewport = opts.viewportHeight > 0 ? opts.viewportHeight : ASSUMED_VIEWPORT;
  // A container scrolled past its own content (bouncing on a trackpad, or a
  // list that just shrank) must not produce a negative index.
  const top = Math.max(0, scrollTop);

  if (typeof rowHeight === "number") {
    if (rowHeight <= 0) {
      return { start: 0, end: count, topPad: 0, bottomPad: 0, windowed: false };
    }
    const last = Math.min(count, Math.ceil((top + viewport) / rowHeight) + overscan);
    // Clamped against `last`, not just against zero: a container scrolled
    // clean past its own content puts the unclamped first index beyond the
    // end of the list, which inverts the range and renders a negative slice.
    const first = Math.min(Math.max(0, Math.floor(top / rowHeight) - overscan), last);
    return {
      start: first,
      end: last,
      topPad: first * rowHeight,
      bottomPad: (count - last) * rowHeight,
      windowed: true,
    };
  }

  // Prefix-sum form. Guarded rather than trusted: a caller whose offsets are
  // the wrong length would otherwise read past the end and window to nothing.
  if (rowHeight.length < count + 1) {
    return { start: 0, end: count, topPad: 0, bottomPad: 0, windowed: false };
  }
  const total = rowHeight[count];
  let last = rowAt(rowHeight, top + viewport, count) + 1 + overscan;
  if (last > count) last = count;
  const first = Math.min(Math.max(0, rowAt(rowHeight, top, count) - overscan), last);
  return {
    start: first,
    end: last,
    topPad: rowHeight[first],
    bottomPad: total - rowHeight[last],
    windowed: true,
  };
}

/**
 * Watches a scrolling container and says which rows to render.
 *
 * Attach `scrollRef` to the element that scrolls, render `items.slice(start,
 * end)` inside a wrapper padded by `topPad` / `bottomPad`, and the scrollbar
 * behaves exactly as it would with every row present.
 */
export function useWindowedList(opts: {
  count: number;
  rowHeight: RowMetrics;
  overscan?: number;
  threshold?: number;
}): WindowPlan & { scrollRef: (el: HTMLElement | null) => void } {
  const { count, rowHeight, overscan, threshold } = opts;
  const [view, setView] = useState({ scrollTop: 0, viewportHeight: 0 });
  const frame = useRef<number | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      cleanup.current?.();
    };
  }, []);

  const scrollRef = useCallback((el: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;

    // Coalesced through a frame. A trackpad fires scroll events far faster
    // than the screen refreshes, and a setState per event is the classic way
    // virtualization ends up slower than rendering everything.
    const measure = () => {
      frame.current = null;
      setView((prev) =>
        prev.scrollTop === el.scrollTop && prev.viewportHeight === el.clientHeight
          ? prev
          : { scrollTop: el.scrollTop, viewportHeight: el.clientHeight }
      );
    };
    const schedule = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(measure);
    };

    el.addEventListener("scroll", schedule, { passive: true });
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(el);
    // Once up front: the container has a height before anything scrolls, and
    // without this the first paint would size its window from the assumption.
    schedule();

    cleanup.current = () => {
      el.removeEventListener("scroll", schedule);
      observer?.disconnect();
    };
  }, []);

  const plan = planWindow({
    count,
    rowHeight,
    scrollTop: view.scrollTop,
    viewportHeight: view.viewportHeight,
    overscan,
    threshold,
  });

  return { ...plan, scrollRef };
}

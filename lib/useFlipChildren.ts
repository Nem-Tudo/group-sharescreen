"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// Tiles that walk to their new place instead of jumping there (FLIP: first,
// last, invert, play). When somebody starts or stops sharing, the room's grid
// recomputes its columns and every tile lands somewhere else in one frame;
// this remembers where each one was and animates it from there.
//
// Only transforms and opacity move, through the Web Animations API, so no
// element is re-created — a <video> keeps playing straight through it.
// Positions are read with offsetLeft/Top/Width/Height, which ignore
// transforms, so a reading taken mid-animation is still the real layout.
//
// Children that are `display: contents` (VideoTile's root) stand for their
// first child, which is the box actually in the grid.
//
// What changed is read from `keyRef` rather than taken as an argument: the
// room computes its tiles well after the point where it may still call hooks
// (it has early returns), so it fills the ref in during render and this
// effect, which runs after the render, compares it with the last one.

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

type Box = { x: number; y: number; w: number; h: number };

function itemsOf(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const items: HTMLElement[] = [];
  for (const child of Array.from(container.children)) {
    const box = getComputedStyle(child).display === "contents" ? child.firstElementChild : child;
    if (box instanceof HTMLElement) items.push(box);
  }
  return items;
}

function boxOf(el: HTMLElement): Box {
  return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
}

export function useFlipChildren(
  ref: RefObject<HTMLElement | null>,
  keyRef: RefObject<string>,
  enabled: boolean
) {
  const boxes = useRef(new WeakMap<Element, Box>());
  const lastKey = useRef<string | null>(null);

  // Every render, but it returns at once unless the set of tiles changed: a
  // resize re-lays the grid too, and that one should follow the window, not
  // lag behind it.
  useLayoutEffect(() => {
    if (!enabled) {
      lastKey.current = null;
      return;
    }
    if (keyRef.current === lastKey.current) return;
    lastKey.current = keyRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const item of itemsOf(ref.current)) {
      const next = boxOf(item);
      const prev = boxes.current.get(item);
      boxes.current.set(item, next);
      if (reduce || next.w === 0 || next.h === 0) continue;
      if (!prev) {
        item.animate(
          [
            { opacity: 0, transform: "scale(0.97)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 220, easing: EASE }
        );
        continue;
      }
      const dx = prev.x - next.x;
      const dy = prev.y - next.y;
      const sx = prev.w / next.w;
      const sy = prev.h / next.h;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
      item.animate(
        [
          { transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transformOrigin: "top left", transform: "none" },
        ],
        { duration: 260, easing: EASE }
      );
    }
  });

  // Between changes the grid still moves (the window, the side panel), so the
  // remembered places are kept current without animating anything. The grid
  // comes and goes with the room's layout (an empty stage, a focused tile),
  // so the observer follows whichever element the ref holds right now.
  const observed = useRef<{ el: HTMLElement; observer: ResizeObserver; frame: number } | null>(null);
  useLayoutEffect(() => {
    const el = enabled ? ref.current : null;
    if (observed.current?.el === el) return;
    if (observed.current) {
      observed.current.observer.disconnect();
      cancelAnimationFrame(observed.current.frame);
      observed.current = null;
    }
    if (!el || typeof ResizeObserver === "undefined") return;
    const entry = {
      el,
      frame: 0,
      observer: new ResizeObserver(() => {
        cancelAnimationFrame(entry.frame);
        entry.frame = requestAnimationFrame(() => {
          for (const item of itemsOf(el)) boxes.current.set(item, boxOf(item));
        });
      }),
    };
    entry.observer.observe(el);
    observed.current = entry;
  });
  useEffect(
    () => () => {
      observed.current?.observer.disconnect();
      if (observed.current) cancelAnimationFrame(observed.current.frame);
    },
    []
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// A row that keeps sliding left forever, for lists that grow while it runs
// (the thank-you wall's subscribers arrive a page at a time).
//
// Not the usual "the list twice, translated by its own width" loop: that one
// jumps whenever the list grows. Here the first item, once fully off the left
// edge, is moved to the end and the row is shifted back by its width — in the
// same frame, before paint — so new items simply join the queue. `onNeedMore`
// is called when the row is about to come round to items it has shown.
//
// A list narrower than the row just sits still. With less motion asked for,
// the row is a plain horizontal scroller (and scrolling to its end asks for
// more).

const GAP = 16;

export function Ticker<T>({
  items,
  itemKey,
  render,
  speed = 40,
  onNeedMore,
}: {
  items: T[];
  itemKey: (item: T) => string;
  render: (item: T) => ReactNode;
  /** Pixels per second. */
  speed?: number;
  onNeedMore?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(0);
  const [moving, setMoving] = useState(false);
  const [reduced, setReduced] = useState(false);
  const offset = useRef(0);
  const shift = useRef(0);
  const paused = useRef(false);
  const visible = useRef(false);
  const shown = useRef(0);
  const n = items.length;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  // Moves only when the list is wider than the row.
  useEffect(() => {
    const el = box.current;
    const inner = track.current;
    if (!el || !inner) return;
    const check = () => setMoving(!reduced && inner.scrollWidth > el.clientWidth + 8);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [n, reduced]);

  // Runs only while on screen.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => (visible.current = entry.isIntersecting), { rootMargin: "100px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!moving) {
      offset.current = 0;
      if (track.current) track.current.style.transform = "";
      return;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const inner = track.current;
      if (inner && visible.current && !paused.current && shift.current === 0) {
        offset.current -= speed * dt;
        const first = inner.firstElementChild as HTMLElement | null;
        if (first && -offset.current > first.offsetWidth + GAP) {
          // Rotated in the next render; the layout effect below applies the shift.
          shift.current = first.offsetWidth + GAP;
          setStart((s) => s + 1);
        } else {
          inner.style.transform = `translate3d(${offset.current}px,0,0)`;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [moving, speed]);

  useLayoutEffect(() => {
    if (shift.current === 0) return;
    offset.current += shift.current;
    shift.current = 0;
    if (track.current) track.current.style.transform = `translate3d(${offset.current}px,0,0)`;
    shown.current += 1;
    // Coming round to the start of what is loaded: ask for the next page.
    if (onNeedMore && n - (shown.current % Math.max(1, n)) < 20) onNeedMore();
  }, [start, n, onNeedMore]);

  // A short list may be asked to grow right away (it may be the first page of many).
  useEffect(() => {
    if (onNeedMore && n > 0 && n < 20) onNeedMore();
  }, [n, onNeedMore]);

  const first = n ? start % n : 0;
  const ordered = moving ? [...items.slice(first), ...items.slice(0, first)] : items;

  return (
    <div
      ref={box}
      className={reduced ? "overflow-x-auto pb-2" : "overflow-hidden"}
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (reduced && onNeedMore && el.scrollLeft + el.clientWidth > el.scrollWidth - 200) onNeedMore();
      }}
    >
      <div ref={track} className={`flex w-max ${moving ? "" : "mx-auto"}`} style={{ gap: GAP, willChange: moving ? "transform" : undefined }}>
        {ordered.map((item) => (
          <div key={itemKey(item)} className="shrink-0">
            {render(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

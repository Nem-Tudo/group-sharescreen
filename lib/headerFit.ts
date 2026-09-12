"use client";

// How much of a group's top bar fits on one line, decided by measuring it.
//
// The bar holds three clusters: the group on the left, the call's controls in
// the middle, and on the right the room's page buttons plus the group's own
// (invite, notifications, account). It was a three-column grid whose side
// columns could shrink to nothing, so on a narrow screen the right cluster
// simply kept its width and slid over the middle one — buttons drawn on top
// of each other.
//
// No breakpoint fixes that, because how wide the bar has to be depends on
// things no stylesheet knows: how long the group's name is, whether music is
// on, whether an update is waiting, whether this is an account or a guest. So
// it is measured, and given way in steps:
//
//   0  everything at full size;
//   1  the labels go and the icons stay (see [data-header-label]);
//   2  the call's controls move to a line of their own under the rest — the
//      same arrangement the bar already uses below lg.
//
// Stepping back up needs the bar to be as wide as the step last proved it
// needs, which is what stops it flicking between two steps at a width that
// fits one and not the other.

import { useEffect, useRef, useState } from "react";

export type HeaderFit = 0 | 1 | 2;

/** The width each step was last measured to need, learned when it overflowed. */
export type FitMemory = { full: number; compact: number };

/**
 * The next step, given how the bar measures now. Pure, so the stepping — and
 * above all the not-flickering — can be tested without a page.
 */
export function nextHeaderFit(
  fit: HeaderFit,
  measure: { width: number; needed: number },
  memory: FitMemory
): { fit: HeaderFit; memory: FitMemory } {
  // A pixel of slack: subpixel layout makes "exactly fits" read as a hair over.
  const overflowing = measure.needed > measure.width + 1;
  if (fit === 0) {
    return overflowing ? { fit: 1, memory: { ...memory, full: measure.needed } } : { fit, memory };
  }
  if (fit === 1) {
    if (overflowing) return { fit: 2, memory: { ...memory, compact: measure.needed } };
    if (measure.width >= memory.full) return { fit: 0, memory };
    return { fit, memory };
  }
  // Two lines cannot overflow for want of width in the way one can; the only
  // question is whether there is room to come back up.
  if (measure.width >= memory.compact) return { fit: 1, memory };
  return { fit, memory };
}

/**
 * Watches the bar's row and the clusters whose content can change, and says
 * which step it is on.
 *
 * `row` is the element the three clusters sit in; `watched` are the ones that
 * grow when something is added to them (a room's buttons arriving, music being
 * put on), since that changes what fits without the window changing at all.
 * `active` is false whenever the call's controls are not in the bar — below lg,
 * or with no call — and then there is nothing to fit.
 */
export function useHeaderFit(
  row: HTMLElement | null,
  watched: (HTMLElement | null)[],
  active: boolean
): HeaderFit {
  const [fit, setFit] = useState<HeaderFit>(0);
  const memory = useRef<FitMemory>({ full: 0, compact: 0 });
  // The watched elements, by identity, as one dependency.
  const [first, second] = watched;

  useEffect(() => {
    if (!row || !active || typeof ResizeObserver === "undefined") return;
    const evaluate = () => {
      setFit((current) => {
        // The row's own scroll width is what the content asks for: when the
        // columns cannot shrink any further the grid spills past its box.
        const next = nextHeaderFit(
          current,
          { width: row.clientWidth, needed: row.scrollWidth },
          memory.current
        );
        memory.current = next.memory;
        return next.fit;
      });
    };
    const observer = new ResizeObserver(evaluate);
    observer.observe(row);
    if (first) observer.observe(first);
    if (second) observer.observe(second);
    evaluate();
    return () => observer.disconnect();
  }, [row, first, second, active]);

  // Nothing to fit while the controls are not in the bar. Read here rather
  // than written back with setState, so turning the call off (or the window
  // below lg) is an instant full-size bar with no effect in between.
  return active ? fit : 0;
}

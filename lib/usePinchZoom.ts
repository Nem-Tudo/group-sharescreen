"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Pinch-to-zoom for a <video> inside a fullscreen tile on a touchscreen.
//
// The browser's own pinch zooms the *page*, and a fullscreen element is not a
// page you can scroll around — on Android Chrome the gesture does nothing at
// all inside fullscreen. So the gesture is handled here and turned into a
// transform on the video itself, which is what lets somebody actually read
// the small print on a screen share from a phone.
//
// Two things force this to be a hook with native listeners rather than
// `onTouchMove` props on the element:
//
//   1. React attaches touch listeners at the root as *passive*, so
//      `preventDefault()` from a React handler is ignored — and without it
//      the browser runs its own pan/zoom underneath ours.
//   2. A pinch fires dozens of moves a second. Writing the transform straight
//      onto the node keeps that off React's render path entirely; only the
//      zoom *level* (which a badge shows) is state, and it only changes when
//      the rounded value does.

const MIN_SCALE = 1;
const MAX_SCALE = 5;
// Below this the zoom is indistinguishable from none, and letting it rest at
// 1.02 would leave the picture subtly off and the reset badge showing "1x".
const SNAP_BACK_BELOW = 1.05;
// How far one finger has to travel before it counts as a pan rather than a
// tap — the same slop every scroller uses, so a slightly shaky tap still
// reveals the controls instead of nudging the picture.
const PAN_SLOP_PX = 8;

type Transform = { scale: number; x: number; y: number };

type PinchStart = {
  distance: number;
  midX: number;
  midY: number;
  // The content point under the fingers when the pinch began, in unscaled
  // pixels from the centre — held fixed under them as the gesture runs, which
  // is what makes zooming feel anchored rather than always centred.
  anchorX: number;
  anchorY: number;
};

type PanStart = { pointerX: number; pointerY: number; originX: number; originY: number };

function distanceBetween(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function usePinchZoom({
  containerRef,
  videoRef,
  enabled,
}: {
  // Where the gesture is listened for — the fullscreen box.
  containerRef: React.RefObject<HTMLElement | null>;
  // What gets transformed. Only the video moves; the controls layered over it
  // are siblings, so they stay put and stay the right size.
  videoRef: React.RefObject<HTMLVideoElement | null>;
  // Off outside fullscreen, where the tile is one cell of a grid and hijacking
  // the page's own scroll gesture would be actively wrong.
  enabled: boolean;
}) {
  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  // Set by any gesture that moved something, and read by the tile's tap
  // handler so the click a one-finger pan leaves behind doesn't also toggle
  // the controls. The reader clears it.
  const gestureRef = useRef(false);

  const applyTransform = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const { scale: s, x, y } = transformRef.current;
    video.style.transform = s === 1 && x === 0 && y === 0 ? "" : `translate3d(${x}px, ${y}px, 0) scale(${s})`;
  }, [videoRef]);

  const reset = useCallback(() => {
    transformRef.current = { scale: 1, x: 0, y: 0 };
    applyTransform();
    setScale(1);
  }, [applyTransform]);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) {
      reset();
      return;
    }

    let pinch: PinchStart | null = null;
    let pan: PanStart | null = null;

    // How far the picture may be dragged before its edge would come inside
    // the screen. Worked out from the *picture*, not the element: an
    // object-contain video is letterboxed inside its box, and clamping to the
    // box would let somebody drag the image off into the black bars.
    function maxOffset(atScale: number): { x: number; y: number } {
      const el = containerRef.current;
      const video = videoRef.current;
      if (!el || !video) return { x: 0, y: 0 };
      const boxW = el.clientWidth;
      const boxH = el.clientHeight;
      const intrinsicW = video.videoWidth || boxW;
      const intrinsicH = video.videoHeight || boxH;
      const fit = Math.min(boxW / intrinsicW, boxH / intrinsicH);
      const drawnW = intrinsicW * fit * atScale;
      const drawnH = intrinsicH * fit * atScale;
      return {
        x: Math.max(0, (drawnW - boxW) / 2),
        y: Math.max(0, (drawnH - boxH) / 2),
      };
    }

    function commit(next: Transform) {
      const bounds = maxOffset(next.scale);
      transformRef.current = {
        scale: next.scale,
        x: clamp(next.x, -bounds.x, bounds.x),
        y: clamp(next.y, -bounds.y, bounds.y),
      };
      applyTransform();
      // Only when the number a person could see actually changes — a pinch
      // fires this on every frame and re-rendering the tile each time would
      // undo the point of writing the transform imperatively.
      setScale((current) =>
        Math.round(current * 10) === Math.round(transformRef.current.scale * 10)
          ? current
          : transformRef.current.scale
      );
    }

    function beginPinch(a: Touch, b: Touch) {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const centreX = rect.left + rect.width / 2;
      const centreY = rect.top + rect.height / 2;
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      const { scale: s, x, y } = transformRef.current;
      pinch = {
        distance: Math.max(1, distanceBetween(a, b)),
        midX,
        midY,
        anchorX: (midX - centreX - x) / s,
        anchorY: (midY - centreY - y) / s,
      };
      pan = null;
    }

    function beginPan(touch: Touch) {
      // Only when there is something to pan. At 1x a one-finger drag is not a
      // gesture this owns — it has to stay a plain tap so the controls keep
      // working.
      if (transformRef.current.scale <= 1) return;
      pan = {
        pointerX: touch.clientX,
        pointerY: touch.clientY,
        originX: transformRef.current.x,
        originY: transformRef.current.y,
      };
    }

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length === 1) {
        // First finger down starts a fresh sequence, so whatever the last one
        // was is forgotten here rather than left to swallow this tap. A pinch
        // usually ends without producing a click at all, so the flag it sets
        // would otherwise still be standing when the next real tap arrives.
        gestureRef.current = false;
        beginPan(event.touches[0]);
        return;
      }
      if (event.touches.length >= 2) {
        beginPinch(event.touches[0], event.touches[1]);
        gestureRef.current = true;
        event.preventDefault();
      }
    }

    function onTouchMove(event: TouchEvent) {
      const el = containerRef.current;
      if (!el) return;

      if (pinch && event.touches.length >= 2) {
        event.preventDefault();
        const [a, b] = [event.touches[0], event.touches[1]];
        const rect = el.getBoundingClientRect();
        const centreX = rect.left + rect.width / 2;
        const centreY = rect.top + rect.height / 2;
        const nextScale = clamp(
          (transformRef.current.scale * distanceBetween(a, b)) / pinch.distance,
          MIN_SCALE,
          MAX_SCALE
        );
        const midX = (a.clientX + b.clientX) / 2;
        const midY = (a.clientY + b.clientY) / 2;
        // Solved from the anchor: the point that was under the fingers stays
        // under them, which also makes a two-finger drag pan for free.
        commit({
          scale: nextScale,
          x: midX - centreX - pinch.anchorX * nextScale,
          y: midY - centreY - pinch.anchorY * nextScale,
        });
        // Re-based every frame so the next one measures against what is on
        // screen now rather than compounding the whole gesture's error.
        pinch = {
          ...pinch,
          distance: Math.max(1, distanceBetween(a, b)),
          midX,
          midY,
          anchorX: (midX - centreX - transformRef.current.x) / transformRef.current.scale,
          anchorY: (midY - centreY - transformRef.current.y) / transformRef.current.scale,
        };
        return;
      }

      if (pan && event.touches.length === 1) {
        const touch = event.touches[0];
        const dx = touch.clientX - pan.pointerX;
        const dy = touch.clientY - pan.pointerY;
        if (!gestureRef.current && Math.hypot(dx, dy) < PAN_SLOP_PX) return;
        gestureRef.current = true;
        event.preventDefault();
        commit({ scale: transformRef.current.scale, x: pan.originX + dx, y: pan.originY + dy });
      }
    }

    function onTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) pinch = null;
      if (event.touches.length === 1) {
        // A pinch that let go of one finger becomes a drag rather than
        // stopping dead.
        beginPan(event.touches[0]);
        return;
      }
      if (event.touches.length === 0) {
        pan = null;
        // Anything this close to 1x is meant to be 1x — otherwise letting go
        // mid-pinch leaves the picture a hair off-centre with no way back
        // except pinching it out and in again.
        if (transformRef.current.scale < SNAP_BACK_BELOW) reset();
        else commit(transformRef.current);
      }
    }

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd);
    container.addEventListener("touchcancel", onTouchEnd);
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
      // Leaving fullscreen puts the tile back in a grid where a zoomed,
      // panned picture would just be a broken-looking cell.
      reset();
    };
  }, [enabled, containerRef, videoRef, applyTransform, reset]);

  return {
    /** Current zoom, for the badge that shows it and offers a way back. */
    scale,
    isZoomed: scale > 1,
    reset,
    /**
     * True when the touch sequence that just ended moved the picture. The
     * tile's tap handler reads it (and clears it) so the click a one-finger
     * pan leaves behind doesn't also toggle the controls.
     */
    consumeGesture(): boolean {
      const moved = gestureRef.current;
      gestureRef.current = false;
      return moved;
    },
  };
}

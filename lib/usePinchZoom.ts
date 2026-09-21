"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  NO_ORIENTATION,
  orientationFitScale,
  orientationTransform,
  type Orientation,
} from "./tileOrientation";

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
  zoomEnabled = false,
  mirrored = false,
  orientation,
}: {
  // Where the gesture is listened for — the fullscreen box.
  containerRef: React.RefObject<HTMLElement | null>;
  // What gets transformed. Only the video moves; the controls layered over it
  // are siblings, so they stay put and stay the right size.
  videoRef: React.RefObject<HTMLVideoElement | null>;
  // Off outside fullscreen, where the tile is one cell of a grid and hijacking
  // the page's own scroll gesture would be actively wrong.
  enabled: boolean;
  // Zoom driven by something other than the fingers — the slider a mouse gets
  // (see VideoTile's ZoomSlider), plus dragging the zoomed picture around
  // with the pointer. On wherever that slider is: a tile on the stage, in
  // hyperfocus, or in fullscreen. Separate from `enabled` because the two
  // answer different questions — this one never touches the touch gestures,
  // which stay fullscreen-only.
  zoomEnabled?: boolean;
  // Flip the picture left-to-right — our own front camera, shown the way a
  // mirror (and every camera app) shows it. Lives here because this hook owns
  // the video's transform: a separate flip would be overwritten by a pinch,
  // or would flip the pan along with the picture.
  mirrored?: boolean;
  // "Girar/inverter" (see lib/tileOrientation.ts): the quarter turn and the
  // flips this viewer — or the broadcaster — put on this tile. Here for the
  // same reason `mirrored` is: this hook owns the video's transform, and a
  // second one written from the tile would be gone by the next pinch frame.
  orientation?: Orientation;
}) {
  const mirroredRef = useRef(mirrored);
  const orientationRef = useRef<Orientation>(orientation ?? NO_ORIENTATION);
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
    const o = orientationRef.current;
    // The mirror of our own front camera and a flip somebody asked for are
    // the same operation, so they cancel out rather than stacking up.
    const flipX = o.flipX !== mirroredRef.current;
    // A quarter-turned picture is as tall as it was wide, so it has to be
    // scaled back into the box — see orientationFitScale.
    const container = containerRef.current;
    const fit = orientationFitScale(
      o.rotation,
      container?.clientWidth ?? 0,
      container?.clientHeight ?? 0,
      video.videoWidth,
      video.videoHeight
    );
    // The turn and the flips go innermost, so they move the picture without
    // moving the pinch/pan maths, which all happen in screen space around it.
    const inner = orientationTransform({ ...o, flipX }, fit);
    video.style.transform =
      s === 1 && x === 0 && y === 0
        ? inner
        : `translate3d(${x}px, ${y}px, 0) scale(${s}) ${inner}`.trim();
  }, [videoRef, containerRef]);

  useEffect(() => {
    mirroredRef.current = mirrored;
    applyTransform();
  }, [mirrored, applyTransform]);

  useEffect(() => {
    orientationRef.current = orientation ?? NO_ORIENTATION;
    applyTransform();
  }, [orientation, applyTransform]);

  // The fit above is measured from the box and from the picture's own size,
  // so it has to be worked out again whenever either changes — a tile
  // resized by the grid, or a stream whose dimensions only arrive with its
  // metadata. Only while the picture is actually turned: for everything else
  // the transform does not depend on any of it.
  const rotated = (orientation?.rotation ?? 0) % 180 !== 0;
  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!rotated || !container || !video) return;
    const observer = new ResizeObserver(() => applyTransform());
    observer.observe(container);
    video.addEventListener("loadedmetadata", applyTransform);
    video.addEventListener("resize", applyTransform);
    return () => {
      observer.disconnect();
      video.removeEventListener("loadedmetadata", applyTransform);
      video.removeEventListener("resize", applyTransform);
    };
  }, [rotated, containerRef, videoRef, applyTransform]);

  const reset = useCallback(() => {
    transformRef.current = { scale: 1, x: 0, y: 0 };
    applyTransform();
    setScale(1);
  }, [applyTransform]);

  // How far the picture may be dragged before its edge would come inside
  // the screen. Worked out from the *picture*, not the element: an
  // object-contain video is letterboxed inside its box, and clamping to the
  // box would let somebody drag the image off into the black bars.
  const maxOffset = useCallback(
    function maxOffset(atScale: number): { x: number; y: number } {
      const el = containerRef.current;
      const video = videoRef.current;
      if (!el || !video) return { x: 0, y: 0 };
      const boxW = el.clientWidth;
      const boxH = el.clientHeight;
      const intrinsicW = video.videoWidth || boxW;
      const intrinsicH = video.videoHeight || boxH;
      const fit = Math.min(boxW / intrinsicW, boxH / intrinsicH);
      // A quarter-turned picture is drawn with its sides swapped (and scaled
      // back into the box), which is what decides how far it may be dragged.
      const turned = orientationRef.current.rotation % 180 !== 0;
      const turnFit = orientationFitScale(
        orientationRef.current.rotation,
        boxW,
        boxH,
        intrinsicW,
        intrinsicH
      );
      const baseW = (turned ? intrinsicH : intrinsicW) * fit * turnFit;
      const baseH = (turned ? intrinsicW : intrinsicH) * fit * turnFit;
      const drawnW = baseW * atScale;
      const drawnH = baseH * atScale;
      return {
        x: Math.max(0, (drawnW - boxW) / 2),
        y: Math.max(0, (drawnH - boxH) / 2),
      };
    },
    [containerRef, videoRef]
  );

  const commit = useCallback(
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
    },
    [applyTransform, maxOffset]
  );

  // The slider's side of the same maths: the zoom changes about the middle of
  // the box, and whatever the picture was panned to is pulled along with it —
  // so zooming back out never leaves it stuck off in a corner.
  const setZoom = useCallback(
    (next: number) => {
      const target = clamp(next, MIN_SCALE, MAX_SCALE);
      const current = transformRef.current;
      if (target <= MIN_SCALE) {
        transformRef.current = { scale: MIN_SCALE, x: 0, y: 0 };
        applyTransform();
        setScale(MIN_SCALE);
        return;
      }
      const ratio = target / current.scale;
      commit({ scale: target, x: current.x * ratio, y: current.y * ratio });
    },
    [applyTransform, commit]
  );

  // Nothing to zoom any more — the tile left the stage, or fullscreen closed
  // behind it and no slider is left. A zoomed, panned picture back in a grid
  // cell is just a broken-looking tile, so it goes back to fitting. Written
  // as a cleanup rather than a plain "if": this has to fire on the way *out*
  // of being zoomable, not on every render that is not.
  useEffect(() => {
    if (!enabled && !zoomEnabled) return;
    return () => {
      reset();
    };
  }, [enabled, zoomEnabled, reset]);

  // Dragging the zoomed picture around with the mouse. The touch side of this
  // lives in the pinch handlers below; a pointer needs its own because it has
  // no second finger to say "this is a gesture, not a click", so it starts
  // only on the picture itself (never on a control layered over it) and only
  // once there is something to pan.
  useEffect(() => {
    const video = videoRef.current;
    if ((!enabled && !zoomEnabled) || !video) return;
    let pan: PanStart | null = null;
    let pointerId: number | null = null;

    function onPointerDown(event: PointerEvent) {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      if (transformRef.current.scale <= 1) return;
      gestureRef.current = false;
      pan = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        originX: transformRef.current.x,
        originY: transformRef.current.y,
      };
      pointerId = event.pointerId;
    }

    function onPointerMove(event: PointerEvent) {
      if (!pan || event.pointerId !== pointerId) return;
      const dx = event.clientX - pan.pointerX;
      const dy = event.clientY - pan.pointerY;
      if (!gestureRef.current && Math.hypot(dx, dy) < PAN_SLOP_PX) return;
      if (!gestureRef.current) {
        gestureRef.current = true;
        // Captured only once it really is a drag, so a plain click on the
        // picture still reaches the tile's own handler.
        video?.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      commit({ scale: transformRef.current.scale, x: pan.originX + dx, y: pan.originY + dy });
    }

    function onPointerUp(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      if (video?.hasPointerCapture(event.pointerId)) video.releasePointerCapture(event.pointerId);
      pan = null;
      pointerId = null;
    }

    video.addEventListener("pointerdown", onPointerDown);
    video.addEventListener("pointermove", onPointerMove);
    video.addEventListener("pointerup", onPointerUp);
    video.addEventListener("pointercancel", onPointerUp);
    return () => {
      video.removeEventListener("pointerdown", onPointerDown);
      video.removeEventListener("pointermove", onPointerMove);
      video.removeEventListener("pointerup", onPointerUp);
      video.removeEventListener("pointercancel", onPointerUp);
    };
  }, [enabled, zoomEnabled, videoRef, commit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) return;

    let pinch: PinchStart | null = null;
    let pan: PanStart | null = null;

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
    };
    // Leaving fullscreen puts the tile back in a grid where a zoomed, panned
    // picture would just be a broken-looking cell — that reset is the effect
    // above, which also knows whether a slider is still there to keep the
    // zoom for (a tile on the stage).
  }, [enabled, containerRef, videoRef, commit, reset]);

  return {
    /** Current zoom, for the badge that shows it and offers a way back. */
    scale,
    isZoomed: scale > 1,
    reset,
    /** The slider's ends, so the control never invents its own. */
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    /** Zoom straight to a level — what the slider moves. */
    setZoom,
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

"use client";

import { useEffect } from "react";

// The height the app shells size against on iOS, published as `--app-h`.
//
// layout.tsx's `interactiveWidget: "resizes-content"` is what makes the
// keyboard shrink the page (and every dvh) on Android. iOS ignores it: there
// the keyboard slides over the page, 100dvh stays the full screen, and a
// fixed-height shell (the room, the groups, a full-screen dialog) keeps its
// composer underneath the keyboard. The visual viewport is the one thing iOS
// does shrink, so its height is measured here and globals.css reads it with
// 100dvh as the fallback: `height: var(--app-h, 100dvh)`.
//
// Only on iOS. Everywhere else the variable is never set, the fallback
// applies, and nothing changes.

type ViewportLike = { height: number; scale: number };

/**
 * The visual viewport's height in layout pixels. Multiplied by the scale so a
 * pinch-zoom (which shrinks `height` but grows `scale`) leaves it alone, and
 * only the keyboard, which changes the height at scale 1, moves it.
 */
export function appHeightPx(vv: ViewportLike): number {
  return Math.round(vv.height * vv.scale);
}

export function isIOS(nav: { userAgent?: string; maxTouchPoints?: number }): boolean {
  const ua = nav.userAgent || "";
  // An iPad reports itself as a Mac; the touch points are what give it away.
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
}

/** Keeps `--app-h` on <html> equal to the height left above the iOS keyboard. */
export function useAppHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !isIOS(navigator)) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--app-h", `${appHeightPx(vv)}px`);
    update();
    vv.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      root.style.removeProperty("--app-h");
    };
  }, []);
}

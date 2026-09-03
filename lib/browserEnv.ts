"use client";

// Two questions about the browser a page is running in, kept in one place so
// the answers cannot drift apart between the screens that ask them.
//
// Neither is a feature test, and neither pretends to be: there is nothing
// here that can be detected by trying it. What both describe is a vendor
// whose behaviour differs from every other one, so both are written as
// narrowly as the decisions they feed.

/**
 * An iPhone, iPod or iPad — including iPadOS 13+, which deliberately reports
 * desktop Safari's user agent and so matches none of the obvious strings.
 * The touch-point count is what still separates it from a real Mac; a
 * trackpad reports 0.
 */
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/**
 * Running with no browser chrome around it — an installed PWA in its own
 * window, launched from the home screen or the dock.
 *
 * Worth asking before opening anything in a second window: a standalone
 * window has no tab strip to put one in, so the OS hands the URL to the
 * default browser instead and this window is left in the background, where
 * the system is free to discard it.
 */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari never matches the standard media query — it exposes its own
  // `navigator.standalone` instead.
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

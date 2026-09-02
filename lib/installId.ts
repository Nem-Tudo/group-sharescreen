"use client";

import { isDesktopApp, isMobileApp } from "./desktop";

// A random id identifying one *installation* of a GoLive shell — the desktop
// (Electron) or Android (Capacitor) build — so the API can count how many
// exist rather than how many are connected right now. See the API's
// server/appInstallStore.ts, which is the only thing that ever reads it.
//
// Why this is its own key rather than something that already exists:
//
//   - clientId (signalingClient.ts) is sessionStorage and per *tab*, so a
//     fresh one appears on every cold start of the app. Counting those would
//     count launches.
//   - the guest token is localStorage and does persist, but its whole design
//     is that losing it resets the identity behind it (see lib/guestToken.ts
//     and the API's guestPointsStore.ts — that reset is what stops reward
//     farming). It also expires after 30 days and is dropped entirely on
//     login, so a returning user would look like a second install, and an
//     account holder like none at all.
//   - the fingerprint (lib/fingerprint.ts) is deliberately *not* stored, and
//     its own header says identical devices collide.
//
// So: a value whose only job is to be stable, kept in the shell's own
// storage. What it cannot survive is someone clearing app data or
// reinstalling — that reads as a new install, and there is no way around it
// short of a native device id, which would mean shipping a new APK and would
// therefore miss every build already installed.
//
// Only ever minted inside a shell. In an ordinary browser this stays absent
// and nothing is written: a website visit is not an install, and the counter
// would be meaningless the moment it counted one.
const INSTALL_ID_STORAGE_KEY = "sharescreen:installId";

function mintInstallId(): string {
  try {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Older WebViews expose crypto without randomUUID — fall through.
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * This installation's id, minting one on first call. Null in a browser, and
 * null if storage can't be used at all (a wiped/locked WebView profile) —
 * both mean "don't report anything", never "make one up per session", which
 * would inflate the count it feeds.
 *
 * Note that `isDesktopApp() || isMobileApp()` is safe to ask this early only
 * because isMobileApp() answers from Capacitor rather than waiting for
 * `window.golive` (see lib/desktop.ts): register goes out before the Android
 * bridge is assembled, and asking the bridge here would have left every
 * Android install unminted until something re-registered.
 */
export function getInstallId(): string | null {
  if (typeof window === "undefined") return null;
  if (!isDesktopApp() && !isMobileApp()) return null;
  try {
    const existing = window.localStorage.getItem(INSTALL_ID_STORAGE_KEY);
    if (existing) return existing;
    const minted = mintInstallId();
    window.localStorage.setItem(INSTALL_ID_STORAGE_KEY, minted);
    return minted;
  } catch {
    return null;
  }
}

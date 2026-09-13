"use client";

import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from "@capacitor/core";

// The phone-shaped bits of the app — what makes the Android shell feel like an
// app rather than a website in a frame, with a web fallback for each so a
// phone browser gets the nearest thing it can.
//
//   - A tap you can feel (haptic), for the controls a thumb presses without
//     looking: the tab bar, the microphone, hanging up.
//   - The system share sheet, for a room's link — WhatsApp, Telegram, a text
//     message — instead of copying and switching apps by hand.
//   - The status and navigation bars painted in the page's own colours, so
//     the app does not sit inside a strip of some other theme.
//   - The hardware back button closing what is open before it leaves the
//     page, and never closing the app itself (which would hang up a call).
//
// The native half is android/…/AppChromePlugin.java. Its absence — an APK
// from before it existed — is checked on every call rather than assumed, and
// each function falls back to what the web can do.

interface AppChromePlugin {
  setColors(options: { background: string; dark: boolean }): Promise<void>;
  haptic(options: { kind: HapticKind }): Promise<void>;
  share(options: { title?: string; text?: string; url?: string }): Promise<{ shared: boolean }>;
}

const AppChrome = registerPlugin<AppChromePlugin>("AppChrome");

function hasAppChrome(): boolean {
  return (
    typeof window !== "undefined" &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "android" &&
    Capacitor.isPluginAvailable("AppChrome")
  );
}

// ─── Haptics ──────────────────────────────────────────────────────────────

/**
 * "tap" for an ordinary press (a tab, a toggle), "confirm" for something that
 * changed state in a way worth feeling (the mic going live), "reject" for the
 * one that ends something (hanging up).
 */
export type HapticKind = "tap" | "confirm" | "reject";

const WEB_VIBRATION: Record<HapticKind, number | number[]> = {
  tap: 8,
  confirm: 14,
  reject: [18, 40, 18],
};

export function haptic(kind: HapticKind = "tap"): void {
  if (hasAppChrome()) {
    void AppChrome.haptic({ kind }).catch(() => {});
    return;
  }
  // A phone browser only, and only one with a touch screen: a laptop that
  // happens to implement the API has no motor to run.
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function" &&
    window.matchMedia?.("(pointer: coarse)").matches
  ) {
    try {
      navigator.vibrate(WEB_VIBRATION[kind]);
    } catch {
      // Refused (no user gesture yet, or turned off) — silence is fine.
    }
  }
}

// ─── Share ────────────────────────────────────────────────────────────────

/** Whether sharing opens something better than a copy to the clipboard. */
export function canShareNatively(): boolean {
  if (hasAppChrome()) return true;
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * Opens the system share sheet. Resolves to what happened: "shared" (or at
 * least handed to the sheet), "cancelled" by the person, or "unsupported" —
 * the caller copies the link instead.
 */
export async function shareLink(input: { title?: string; text?: string; url: string }): Promise<
  "shared" | "cancelled" | "unsupported"
> {
  if (hasAppChrome()) {
    try {
      await AppChrome.share(input);
      return "shared";
    } catch {
      return "unsupported";
    }
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(input);
      return "shared";
    } catch (err) {
      return (err as DOMException)?.name === "AbortError" ? "cancelled" : "unsupported";
    }
  }
  return "unsupported";
}

// ─── System bars ──────────────────────────────────────────────────────────

let lastColors = "";

/** Paints the Android status and navigation bars. A no-op anywhere else. */
export function setSystemBarColors(background: string, dark: boolean): void {
  const key = `${background}:${dark}`;
  if (key === lastColors) return;
  lastColors = key;
  if (hasAppChrome()) {
    void AppChrome.setColors({ background, dark }).catch(() => {});
    return;
  }
  // An older APK still has Capacitor's own SystemBars, which can at least make
  // the icons readable against whatever is behind them.
  if (typeof window !== "undefined" && Capacitor.isNativePlatform()) {
    void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
  }
}

// ─── Back button ──────────────────────────────────────────────────────────
//
// Android's back button (or the back gesture) means "close what I opened",
// then "go back a screen", and only from the first screen "leave" — which for
// an app that may be carrying a call is *minimise*, never quit.
//
// Sheets and panels that should close on back register here while open (see
// useBackHandler); the newest one wins, like a stack of screens. Dialogs drawn
// by ntpopups close on Escape and say so by cancelling the event, which is how
// they are reached without each one registering.

type BackHandler = () => void;
const backStack: { id: number; handler: BackHandler }[] = [];
let nextBackId = 1;

/** Registers a handler for the back button; returns what unregisters it. */
export function pushBackHandler(handler: BackHandler): () => void {
  const id = nextBackId++;
  backStack.push({ id, handler });
  return () => {
    const index = backStack.findIndex((entry) => entry.id === id);
    if (index >= 0) backStack.splice(index, 1);
  };
}

/**
 * Closes whatever is open on top. Returns whether something was — false means
 * the caller should navigate back instead.
 */
export function closeTopLayer(): boolean {
  const top = backStack[backStack.length - 1];
  if (top) {
    top.handler();
    return true;
  }
  // A dialog that closes on Escape and cancels the key when it does (ntpopups).
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.dispatchEvent(escape);
  if (escape.defaultPrevented) return true;
  // Any other modal on screen got the same Escape; most of them close on it
  // without saying so, and navigating away underneath one would be worse than
  // a back press that sometimes needs a second try. But only once for the same
  // one: a modal that is still there on the next press does not close on
  // Escape, and back must not become a button that does nothing at all.
  const modal = document.querySelector('[aria-modal="true"]');
  if (modal && modal !== lastEscapedModal) {
    lastEscapedModal = modal;
    return true;
  }
  lastEscapedModal = null;
  return false;
}

let lastEscapedModal: Element | null = null;

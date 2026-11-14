"use client";

// HOTFIX socket-limit (2026-11-13).
//
// The host capped the API at 10k sockets in total. Until that is lifted, only
// people who are actually using the site keep one: anyone in a room, or with
// the page open and in use. Someone who is not in a room and has left the tab
// in the background (or untouched) for a while gets their socket closed —
// "parked" — and this notice tells them, with a button to come back. Joining
// a room unparks on its own (see signalingClient.joinRoom).
//
// To remove: delete this file, its <SocketIdleNotice /> in app/layout.tsx,
// the `socketIdle.*` texts in locales/, and every line marked
// "HOTFIX socket-limit" in lib/signalingClient.ts. Or just flip ENABLED.

import { useEffect, useSyncExternalStore } from "react";
import { signalingClient } from "@/lib/signalingClient";
import { isPageHidden, onPageHiddenChange } from "@/lib/pageHidden";
import { useT } from "@/lib/useI18n";

const ENABLED = true;
// Out of a room with the page hidden (background tab, minimised app) this long.
const HIDDEN_MS = 3 * 60_000;
// Out of a room with the page visible but no input at all this long.
const IDLE_MS = 20 * 60_000;
const CHECK_EVERY_MS = 15_000;

const subscribe = (cb: () => void) => signalingClient.subscribe(cb);
const getParked = () => signalingClient.isParked;
const getServerParked = () => false;

export function SocketIdleNotice() {
  const t = useT();
  const parked = useSyncExternalStore(subscribe, getParked, getServerParked);

  useEffect(() => {
    if (!ENABLED) return;
    let hiddenSince: number | null = isPageHidden() ? Date.now() : null;
    let lastInput = Date.now();

    const onInput = () => {
      lastInput = Date.now();
    };
    const offHidden = onPageHiddenChange(() => {
      hiddenSince = isPageHidden() ? Date.now() : null;
      if (hiddenSince === null) lastInput = Date.now();
    });
    const inputEvents = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
    inputEvents.forEach((e) => window.addEventListener(e, onInput, { passive: true }));

    const check = () => {
      if (signalingClient.isParked) return;
      const now = Date.now();
      if (signalingClient.isInRoom) {
        lastInput = now;
        if (hiddenSince !== null) hiddenSince = now;
        return;
      }
      const hiddenTooLong = hiddenSince !== null && now - hiddenSince >= HIDDEN_MS;
      const idleTooLong = now - lastInput >= IDLE_MS;
      if (hiddenTooLong || idleTooLong) signalingClient.park();
    };
    const timer = setInterval(check, CHECK_EVERY_MS);

    return () => {
      clearInterval(timer);
      offHidden();
      inputEvents.forEach((e) => window.removeEventListener(e, onInput));
    };
  }, []);

  if (!ENABLED || !parked) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-20 z-[60] mx-auto max-w-md rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-lg sm:bottom-6 dark:border-amber-700/60 dark:bg-zinc-900 dark:text-amber-200"
    >
      <p className="font-semibold">{t("socketIdle.title")}</p>
      <p className="mt-1 text-amber-800 dark:text-zinc-300">{t("socketIdle.text")}</p>
      <button
        type="button"
        onClick={() => signalingClient.unpark()}
        className="mt-3 rounded-lg bg-amber-500 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-amber-600"
      >
        {t("socketIdle.reconnect")}
      </button>
    </div>
  );
}

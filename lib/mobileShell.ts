"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { isAppShell, isDesktopApp, isMobileApp } from "@/lib/desktop";
import { fetchConversations } from "@/lib/dmApi";
import { useAuth } from "@/lib/AuthContext";
import { useDirectMessagesWindow } from "@/lib/dmWindow";
import { selectDmReadSeq, selectDmSeq } from "@/lib/signalingSelectors";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { LG_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/useMediaQuery";

// The app on a phone: bottom tabs instead of a website's top bar of links.
//
// Below lg the site's navigation moves into a tab bar at the foot of the
// screen (components/MobileTabBar) — Início, Salas, Grupos, Conversas and Você
// — and the header keeps only what belongs at the top: where you are, and the
// bell. What used to be links in the header (Temas, Pro, the desktop app, the
// Discord bot, the sponsor) lives on the Você screen (app/me) now.
//
// Everywhere but the Electron shell. That one is a desktop program whose
// window happens to be resizable, and a narrow desktop window is still a
// desktop: it keeps its header.

/** True unless this is the desktop (Electron) app. */
export function useTabBarEnabled(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => !(isDesktopApp() && !isMobileApp()),
    () => true
  );
}

function noopSubscribe() {
  return () => {};
}

/**
 * Inside one of GoLive's own shells (Android or desktop) — false during the
 * server render and hydration, so what the server sent and the first client
 * paint agree, then the real answer.
 */
export function useIsAppShell(): boolean {
  return useSyncExternalStore(noopSubscribe, isAppShell, () => false);
}

/**
 * The screens that show the tabs: the ones the tabs lead to, and the pages you
 * browse between them. Not a room, not a text channel, not a stream — those
 * are screens you are *in*, with controls of their own along the bottom.
 */
export function isTabBarRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return true;
  // /groups and /groups/:id (the group's rooms) — not /groups/:id/:room.
  if (/^\/groups(\/[^/]+)?$/.test(path)) return true;
  if (/^\/theme\/[^/]+$/.test(path)) return true;
  return /^\/(rooms|worldmap|friends|me|workshop|pro|badges|terms|app|discord-bot|user)(\/|$)/.test(path);
}

/** Whether the tab bar is on screen right now — for decisions JS has to make. */
export function useTabBarVisible(pathname: string | null): boolean {
  const enabled = useTabBarEnabled();
  const wide = useMediaQuery(LG_BREAKPOINT_QUERY);
  return enabled && !wide && isTabBarRoute(pathname);
}

/** How long after a nudge the conversations are re-read — a burst is one request. */
const DM_REFRESH_DEBOUNCE_MS = 800;

/**
 * Unread private messages, for the Conversas tab's badge. Read the same way
 * the header's conversation strip reads them (see DmRecentStrip): the list is
 * re-fetched when a message arrives or is read anywhere, and when the
 * conversations window closes — which is when something was most likely just
 * read. Asks nothing while `enabled` is false.
 */
export function useDmUnreadTotal(enabled: boolean): number {
  const { account } = useAuth();
  const dmSeq = useSignalingSelector(selectDmSeq);
  const dmReadSeq = useSignalingSelector(selectDmReadSeq);
  const { open } = useDirectMessagesWindow();
  const [total, setTotal] = useState(0);
  const accountId = account?.id ?? null;

  useEffect(() => {
    if (!enabled || !accountId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchConversations(controller.signal).then((data) => {
        if (controller.signal.aborted || !data) return;
        setTotal(data.conversations.reduce((sum, c) => sum + c.unread, 0));
      });
    }, DM_REFRESH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, accountId, dmSeq, dmReadSeq, open]);

  return enabled && accountId ? total : 0;
}

/**
 * Whether the on-screen keyboard is (most likely) up: a text field has focus
 * on a touch screen. The tabs step out of the way then, like an app's do —
 * with the page resized to the space above the keyboard (see layout.tsx's
 * interactiveWidget), a bar pinned to the bottom would sit on top of it,
 * covering the very field being typed in.
 */
export function useSoftKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const isTextField = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
      if (!(el instanceof HTMLInputElement)) return false;
      return !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset", "image"].includes(el.type);
    };
    const onFocusIn = (e: FocusEvent) => setOpen(isTextField(e.target));
    const onFocusOut = (e: FocusEvent) => {
      if (!isTextField(e.relatedTarget)) setOpen(false);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  return open;
}

"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useFeature } from "@/lib/features";
import { arrivedBefore } from "@/lib/newcomer";
import { ANNIVERSARY_EVENTS, ANNIVERSARY_FEATURE, trackAnniversary } from "@/lib/anniversary";

// The one-time "Go Live fez 3 meses" popup, on any page, for people in the
// anniversary-3m experiment who have been around for more than two days (by
// their account's age, or this browser's first visit). Shown once per
// browser: the moment it opens is remembered, whatever is clicked after.
//
// This part only decides; the card itself (and its CSS) is a separate chunk,
// downloaded only by the few who will see it.

const loadCard = () => import("./AnniversaryPopupCard");
const AnniversaryPopupCard = dynamic(() => loadCard().then((m) => m.AnniversaryPopupCard), {
  ssr: false,
});

const SEEN_KEY = "sharescreen:anniversary:popup";
const VETERAN_MS = 2 * 24 * 60 * 60 * 1000;
/** A beat after the page appears, so it does not cover the first paint. */
const SHOW_AFTER_MS = 700;
/** Pages it never opens on: the anniversary itself, sign-in, and the ones OBS or another window shows. */
const EXCLUDED = ["/3-meses", "/login", "/obs", "/stream", "/oauth", "/oauth2", "/cam", "/admin", "/ad"];

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    // Nowhere to remember it: never show, rather than show on every page.
    return true;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    // Already treated as seen when storage is refused.
  }
}

export function AnniversaryPopup() {
  const pathname = usePathname();
  const { account, loading } = useAuth();
  const [seen, setSeen] = useState(true);
  const [open, setOpen] = useState(false);
  /** When this tab started looking; null before hydration. */
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // Storage and the clock are only read after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeen(readSeen());
    setNow(Date.now());
  }, []);

  const routeOk = pathname !== null && !EXCLUDED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // This browser's own first visit answers without waiting for the account to load.
  const veteran =
    now !== null &&
    (arrivedBefore(now - VETERAN_MS) || (!loading && account !== null && now - account.createdAt > VETERAN_MS));
  const candidate = !seen && !open && routeOk && veteran;
  // An exposure only for somebody who would actually get the popup.
  const { enabled } = useFeature(ANNIVERSARY_FEATURE, { track: candidate });

  useEffect(() => {
    if (!candidate || !enabled) return;
    // The card's chunk (mascot, page CSS) downloads during the wait, not after it.
    void loadCard();
    const timer = setTimeout(() => {
      // Not on top of another dialog already open; the next page will try again.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (readSeen()) return;
      markSeen();
      setSeen(true);
      setOpen(true);
      trackAnniversary(ANNIVERSARY_EVENTS.popupShow);
    }, SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [candidate, enabled]);

  if (!open) return null;
  return <AnniversaryPopupCard signedIn={Boolean(account)} onClose={() => setOpen(false)} />;
}

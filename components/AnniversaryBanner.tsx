"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useAccountToken } from "@/lib/accountApi";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { arrivedBefore } from "@/lib/newcomer";
import {
  ANNIVERSARY_BANNER_EVENTS,
  ANNIVERSARY_BANNER_FEATURE,
  fetchAnniversaryGift,
  hasVisitedAnniversary,
  markAnniversaryVisited,
} from "@/lib/anniversary";

// The "3 meses" bar at the top of every page, for whoever has not seen the
// page yet (experiment anniv-banner). "Seen" is this browser having opened
// /3-meses (lib/anniversary markAnniversaryVisited), or, signed in, the gift
// roulette already spun there (that one also covers a visit from another
// device, or from before the bar existed). The ✕ hides it for good.
//
// This part only decides; the bar (and the page's CSS) is a separate chunk.

const AnniversaryBannerBar = dynamic(() => import("./AnniversaryBannerBar").then((m) => m.AnniversaryBannerBar), {
  ssr: false,
});

const CLOSED_KEY = "sharescreen:anniversary:banner-closed";
/** Somebody who arrived less than this ago has little to look back on (same rule as the popup). */
const VETERAN_MS = 2 * 24 * 60 * 60 * 1000;
/** The anniversary page itself, sign-in, admin, and the pages OBS or another window shows. */
const EXCLUDED = ["/3-meses", "/login", "/obs", "/stream", "/oauth", "/oauth2", "/cam", "/admin", "/ad"];

function readClosed(): boolean {
  try {
    return window.localStorage.getItem(CLOSED_KEY) !== null;
  } catch {
    return true;
  }
}

export function AnniversaryBanner() {
  const pathname = usePathname();
  const { account, loading } = useAuth();
  const token = useAccountToken();
  /** Null until read after hydration; true = never show. */
  const [done, setDone] = useState<boolean | null>(null);
  /** Signed in: has the gift been drawn already? Null while unknown. */
  const [spun, setSpun] = useState<boolean | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // Storage and the clock are only read after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDone(readClosed() || hasVisitedAnniversary());
    setNow(Date.now());
  }, []);

  // The page marks the visit while this stays mounted (the root layout): back
  // from /3-meses, the bar is gone. (State adjusted while rendering, React's
  // pattern for "reset on a prop change".)
  if (done === false && pathname === "/3-meses") setDone(true);

  const signedIn = Boolean(account && token);
  const routeOk = pathname !== null && !EXCLUDED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const veteran =
    now !== null &&
    !loading &&
    ((account ? now - account.createdAt > VETERAN_MS : false) || arrivedBefore(now - VETERAN_MS));
  const maybe = done === false && routeOk && veteran;
  // Signed out there is no gift to ask about.
  const candidate = maybe && (signedIn ? spun === false : true);
  // Counted only for somebody who would actually get the bar.
  const { enabled } = useFeature(ANNIVERSARY_BANNER_FEATURE, { track: candidate });
  const show = candidate && enabled;

  useEffect(() => {
    // Asked only of somebody in the experiment who could get the bar.
    if (!maybe || !enabled || spun !== null || !signedIn || !token) return;
    let live = true;
    fetchAnniversaryGift(token)
      .then((gift) => {
        if (!live) return;
        const been = gift.pick !== null || gift.claimed;
        // Remembered, so the question is not asked again on every page load.
        if (been) markAnniversaryVisited();
        setSpun(been);
      })
      .catch(() => {
        if (live) setSpun(false);
      });
    return () => {
      live = false;
    };
  }, [maybe, enabled, spun, signedIn, token]);

  const [shownOnce, setShownOnce] = useState(false);
  useEffect(() => {
    if (!show || shownOnce) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShownOnce(true);
    trackFeatureEvent(ANNIVERSARY_BANNER_EVENTS.show, { feature: ANNIVERSARY_BANNER_FEATURE });
  }, [show, shownOnce]);

  if (!show) return null;
  return (
    <AnniversaryBannerBar
      signedIn={signedIn}
      onOpen={() => {
        trackFeatureEvent(ANNIVERSARY_BANNER_EVENTS.click, { feature: ANNIVERSARY_BANNER_FEATURE });
        setDone(true);
      }}
      onClose={() => {
        trackFeatureEvent(ANNIVERSARY_BANNER_EVENTS.close, { feature: ANNIVERSARY_BANNER_FEATURE });
        try {
          window.localStorage.setItem(CLOSED_KEY, String(Date.now()));
        } catch {
          // Closed for this page load at least.
        }
        setDone(true);
      }}
    />
  );
}

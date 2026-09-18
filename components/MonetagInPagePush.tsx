"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useFeature, trackFeatureEvent } from "@/lib/features";
import { useAdsAllowed } from "@/lib/useAdsAllowed";

// Monetag's In-Page Push, behind the "monetag-inpage-push" experiment.
//
// Unlike the Adsterra slots this is not a box in the layout: the tag floats a
// notification-style ad over the page wherever Monetag decides. So it never
// loads on a room page (/watch, /groups), where it would sit on top of the
// stream or the chat. Same gates as every other ad (useAdsAllowed): the admin
// switch, Pro's `no_ads`, and the desktop/Android shells.
//
// Once the script runs it cannot be unloaded — a client-side navigation into
// a room afterwards keeps it alive until the next full page load.

export const MONETAG_FEATURE = "monetag-inpage-push";
export const MONETAG_LOADED_EVENT = "monetag_inpage_loaded";

const ZONE = "11835375";
const SRC = "https://nap5k.com/tag.min.js";

let injected = false;

function isRoomPath(pathname: string | null): boolean {
  return !!pathname && (pathname.startsWith("/watch") || pathname.startsWith("/groups"));
}

export function MonetagInPagePush() {
  const pathname = usePathname();
  const adsAllowed = useAdsAllowed();
  const eligible = adsAllowed && !isRoomPath(pathname);
  // Exposure is only counted where the ad could actually load.
  const { enabled, ready } = useFeature(MONETAG_FEATURE, { track: eligible });

  useEffect(() => {
    if (!eligible || !ready || !enabled || injected) return;
    injected = true;
    const script = document.createElement("script");
    script.dataset.zone = ZONE;
    script.src = SRC;
    script.onload = () => trackFeatureEvent(MONETAG_LOADED_EVENT);
    (document.body || document.documentElement).appendChild(script);
  }, [eligible, ready, enabled]);

  return null;
}

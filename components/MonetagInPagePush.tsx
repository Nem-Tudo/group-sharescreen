"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useFeature, trackFeatureEvent } from "@/lib/features";
import { useAdsAllowed } from "@/lib/useAdsAllowed";

// Monetag's In-Page Push — the site's ad network, gated by the
// "monetag-inpage-push" experiment.
//
// Not a box in the layout: the tag floats a notification-style ad over the
// page wherever Monetag decides. It never loads on a room page (/watch,
// /groups) or on admin pages (/admin). Gated like every ad (useAdsAllowed):
// the admin panel's switch (MonetagPanel), Pro's `no_ads`, admin accounts,
// and the desktop/Android shells.
//
// When disabled or on ineligible paths, the injected script tag is removed.

export const MONETAG_FEATURE = "monetag-inpage-push";
export const MONETAG_LOADED_EVENT = "monetag_inpage_loaded";

const ZONE = "11835375";
const SRC = "https://nap5k.com/tag.min.js";
const SCRIPT_ID = "monetag-inpage-push-tag";

function isExcludedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname.startsWith("/watch") ||
    pathname.startsWith("/groups") ||
    pathname.startsWith("/admin")
  );
}

export function MonetagInPagePush() {
  const pathname = usePathname();
  const adsAllowed = useAdsAllowed();
  const eligible = adsAllowed && !isExcludedPath(pathname);
  // Exposure is only counted where the ad could actually load.
  const { enabled: featureEnabled, ready: featureReady } = useFeature(MONETAG_FEATURE, {
    track: eligible,
  });

  const shouldLoad = Boolean(eligible && featureReady && featureEnabled);

  useEffect(() => {
    if (!shouldLoad) {
      const existing = document.getElementById(SCRIPT_ID);
      if (existing) existing.remove();
      return;
    }

    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.dataset.zone = ZONE;
    script.src = SRC;
    script.onload = () => trackFeatureEvent(MONETAG_LOADED_EVENT);
    (document.body || document.documentElement).appendChild(script);
  }, [shouldLoad]);

  return null;
}

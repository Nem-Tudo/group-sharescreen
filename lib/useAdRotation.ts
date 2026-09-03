"use client";

import { useEffect, useState } from "react";

// Which of the two advertisers has the room's one ad slot right now.
//
// The room sells the same square twice: to a partner directly (see
// usePartnerAd and PartnerCard) and to Adsterra. Showing both at once was the
// first arrangement and it was the wrong one — two ads stacked in a 256px
// column read as a page full of advertising, and on a phone they were
// competing for the height the video needed. So they take turns instead.

/** How long each side holds the slot before handing it over. */
export const AD_ROTATION_INTERVAL_MS = 60 * 1000;

/**
 * Flips every minute, starting on the partner.
 *
 * The partner goes first because it is the ad this room sold itself: if
 * somebody only ever sees one turn of this, it should be that one.
 *
 * `enabled` is what makes the whole thing safe to switch on unconditionally.
 * When Adsterra has nothing to show — no key configured, a Pro account, the
 * desktop shell — this stays false forever and the partner simply keeps the
 * slot, rather than the room blanking out every other minute.
 */
export function useAdRotation(enabled: boolean): boolean {
  const [showAdsterra, setShowAdsterra] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      // A hidden tab has nobody to hand the slot to, and swapping there would
      // spend one side's minute on an empty room — the same reasoning
      // usePartnerAd applies to its own rotation, and the reason the two stay
      // in step through a long alt-tab instead of drifting apart.
      if (document.visibilityState !== "visible") return;
      setShowAdsterra((current) => !current);
    }, AD_ROTATION_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  // Guarded on the way out as well as on the way in: `enabled` can go false
  // after the flag is already true — an account's `features` arrive from an
  // API call, so somebody's Pro status can land a second after the page does
  // — and without this the slot would stay stuck on an Adsterra unit that has
  // just decided to render nothing.
  return enabled && showAdsterra;
}

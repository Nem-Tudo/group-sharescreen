"use client";

import { useEffect, useRef } from "react";
import useNtPopups from "ntpopups";

// Notices that somebody arrived holding a present, and opens it.
//
// The code reaches the site as `?gift=` on the home page, put there by the
// redirect at /gift/[code]. Read from `window.location` rather than through
// useSearchParams, and that is not a preference: this component is mounted at
// the layout root, and that hook would make every page in the app render on
// demand — a Suspense boundary and a lost static prerender, for a parameter
// that is absent from all but one visit in a thousand.
//
// Opening it is an effect and nothing else is: the present is an ntpopups
// popup (registered as "gift_claim" in NtPopups.tsx), so this file holds no
// state, draws nothing, and has nothing to unmount. Talking to the popup
// system is exactly the kind of outside world an effect is for.
//
// The URL is cleared when the popup closes, however it closed. Otherwise
// "recusar" followed by a refresh is the same present again, and again — a
// present that nags is not one.

/** Where the code travels. Matches the redirect in app/gift/[code]/page.tsx. */
const PARAM = "gift";

/**
 * What it used to be called.
 *
 * Still read, and still cleared, for as long as it costs two lines: the
 * parameter normally exists for the instant between the redirect and this
 * popup opening, but anybody who copied the address bar in that instant — or
 * shared what they copied — is holding a link with the old name on it, and a
 * present that silently does nothing is the worst way to find that out.
 */
const LEGACY_PARAM = "presente";

export function GiftClaimHost() {
  const { openPopup } = useNtPopups();
  // Once per page load. The effect's dependency is a function the provider may
  // hand back fresh on its own re-renders, and a present that reopens every
  // time something above it re-rendered would be unbearable.
  const openedRef = useRef(false);

  useEffect(() => {
    if (openedRef.current) return;
    const query = new URLSearchParams(window.location.search);
    const found = query.get(PARAM) ?? query.get(LEGACY_PARAM);
    if (!found) return;
    openedRef.current = true;

    void openPopup("gift_claim", {
      // Folded to match the alphabet codes are minted in (see the API's
      // premiumGiftStore), so a link retyped in lower case still opens a
      // present.
      data: { code: found.trim().toUpperCase() },
      onClose: () => {
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete(PARAM);
          url.searchParams.delete(LEGACY_PARAM);
          // replaceState rather than a router navigation: there is nothing to
          // re-render — the popup is already gone — and pushing an entry would
          // put the present back one press of "voltar" away.
          window.history.replaceState(null, "", url.toString());
        } catch {
          // A URL the browser will not let us rewrite costs the tidy address
          // bar and nothing else.
        }
      },
    });
  }, [openPopup]);

  return null;
}

"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
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
// Reading it is not enough on its own, though. This sits in the layout, so it
// mounts once and stays mounted, while /gift/[code] arrives here by a *client*
// navigation (see GiftRedirect, and why it cannot be a server redirect). At
// the moment this first mounted the address was still /gift/<code>, with no
// query on it at all — so an effect that only ran on mount looked, found
// nothing, and never looked again. Following a present's link did nothing;
// opening the same home page with ?gift= by hand worked, which is what made
// it look like the redirect was at fault rather than the listening.
//
// So the effect follows the pathname. usePathname does not force dynamic
// rendering the way useSearchParams does, which keeps the reason for reading
// window.location intact — it is only used to know that the address changed,
// never for what it changed to.
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
  const pathname = usePathname();
  // Which presents this page load has already shown. By code rather than a
  // single "have I opened one" flag: the effect can now run more than once,
  // and the two things worth telling apart are the same present arriving
  // twice — the popup closing rewrites the URL, and a re-render must not
  // reopen it — and a genuinely different present, which somebody following a
  // second link in the same session should still get.
  const openedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const found = query.get(PARAM) ?? query.get(LEGACY_PARAM);
    if (!found) return;
    // Folded to match the alphabet codes are minted in (see the API's
    // premiumGiftStore), so a link retyped in lower case still opens a
    // present.
    const code = found.trim().toUpperCase();
    if (!code || openedRef.current.has(code)) return;
    openedRef.current.add(code);

    void openPopup("gift_claim", {
      data: { code },
      onClose: () => {
        // Deferred out of the current task, and that is not tidiness. Next
        // patches history.replaceState so its router can follow along, and
        // ntpopups calls onClose while it is rendering — so doing this inline
        // updates the Router from inside NtPopupProvider's render, which
        // React reports as "Cannot update a component while rendering a
        // different component". A timeout puts it after that render, where
        // changing the address is an ordinary thing to do.
        setTimeout(() => {
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete(PARAM);
            url.searchParams.delete(LEGACY_PARAM);
            // replaceState rather than a router navigation: there is nothing
            // to re-render — the popup is already gone — and pushing an entry
            // would put the present back one press of "voltar" away.
            window.history.replaceState(null, "", url.toString());
          } catch {
            // A URL the browser will not let us rewrite costs the tidy
            // address bar and nothing else.
          }
        }, 0);
      },
    });
  }, [openPopup, pathname]);

  return null;
}

"use client";

import { useState, useSyncExternalStore } from "react";
import { GiftClaimDialog } from "@/components/GiftClaimDialog";

// Notices that somebody arrived holding a present, and opens it.
//
// The code reaches the site as `?presente=` on the home page, put there by the
// redirect at /gift/[code]. Read from `window.location` rather than through
// useSearchParams, and that is not a preference: this component is mounted at
// the layout root, and that hook would make every page in the app render on
// demand — a Suspense boundary and a lost static prerender, for a parameter
// that is absent from all but one visit in a thousand.
//
// Cleared from the URL the moment the dialog closes. Otherwise "recusar"
// followed by a refresh is the same present again, and again — a present that
// nags is not one.

/** Where the code travels. Matches the redirect in app/gift/[code]/page.tsx. */
const PARAM = "presente";

/** Nothing to subscribe to: the address bar only changes here when we change it. */
const subscribeNothing = () => () => {};

function readCode(): string | null {
  const found = new URLSearchParams(window.location.search).get(PARAM);
  // Folded to match the alphabet codes are minted in (see the API's
  // premiumGiftStore), so a link retyped in lower case still opens a present.
  return found ? found.trim().toUpperCase() : null;
}

/** The server has no address bar, and there is nothing to draw without one. */
const readNothing = () => null;

export function GiftClaimHost() {
  // Through the store rather than an effect, which is what keeps the first
  // client render from being a second render: the parameter is readable the
  // instant this mounts, and setting state to discover it would mean drawing
  // the page once without the present and once with it.
  const code = useSyncExternalStore(subscribeNothing, readCode, readNothing);
  // Closing is this component's own business and nothing the URL can express
  // — the address is tidied below, but a value nothing subscribes to would not
  // report the change anyway.
  const [dismissed, setDismissed] = useState(false);

  if (!code || dismissed) return null;

  return (
    <GiftClaimDialog
      code={code}
      onClose={() => {
        setDismissed(true);
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete(PARAM);
          // replaceState rather than a router navigation: there is nothing to
          // re-render — the dialog is already gone — and pushing an entry
          // would put the present back one press of "voltar" away.
          window.history.replaceState(null, "", url.toString());
        } catch {
          // A URL the browser will not let us rewrite costs the tidy address
          // bar and nothing else.
        }
      }}
    />
  );
}

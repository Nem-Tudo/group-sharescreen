"use client";

import { useSyncExternalStore } from "react";
import { useAuth } from "@/lib/AuthContext";
import { isDesktopApp, isMobileApp } from "@/lib/desktop";
import { useAdsEnabled } from "@/lib/useAdsEnabled";

// "Is this running in the browser yet?", without a setState in an effect.
// The server snapshot is false and the client one is true, so the first
// render matches what was sent and the second — the one after hydration —
// is the first that can be honest. Same primitive useMediaQuery is built on,
// for the same reason.
const NEVER_CHANGES = () => () => {};

function useHydrated(): boolean {
  return useSyncExternalStore(
    NEVER_CHANGES,
    () => true,
    () => false
  );
}

/**
 * Whether this viewer should be shown ads at all.
 *
 * Three independent reasons not to, and each is a different kind of no:
 *
 *   - an admin switched the network off from the admin panel. Live, so a slot
 *     empties on every open tab the moment the button is pressed — see
 *     useAdsEnabled;
 *   - the account pays (the `no_ads` entitlement, resolved server-side like
 *     every other one — see the API's entitlements.ts). Not decided from the
 *     subscription's fields here: the client's job is to ask what an account
 *     may do, never to work out whether it is premium;
 *   - the site is running inside the desktop or Android shell. Those are
 *     packaged applications rather than web traffic, and an ad network that
 *     believes it is buying the latter should not be served the former.
 *
 * Returns false during the first render on purpose. Which of the three
 * applies is only knowable in the browser — the shells announce themselves
 * after mount, and the account arrives from an API call — so rendering a slot
 * on the server would mean an ad flashing in front of somebody who paid not
 * to see one.
 */
export function useAdsAllowed(): boolean {
  const { account, loading } = useAuth();
  const hydrated = useHydrated();
  const switchedOn = useAdsEnabled();

  if (!hydrated || loading) return false;
  if (!switchedOn) return false;
  if (isDesktopApp() || isMobileApp()) return false;
  return !account?.features?.includes("no_ads");
}

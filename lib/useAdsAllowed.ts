"use client";

import { useSyncExternalStore } from "react";
import { useAuth } from "@/lib/AuthContext";
import { isDesktopApp, isMobileApp } from "@/lib/desktop";
import { DESKTOP_BANNER, MOBILE_BANNER, NATIVE_BANNER } from "@/lib/adsterra";

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
 *   - the deployment configured no slots, which is the default and makes the
 *     whole feature inert;
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

  if (!hydrated || loading) return false;
  if (!DESKTOP_BANNER && !MOBILE_BANNER && !NATIVE_BANNER) return false;
  if (isDesktopApp() || isMobileApp()) return false;
  return !account?.features?.includes("no_ads");
}

/**
 * Whether an Adsterra slot of `format` would actually paint something.
 *
 * `useAdsAllowed` answers "may this viewer be shown ads"; this adds the other
 * half — "is a unit of this shape configured at all". Both are needed before
 * anything *alternates* with the house ad (see useAdRotation): a slot that
 * rotates onto a network with no key would leave the room's own ad blank for
 * a minute at a time, which is worse than never rotating.
 */
export function useAdsterraAvailable(format: "banner" | "native"): boolean {
  const allowed = useAdsAllowed();
  if (!allowed) return false;
  // The banner component falls back between the two units, so either one is
  // enough for it to render something.
  return format === "native"
    ? NATIVE_BANNER !== null
    : DESKTOP_BANNER !== null || MOBILE_BANNER !== null;
}

"use client";

import { useSyncExternalStore } from "react";
import { isIOSApp } from "./desktop";

// What the iOS app may not show: anything that sells.
//
// App Store rule 3.1.1 says a digital plan bought inside an iOS app has to go
// through Apple's in-app purchase. GoLive Pro is sold with Stripe and Pix, so
// the iOS app does not sell it at all — the arrangement rule 3.1.3(f) allows
// for a free companion app of a paid web service (VoIP is the guideline's own
// example), on one condition: no buying inside the app and no button or link
// that sends the person to buy elsewhere. A plan bought on the site still
// works in the app; the app only never offers one.
//
// So, inside the iOS app only:
//   - every element marked `data-sells` is hidden by CSS (app/globals.css),
//     from the first paint, because STORE_POLICY_INIT_SCRIPT marks <html>
//     before any bundle runs;
//   - the pages whose whole purpose is buying (/pro, /gift, /redeem,
//     /partner/new) render <NotSoldInApp /> instead;
//   - the Pro modal and the checkout popups render the same neutral card.
//
// Android and every browser are untouched: sellsHere() is true there.

// The inline script that marks <html> lives in lib/storePolicyInit.ts: the
// root layout is a server component and cannot import from this client file.

/** False inside the iOS app: nothing may be sold or linked to for sale. */
export function sellsHere(): boolean {
  if (typeof window === "undefined") return true;
  if (isIOSApp()) return false;
  return !/GoLiveApp\/ios/.test(navigator.userAgent || "");
}

const noopSubscribe = () => () => {};

/**
 * sellsHere() for a component. True on the server and during hydration (the
 * HTML is the same for everyone), then the real answer — elements that must
 * not flash in the iOS app should also carry `data-sells`, which CSS hides
 * from the first paint.
 */
export function useSellsHere(): boolean {
  return useSyncExternalStore(noopSubscribe, sellsHere, () => true);
}

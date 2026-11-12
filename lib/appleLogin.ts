"use client";

import { isIOSApp } from "./desktop";
import { useFeature } from "./features";

// "Continuar com a Apple" (Sign in with Apple).
//
// In the iOS app it is always there: App Review requires it of an app that
// offers Google/Discord login (guideline 4.8). On the site and in the other
// apps it is new, so it rolls out as the experiment below.
//
// The API only lists the provider once its APPLE_SIGNIN_* env vars are set
// (see sharescreen-api/server/oauth.ts), so without them nothing shows anywhere.

/** The feature's key in the admin panel. Target: user, guests included (the button is on the login form). */
export const APPLE_LOGIN_FEATURE = "apple-login";

/** Every event the button reports — each must be a site event of the feature. */
export const APPLE_LOGIN_EVENTS = {
  /** The button was pressed. */
  click: "apple_login_click",
  /** Apple answered with a session or a signup ticket. */
  done: "apple_login_done",
} as const;

/**
 * Whether to offer Apple. `listed`: the API offers it at all — the exposure is
 * only counted where the button would really appear.
 */
export function useAppleLoginVisible(listed: boolean): boolean {
  const ios = isIOSApp();
  const feature = useFeature(APPLE_LOGIN_FEATURE, { track: listed && !ios });
  return listed && (ios || feature.enabled);
}

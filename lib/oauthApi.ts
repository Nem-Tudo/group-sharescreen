"use client";

import { getSignalingHttpBase } from "./roomsApi";
import { getAccountToken, setAccountToken } from "./accountApi";
import { createOAuthNonce, desktopOAuthReturnPath, getDesktopBridge } from "./desktop";
import { translate } from "@/lib/i18n";

// Client half of the social login. The whole OAuth dance happens on the API
// (see the API's server/oauthRoutes.ts) — this module only opens it, waits
// for the result, and hands it back typed. Nothing here ever sees a client
// secret, an authorization code, or a provider domain.

export type OAuthProviderId = "discord" | "google";

export type OAuthProvider = { id: OAuthProviderId; label: string };

// What the API's callback redirect boils down to, once the callback page has
// parsed the URL fragment it landed on.
export type OAuthResult =
  // Already had an account (or just linked one): straight to a session.
  | { kind: "token"; token: string; linked: OAuthProviderId | null; next: string }
  // First time with this provider — the account doesn't exist yet, and this
  // ticket carries the verified identity into the username step.
  | {
      kind: "ticket";
      ticket: string;
      provider: OAuthProviderId;
      suggestedUsername: string;
      suggestedDisplayName: string;
      next: string;
    }
  | { kind: "error"; error: string; next: string };

// Marks a postMessage as ours. The callback page runs on this same origin,
// so the listener also checks event.origin — this is just what keeps us from
// reacting to unrelated same-origin messages (extensions, dev tooling).
const MESSAGE_SOURCE = "golive-oauth";

export type OAuthMessage = { source: typeof MESSAGE_SOURCE; result: OAuthResult };

export function isOAuthMessage(data: unknown): data is OAuthMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { source?: unknown }).source === MESSAGE_SOURCE
  );
}

export async function fetchOAuthProviders(signal?: AbortSignal): Promise<OAuthProvider[]> {
  const res = await fetch(`${getSignalingHttpBase()}/auth/oauth/providers`, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as { providers: OAuthProvider[] };
  return data.providers ?? [];
}

// `returnTo` is the page the user is on right now: the API validates its
// origin against its own allowlist and keeps only the path, so a login
// started inside a room comes back to that room.
function buildStartUrl(
  provider: OAuthProviderId,
  options: { link?: boolean } = {},
  // Overrides where the flow comes back to. Only the desktop app passes
  // this, and only to plant the marker path the callback page recognises
  // (see lib/desktop.ts) — a browser login keeps returning to the exact
  // page the user was on.
  returnToPath?: string
): string {
  const url = new URL(`${getSignalingHttpBase()}/auth/oauth/${provider}/start`);
  url.searchParams.set(
    "returnTo",
    returnToPath ? new URL(returnToPath, window.location.origin).toString() : window.location.href
  );
  if (options.link) {
    // Only present when connecting a provider to an account that's already
    // logged in — the API verifies this token and links to *that* account
    // instead of starting a new session.
    const token = getAccountToken();
    if (token) url.searchParams.set("token", token);
  }
  return url.toString();
}

// Parses the fragment the API redirected to. Fragments (not query strings)
// because the value can be a session token: they never reach a server, a log,
// or a Referer header.
export function parseOAuthFragment(hash: string): OAuthResult | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const next = params.get("next") || "/";
  const error = params.get("error");
  if (error) return { kind: "error", error, next };
  const token = params.get("token");
  if (token) {
    const linked = params.get("linked");
    return {
      kind: "token",
      token,
      linked: linked === "discord" || linked === "google" ? linked : null,
      next,
    };
  }
  const ticket = params.get("ticket");
  const provider = params.get("provider");
  if (ticket && (provider === "discord" || provider === "google")) {
    return {
      kind: "ticket",
      ticket,
      provider,
      suggestedUsername: params.get("suggestedUsername") || "",
      suggestedDisplayName: params.get("suggestedDisplayName") || "",
      next,
    };
  }
  return null;
}

const POPUP_FEATURES = "width=520,height=680,menubar=no,toolbar=no,location=yes";

// A popup, not a full-page redirect, because of where this gets used: a
// logged-out viewer sitting in a room has live WebRTC connections, and
// navigating the tab away would tear the call down just to log in. If the
// browser blocks the popup we fall back to the redirect anyway — the
// callback page handles both (see app/oauth/callback/page.tsx).
export function startOAuthLogin(
  provider: OAuthProviderId,
  options: { link?: boolean } = {}
): Promise<OAuthResult> {
  const desktop = getDesktopBridge();
  if (desktop) return startDesktopOAuthLogin(desktop, provider, options);
  const startUrl = buildStartUrl(provider, options);
  return new Promise((resolve) => {
    const popup = window.open(startUrl, "golive-oauth", POPUP_FEATURES);
    if (!popup) {
      window.location.href = startUrl;
      // Never settles: the page is navigating away, and resolving with a
      // fake result here would flash a wrong state on the way out.
      return;
    }

    let settled = false;
    function finish(result: OAuthResult) {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearInterval(closedTimer);
      // Stored here rather than by each caller: in popup mode the callback
      // page only forwards the token to this window (it's the opener that
      // owns the session), so this is the one place both modes pass
      // through. The redirect fallback stores it on the callback page
      // itself, because there is no opener to forward it to.
      if (result.kind === "token") setAccountToken(result.token);
      resolve(result);
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!isOAuthMessage(event.data)) return;
      finish(event.data.result);
      // The callback page closes itself, but a popup that somehow stayed
      // open would otherwise sit there after the flow is done.
      try {
        popup?.close();
      } catch {
        // Cross-origin at this instant (still on the provider's domain) —
        // nothing to do, and the user can close it themselves.
      }
    }

    window.addEventListener("message", onMessage);

    // Someone closing the popup mid-flow is a cancellation, and there's no
    // event for it — polling is the only way a parent window can notice.
    const closedTimer = window.setInterval(() => {
      if (popup.closed) finish({ kind: "error", error: "cancelled", next: "/" });
    }, 500);
  });
}

// The desktop app's version of the same flow.
//
// The shape is deliberately identical from the caller's point of view — same
// function, same OAuthResult, same token storage — because everything above
// this layer (OAuthButtons, the signup step, AccountConnections) should not
// have to know which shell it is running in.
//
// What differs is only the transport. There is no popup to postMessage back
// to: the login happens in the user's real browser, and the result returns
// through the app's custom protocol as the same URL fragment the callback
// page would have parsed. So this hands that fragment to the exact same
// parser and is otherwise the browser path verbatim.
async function startDesktopOAuthLogin(
  desktop: NonNullable<ReturnType<typeof getDesktopBridge>>,
  provider: OAuthProviderId,
  options: { link?: boolean }
): Promise<OAuthResult> {
  const nonce = createOAuthNonce();
  const startUrl = buildStartUrl(provider, options, desktopOAuthReturnPath(nonce));
  let fragment: string | null;
  try {
    fragment = await desktop.startOAuth(startUrl, nonce);
  } catch {
    return { kind: "error", error: "provider_failed", next: "/" };
  }
  // Null means cancelled or timed out — the same outcome as closing the
  // popup in a browser, and reported the same way.
  if (!fragment) return { kind: "error", error: "cancelled", next: "/" };
  const result = parseOAuthFragment(fragment) ?? {
    kind: "error" as const,
    error: "unknown",
    next: "/",
  };
  // Same reason the popup path stores it here: this is the window that owns
  // the session, and the callback page (running in a different browser
  // entirely) has no way to hand it over other than through this fragment.
  if (result.kind === "token") setAccountToken(result.token);
  // `next` is the desktop marker path, which is not a real page — send the
  // caller back to where it already is instead of navigating into it.
  return { ...result, next: "/" };
}

// The API only ever sends back an error *code* (the redirect it travels in
// is user-visible, and a message there would be untranslatable and easy to
// spoof) — this is where each one becomes something worth reading.
export function oauthErrorMessage(error: string): string {
  switch (error) {
    case "cancelled":
      return translate("oauthApi.signInCancelled");
    case "state_mismatch":
      return translate("oauthApi.theSignInSessionExpiredOr");
    case "provider_failed":
      return translate("oauthApi.couldNotReachTheProviderTry");
    case "identity_taken":
      return translate("oauthApi.thatAccountIsAlreadyLinkedTo");
    case "account_gone":
      return translate("oauthApi.yourAccountWasNotFoundSign");
    default:
      return translate("oauthApi.signInFailedTryAgain");
  }
}

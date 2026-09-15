"use client";

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import { translate } from "@/lib/i18n";

// "Entrar com GoLive" — the site's half.
//
// Two different things share the prefix and must not be confused: lib/
// oauthApi.ts is how somebody signs in *here* with Discord or Google, and
// this file is how somebody signs in *somewhere else* with GoLive. The first
// makes this site a client; this one makes it the provider.
//
// All of this is the consent screen (app/oauth2/authorize) and the list of
// applications the person has agreed to (see the account page). The
// application's own side of the flow — trading the code for a token — never
// touches a browser and lives entirely on the developer's server (see the
// API's oauth2Routes.ts).

/** The scopes the API knows about today. See its oauth2Scopes.ts. */
export type OAuth2Scope = "openid" | "identify" | "email" | "groups" | "friends";

export type OAuth2Application = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  bot: true;
  /** Who made it. Part of the question being asked, not decoration. */
  owner: { id: string; username: string; displayName: string } | null;
};

export type AuthorizeInfo = {
  application: OAuth2Application;
  scopes: OAuth2Scope[];
  redirectUri: string;
  state: string | null;
  /** This person has already agreed to all of this — the button says "continuar". */
  alreadyGranted: boolean;
  signedIn: boolean;
};

/**
 * Why a consent screen cannot be shown.
 *
 * `redirect` is the whole point of the split: when the application is known
 * and its address is registered, the honest thing is to send the person back
 * with an error the application can explain. When it is not — an unknown
 * client, an address nobody registered — there is nowhere safe to send them
 * and the page has to say so itself.
 */
export type AuthorizeError = {
  error: string;
  description: string;
  redirect: string | null;
};

function authHeaders(): Record<string, string> {
  const token = getAccountToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** The query the application sent, passed through to the API untouched. */
export function authorizeQuery(search: URLSearchParams): string {
  const params = new URLSearchParams();
  for (const key of [
    "client_id",
    "redirect_uri",
    "response_type",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method",
    // OpenID Connect's replay guard. Forwarded like the rest and never read
    // here: the API is what ties it to the id_token it ends up in.
    "nonce",
  ]) {
    const value = search.get(key);
    if (value !== null) params.set(key, value);
  }
  return params.toString();
}

export async function fetchAuthorizeInfo(
  query: string,
  signal?: AbortSignal
): Promise<{ ok: true; info: AuthorizeInfo } | { ok: false; error: AuthorizeError }> {
  let res: Response;
  try {
    res = await fetch(`${getSignalingHttpBase()}/oauth2/authorize/info?${query}`, {
      headers: authHeaders(),
      signal,
    });
  } catch {
    return {
      ok: false,
      error: {
        error: "network",
        description: translate("common.noConnectionToTheServer"),
        redirect: null,
      },
    };
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !data) {
    return {
      ok: false,
      error: {
        error: typeof data?.error === "string" ? data.error : "server_error",
        description:
          typeof data?.error_description === "string"
            ? data.error_description
            : translate("groupsApi.somethingWentWrongTryAgain"),
        redirect: typeof data?.redirect === "string" ? data.redirect : null,
      },
    };
  }
  return { ok: true, info: data as unknown as AuthorizeInfo };
}

/**
 * The decision, both ways round. Answers with where to send the browser —
 * including for a refusal, which the application is told about at its own
 * address rather than left waiting for a callback that never comes.
 */
export async function decideAuthorize(
  query: string,
  approve: boolean
): Promise<{ ok: true; redirect: string } | { ok: false; error: string }> {
  const params = Object.fromEntries(new URLSearchParams(query));
  try {
    const res = await fetch(`${getSignalingHttpBase()}/oauth2/authorize`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, approve }),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && typeof data?.redirect === "string") return { ok: true, redirect: data.redirect };
    return {
      ok: false,
      error:
        typeof data?.error_description === "string"
          ? data.error_description
          : translate("groupsApi.somethingWentWrongTryAgain"),
    };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

// ─── The applications this account has authorized ──────────────────────────

export type Authorization = {
  clientId: string;
  /** Null when the bot behind it is gone; the row is still revocable. */
  application: OAuth2Application | null;
  scopes: OAuth2Scope[];
  authorizedAt: number;
  lastUsedAt: number;
};

/** Null when the list could not be read at all. */
export async function fetchAuthorizations(signal?: AbortSignal): Promise<Authorization[] | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/account/authorizations`, {
      headers: authHeaders(),
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { authorizations?: Authorization[] };
    return Array.isArray(data.authorizations) ? data.authorizations : [];
  } catch {
    return null;
  }
}

/** Takes an application's access away. Its tokens stop working immediately. */
export async function revokeAuthorization(clientId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/account/authorizations/${encodeURIComponent(clientId)}`,
      { method: "DELETE", headers: authHeaders() }
    );
    return res.ok;
  } catch {
    return false;
  }
}

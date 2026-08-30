"use client";

import { useSyncExternalStore } from "react";
import { getSignalingHttpBase } from "./roomsApi";

export type Account = {
  id: string;
  username: string;
  displayName: string;
  flags: string[];
  // Shown in the Watch room header (see WatchRoom's top bar). Earned by
  // claiming a partner ad's reward (see lib/partner.ts), and otherwise
  // changed by hand directly in the database. Absent on a response from an
  // older API that predates this field; every reader treats that the same
  // as 0. Read through AuthContext's `points` rather than here, so a guest —
  // who earns the same rewards without an account to hold them, see
  // lib/guestPoints.ts — is shown the same way.
  points?: number;
  // Public profile page content (see app/user/[id]/page.tsx and lib/
  // userProfile.ts) — DB-edited only, unlike points above.
  bio?: string | null;
  bannerUrl?: string | null;
  // Cumulative seconds, tracked automatically by the signaling server —
  // never hand-edited. Absent on an older API response, same "reads as 0"
  // fallback as points.
  callSeconds?: number;
  micSeconds?: number;
  shareSeconds?: number;
  createdAt: number;
  updatedAt: number;
};


// Which social providers this account can also log in with, plus whether it
// still has a password. Kept as plain strings (not the OAuthProviderId union
// in oauthApi.ts) so this module stays at the bottom of the import graph —
// oauthApi imports *from* here.
export type AccountConnections = { providers: string[]; hasPassword: boolean };

const TOKEN_STORAGE_KEY = "sharescreen:accountToken";

// localStorage (not sessionStorage) — unlike the admin token in
// adminApi.ts, a regular account is meant to keep someone logged in across
// browser sessions, not just the current tab.
let cachedToken: string | null = null;
let initialized = false;
const listeners = new Set<() => void>();

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getAccountToken(): string | null {
  if (!initialized) {
    cachedToken = readStoredToken();
    initialized = true;
  }
  return cachedToken;
}

// Exported because the social login gets its token from a redirect rather
// than from a fetch in this module (see oauthApi.ts / the OAuth callback
// page) — it still has to land in the same place, through the same
// listeners, so every consumer of useAccountToken reacts identically no
// matter how the token was obtained.
export function setAccountToken(token: string | null) {
  cachedToken = token;
  initialized = true;
  if (typeof window !== "undefined") {
    try {
      if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // ignored - localStorage may be unavailable (private mode, quota, etc.)
    }
  }
  listeners.forEach((l) => l());
}

function subscribeAccountToken(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getAccountTokenServer(): string | null {
  return null;
}

export function useAccountToken(): string | null {
  return useSyncExternalStore(subscribeAccountToken, getAccountToken, getAccountTokenServer);
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return (data && typeof data === "object" && "error" in data && String(data.error)) || fallback;
}

export type UsernameCheck = {
  username: string;
  // Whether it passes the shape rules at all (3-20 letters, digits or _).
  valid: boolean;
  available: boolean;
  error?: string;
};

// Asked as somebody types on the signup form. Cheap on the server (one lookup
// in the same index every login goes through), and it exists so that finding a
// free username is something you do *while typing* rather than by submitting
// the form and reading the error — which is how people were burning the
// signup rate limit and getting auto-banned for trying to sign up.
export async function checkUsernameAvailable(
  username: string,
  signal?: AbortSignal
): Promise<UsernameCheck> {
  const res = await fetch(
    `${getSignalingHttpBase()}/auth/username-available?username=${encodeURIComponent(username)}`,
    { signal }
  );
  if (!res.ok) throw new Error("Não foi possível verificar o usuário.");
  return (await res.json()) as UsernameCheck;
}

export async function registerAccount(
  username: string,
  displayName: string,
  password: string
): Promise<{ token: string; account: Account }> {
  const res = await fetch(`${getSignalingHttpBase()}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, displayName, password }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Falha ao criar conta."));
  const data = (await res.json()) as { token: string; account: Account };
  setAccountToken(data.token);
  return data;
}

export async function loginAccount(
  username: string,
  password: string
): Promise<{ token: string; account: Account }> {
  const res = await fetch(`${getSignalingHttpBase()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Usuário ou senha inválidos."));
  const data = (await res.json()) as { token: string; account: Account };
  setAccountToken(data.token);
  return data;
}

// Finishes a social *signup*: the ticket proves the provider identity was
// already verified server-side, and these are the names the user just chose
// for it. Same { token, account } contract as loginAccount above, so the
// caller can't tell the two apart afterwards.
export async function completeOAuthSignup(
  ticket: string,
  username: string,
  displayName: string
): Promise<{ token: string; account: Account }> {
  const res = await fetch(`${getSignalingHttpBase()}/auth/oauth/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket, username, displayName }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Falha ao criar conta."));
  const data = (await res.json()) as { token: string; account: Account };
  setAccountToken(data.token);
  return data;
}

export function logoutAccount() {
  setAccountToken(null);
}

// Resolves the currently stored token to its account, clearing it if the
// server no longer accepts it (expired, or the account is gone) — called on
// startup to decide whether to auto-connect as this account.
//
// Also brings back the account's linked providers, since it's the one
// request that already knows the answer: re-asking on every render of the
// connections panel would be a second round trip for data this one carries
// for free.
export async function fetchMe(): Promise<{
  account: Account;
  connections: AccountConnections;
} | null> {
  const token = getAccountToken();
  if (!token) return null;
  const res = await fetch(`${getSignalingHttpBase()}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    setAccountToken(null);
    return null;
  }
  const data = (await res.json()) as { account: Account; connections?: AccountConnections };
  return {
    account: data.account,
    // An older API that predates social login answers without this field;
    // "nothing linked, has a password" is the right reading of that.
    connections: data.connections ?? { providers: [], hasPassword: true },
  };
}

// Detaches a provider from the logged-in account. The API refuses when it's
// the only way in left (no password and no other provider), which surfaces
// here as the thrown message.
export async function unlinkOAuthProvider(provider: string): Promise<void> {
  const token = getAccountToken();
  if (!token) throw new Error("Você não está conectado.");
  const res = await fetch(`${getSignalingHttpBase()}/auth/oauth/${provider}/link`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Falha ao desconectar."));
}

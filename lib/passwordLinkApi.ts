"use client";

import type { Account } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";

// The page an administrator's "new password" link opens (see the API's
// passwordResetLinkRoutes.ts). No session needed: the token in the link is
// the whole credential.

export type PasswordLinkInfo = {
  account: { username: string; displayName: string; avatarUrl: string | null };
  expiresAt: number;
};

/** Thrown when the link was used, replaced by a newer one, or expired. */
export class PasswordLinkGoneError extends Error {}

async function errorFrom(res: Response): Promise<Error> {
  if (res.status === 404) return new PasswordLinkGoneError("gone");
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(data?.error ?? `HTTP ${res.status}`);
}

function linkUrl(token: string): string {
  return `${getSignalingHttpBase()}/auth/password/link/${encodeURIComponent(token)}`;
}

export async function fetchPasswordLink(token: string): Promise<PasswordLinkInfo> {
  const res = await fetch(linkUrl(token), { cache: "no-store" });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as PasswordLinkInfo;
}

/**
 * Sets the password and spends the link. Returns a session for that account,
 * but does not store it: the page decides, so a different account already
 * signed in on this browser is not swapped out without asking.
 */
export async function setPasswordWithLink(
  token: string,
  password: string
): Promise<{ token: string; account: Account }> {
  const res = await fetch(linkUrl(token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as { token: string; account: Account };
}

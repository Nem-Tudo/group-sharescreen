"use client";

import { getAccountToken, setAccountToken, type Account } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import { getCaptchaToken } from "./turnstile";
import { translate } from "@/lib/i18n";

// The email side of an account: confirming the address on it, and getting back
// in when the password is gone. Both are six digits in a message (see the
// API's emailRoutes.ts) — there is no emailed link anywhere in here, so
// nothing in this flow depends on which browser a mail client decides to open.
//
// Kept out of accountApi.ts on purpose. That module is the bottom of the
// import graph (oauthApi imports from it, not the other way round) and it is
// loaded by every page that knows who you are; this one is only pulled in by
// the two screens that actually offer these flows.

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return (data && typeof data === "object" && "error" in data && String(data.error)) || fallback;
}

/** What the settings card needs to draw itself. */
export type EmailState = {
  /** The address on the account, in full — this answer only goes to its owner. */
  email: string | null;
  verified: boolean;
  /**
   * Whether this deployment can send at all (RESEND_API_KEY). False hides the
   * whole card rather than offering a button that can only fail.
   */
  configured: boolean;
  /** The server's floor between two sends, mirrored into the button's countdown. */
  cooldownMs: number;
  expiresInMinutes: number;
};

export async function fetchEmailState(signal?: AbortSignal): Promise<EmailState | null> {
  const token = getAccountToken();
  if (!token) return null;
  const res = await fetch(`${getSignalingHttpBase()}/account/email`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  // A 401 here is not worth surfacing: the card is one block on a settings
  // page, and the session is resolved (and cleared, if it is dead) by fetchMe.
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await parseErrorMessage(res, translate("email.couldNotLoad")));
  return (await res.json()) as EmailState;
}

export type SendCodeResult = {
  sent: boolean;
  /** Masked by the server ("ti****@gmail.com") — shown in "we sent a code to…". */
  email?: string;
  alreadyVerified?: boolean;
  expiresAt?: number;
};

export async function sendEmailVerificationCode(): Promise<SendCodeResult> {
  const token = getAccountToken();
  if (!token) throw new Error(translate("accountApi.youAreNotSignedIn"));
  const res = await fetch(`${getSignalingHttpBase()}/account/email/send-code`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, translate("email.couldNotSend")));
  return (await res.json()) as SendCodeResult;
}

export async function confirmEmailCode(code: string): Promise<void> {
  const token = getAccountToken();
  if (!token) throw new Error(translate("accountApi.youAreNotSignedIn"));
  const res = await fetch(`${getSignalingHttpBase()}/account/email/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, translate("email.wrongCode")));
}

/**
 * Step one of a reset: asks for a code to be mailed to whoever owns this
 * username or address.
 *
 * Resolves for anything typed, including a username that does not exist — the
 * API answers the same way either way, on purpose, so that this cannot be used
 * to find out who has an account here. The screen says "if there is an account,
 * a code is on its way", which is exactly as much as is known.
 */
export async function requestPasswordReset(identifier: string): Promise<void> {
  const res = await fetch(`${getSignalingHttpBase()}/auth/password/forgot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier,
      turnstileToken: await getCaptchaToken("password_reset"),
    }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, translate("email.couldNotSend")));
}

/**
 * Step two: the code plus the new password. Answers with a session, so the
 * person ends up logged in rather than back on the login form.
 */
export async function resetPassword(
  identifier: string,
  code: string,
  password: string
): Promise<{ token: string; account: Account }> {
  const res = await fetch(`${getSignalingHttpBase()}/auth/password/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier,
      code,
      password,
      turnstileToken: await getCaptchaToken("password_reset"),
    }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, translate("email.wrongCode")));
  const data = (await res.json()) as { token: string; account: Account };
  setAccountToken(data.token);
  return data;
}

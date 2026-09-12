"use client";

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import { getDeviceId } from "./deviceId";
import { translate } from "@/lib/i18n";

// The push-subscription client: three thin calls onto the API's /push routes.
//
// Kept apart from lib/pushRegistration.ts on purpose. This file knows how to
// *tell the server* about a subscription; that one knows how to obtain one
// from whichever shell the app is running in, which is the half that is full
// of platform detail. Splitting them is what keeps the platform detail out of
// everything that only needs "register this endpoint".

export interface PushConfig {
  enabled: boolean;
  webPush: boolean;
  fcm: boolean;
  vapidPublicKey: string;
}

function authHeaders(): Record<string, string> {
  const token = getAccountToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Fetched once per page: the VAPID key is a deployment constant, and asking
// for it again on every re-render of whatever mounts the registrar would be a
// request per navigation for a value that cannot have changed.
let configPromise: Promise<PushConfig | null> | null = null;

export function fetchPushConfig(): Promise<PushConfig | null> {
  if (configPromise) return configPromise;
  configPromise = (async () => {
    try {
      const res = await fetch(`${getSignalingHttpBase()}/push/config`);
      if (!res.ok) return null;
      return (await res.json()) as PushConfig;
    } catch {
      return null;
    }
  })();
  return configPromise;
}

/** Registers one endpoint against the signed-in account. */
export async function registerPushSubscription(input: {
  kind: "webpush" | "fcm";
  endpoint: string;
  keys?: { p256dh: string; auth: string };
}): Promise<boolean> {
  const deviceId = getDeviceId();
  if (!deviceId) return false;
  try {
    const res = await fetch(`${getSignalingHttpBase()}/push/subscribe`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, deviceId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Forgets one endpoint — "parar de receber neste aparelho". */
export async function unregisterPushSubscription(endpoint: string): Promise<void> {
  try {
    await fetch(`${getSignalingHttpBase()}/push/unsubscribe`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    // An endpoint the server still thinks is live costs one notification that
    // lands nowhere, and the push service's own 410 removes the row on the
    // next send. Nothing to retry here.
  }
}

/**
 * Sends this account a notification right now.
 *
 * The "does the whole chain work" probe, and it is not a nicety: every link in
 * it fails silently by design, so without this the only way to test
 * notifications is to ask a second person to message you.
 */
export async function sendTestPush(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/push/test`, {
      method: "POST",
      headers: authHeaders(),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? translate("common.couldNotSend") };
    return { ok: true };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

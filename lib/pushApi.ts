"use client";

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import { getDeviceId } from "./deviceId";
import { getLocale, translate } from "@/lib/i18n";

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
  /** The kinds that can be silenced one by one — the API's own list. */
  kinds?: NotifyKind[];
}

/** Kept in step with the API's NOTIFY_KINDS (see notifyPrefsModels.ts). */
export type NotifyKind =
  | "dm"
  | "call"
  | "group-message"
  | "theme-like"
  | "friend-request"
  | "gift";

/** One device this account receives notifications on. */
export interface PushDevice {
  id: string;
  kind: "webpush" | "fcm";
  deviceId: string;
  userAgent: string;
  locale: string | null;
  createdAt: number;
  lastSeenAt: number;
  /** Whether this is the browser asking. */
  current: boolean;
}

/** What somebody has said they do not want to be told about. */
export interface NotifyPrefs {
  mutedKinds: NotifyKind[];
  mutedDms: string[];
  mutedGroups: string[];
  /** Minutes from local midnight, or null for "no quiet hours". */
  quietFrom: number | null;
  quietTo: number | null;
  /** Minutes to add to UTC for the person's local time. */
  quietOffset: number | null;
  quietAllowCalls: boolean;
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  mutedKinds: [],
  mutedDms: [],
  mutedGroups: [],
  quietFrom: null,
  quietTo: null,
  quietOffset: null,
  quietAllowCalls: true,
};

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
  /** "native" when the Android shell draws its own — see lib/androidNotifications.ts. */
  renderer?: "native";
}): Promise<boolean> {
  const deviceId = getDeviceId();
  if (!deviceId) return false;
  try {
    const res = await fetch(`${getSignalingHttpBase()}/push/subscribe`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      // The language this browser is reading the site in, so the notification
      // that lands on it is written in that one. Sent on every registration —
      // which is every app open — so switching the site's language switches
      // them too, without a route of its own.
      body: JSON.stringify({ ...input, deviceId, locale: getLocale() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── The device list ──────────────────────────────────────────────────────

/** Where this account receives notifications, newest use first. */
export async function fetchPushDevices(): Promise<PushDevice[]> {
  const deviceId = getDeviceId();
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/push/devices?deviceId=${encodeURIComponent(deviceId ?? "")}`,
      { headers: authHeaders() }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { devices?: PushDevice[] };
    return Array.isArray(data.devices) ? data.devices : [];
  } catch {
    return [];
  }
}

/** Turns one device off — including one that is not this one. */
export async function removePushDevice(id: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/push/devices/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: authHeaders() }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Preferences ──────────────────────────────────────────────────────────

export async function fetchNotifyPrefs(): Promise<NotifyPrefs | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/push/prefs`, { headers: authHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as { prefs?: NotifyPrefs };
    return data.prefs ?? null;
  } catch {
    return null;
  }
}

/** Changes some of them; whatever is left out is left alone. */
export async function saveNotifyPrefs(patch: Partial<NotifyPrefs>): Promise<NotifyPrefs | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/push/prefs`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { prefs?: NotifyPrefs };
    return data.prefs ?? null;
  } catch {
    return null;
  }
}

/**
 * Silences (or un-silences) one conversation, group or kind.
 *
 * Its own call rather than a PATCH of the whole list: the mute button in a
 * conversation must not be able to overwrite a list another tab changed a
 * moment ago — the API adds and removes one entry at a time.
 */
export async function setNotifyMute(
  list: "dm" | "group" | "kind",
  id: string,
  muted: boolean
): Promise<NotifyPrefs | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/push/prefs/mute`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ list, id, muted }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { prefs?: NotifyPrefs };
    return data.prefs ?? null;
  } catch {
    return null;
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

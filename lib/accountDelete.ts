// Deleting your own account, in one place.
//
// "Excluir" from the person's side, a tombstone from the server's: nothing is
// erased, the account only becomes unreachable for good — it cannot be signed
// into again, and its profile is gone for everybody (see the API's
// accountStore.markAccountDeleted). The row on /me that leads here is a new
// feature, so it goes out behind a feature flag created in the admin panel —
// see CLAUDE.md.
//
// Keys and event names live here rather than being typed at each call site,
// because an event whose name is not exactly one of the feature's "site
// events" in the admin panel is an event that is silently dropped.

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import { translate } from "@/lib/i18n";

/** The feature's key in the admin panel. Target: user. */
export const ACCOUNT_DELETE_FEATURE = "account-delete";

/**
 * Every event the flow reports. Each has to be registered as a "site event"
 * on the feature in the admin panel or it will not be counted.
 */
export const ACCOUNT_DELETE_EVENTS = {
  /** The page was opened from /me. */
  open: "account_delete_open",
  /** The sign-in step was passed and the confirmation shown. */
  confirmShown: "account_delete_confirm_shown",
  /** Refused because the account still owns a group. */
  blockedGroups: "account_delete_blocked_groups",
  /** Refused because a subscription is still renewing. */
  blockedSubscription: "account_delete_blocked_subscription",
  /** The account was deleted. */
  done: "account_delete_done",
} as const;

export type DeleteAccountResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /** The sign-in is too old — the page shows the login step again. */
      reauthRequired?: boolean;
      usernameMismatch?: boolean;
      /** Groups this account owns, to be handed over first. */
      groups?: { id: string; name: string }[];
      /** A card subscription that would go on charging. */
      subscriptionActive?: boolean;
    };

/** POST /account/delete — `username` is the confirmation typed back. */
export async function deleteOwnAccount(username: string): Promise<DeleteAccountResult> {
  const token = getAccountToken();
  if (!token) return { ok: false, error: translate("common.noConnectionToTheServer"), reauthRequired: true };
  try {
    const res = await fetch(`${getSignalingHttpBase()}/account/delete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as Omit<Extract<DeleteAccountResult, { ok: false }>, "ok">;
    return {
      ok: false,
      error: data.error ?? translate("accountDelete.couldNotDelete"),
      reauthRequired: data.reauthRequired,
      usernameMismatch: data.usernameMismatch,
      groups: data.groups,
      subscriptionActive: data.subscriptionActive,
    };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

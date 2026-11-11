// What an administrator may do in /admin, one switch per job.
//
// A copy of the API's server/adminPermissions.ts — keep the two lists in sync.
// The API is what enforces them; here they only decide which tabs and panels
// are drawn, so a panel that would answer "unauthorized" is never shown.
//
// Stored as ADMIN_PERM_<KEY> flags on the account, so they arrive with the
// account itself (/auth/me) and need no request of their own.

import { translate } from "@/lib/i18n";

export const ADMIN_PERMISSIONS = [
  "stats",
  "turn",
  "premium_grant",
  "gifts",
  "test_gifts",
  "cancellations",
  "account_flags",
  "badges",
  "usernames",
  "points",
  "auto_flags",
  "groups",
  "bots",
  "bans",
  "themes",
  "banned_words",
  "antispam",
  "eval",
  "features",
  "announcement",
  "supporters",
  "desktop_update",
  "event_promos",
  "ads",
  "logs",
  "sales",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_PERM_FLAG_PREFIX = "ADMIN_PERM_";

export function adminPermissionFlag(permission: AdminPermission): string {
  return `${ADMIN_PERM_FLAG_PREFIX}${permission.toUpperCase()}`;
}

/** A flag only ADMIN_MASTER may add or remove. */
export function isRestrictedAdminFlag(flag: string): boolean {
  return flag === "ADMIN" || flag === "ADMIN_MASTER" || flag.startsWith(ADMIN_PERM_FLAG_PREFIX);
}

/** What these flags allow. ADMIN_MASTER: everything. Not ADMIN: nothing. */
export function adminPermissionsFromFlags(flags: readonly string[]): Set<AdminPermission> {
  if (!flags.includes("ADMIN")) return new Set();
  if (flags.includes("ADMIN_MASTER")) return new Set(ADMIN_PERMISSIONS);
  return new Set(ADMIN_PERMISSIONS.filter((permission) => flags.includes(adminPermissionFlag(permission))));
}

export function adminPermissionLabel(permission: AdminPermission): string {
  return translate(`admin.permissions.${permission}`);
}

export function adminPermissionHint(permission: AdminPermission): string {
  return translate(`admin.permissions.${permission}.hint`);
}

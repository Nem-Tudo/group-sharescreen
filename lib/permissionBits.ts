import type { AnyPermissionKey } from "./groupPermissions";

// A set of group permissions as one integer — the `permissions` of a bot's
// install link (/bots/:id/add?permissions=...), the way Discord's works.
//
// A copy of the API's permissionBits.ts, and it has to match it bit for bit:
// each switch is the bit at its place in this list, and links already handed
// out decode through it. New switches are only ever appended.
export const PERMISSION_BITS: readonly AnyPermissionKey[] = [
  "administrator",
  "manageGroup",
  "manageChannels",
  "manageRoles",
  "kickMembers",
  "banMembers",
  "manageMessages",
  "manageReactions",
  "createInvites",
  "manageWebhooks",
  "viewChannel",
  "sendMessages",
  "sendGifs",
  "sendImages",
  "mentionMembers",
  "mentionEveryone",
  "addReactions",
  "react",
  "connect",
  "mic",
  "screen",
  "camera",
  "videoSource",
  "chat",
  "gif",
  "image",
];

export const ALL_PERMISSION_BITS = (1 << PERMISSION_BITS.length) - 1;

export function bitOf(key: AnyPermissionKey): number {
  return 1 << PERMISSION_BITS.indexOf(key);
}

export function hasBit(bits: number, key: AnyPermissionKey): boolean {
  return (bits & bitOf(key)) !== 0;
}

/** From a query string. Null when absent or not a bitfield. */
export function parsePermissionBits(raw: string | null | undefined): number | null {
  if (!raw || !/^\d{1,10}$/.test(raw.trim())) return null;
  return Number(raw.trim()) & ALL_PERMISSION_BITS;
}

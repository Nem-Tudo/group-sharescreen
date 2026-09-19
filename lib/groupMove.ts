import type { GroupChannel, GroupDetail } from "./groupsApi";
import { canInChannel, canManage, isAdministrator, memberCanInChannel } from "./groupPermissions";
import { signalingClient } from "./signalingClient";
import { trackFeatureEvent } from "./features";
import { markFeatureUsed } from "@/components/NewBadge";

// Moving somebody in one of a group's calls to another of its voice rooms —
// "Conectar" or not, that is the point (see the API's "group-move-member").
// Two ways in, one set of rules: the member menu's "Mover para" and dragging
// them onto another room in the rooms list.

/** The experiment behind moving members — and the NewBadge's id. */
export const GROUP_MOVE_FEATURE = "group-move-members";

/** The voice room somebody is in, by the group's own record of its calls — null when in none. */
export function voiceChannelOf(detail: GroupDetail, userId: string): string | null {
  for (const [channelId, people] of Object.entries(detail.voice ?? {})) {
    if (people.some((p) => p.userId === userId)) return channelId;
  }
  return null;
}

/**
 * Whether the person looking may move `userId` at all — the API's limits:
 * "moveMembers", nobody moves the owner, and only the owner moves an
 * administrator. Where they are is the caller's question.
 */
export function mayMoveMember(detail: GroupDetail, userId: string): boolean {
  if (!canManage(detail, "moveMembers")) return false;
  if (userId === detail.me.id || detail.me.role === "owner") return true;
  return !isAdministrator(detail, { id: userId });
}

/**
 * Whether `channel` is somewhere they can be moved to: another voice room,
 * one both of you can see — a room they cannot see would be answered as not
 * existing.
 */
export function canMoveTo(detail: GroupDetail, userId: string, channel: GroupChannel, fromChannelId: string | null): boolean {
  return (
    channel.kind === "voice" &&
    channel.id !== fromChannelId &&
    canInChannel(detail, channel, "viewChannel") &&
    memberCanInChannel(detail, channel, { id: userId }, "viewChannel")
  );
}

/** Whether they could have joined `channel` themselves — false is where the move matters. */
export function couldConnect(detail: GroupDetail, userId: string, channel: GroupChannel): boolean {
  return memberCanInChannel(detail, channel, { id: userId }, "connect");
}

export function moveGroupMember(groupId: string, userId: string, channelId: string, via: "menu" | "drag"): void {
  signalingClient.moveGroupMember(groupId, userId, channelId);
  markFeatureUsed(GROUP_MOVE_FEATURE);
  trackFeatureEvent("group_move_member", { group: groupId, feature: GROUP_MOVE_FEATURE });
  if (via === "drag") trackFeatureEvent("group_move_member_drag", { group: groupId, feature: GROUP_MOVE_FEATURE });
}

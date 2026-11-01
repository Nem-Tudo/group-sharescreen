import type { GroupChannel, GroupDetail } from "./groupsApi";
import { canManage } from "./groupPermissions";
import { trackFeatureEvent } from "./features";
import { markFeatureUsed } from "@/components/NewBadge";

// A voice room's "Limite de participantes", the way a Discord voice channel
// has one: set in the room's settings, shown as "2/5" in the rooms list, and
// enforced by the API's join (see GroupChannel.userLimit there). Whoever may
// move members walks into a full room anyway, and so does somebody they move.

/** The experiment behind setting a limit — and the NewBadge's id. */
export const GROUP_VOICE_LIMIT_FEATURE = "group-voice-user-limit";

/** The room's limit, 0 for none. */
export function userLimitOf(channel: GroupChannel): number {
  return channel.kind === "voice" ? channel.userLimit ?? 0 : 0;
}

/**
 * Whether the person looking would be turned away from `channel` — full, and
 * not somebody the limit lets past. `people` is who is in it, one per person.
 */
export function isVoiceRoomFullFor(detail: GroupDetail, channel: GroupChannel, people: number): boolean {
  const limit = userLimitOf(channel);
  return limit > 0 && people >= limit && !canManage(detail, "moveMembers");
}

export function trackVoiceLimitSet(groupId: string, limit: number): void {
  markFeatureUsed(GROUP_VOICE_LIMIT_FEATURE);
  trackFeatureEvent(limit > 0 ? "group_voice_limit_set" : "group_voice_limit_clear", {
    group: groupId,
    value: limit,
    feature: GROUP_VOICE_LIMIT_FEATURE,
  });
}

/** Somebody clicked a room that was full for them. */
export function trackVoiceLimitBlocked(groupId: string): void {
  trackFeatureEvent("group_voice_full_click", { group: groupId, feature: GROUP_VOICE_LIMIT_FEATURE });
}

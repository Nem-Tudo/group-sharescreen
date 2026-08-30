// The bounds a room's participant limit is allowed to take. The client's copy
// of the server's MIN/MAX_ROOM_MEMBER_LIMIT (see roomStore.ts) — the input
// enforces them so a number that would be silently clamped is refused where
// somebody can see it, and the server clamps again because it is the one that
// decides.
//
// Two, not one: a limit of one is a room that can never be more than its owner,
// which is a different feature and a confusing way to spell it.
export const MIN_ROOM_MEMBER_LIMIT = 2;
export const MAX_ROOM_MEMBER_LIMIT = 200;

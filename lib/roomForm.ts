import {
  ENFORCE_NEW_ROOM_CODE_SYSTEM,
  MAX_PRIVATE_ROOM_NAME_LENGTH,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  isPrivateRoomHandle,
  roomHandleFromInput,
  splitPrivateRoomHandle,
  toPrivateRoomHandle,
  toRoomHandle,
} from "./roomsApi";
import { translate } from "./i18n";

// What a "start a room" form does with what was typed — the home page's form
// and the one at the top of the groups layout's home (experiment groups-hub)
// ask the same three questions, and must answer them the same way.
//
// Mirrors server/signaling.ts's HANDLE_RE — see the home page's copy.

export const ROOM_HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;

/** Public; a private room to create (the code is minted here); a private room to join (name and code typed). */
export type RoomMode = "public" | "private-create" | "private-join";

export type RoomTarget = { ok: true; handle: string; needsCheck: boolean } | { ok: false; error: string };

/**
 * The room a submit is about to open, or why it cannot. `needsCheck` is set
 * for a private room being joined: joining one that is not there would create
 * it, so the caller asks whether it exists before going (see roomExists).
 */
export function roomTarget(mode: RoomMode, raw: string): RoomTarget {
  // A pasted link is unwrapped back into the room it names first.
  const trimmed = roomHandleFromInput(raw);
  if (mode === "private-create") {
    if (trimmed.length > MAX_PRIVATE_ROOM_NAME_LENGTH) {
      return { ok: false, error: translate("common.theNameCanHaveAtMost", { MAX_PRIVATE_ROOM_NAME_LENGTH }) };
    }
    const handle = toPrivateRoomHandle(trimmed, generateRoomCode());
    if (!ROOM_HANDLE_RE.test(handle)) return { ok: false, error: translate("common.use1To32LettersNumbers") };
    return { ok: true, handle, needsCheck: false };
  }
  if (mode === "private-join") {
    const handle = isPrivateRoomHandle(trimmed) ? trimmed : toRoomHandle(trimmed, true);
    if (!ROOM_HANDLE_RE.test(handle)) return { ok: false, error: translate("common.use1To32LettersNumbers") };
    if (ENFORCE_NEW_ROOM_CODE_SYSTEM && !splitPrivateRoomHandle(handle)) {
      return { ok: false, error: translate("page.includeTheCodeAtTheEnd", { value: "0".repeat(ROOM_CODE_LENGTH) }) };
    }
    return { ok: true, handle, needsCheck: true };
  }
  const handle = toRoomHandle(trimmed, false);
  if (!ROOM_HANDLE_RE.test(handle)) return { ok: false, error: translate("common.use1To32LettersNumbers") };
  return { ok: true, handle, needsCheck: false };
}

"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "./AuthContext";
import {
  applyRoomTheme,
  fetchTheme,
  isRoomThemeOptedOut,
  isRoomThemeOptedOutServer,
  isThemePreviewActive,
  isThemePreviewActiveServer,
  subscribeRoomThemeOptOut,
  subscribeThemePreview,
  type RoomTheme,
} from "./roomThemes";

// Decides which theme a room wears, fetches it, and puts it on.
//
// The rule, in one line: **the room wins**. If somebody with Pro Max repainted
// the room, everybody in it sees that — which is what "troca pra todos" has to
// mean — and your own theme is what you see in every room that has not been
// repainted. Both are ids rather than palettes (see the API's roomStore and
// accountModels), so the answer to "what does this look like" is re-read on
// every join, and an author editing their theme reaches every room wearing it
// the next time anybody loads one.
//
// Nothing here is cached across rooms on purpose. A theme read is one small
// request on entering a call that is about to negotiate video with several
// peers, and a cache would be a second copy of a thing whose whole selling
// point is that it updates.

export interface RoomThemeState {
  /** The theme actually on screen, or null for the site's own look. */
  theme: RoomTheme | null;
  /** Whether the look came from the room rather than from this account. */
  fromRoom: boolean;
}

/**
 * `roomThemeId` is what the room broadcast (see the "room-settings" payload);
 * undefined means the room has not said yet, which is different from null —
 * "not told" should not flash the account's own theme on and then off again.
 */
export function useRoomTheme(roomThemeId: string | null | undefined): RoomThemeState {
  const { account } = useAuth();
  const mine = account?.roomThemeId ?? null;
  // The room's if it has one, otherwise this account's. Undefined until the
  // room answers, which is why the effect below waits rather than applying.
  // Whether this browser refuses room themes outright. See the opt-out in
  // roomThemes — it is a viewing preference, kept per browser.
  const optedOut = useSyncExternalStore(
    subscribeRoomThemeOptOut,
    isRoomThemeOptedOut,
    isRoomThemeOptedOutServer
  );
  // The room's if it has one and this browser accepts them, otherwise this
  // account's. Opting out does not mean "no theme" — it means the room never
  // gets to choose for you, and what you chose for yourself still stands.
  const fromRoomId = optedOut ? null : roomThemeId;
  const wanted = roomThemeId === undefined ? undefined : fromRoomId ?? mine;
  // Tagged with the id it answers, which is what lets "no theme" be *derived*
  // rather than stored: without the tag, clearing a theme would mean writing
  // state from inside an effect, and the answer for "nothing to wear" is
  // already knowable from `wanted` alone.
  const [loaded, setLoaded] = useState<{ id: string; theme: RoomTheme | null } | null>(null);
  // Whether the editor is showing something right now — a boolean, not the
  // colours. See roomThemes' preview channel: the colours are painted there
  // so that dragging one does not re-render the room around this hook.
  const previewing = useSyncExternalStore(
    subscribeThemePreview,
    isThemePreviewActive,
    isThemePreviewActiveServer
  );

  useEffect(() => {
    // Somebody is watching their own edit. The preview owns the document until
    // they are done; repainting the room's real theme over them mid-drag is
    // exactly what this stands aside for.
    if (previewing) return;
    // The room has not said yet. Applying anything here is the flash of this
    // account's own colours on every join, immediately replaced.
    if (wanted === undefined) return;
    if (!wanted) {
      applyRoomTheme(null);
      return;
    }
    // Already in hand — including from before a preview covered it, which is
    // the case that makes closing the editor restore instead of re-fetch.
    if (loaded?.id === wanted) {
      applyRoomTheme(loaded.theme?.spec ?? null);
      return;
    }
    const controller = new AbortController();
    void fetchTheme(wanted, controller.signal).then((theme) => {
      if (controller.signal.aborted) return;
      // A theme that no longer exists — deleted by its author, or unpublished
      // out from under a room — resolves to nothing rather than to an error.
      // The room falls back to the site's look, which is the right failure for
      // something whose only job is to be a colour.
      setLoaded({ id: wanted, theme });
      applyRoomTheme(theme?.spec ?? null);
    });
    return () => controller.abort();
  }, [wanted, previewing, loaded]);

  // Taken off when this leaves the screen, whatever the reason — navigating
  // out of the room, or the room ending. The theme is written onto the
  // document element (it has to be, so dialogs portalled to the body follow
  // it), so nothing else would ever remove it.
  useEffect(() => {
    return () => applyRoomTheme(null);
  }, []);

  // Only the answer to the question currently being asked. A reply that
  // landed for the previous room, or for the theme worn before this one, is
  // not an answer about this one.
  const theme = wanted && loaded?.id === wanted ? loaded.theme : null;
  return { theme, fromRoom: Boolean(theme && fromRoomId) };
}

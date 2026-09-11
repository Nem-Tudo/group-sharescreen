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
  getCachedTheme,
  getThemeSeq,
  getWornOverride,
  getWornOverrideServer,
  subscribeRoomThemeOptOut,
  subscribeThemeChanged,
  subscribeThemePreview,
  subscribeWornOverride,
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
 *
 * `viewThemeId` is a theme this tab was sent here to look at (see the theme
 * page's "Visualizar" and themeViewRoomLink). It outranks everything below,
 * including the room's own theme and the opt-out: both of those are about
 * rooms deciding for you, and this is somebody who asked, by name, to see one
 * particular theme. It is also only ever on their screen — nothing here
 * writes it to the room or to the account.
 */
export function useRoomTheme(
  roomThemeId: string | null | undefined,
  viewThemeId: string | null = null
): RoomThemeState {
  const { account } = useAuth();
  // What this tab just chose, if the account has not caught up yet. Pressing
  // "usar tema" writes it (see the workshop and the hub) so the room repaints
  // now rather than after a round trip to /auth/me and back.
  const override = useSyncExternalStore(
    subscribeWornOverride,
    getWornOverride,
    getWornOverrideServer
  );
  const mine = override !== undefined ? override : account?.roomThemeId ?? null;
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
  // A viewed theme does not wait for the room to answer: it does not depend on
  // anything the room could say, so there is no flash to avoid by waiting.
  const wanted = viewThemeId
    ? viewThemeId
    : roomThemeId === undefined
      ? undefined
      : fromRoomId ?? mine;
  // Bumped whenever a theme is saved or deleted anywhere in this tab (see
  // roomThemes' notifyThemeChanged). It is part of what a cached answer is an
  // answer *to*: the same id after an edit is a different palette.
  const seq = useSyncExternalStore(subscribeThemeChanged, getThemeSeq, () => 0);
  // Tagged with the id it answers and the edit it answers at, which is what
  // lets "no theme" be *derived* rather than stored: without the tag, clearing
  // a theme would mean writing state from inside an effect, and the answer for
  // "nothing to wear" is already knowable from `wanted` alone.
  const [loaded, setLoaded] = useState<{
    id: string;
    seq: number;
    theme: RoomTheme | null;
  } | null>(null);
  // Read here rather than stored: a cached palette is already an answer, and
  // putting it into state would be a second render to learn what this one
  // already knows. Consistent across renders because the only thing that
  // empties the cache also bumps `seq`, which is subscribed — so a render
  // always follows.
  const cached = wanted ? getCachedTheme(wanted) : null;
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
    // Unless the theme was edited since, in which case what is in hand is the
    // version the author just replaced.
    if (loaded?.id === wanted && loaded.seq === seq) {
      applyRoomTheme(loaded.theme?.spec ?? null);
      return;
    }
    // Already in this tab's hands — the palette came down with whatever list
    // the person was looking at when they chose it, so there is nothing to ask
    // for. This is the whole difference between a theme that changes on the
    // press and one that changes a second later.
    //
    // Safe to trust because the cache is emptied the moment anything is edited
    // (see notifyThemeChanged): a stale entry can only be somebody *else's*
    // edit, which this room was never going to notice before its next load
    // anyway.
    if (cached) {
      applyRoomTheme(cached.spec);
      return;
    }
    const controller = new AbortController();
    void fetchTheme(wanted, controller.signal).then((theme) => {
      if (controller.signal.aborted) return;
      // A theme that no longer exists — deleted by its author, or unpublished
      // out from under a room — resolves to nothing rather than to an error.
      // The room falls back to the site's look, which is the right failure for
      // something whose only job is to be a colour.
      setLoaded({ id: wanted, seq, theme });
      applyRoomTheme(theme?.spec ?? null);
    });
    return () => controller.abort();
  }, [wanted, previewing, loaded, seq, cached]);

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
  const theme =
    cached ?? (wanted && loaded?.id === wanted && loaded.seq === seq ? loaded.theme : null);
  return { theme, fromRoom: Boolean(theme && !viewThemeId && fromRoomId) };
}

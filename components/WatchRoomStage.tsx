"use client";

import { useCallback, useEffect, useState } from "react";
import { CallOutlet } from "@/components/CallOutlet";
import { RoomSkeleton } from "@/components/RoomSkeleton";
import { RoomPrejoin, ROOM_PREJOIN_EVENTS, ROOM_PREJOIN_FEATURE } from "@/components/RoomPrejoin";
import { useAuth } from "@/lib/AuthContext";
import { getCallSession, setCallSession, useCallSession } from "@/lib/callSession";
import { isAppShell } from "@/lib/desktop";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { GROUP_VOICE_PREFIX } from "@/lib/groupLinks";
import { isCallRoomHandle, isThemeRoomHandle } from "@/lib/roomsApi";

// What /watch/[handle] renders instead of the room itself.
//
// Opening a room's page is still joining it — that has not changed, and the
// effect below is where it now happens. What changed is the leaving: the page
// no longer owns the room, so walking off it no longer ends the call (see
// lib/callSession). Only hanging up does.
//
// Experiment "room-prejoin": a screen in front of the door (see RoomPrejoin),
// and the join waits for its "Entrar". Only ever for an ordinary room opened on
// its own page. Groups and private calls do not come through this component at
// all — a group's voice room opens from the group's pages, a direct call from
// the conversation (lib/callActions) — and the handles below are left out as
// well, for the odd link that brings one of them here anyway:
//   - a group's voice room ("grp-…"), which belongs to its group;
//   - a private call's room ("priv-call-…"), which belongs to its conversation;
//   - the rooms the theme pages open, which are a tool, not a place to arrive.

function prejoinApplies(handle: string): boolean {
  return !handle.startsWith(GROUP_VOICE_PREFIX) && !isCallRoomHandle(handle) && !isThemeRoomHandle(handle);
}

export function WatchRoomStage({
  handle,
  viewThemeId,
}: {
  handle: string;
  viewThemeId: string | null;
}) {
  // Already in this very call (a page reopened mid-call, or walked back to
  // from elsewhere on the site): there is no door to stand at. Decided once,
  // when the page opens — it is a fact about how we got here.
  const [alreadyIn] = useState(() => {
    const current = getCallSession();
    return Boolean(current && current.handle === handle && !current.group);
  });
  // The apps have no guest mode (see WatchRoom's appShell): signed out there,
  // the room's own screen asks for an account, and a door offering a guest
  // name would be offering something the app then refuses.
  const [appShell] = useState(() => isAppShell());
  const { account, loading: resolvingAccount } = useAuth();
  const guestInApp = appShell && !resolvingAccount && !account;
  const eligible = prejoinApplies(handle) && !alreadyIn && !guestInApp;
  const prejoin = useFeature(ROOM_PREJOIN_FEATURE, { track: eligible });
  const [entered, setEntered] = useState(false);
  const enter = useCallback(() => setEntered(true), []);
  // Until the experiment has an answer, nobody joins: going in and then being
  // shown the door would be the worst of both.
  const canJoin = !eligible || (prejoin.ready && (!prejoin.enabled || entered));
  const showPrejoin = eligible && prejoin.ready && prejoin.enabled && !entered;

  useEffect(() => {
    if (!canJoin) return;
    const current = getCallSession();
    // Already here: a page reopened mid-call must not restart the call it is
    // about to draw. Any *other* call is left, exactly as it was when the room
    // belonged to the page.
    if (current && current.handle === handle && !current.group) return;
    setCallSession({ handle, viewThemeId, group: null });
    // The control side of "how many of the people who opened a room went in":
    // the screen counts its own (with the time spent on it) in RoomPrejoin.
    if (eligible && !prejoin.enabled) {
      trackFeatureEvent(ROOM_PREJOIN_EVENTS.enter, { feature: ROOM_PREJOIN_FEATURE });
    }
  }, [canJoin, handle, viewThemeId, eligible, prejoin.enabled]);

  const session = useCallSession();
  if (showPrejoin) return <RoomPrejoin handle={handle} onEnter={enter} />;
  // One frame, between this page mounting and the effect above running — and
  // the same shape the room lands in, which is what this skeleton is for.
  if (session?.handle !== handle) return <RoomSkeleton />;
  return <CallOutlet />;
}

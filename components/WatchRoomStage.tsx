"use client";

import { useEffect } from "react";
import { CallOutlet } from "@/components/CallOutlet";
import { RoomSkeleton } from "@/components/RoomSkeleton";
import { getCallSession, setCallSession, useCallSession } from "@/lib/callSession";

// What /watch/[handle] renders instead of the room itself.
//
// Opening a room's page is still joining it — that has not changed, and the
// effect below is where it now happens. What changed is the leaving: the page
// no longer owns the room, so walking off it no longer ends the call (see
// lib/callSession). Only hanging up does.


export function WatchRoomStage({
  handle,
  viewThemeId,
}: {
  handle: string;
  viewThemeId: string | null;
}) {
  useEffect(() => {
    const current = getCallSession();
    // Already here: a page reopened mid-call must not restart the call it is
    // about to draw. Any *other* call is left, exactly as it was when the room
    // belonged to the page.
    if (current && current.handle === handle && !current.group) return;
    setCallSession({ handle, viewThemeId, group: null });
  }, [handle, viewThemeId]);

  const session = useCallSession();
  // One frame, between this page mounting and the effect above running — and
  // the same shape the room lands in, which is what this skeleton is for.
  if (session?.handle !== handle) return <RoomSkeleton />;
  return <CallOutlet />;
}

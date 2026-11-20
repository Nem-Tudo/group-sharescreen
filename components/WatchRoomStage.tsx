"use client";

import { useCallback, useEffect, useState } from "react";
import { CallOutlet } from "@/components/CallOutlet";
import { RoomSkeleton } from "@/components/RoomSkeleton";
import {
  RoomPrejoin,
  ROOM_PREJOIN_EVENTS,
  ROOM_PREJOIN_FEATURE,
  clearPrejoinSkip,
  markPrejoinSkip,
  readPrejoinSkip,
} from "@/components/RoomPrejoin";
import { useAuth } from "@/lib/AuthContext";
import { getCallSession, setCallSession, useCallSession } from "@/lib/callSession";
import { isAppShell } from "@/lib/desktop";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { GROUP_VOICE_PREFIX } from "@/lib/groupLinks";
import { isCallRoomHandle, isThemeRoomHandle } from "@/lib/roomsApi";
import { getStoredName } from "@/lib/signalingClient";
import { startRoomVisitMetrics } from "@/lib/prejoinMetrics";

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
//
// One confirmation, never two. The room already has a screen of its own for
// somebody who arrives as nobody — no account, no guest name — where they make
// an account, sign in or pick a guest name, and that screen *is* their door. So
// the prejoin is only for somebody who arrives already being someone, decided
// once on arrival; signing in afterwards does not bring it up. And signing in
// can leave the page (Google, Discord, the login page) and come back to it, a
// fresh load with an account: a mark in this tab's sessionStorage (see
// markPrejoinSkip) carries "already went through a door" across that trip.

// Whether this page load is a reload of this very room. Reloading is already
// being in the room — a refresh to fix something, the app reloading itself for
// an update — and a door then is a question nobody asked. Only for the room the
// document was loaded on, and only once: the navigation entry keeps saying
// "reload" for the life of the document, including later rooms reached from
// here without a reload of their own.
let reloadClaimed = false;
function openedByReload(handle: string): boolean {
  if (reloadClaimed || typeof performance === "undefined") return false;
  try {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (entry?.type !== "reload") return false;
    return decodeURIComponent(new URL(entry.name).pathname) === `/watch/${handle}`;
  } catch {
    return false;
  }
}

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
  // Back from signing in that started at a door (this page's own name screen,
  // or the prejoin's "Entrar com sua conta"). Read here, cleared in an effect.
  const [skipMarked] = useState(() => readPrejoinSkip(handle));
  const [reloaded] = useState(() => openedByReload(handle));
  // For "tempo até entrar", the same clock on both sides of the experiment.
  const [openedAt] = useState(() => Date.now());
  const [appShell] = useState(() => isAppShell());
  const { account, loading: resolvingAccount } = useAuth();

  // Who this person was when they got here: an account, or a guest name saved
  // from before. Latched the first time the account is known (React's "store
  // what you saw" pattern — set during render, once), so that signing in on
  // the room's own name screen never turns this page into one with a prejoin.
  const [arrivedAsSomeone, setArrivedAsSomeone] = useState<boolean | null>(null);
  if (arrivedAsSomeone === null && !resolvingAccount) {
    // The apps have no guest mode (see WatchRoom's appShell): a saved guest
    // name means nothing there without an account.
    setArrivedAsSomeone(Boolean(account) || (!appShell && getStoredName() !== null));
  }

  const applies = prejoinApplies(handle) && !alreadyIn && !skipMarked && !reloaded;
  const eligible = applies && arrivedAsSomeone === true;
  const prejoin = useFeature(ROOM_PREJOIN_FEATURE, { track: eligible });
  const [entered, setEntered] = useState(false);
  const enter = useCallback(() => setEntered(true), []);
  // Until both answers are in — who they are, and which side of the experiment
  // — nobody joins: going in and then being shown the door would be the worst
  // of both.
  const canJoin =
    !applies || (arrivedAsSomeone !== null && (!eligible || (prejoin.ready && (!prejoin.enabled || entered))));
  const showPrejoin = eligible && prejoin.ready && prejoin.enabled && !entered;

  // The mark is spent by the visit it was left for; the reload, by the first
  // room to look at it.
  useEffect(() => {
    reloadClaimed = true;
    if (skipMarked) clearPrejoinSkip();
  }, [skipMarked]);

  // Why a room's page opened without the screen, for sizing who it reaches.
  // Both groups: these are facts about the visit, not about the screen.
  useEffect(() => {
    if (!prejoinApplies(handle) || alreadyIn) return;
    if (reloaded) trackFeatureEvent(ROOM_PREJOIN_EVENTS.skipReload, { feature: ROOM_PREJOIN_FEATURE });
  }, [handle, alreadyIn, reloaded]);
  useEffect(() => {
    if (applies && arrivedAsSomeone === false) {
      trackFeatureEvent(ROOM_PREJOIN_EVENTS.skipNobody, { feature: ROOM_PREJOIN_FEATURE });
    }
  }, [applies, arrivedAsSomeone]);

  // Arrived as nobody: the room's own screen is this person's door. If signing
  // in there leaves the page and comes back, the prejoin must not greet them
  // as if they had not just been through one.
  useEffect(() => {
    if (applies && arrivedAsSomeone === false) markPrejoinSkip(handle);
  }, [applies, arrivedAsSomeone, handle]);

  useEffect(() => {
    if (!canJoin) return;
    const current = getCallSession();
    // Already here: a page reopened mid-call must not restart the call it is
    // about to draw. Any *other* call is left, exactly as it was when the room
    // belonged to the page.
    if (current && current.handle === handle && !current.group) return;
    setCallSession({ handle, viewThemeId, group: null });
    // "Of the people who opened a room, how many went in, and how fast" — the
    // same event on both sides, counted only for visits that could have shown
    // the screen, so the two groups are the same kind of visit.
    if (eligible) {
      trackFeatureEvent(ROOM_PREJOIN_EVENTS.enter, {
        feature: ROOM_PREJOIN_FEATURE,
        value: Math.max(1, Date.now() - openedAt),
      });
    }
    // And what the visit was used for (see lib/prejoinMetrics): fewer people
    // walking in is only half of the question, the other half is whether
    // those who do use rooms less.
    if (eligible) startRoomVisitMetrics(handle);
  }, [canJoin, handle, viewThemeId, eligible, openedAt]);

  const session = useCallSession();
  if (showPrejoin) return <RoomPrejoin handle={handle} onEnter={enter} onSkip={enter} />;
  // One frame, between this page mounting and the effect above running — and
  // the same shape the room lands in, which is what this skeleton is for.
  if (session?.handle !== handle) return <RoomSkeleton />;
  return <CallOutlet />;
}

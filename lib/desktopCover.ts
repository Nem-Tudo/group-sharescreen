"use client";

import { useEffect, useState } from "react";
import { getDesktopBridge } from "./desktop";
import { trackFeatureEvent, useFeature } from "./features";
import { setWindowCovered } from "./pageHidden";

// Experiment "desktop-cover-hide": the desktop app treats its window hidden behind
// another application's — a game in full screen on the same monitor — like a
// minimised one: tiles let go of their video, viewers' senders stop encoding for
// us after a few seconds, the speaking pump and the clocks rest (see lib/pageHidden).
//
// Without it a call left behind a game goes on decoding every video in the room
// and drawing every frame of it for nobody: the shell runs with background
// throttling off, which also turns Chromium's own occlusion tracking off, and the
// shell only knew about minimised and tray. The shell now asks Windows (see
// electron/windowCover.ts). An experiment because it stops video somebody could in
// principle be looking at, if "covered" is ever wrong.
//
// Watched for the whole population of the experiment, control included, so both
// groups count how often and how long a call sits behind something; only the
// treatment acts on it.
export const DESKTOP_COVER_FEATURE = "desktop-cover-hide";

export const DESKTOP_COVER_EVENTS = {
  /** The window went behind another one, during a call. */
  covered: "desktop_cover",
  /** ...and came back after this many seconds (value). */
  seconds: "desktop_cover_s",
} as const;

/** Mounted with the call (see components/RoomCallHost); `active` while there is one. */
export function useDesktopCoverHide(active: boolean) {
  // The exposure is the first time it is covered: before that, nothing differs.
  const [seen, setSeen] = useState(false);
  const feature = useFeature(DESKTOP_COVER_FEATURE, { track: seen });
  const watching = active && feature.group !== null;
  const applies = feature.enabled;

  useEffect(() => {
    const watch = getDesktopBridge()?.watchWindowCovered;
    if (!watching || !watch) return;
    let since: number | null = null;
    const stop = watch((covered) => {
      if (covered && since === null) {
        since = Date.now();
        setSeen(true);
        trackFeatureEvent(DESKTOP_COVER_EVENTS.covered, { feature: DESKTOP_COVER_FEATURE });
      } else if (!covered && since !== null) {
        trackFeatureEvent(DESKTOP_COVER_EVENTS.seconds, {
          feature: DESKTOP_COVER_FEATURE,
          value: Math.round((Date.now() - since) / 1000),
        });
        since = null;
      }
      if (applies) setWindowCovered(covered);
    });
    return () => {
      stop();
      setWindowCovered(false);
    };
  }, [watching, applies]);
}

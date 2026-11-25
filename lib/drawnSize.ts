// Experiment "sq-drawn-size": what a viewer's tile asks the broadcaster for is the picture
// it draws, not the box the picture sits in.
//
// Every tile's <video> is object-fit: contain, so a picture that is not the box's shape is
// drawn smaller than the box, with bars. The size reported to qualityNegotiation used to be
// the box: a phone held upright, a lone tile filling a tall stage or an ultrawide screen in
// full screen asked for a picture as tall (or as wide) as the box, which no tier covers, and
// got the top tier the broadcaster offers. A 16:9 share drawn 390 px wide on a 3x phone needs
// 720 lines and was being sent at 1080 or more, at the broadcaster's cost (an encoder and an
// uplink per viewer) and the phone's (decoding pixels it throws away). In the reports
// (2026-11-17..25) the Android app got 1080p in 61% of visible sessions, against ~50% on
// computers.
//
// The sender scales by height (see scaleForHeight in lib/videoQuality), so what a tile needs is
// as many lines as the picture is drawn tall, whatever its shape: the size reported is a 16:9
// box with that many lines. A 21:9 picture is sent 21:9 at those lines, a portrait one portrait.

import { experimentFlag } from "./experimentFlag";
import { trackFeatureEvent } from "./features";
import { drawnNeed, tierForRenderedSize, tierSpec, MAX_TIER_FPS } from "./videoQuality";

export const DRAWN_SIZE_FEATURE = "sq-drawn-size";

/**
 * Counted in both groups, once per tile: its drawn picture asks for a smaller tier than its
 * box does. value = how many fewer lines it asks for.
 */
export const DRAWN_SIZE_EVENTS = { lower: "drawn_lower" } as const;

const flag = experimentFlag();
export const setDrawnSize = flag.set;
export const isDrawnSize = flag.get;
export const onDrawnSizeChange = flag.onChange;

/**
 * What a tile reports: the drawn picture in the experiment, the box outside it (see
 * drawnNeed in lib/videoQuality). `seen` is the tile's own, so each counts once. `magnify` is
 * what a transform does to the picture on top of the layout: a pinch zoom, a quarter turn's fit.
 */
export function reportedSize(
  boxWidth: number,
  boxHeight: number,
  video: { videoWidth: number; videoHeight: number } | null,
  seen?: { counted: boolean },
  magnify = 1
): { width: number; height: number } {
  const box = { width: boxWidth, height: boxHeight };
  if (!video) return box;
  const drawn = drawnNeed(boxWidth, boxHeight, video.videoWidth, video.videoHeight, magnify);
  if (seen && !seen.counted && drawn.height !== boxHeight) {
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    const lines = (w: number, h: number) => tierSpec(tierForRenderedSize(w, h, dpr, MAX_TIER_FPS)).height;
    const saved = lines(box.width, box.height) - lines(drawn.width, drawn.height);
    if (saved > 0) {
      seen.counted = true;
      trackFeatureEvent(DRAWN_SIZE_EVENTS.lower, { feature: DRAWN_SIZE_FEATURE, value: saved });
    }
  }
  return isDrawnSize() ? drawn : box;
}

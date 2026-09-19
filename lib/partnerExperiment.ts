"use client";

import { trackFeatureEvent, useFeature } from "./features";

// The partner-ad click-through experiment. One feature (user target, created
// in the admin panel's "Features" tab), one treatment — "on" — that changes
// three things at once:
//   - a room nobody is transmitting in shows the ad under its "start" buttons
//     instead of in the sidebar (see WatchRoom's empty pane);
//   - below lg the folded card's slim bar carries the ad's own button;
//   - click points read as something you *earn* ("+50", in gold, and "Clique e
//     ganhe 50 pontos" over the button) rather than as a price on the button.
//
// The events below fire for everybody, control included — that is what makes
// the two sides comparable. Every name has to be listed in the feature's
// "site events" in the admin panel to count. The admin panel's CTR table
// divides partner_click by partner_impression (and by partner_session_view)
// per group; see FeaturesPanel's PartnerCtrTable.
//
// Named "partner", never "ad", for the same reason as everything else around
// these cards: ad-blocker filter lists key off that word.

export const PARTNER_EXPERIMENT_FEATURE = "partner-ctr";

export const PARTNER_EVENTS = {
  /** A served ad on screen in a visible tab (once per serve — rotation included). */
  impression: "partner_impression",
  /** First sight of a given ad in this page load. */
  sessionView: "partner_session_view",
  /** The ad's own link opened, from any spot. Real ads only, never the house ad. */
  click: "partner_click",
  /** Which spot that click came from — one of these alongside every partner_click. */
  clickSidebar: "partner_click_sidebar",
  clickStage: "partner_click_stage",
  clickBar: "partner_click_bar",
  clickTile: "partner_click_tile",
  clickVideo: "partner_click_video",
  /** Click points collected. value: the points. */
  clickReward: "partner_click_reward",
  /** The watch-to-earn video opened. */
  videoOpen: "partner_video_open",
} as const;

export type PartnerClickSpot = "sidebar" | "stage" | "bar" | "tile" | "video";

const SPOT_EVENT: Record<PartnerClickSpot, string> = {
  sidebar: PARTNER_EVENTS.clickSidebar,
  stage: PARTNER_EVENTS.clickStage,
  bar: PARTNER_EVENTS.clickBar,
  tile: PARTNER_EVENTS.clickTile,
  video: PARTNER_EVENTS.clickVideo,
};

/**
 * Whether this person is on the treatment. `track` only where an ad is
 * actually on screen (usePartnerAd); everywhere else just reads the answer.
 */
export function usePartnerExperiment(options: { track?: boolean } = {}): boolean {
  return useFeature(PARTNER_EXPERIMENT_FEATURE, { track: options.track ?? false }).enabled;
}

export function trackPartnerImpression() {
  trackFeatureEvent(PARTNER_EVENTS.impression);
}

export function trackPartnerSessionView() {
  trackFeatureEvent(PARTNER_EVENTS.sessionView);
}

export function trackPartnerClick(spot: PartnerClickSpot) {
  trackFeatureEvent(PARTNER_EVENTS.click);
  trackFeatureEvent(SPOT_EVENT[spot]);
}

export function trackPartnerClickReward(points: number | null | undefined) {
  trackFeatureEvent(PARTNER_EVENTS.clickReward, points ? { value: Math.max(1, Math.round(points)) } : {});
}

export function trackPartnerVideoOpen() {
  trackFeatureEvent(PARTNER_EVENTS.videoOpen);
}

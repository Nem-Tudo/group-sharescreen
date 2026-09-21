"use client";

import { useEffect, useState } from "react";
import { getSignalingHttpBase } from "./roomsApi";
import { trackFeatureEvent } from "./features";
import type { PartnerCardData } from "./partner";
import { fetchPremiumPlans } from "./premiumApi";

// "Transmissão pausada" — the ad gate, as the site sees it.
//
// The rule and the arithmetic live on the API (server/broadcastAdGate.ts),
// and deliberately so: this file never decides *whether* somebody owes an ad.
// It is told, over the socket, and everything here is about what that looks
// like — which streams go black, which popup opens, and what gets counted.
//
// The two hour figures arrive with the message rather than being written
// down here, because they are moved from the admin panel while the site is
// running (see the API's adsConfig) and a popup that says "6 horas" when the
// dial has been turned to four is worse than a popup that says nothing.

/** The feature the whole thing is behind — created in the admin panel. */
export const BROADCAST_AD_GATE_FEATURE = "broadcast-ad-gate";

/**
 * The events counted from this side. The server counts its own half (see its
 * BROADCAST_AD_GATE_EVENTS) — these are the ones only a browser can see.
 *
 * Every name here, and every one of the server's, has to be listed in the
 * feature's "site events" in the admin panel to count for anything. So do the
 * ordinary pro funnel's (`pro_view`, `pro_checkout_click`, `pro_purchase`):
 * those are already counted per live feature, so listing them is what turns
 * "did this sell any subscriptions" into a number rather than a hunch.
 */
export const AD_GATE_EVENTS = {
  /** The popup opened with an ad in it. */
  opened: "ad_gate_popup_open",
  /** The ad started playing. */
  adStart: "ad_gate_ad_start",
  /** They clicked the advertiser's own button. */
  adClick: "ad_gate_ad_click",
  /** They reached for Pro from the popup. */
  proClick: "ad_gate_pro_click",
  /** The popup was closed without the gate being cleared. */
  dismissed: "ad_gate_dismissed",
  /** No ad could be loaded, so the wait below was offered instead. */
  noAd: "ad_gate_no_ad",
  /** They sat out the no-ad wait and pressed the button at the end of it. */
  waitConfirmed: "ad_gate_wait_confirmed",
  /** A long ad left behind at the minute mark; value = seconds watched. */
  skipped: "ad_gate_skipped",
} as const;

/**
 * The most the gate ever costs: one minute.
 *
 * It is a ceiling, not a duration. A thirty-second ad is thirty seconds; a
 * three-minute one is still a minute, after which the way back appears even
 * though the video is still running. Advertisers can upload whatever length
 * they like, and without this the cost of the gate would be set by whoever
 * happened to win the weighted roll — somebody's broadcast held for three
 * minutes because of an inventory decision they have no part in.
 *
 * A minute is also what somebody waits when we have nothing to show at all
 * (NO_AD_WAIT_SECONDS below), and that is the same constant deliberately:
 * whatever the reason, the gate costs a minute.
 */
export const MAX_GATE_SECONDS = 30;

/**
 * How long somebody waits when we have no ad to show them.
 *
 * The same minute as the ceiling above, and the same constant on purpose:
 * whatever the reason, the gate costs a minute. Splitting them would be an
 * invitation to make the empty-shelf case the longer of the two.
 */
export const NO_AD_WAIT_SECONDS = MAX_GATE_SECONDS;

export function trackAdGate(event: string, value?: number) {
  trackFeatureEvent(event, value ? { value: Math.max(1, Math.round(value)) } : {});
}

/** What the server says when it pauses a broadcast. */
export type BroadcastAdGate = {
  /** Their lifetime broadcast time, which is what the popup explains with. */
  totalSeconds: number;
  firstHours: number;
  intervalHours: number;
};

/**
 * An ad with a reward video, for the popup to play.
 *
 * Null is a real and expected answer — it means we have nothing to show —
 * and the caller's job when it comes back null is to let the broadcast
 * through, not to hold it. See the API's GET /partner/ad-gate.
 */
export async function fetchAdGatePartner(signal?: AbortSignal): Promise<PartnerCardData | null> {
  const res = await fetch(`${getSignalingHttpBase()}/partner/ad-gate`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { partner: PartnerCardData | null };
  return data.partner?.rewardVideoUrl ? data.partner : null;
}

/**
 * Blanks (or restores) every video track going out of this browser.
 *
 * `enabled = false` is the whole mechanism, and it is chosen over stopping
 * the tracks for one reason: it is reversible in a single frame. The capture
 * stays open, the browser's "you are sharing" bar stays up, the senders keep
 * their tracks, and every viewer's peer connection keeps delivering — black
 * frames instead of the screen. When the gate clears, the picture is simply
 * there again, with nobody re-picking a window and no tile anywhere having
 * blinked out and back.
 *
 * Audio is deliberately untouched. The point is to interrupt the broadcast,
 * not the conversation — cutting somebody's voice mid-sentence would make
 * this a punishment rather than an interruption, and the mic was never what
 * the gate is about.
 */
export function setOutgoingVideoPaused(
  streams: readonly (MediaStream | null | undefined)[],
  paused: boolean
): void {
  for (const stream of streams) {
    if (!stream) continue;
    for (const track of stream.getVideoTracks()) {
      // Guarded: a track that has already ended throws on some engines, and
      // one stream in the list failing must not leave the rest un-blanked.
      try {
        track.enabled = !paused;
      } catch {
        // Nothing to do — an ended track sends nothing either way.
      }
    }
  }
}

/** "6 horas", "90 minutos" — the dials as the popup says them out loud. */
export function formatGateHours(hours: number): string {
  if (hours >= 1 && Number.isInteger(hours)) return hours === 1 ? "1 hora" : `${hours} horas`;
  const minutes = Math.round(hours * 60);
  return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

/**
 * The ad the popup should play, loaded once when it opens.
 *
 * `loading` is a third state and the important one: with no ad *yet* and no
 * ad *at all* looking the same, the popup would let the broadcast through the
 * instant it opened, every time. So it starts loading rather than empty, and
 * only the answer coming back can make it empty.
 *
 * Mount-scoped on purpose — the popup is only ever on screen while a gate is
 * open, so "when does this load" and "when does the popup exist" are the same
 * question, and taking an `active` flag would be a second way to ask it.
 */
export function useAdGatePartner() {
  const [state, setState] = useState<{ loading: boolean; partner: PartnerCardData | null }>({
    loading: true,
    partner: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchAdGatePartner(controller.signal)
      .then((partner) => setState({ loading: false, partner }))
      .catch(() => {
        // An API that cannot answer is the same as having nothing to show.
        // Failing *open* on purpose: our own outage is not a reason to keep
        // somebody's broadcast black.
        if (!controller.signal.aborted) setState({ loading: false, partner: null });
      });
    return () => controller.abort();
  }, []);

  return state;
}

/**
 * The cheapest plan's price, for the popup's "por apenas ..." line.
 *
 * Null while it is loading and null if it cannot be loaded, and the caller
 * renders nothing either way: a price is the one thing here that must never
 * be guessed at, and the button works perfectly well without it.
 *
 * The list is already sorted cheapest first (see fetchPremiumPlans), and the
 * cheapest is the honest number for "por apenas" — it is the least somebody
 * can pay to make this popup stop existing.
 */
export function useCheapestProPrice(): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchPremiumPlans(controller.signal).then((plans) => {
      if (controller.signal.aborted) return;
      const cheapest = plans[0];
      if (cheapest?.priceLabel) setLabel(cheapest.priceLabel);
    });
    return () => controller.abort();
  }, []);
  return label;
}

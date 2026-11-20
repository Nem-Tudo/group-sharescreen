"use client";

import { useEffect } from "react";
import { MdClose } from "react-icons/md";
import { VerifiedBadgeIcon } from "./icons";
import { useT } from "@/lib/useI18n";
import { useOpenPro } from "@/lib/proModal";
import { noteProSourceCta } from "@/lib/proSourceAttribution";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { dismissTurnUpsell, turnUpsellRaisedAt, useTurnUpsell } from "@/lib/turnUpsell";
import { secondsSince, TURN_COPY_EVENTS, TURN_COPY_FEATURE, TURN_COPY_FRIENDLY } from "@/lib/turnUpsellCopy";

// "A transmissão está ruim ou não carrega? Assine o Pro": shown when a stream
// never connected and this account has no TURN (see lib/turnUpsell). Behind
// the experiment below so the notice itself can be measured; its wording is
// a second experiment (lib/turnUpsellCopy).
export const TURN_UPSELL_FEATURE = "pro-turn-notice";
export const TURN_UPSELL_EVENTS = {
  shown: "turn_upsell_shown",
  click: "turn_upsell_click",
  dismiss: "turn_upsell_dismiss",
} as const;
// The other way of saying it: inside the stuck tile instead of the banner below.
const TILE_VARIANT = "tile";

// Once per page, however many tiles are stuck at the same time.
let tileShownCounted = false;

type Place = "tile" | "banner";

/** The texts for this person's side of turn-upsell-copy. Never an exposure. */
function useCopy() {
  const t = useT();
  const copy = useFeature(TURN_COPY_FEATURE, { track: false });
  const friendly = copy.variant === TURN_COPY_FRIENDLY;
  const prefix = friendly ? "turnUpsell.friendly" : "turnUpsell";
  return {
    friendly,
    title: t(`${prefix}.title`),
    body: t(`${prefix}.body`),
    cta: t(`${prefix}.cta`),
  };
}

function trackShown(place: Place) {
  trackFeatureEvent(TURN_UPSELL_EVENTS.shown, { feature: TURN_UPSELL_FEATURE });
  trackFeatureEvent(TURN_COPY_EVENTS.shown, { feature: TURN_COPY_FEATURE });
  trackFeatureEvent(place === "tile" ? TURN_COPY_EVENTS.shownTile : TURN_COPY_EVENTS.shownBanner, {
    feature: TURN_COPY_FEATURE,
  });
}

function trackClick(place: Place) {
  trackFeatureEvent(TURN_UPSELL_EVENTS.click, { feature: TURN_UPSELL_FEATURE });
  trackFeatureEvent(TURN_COPY_EVENTS.click, { feature: TURN_COPY_FEATURE });
  trackFeatureEvent(place === "tile" ? TURN_COPY_EVENTS.clickTile : TURN_COPY_EVENTS.clickBanner, {
    feature: TURN_COPY_FEATURE,
  });
  const raisedAt = turnUpsellRaisedAt();
  if (raisedAt) trackFeatureEvent(TURN_COPY_EVENTS.clickSecs, { feature: TURN_COPY_FEATURE, value: secondsSince(raisedAt) });
  noteProSourceCta("turnUpsell");
  noteProSourceCta("turnUpsellCopy");
}

/** Under a remote tile's loading spinner, on the "tile" side of the experiment. */
export function TurnUpsellTileMessage({ compact = false }: { compact?: boolean }) {
  const openPro = useOpenPro();
  const needed = useTurnUpsell();
  // Not an exposure: TurnUpsellNotice counts that, once per page.
  const feature = useFeature(TURN_UPSELL_FEATURE, { track: false });
  const copy = useCopy();
  const visible = needed && feature.variant === TILE_VARIANT;

  useEffect(() => {
    if (!visible || tileShownCounted) return;
    tileShownCounted = true;
    trackShown("tile");
  }, [visible]);

  if (!visible) return null;
  return (
    // Not in the iOS app, which sells nothing (lib/storePolicy.ts).
    <div data-sells="" className="flex max-w-xs flex-col items-center gap-1 px-3 text-center text-white">
      <p className="text-xs font-medium sm:text-sm">{copy.title}</p>
      {/* A small tile only has room for the question and the button. */}
      {!compact && <p className="text-xs text-white/70">{copy.body}</p>}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          trackClick("tile");
          openPro("turn_tile");
        }}
        className="mt-1 flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
      >
        {copy.cta}
        {copy.friendly && <VerifiedBadgeIcon className="h-3.5 w-3.5 shrink-0" />}
      </button>
    </div>
  );
}

export default function TurnUpsellNotice() {
  const t = useT();
  const openPro = useOpenPro();
  const needed = useTurnUpsell();
  const feature = useFeature(TURN_UPSELL_FEATURE, { track: needed });
  // Rendered once per page, whichever place the notice takes: the wording's
  // exposure is counted here, and only once it is actually up (banner or tile).
  useFeature(TURN_COPY_FEATURE, { track: needed && feature.enabled });
  const copy = useCopy();
  const visible = needed && feature.enabled && feature.variant !== TILE_VARIANT;

  useEffect(() => {
    if (visible) trackShown("banner");
  }, [visible]);

  if (!visible) return null;
  return (
    <div
      data-sells=""
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-start gap-3 rounded-xl bg-blue-600 px-4 py-3 text-sm text-white shadow-lg"
    >
      <VerifiedBadgeIcon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="flex-1">
        <p className="font-medium">{copy.title}</p>
        <p className="mt-0.5 text-white/85">{copy.body}</p>
        <button
          type="button"
          onClick={() => {
            trackClick("banner");
            openPro("turn_banner");
          }}
          className="mt-2 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
        >
          {copy.cta}
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          trackFeatureEvent(TURN_UPSELL_EVENTS.dismiss, { feature: TURN_UPSELL_FEATURE });
          trackFeatureEvent(TURN_COPY_EVENTS.dismiss, { feature: TURN_COPY_FEATURE });
          dismissTurnUpsell();
        }}
        aria-label={t("turnUpsell.dismiss")}
        className="-m-1 rounded p-1 text-white/80 hover:text-white"
      >
        <MdClose className="h-5 w-5" />
      </button>
    </div>
  );
}

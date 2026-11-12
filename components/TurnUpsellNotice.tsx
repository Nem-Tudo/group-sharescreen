"use client";

import { useEffect } from "react";
import { MdClose } from "react-icons/md";
import { VerifiedBadgeIcon } from "./icons";
import { useT } from "@/lib/useI18n";
import { useOpenPro } from "@/lib/proModal";
import { noteProSourceCta } from "@/lib/proSourceAttribution";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { dismissTurnUpsell, useTurnUpsell } from "@/lib/turnUpsell";

// "A transmissão está ruim ou não carrega? Assine o Pro": shown when a stream
// never connected and this account has no TURN (see lib/turnUpsell). Behind
// the experiment below so the notice itself can be measured.
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

/** Under a remote tile's loading spinner, on the "tile" side of the experiment. */
export function TurnUpsellTileMessage({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const openPro = useOpenPro();
  const needed = useTurnUpsell();
  // Not an exposure: TurnUpsellNotice counts that, once per page.
  const feature = useFeature(TURN_UPSELL_FEATURE, { track: false });
  const visible = needed && feature.variant === TILE_VARIANT;

  useEffect(() => {
    if (!visible || tileShownCounted) return;
    tileShownCounted = true;
    trackFeatureEvent(TURN_UPSELL_EVENTS.shown, { feature: TURN_UPSELL_FEATURE });
  }, [visible]);

  if (!visible) return null;
  return (
    // Not in the iOS app, which sells nothing (lib/storePolicy.ts).
    <div data-sells="" className="flex max-w-xs flex-col items-center gap-1 px-3 text-center text-white">
      <p className="text-xs font-medium sm:text-sm">{t("turnUpsell.title")}</p>
      {/* A small tile only has room for the question and the button. */}
      {!compact && <p className="text-xs text-white/70">{t("turnUpsell.body")}</p>}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          trackFeatureEvent(TURN_UPSELL_EVENTS.click, { feature: TURN_UPSELL_FEATURE });
          noteProSourceCta("turnUpsell");
          openPro("turn_tile");
        }}
        className="mt-1 flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
      >
        {t("turnUpsell.cta")}
      </button>
    </div>
  );
}

export default function TurnUpsellNotice() {
  const t = useT();
  const openPro = useOpenPro();
  const needed = useTurnUpsell();
  const feature = useFeature(TURN_UPSELL_FEATURE, { track: needed });
  const visible = needed && feature.enabled && feature.variant !== TILE_VARIANT;

  useEffect(() => {
    if (visible) trackFeatureEvent(TURN_UPSELL_EVENTS.shown, { feature: TURN_UPSELL_FEATURE });
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
        <p className="font-medium">{t("turnUpsell.title")}</p>
        <p className="mt-0.5 text-white/85">{t("turnUpsell.body")}</p>
        <button
          type="button"
          onClick={() => {
            trackFeatureEvent(TURN_UPSELL_EVENTS.click, { feature: TURN_UPSELL_FEATURE });
            noteProSourceCta("turnUpsell");
            openPro("turn_banner");
          }}
          className="mt-2 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
        >
          {t("turnUpsell.cta")}
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          trackFeatureEvent(TURN_UPSELL_EVENTS.dismiss, { feature: TURN_UPSELL_FEATURE });
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

// Experiment "turn-upsell-copy": how the "Pro relays" notice (lib/turnUpsell,
// components/TurnUpsellNotice) is worded. Control keeps the original ("A
// transmissão está ruim ou não carrega? Assine o Pro"); "friendly" explains
// that the person's network probably blocked the connection, says it happens,
// and offers Pro with the verified badge instead of a bare "Assinar".
//
// Crossed with pro-turn-notice (banner vs tile): that one decides where the
// notice goes, this one what it says. Exposure is counted once, by
// TurnUpsellNotice, only when the notice is actually up.
//
// Sales: the generic pro_* funnel is counted per group on its own (it is
// listed in the feature's site events); tcopy_checkout / tcopy_purchase* are
// the sales the notice itself led to (the API's proSourceStats).

export const TURN_COPY_FEATURE = "turn-upsell-copy";
export const TURN_COPY_FRIENDLY = "friendly";

export const TURN_COPY_EVENTS = {
  /** The notice was shown (once per page). */
  shown: "tcopy_shown",
  /** ...and where: `.tile` or `.banner`. */
  shownTile: "tcopy_shown.tile",
  shownBanner: "tcopy_shown.banner",
  /** The Pro button was pressed. */
  click: "tcopy_click",
  clickTile: "tcopy_click.tile",
  clickBanner: "tcopy_click.banner",
  /** value = seconds between the notice going up and the click. */
  clickSecs: "tcopy_click_secs",
  /** The banner's ✕. */
  dismiss: "tcopy_dismiss",
  /** A stream connected after all (no Pro needed); value = seconds after. */
  recovered: "tcopy_recovered",
  /** Left the page with the notice still up; value = seconds it was up. */
  leftStuck: "tcopy_left_stuck",
  /** A pay button pressed within a week of clicking the notice (proSourceAttribution). */
  checkout: "tcopy_checkout",
} as const;

/** Whole seconds since `at`, at least 1 (a value of 0 is not sent). */
export function secondsSince(at: number): number {
  return Math.max(1, Math.round((Date.now() - at) / 1000));
}

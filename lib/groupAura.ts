import { translate } from "@/lib/i18n";
import type { FeatureTier } from "@/lib/entitlements";

// Group auras — Discord's server boost. Subscribers give them to a group
// (Pro Max: 1, Pro Ultra: 3, two of which may go to the same group), and a
// group's auras add up to a level that turns perks on for everybody in it.
//
// The API decides everything (see its groupAura.ts and auraStore.ts) and
// sends the ladder with each read of GET /groups/:id/aura; this file only
// knows how to *draw* it. A new perk is a new id in the API's AURA_LEVELS and
// a label in PERK_LABELS below — until it has one here it is drawn by its id.

/** The experiment the whole thing sits behind (admin panel's "Features"). */
export const GROUP_AURA_FEATURE = "group-aura";
/** The "NOVO" badge's id — see components/NewBadge. */
export const GROUP_AURA_BADGE = GROUP_AURA_FEATURE;

/** What the feature counts — each must be in its "site events" in the admin panel. */
export const GROUP_AURA_EVENTS = {
  /** The Aura tab was opened. */
  open: "aura_tab_open",
  /** Somebody gave a group an aura. */
  give: "aura_give",
  /** Somebody took one back. */
  remove: "aura_remove",
  /** Somebody without a plan clicked through to it from the tab. */
  upgrade: "aura_upgrade_click",
} as const;

/** The ladder when the API has not answered yet — the same numbers as its AURA_LEVELS. */
export const DEFAULT_AURA_LEVELS: { level: number; auras: number; perks: string[]; emojiSlots: number }[] = [
  { level: 1, auras: 2, perks: [], emojiSlots: 20 },
  { level: 2, auras: 7, perks: ["customInvite"], emojiSlots: 30 },
  { level: 3, auras: 14, perks: [], emojiSlots: 200 },
];

/** Auras each plan gives to hand out — the API's aurasAllowedFor. For the /pro page. */
export const AURAS_PER_PLAN: Record<FeatureTier, number> = {
  free: 0,
  account: 0,
  premium: 0,
  premium_max: 1,
  pro_ultra: 3,
};

/** Custom emoji slots of a group with no level — the API's BASE_GROUP_EMOJI_SLOTS. */
export const BASE_GROUP_EMOJI_SLOTS = 10;

const PERK_LABELS: Record<string, () => string> = {
  customInvite: () => translate("groups.aura.perkCustomInvite"),
};

export function auraPerkLabel(perk: string): string {
  return PERK_LABELS[perk]?.() ?? perk;
}

/**
 * How far a group is toward its next level, for the bar: the auras it has
 * past the current level's mark, out of what the next one needs. Null past
 * the top.
 */
export function auraProgress(
  count: number,
  levels: { level: number; auras: number }[]
): { next: { level: number; auras: number } | null; fraction: number; missing: number } {
  const next = levels.find((l) => count < l.auras) ?? null;
  if (!next) return { next: null, fraction: 1, missing: 0 };
  const floor = [...levels].reverse().find((l) => count >= l.auras)?.auras ?? 0;
  const span = Math.max(1, next.auras - floor);
  return { next, fraction: Math.min(1, Math.max(0, (count - floor) / span)), missing: next.auras - count };
}

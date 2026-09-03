import { VerifiedBadgeIcon } from "@/components/icons";

// What a plan's `iconId` resolves to on screen.
//
// The API stores a name and validates it against its own list (see its
// premiumPlan.ts's PLAN_ICON_IDS); this is the other half — the components
// that name refers to. Splitting it that way is the point of having an id at
// all: adding a second mark is a value in one database row plus an entry
// here, and no schema change, no image upload, and nothing to keep in sync
// beyond a string.
//
// Each entry carries two renderings of the same mark, and both are needed:
//
//   - `Icon`, for anywhere real markup can go.
//   - `glyph`, for the one place it cannot. A native <option> may contain
//     text and nothing else — no element inside it renders, in any browser —
//     so the quality pickers in the room mark their Pro-only options with a
//     character. It is a compromise and it is written down here rather than
//     inline at the call site, so the two never drift into different marks.

export type PlanIconId = "blue_verified";

export interface PlanIcon {
  Icon: (props: { className?: string }) => React.ReactElement;
  /** Colour class, because the mark is recognised by *being* blue. */
  className: string;
  /** Text stand-in, for `<option>` and anywhere else markup is refused. */
  glyph: string;
  /** What it means, for a title/aria attribute. */
  label: string;
}

export const PLAN_ICONS: Record<PlanIconId, PlanIcon> = {
  blue_verified: {
    Icon: VerifiedBadgeIcon,
    className: "text-blue-500",
    glyph: "✔",
    label: "Verificado",
  },
};

/**
 * The mark used when a plan names none, or names one this build has never
 * heard of.
 *
 * The second case is the one that matters: the database can be edited by
 * hand and can be ahead of a deployed client, and a page that renders nothing
 * beside its own product name because of a typo is worse than one that shows
 * the mark it has always shown.
 */
export const DEFAULT_PLAN_ICON_ID: PlanIconId = "blue_verified";

export function planIcon(iconId: string | null | undefined): PlanIcon {
  return PLAN_ICONS[(iconId ?? "") as PlanIconId] ?? PLAN_ICONS[DEFAULT_PLAN_ICON_ID];
}

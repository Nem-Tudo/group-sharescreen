import type { ReactNode } from "react";

/**
 * The band across the top of a present or a purchase, in the plan's colours.
 *
 * Wrapping paper, drawn rather than illustrated: two crossed ribbons and a
 * sweep of light. It is four divs because that is all it needs to be — an
 * image here would be a file to host, a thing to load, and one more decision
 * to keep in step with a plan whose mark is already chosen in the database.
 *
 * Shared by the two moments a plan changes hands — a present being opened
 * (GiftClaimDialog) and a payment landing (PixChargeModal) — so both look like
 * the same kind of event.
 */
export type PlanTone = "ruby" | "gold" | "blue";

/** A plan's colour, from the rung it sells. Matches the badge its subscribers wear. */
export function planTone(tier: string | null | undefined): PlanTone {
  if (tier === "pro_ultra") return "ruby";
  if (tier === "premium_max") return "gold";
  return "blue";
}

/** The solid button colour for a plan's tone. */
export const PLAN_TONE_BUTTON: Record<PlanTone, string> = {
  ruby: "bg-rose-800 hover:bg-rose-900",
  gold: "bg-amber-500 hover:bg-amber-600",
  blue: "bg-blue-600 hover:bg-blue-700",
};

const PLAN_TONE_BAND: Record<PlanTone, string> = {
  // Ruby: a deep red, darker at the far corner, like the badge's gradient.
  ruby: "bg-gradient-to-br from-rose-500 via-rose-700 to-red-950",
  gold: "bg-gradient-to-br from-amber-300 via-amber-500 to-orange-600",
  blue: "bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600",
};

export function PlanBand({ tone, children }: { tone: PlanTone; children: ReactNode }) {
  return (
    <div className={`relative h-32 overflow-hidden ${PLAN_TONE_BAND[tone]}`}>
      {/* The ribbons. Off-centre on purpose: dead centre reads as a target,
          slightly off reads as something somebody tied. */}
      <span aria-hidden className="absolute inset-y-0 left-[38%] w-9 bg-white/15" />
      <span aria-hidden className="absolute inset-x-0 top-1/2 h-9 -translate-y-1/2 bg-white/15" />
      {/* A light passing over it, the same sweep the Pro page uses for its
          offer — and, like that one, it stops for anybody who asked their
          system for less motion (see globals.css). */}
      <span
        aria-hidden
        className="golive-shine pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent"
      />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/40 backdrop-blur-sm">
          {children}
        </span>
      </span>
    </div>
  );
}

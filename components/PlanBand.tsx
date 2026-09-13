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
export function PlanBand({ tone, children }: { tone: "gold" | "blue"; children: ReactNode }) {
  return (
    <div
      className={`relative h-32 overflow-hidden ${
        tone === "gold"
          ? "bg-gradient-to-br from-amber-300 via-amber-500 to-orange-600"
          : "bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600"
      }`}
    >
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

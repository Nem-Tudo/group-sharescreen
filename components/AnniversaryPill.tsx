"use client";

import Link from "next/link";
import { useT } from "@/lib/useI18n";
import { useFeature } from "@/lib/features";
import { ANNIVERSARY_EVENTS, ANNIVERSARY_FEATURE, anniversaryPath, trackAnniversary } from "@/lib/anniversary";
import { NewBadge } from "@/components/NewBadge";

// The way into the "3 meses" page from the home page, behind the
// anniversary-3m experiment (the page itself opens for anybody with the link).
export function AnniversaryPill() {
  const t = useT();
  const { enabled } = useFeature(ANNIVERSARY_FEATURE, { track: true });
  if (!enabled) return null;
  return (
    <Link
      href={anniversaryPath("pill")}
      onClick={() => trackAnniversary(ANNIVERSARY_EVENTS.promoClick)}
      className="content-in flex items-center gap-2 rounded-full bg-zinc-950 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm ring-1 ring-white/10 transition hover:bg-zinc-800"
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#ff3b2f]" />
      {t("anniversary.pill")}
      <NewBadge id={ANNIVERSARY_FEATURE} className="bg-white/25" />
    </Link>
  );
}

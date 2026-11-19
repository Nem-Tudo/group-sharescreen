"use client";

import Link from "next/link";
import { useT } from "@/lib/useI18n";
import { useFeature } from "@/lib/features";
import { ANNIVERSARY_EVENTS, ANNIVERSARY_FEATURE, ANNIVERSARY_PATH, trackAnniversary } from "@/lib/anniversary";
import { NewBadge } from "@/components/NewBadge";

// The way into the "3 meses" page from the home page, behind the
// anniversary-3m experiment (the page itself opens for anybody with the link).
export function AnniversaryPill() {
  const t = useT();
  const { enabled } = useFeature(ANNIVERSARY_FEATURE, { track: true });
  if (!enabled) return null;
  return (
    <Link
      href={ANNIVERSARY_PATH}
      onClick={() => trackAnniversary(ANNIVERSARY_EVENTS.promoClick)}
      className="content-in group flex items-center gap-2 rounded-full bg-[linear-gradient(100deg,#f59e0b,#ec4899,#8b5cf6)] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:brightness-110"
    >
      <span aria-hidden="true" className="inline-block transition-transform group-hover:rotate-12 group-hover:scale-125">
        🎉
      </span>
      {t("anniversary.pill")}
      <NewBadge id={ANNIVERSARY_FEATURE} className="bg-white/25" />
    </Link>
  );
}

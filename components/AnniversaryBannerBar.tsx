"use client";

import Link from "next/link";
import { useT } from "@/lib/useI18n";
import { anniversaryPath } from "@/lib/anniversary";
import { Mascot } from "@/app/3-meses/Mascot";
import "@/app/3-meses/anniversary.css";

// The bar itself (AnniversaryBanner decides whether it shows). The page's own
// look in one strip: colour bars rising, the on-air tally, the mascot waving,
// and a colour-bar edge that keeps running underneath.

const BARS = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];

const KEYFRAMES = `
@keyframes anniv-bn-in { from { transform: translateY(-100%); } to { transform: none; } }
@keyframes anniv-bn-bar { 0% { transform: scaleY(0); } 60% { transform: scaleY(1.08); } 100% { transform: scaleY(1); } }
@keyframes anniv-bn-pulse { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.55); } }
@keyframes anniv-bn-text { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: none; } }
@keyframes anniv-bn-edge { to { background-position: 280px 0; } }
@keyframes anniv-bn-shine { 0% { transform: translateX(-120%) skewX(-20deg); } 60%, 100% { transform: translateX(320%) skewX(-20deg); } }
.anniv-bn { animation: anniv-bn-in 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.anniv-bn-bar { transform-origin: bottom; animation: anniv-bn-bar 0.5s cubic-bezier(0.3, 0.9, 0.3, 1) both, anniv-bn-pulse 1.6s 0.9s ease-in-out infinite; }
.anniv-bn-text { animation: anniv-bn-text 0.4s 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.anniv-bn-edge {
  background: linear-gradient(90deg, #c0c0c0 0 40px, #c0c000 0 80px, #00c0c0 0 120px, #00c000 0 160px, #c000c0 0 200px, #c00000 0 240px, #0000c0 0 280px);
  background-size: 280px 100%;
  animation: anniv-bn-edge 4s linear infinite;
}
.anniv-bn-cta { position: relative; overflow: hidden; }
.anniv-bn-cta::after {
  content: ""; position: absolute; inset: 0 auto 0 0; width: 35%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent);
  animation: anniv-bn-shine 2.8s 1.2s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .anniv-bn, .anniv-bn-bar, .anniv-bn-text, .anniv-bn-edge, .anniv-bn-cta::after { animation: none !important; }
  .anniv-bn-cta::after { display: none; }
}
`;

export function AnniversaryBannerBar({
  signedIn,
  onOpen,
  onClose,
}: {
  signedIn: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="anniv anniv-bn relative z-[60] shrink-0 overflow-hidden" role="region" aria-label={t("anniversary.banner.label")}>
      <style>{KEYFRAMES}</style>
      <div className="flex items-center gap-3 py-2 pl-[max(12px,env(safe-area-inset-left,0px))] pr-[max(8px,env(safe-area-inset-right,0px))] sm:gap-4">
        {/* Colour bars, rising then breathing like a level meter. */}
        <div className="flex h-8 shrink-0 items-end gap-[2px]" aria-hidden="true">
          {BARS.map((color, i) => (
            <span
              key={color}
              className="anniv-bn-bar block w-[5px] rounded-[1px]"
              style={{ background: color, height: `${55 + ((i * 37) % 45)}%`, animationDelay: `${i * 60}ms, ${0.9 + i * 0.13}s` }}
            />
          ))}
        </div>
        <div className="-my-2 hidden h-12 w-10 shrink-0 sm:block" aria-hidden="true">
          <Mascot mood="wave" className="h-full w-full" />
        </div>

        <div className="anniv-bn-text flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="anniv-onair shrink-0 text-[10px]">
            <span className="anniv-live-dot h-1.5 w-1.5 rounded-full bg-white" />
            {t("anniversary.intro.live")}
          </span>
          <p className="min-w-0 text-sm leading-snug">
            <strong className="font-bold">{t("anniversary.banner.title")}</strong>{" "}
            <span className="text-[var(--a-mute)]">{t(signedIn ? "anniversary.banner.textRecap" : "anniversary.banner.text")}</span>
          </p>
        </div>

        <Link
          href={anniversaryPath("banner")}
          onClick={onOpen}
          className="anniv-bn-cta anniv-mono shrink-0 rounded-sm bg-[var(--a-tally)] px-3 py-2 text-[11px] font-semibold uppercase text-white transition hover:brightness-110 sm:px-4"
        >
          {t(signedIn ? "anniversary.banner.ctaRecap" : "anniversary.banner.cta")}
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("anniversary.banner.close")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-lg leading-none text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="anniv-bn-edge h-[3px]" aria-hidden="true" />
    </div>
  );
}

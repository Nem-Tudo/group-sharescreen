"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useT } from "@/lib/useI18n";
import { ANNIVERSARY_EVENTS, anniversaryPath, trackAnniversary } from "@/lib/anniversary";
import { Mascot } from "@/app/3-meses/Mascot";
import "@/app/3-meses/anniversary.css";

// The card of the one-time anniversary popup (see AnniversaryPopup, which
// decides whether it opens). Its banner is the page's own opener in small:
// colour bars come up, the "on air" slate slides in, the mascot waves.

const BARS = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];

const KEYFRAMES = `
@keyframes anniv-pop-in { from { opacity: 0; transform: translateY(24px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes anniv-pop-bar { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes anniv-pop-slate { from { opacity: 0; transform: translate(-24px, -50%); } to { opacity: 1; transform: translate(0, -50%); } }
@keyframes anniv-pop-mascot { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: none; } }
.anniv-pop-in { animation: anniv-pop-in 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.anniv-pop-bar { animation: anniv-pop-bar 0.45s cubic-bezier(0.3, 0.9, 0.3, 1) both; transform-origin: bottom; }
.anniv-pop-slate { animation: anniv-pop-slate 0.45s 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.anniv-pop-mascot { animation: anniv-pop-mascot 0.6s 0.75s cubic-bezier(0.3, 1.4, 0.5, 1) both; }
`;

export function AnniversaryPopupCard({ signedIn, onClose }: { signedIn: boolean; onClose: () => void }) {
  const t = useT();
  const cta = useRef<HTMLAnchorElement>(null);

  const close = () => {
    trackAnniversary(ANNIVERSARY_EVENTS.popupClose);
    onClose();
  };

  useEffect(() => {
    cta.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // close only reads stable props; the listener is set once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={close} role="presentation">
      <style>{KEYFRAMES}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="anniv-pop-title"
        onClick={(e) => e.stopPropagation()}
        className="anniv anniv-pop-in relative w-full max-w-md overflow-hidden rounded-lg border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
      >
        <div className="relative h-44 overflow-hidden bg-black" aria-hidden="true">
          <div className="absolute inset-0 flex">
            {BARS.map((color, i) => (
              <div key={color} className="anniv-pop-bar h-full flex-1" style={{ background: color, animationDelay: `${i * 55}ms` }} />
            ))}
          </div>
          <div className="anniv-pop-slate absolute left-5 top-1/2 bg-[#111215] px-4 py-3">
            <span className="anniv-onair text-[10px]">
              <span className="anniv-live-dot h-1.5 w-1.5 rounded-full bg-white" />
              {t("anniversary.intro.live")}
            </span>
            <p className="mt-2 text-4xl font-black uppercase leading-none tracking-tight text-white">{t("anniversary.popup.badge")}</p>
            <p className="anniv-mono mt-1.5 text-[11px] uppercase text-white/60">{t("anniversary.popup.since")}</p>
          </div>
          <div className="anniv-pop-mascot absolute -bottom-4 right-4 w-28">
            <Mascot mood="wave" />
          </div>
        </div>

        <div className="p-5">
          <h2 id="anniv-pop-title" className="text-xl font-bold leading-snug">
            {t("anniversary.popup.title")}
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-[var(--a-mute)]">
            {t(signedIn ? "anniversary.popup.textRecap" : "anniversary.popup.text")}
          </p>
          <div className="mt-5 flex gap-2">
            <Link
              ref={cta}
              href={anniversaryPath("popup")}
              onClick={() => {
                trackAnniversary(ANNIVERSARY_EVENTS.popupClick);
                onClose();
              }}
              className="anniv-mono flex flex-1 items-center justify-center gap-2 rounded-sm bg-[var(--a-tally)] px-4 py-3 text-xs font-semibold uppercase text-white outline-offset-2 transition hover:brightness-110"
            >
              {t("anniversary.popup.cta")}
            </Link>
            <button
              type="button"
              onClick={close}
              className="anniv-mono rounded-sm border border-white/15 px-4 py-3 text-xs font-semibold uppercase text-[var(--a-ink)] transition hover:border-white/40"
            >
              {t("anniversary.popup.later")}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={close}
          aria-label={t("anniversary.popup.close")}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-sm bg-black/70 text-white transition hover:bg-black"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}

"use client";

import type { PlanSale } from "@/lib/premiumApi";
import { formatCountdown, useCountdown } from "@/lib/proSale";
import { LOCALE_TAGS } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/useI18n";

// The Black Friday look for /pro, the Pro popup and the gift popup.
//
// Drawn after a shop window rather than a "dark gradient hero": a strip of
// yellow tape running across the top, a paper price tag swinging on its
// string, and a countdown in clock digits. Black and yellow in both themes —
// it is the sale's own colour, not the page's.
//
// Only the look lives here. Every price on the page still comes from the API,
// which is also what ends the sale (see the API's planSale.ts); this hides
// itself when its countdown reaches zero.

const YELLOW = "#FFD400";

function Tape({ text }: { text: string }) {
  // Twice the same run, so the loop's seam is never on screen.
  const run = Array.from({ length: 8 }, (_, i) => (
    <span key={i} className="flex shrink-0 items-center gap-3 pr-3">
      {text}
      <span aria-hidden>✦</span>
    </span>
  ));
  return (
    <div
      aria-hidden
      // contain: the running strip is wider than any screen, and without this
      // its width becomes the card's minimum inside a flex column.
      className="pointer-events-none relative z-10 -mx-3 -rotate-[1.2deg] overflow-hidden [contain:inline-size] border-y-2 border-black py-1 text-[11px] font-black uppercase tracking-[0.18em] text-black shadow-[0_6px_14px_-8px_rgba(0,0,0,0.6)]"
      style={{ backgroundColor: YELLOW }}
    >
      <div className="golive-bf-tape flex w-max">
        {run}
        {run}
      </div>
    </div>
  );
}

function PriceTag({ percent, small }: { percent: number; small?: boolean }) {
  return (
    <div className={`golive-bf-swing relative shrink-0 origin-top ${small ? "pt-3" : "pt-5"}`} aria-hidden>
      {/* The string, from the nail to the hole. */}
      <span className={`absolute left-1/2 top-0 w-px -translate-x-1/2 bg-zinc-400 ${small ? "h-4" : "h-6"}`} />
      <div
        className={`relative flex flex-col items-center justify-center text-black ${
          small ? "h-[4.25rem] w-14 pt-3" : "h-24 w-[4.75rem] pt-4"
        }`}
        style={{
          backgroundColor: YELLOW,
          clipPath: "polygon(50% 0, 100% 18%, 100% 100%, 0 100%, 0 18%)",
        }}
      >
        <span className={`absolute left-1/2 top-[11%] -translate-x-1/2 rounded-full bg-zinc-950 ${small ? "h-2 w-2" : "h-2.5 w-2.5"}`} />
        <span className={`font-black leading-none tracking-tighter ${small ? "text-xl" : "text-[1.75rem]"}`}>
          -{percent}%
        </span>
        <span className={`mt-0.5 font-bold uppercase leading-none ${small ? "text-[8px]" : "text-[9px]"} tracking-widest`}>
          off
        </span>
      </div>
    </div>
  );
}

function Clock({ ms }: { ms: number }) {
  const { h, m, s } = formatCountdown(ms);
  const cell = "rounded-md bg-white/10 px-1.5 py-0.5 tabular-nums";
  return (
    <span className="inline-flex items-center gap-1 font-mono text-base font-bold text-white sm:text-lg">
      <span className={cell}>{h}</span>
      <span className="text-white/50">:</span>
      <span className={cell}>{m}</span>
      <span className="text-white/50">:</span>
      <span className={cell} style={{ color: YELLOW }}>
        {s}
      </span>
    </span>
  );
}

export function ProSaleBanner({
  sale,
  compact = false,
  gift = false,
  className = "",
}: {
  sale: PlanSale;
  /** The popups: smaller, same pieces. */
  compact?: boolean;
  /** The gift popup: a gift is a single charge, so the subscription line is left out. */
  gift?: boolean;
  className?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const left = useCountdown(sale.endsAt);
  if (left === 0) return null;

  const until = new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(sale.endsAt);
  const fine = gift
    ? t("proSale.finePrintGift")
    : sale.onSubscription
      ? t("proSale.finePrint")
      : t("proSale.finePrintPixOnly");

  return (
    <section
      aria-label={t("proSale.label", { percent: sale.percentOff })}
      className={`relative min-w-0 overflow-hidden rounded-2xl bg-zinc-950 text-white ring-1 ring-black/5 dark:ring-white/10 ${className}`}
    >
      <Tape text={`Black Friday · ${t("proSale.off", { percent: sale.percentOff })}`} />
      <div className={`flex items-start gap-4 ${compact ? "px-4 pb-4 pt-3" : "px-5 pb-5 pt-4 sm:px-6"}`}>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: YELLOW }}>
            {t("proSale.kicker")}
          </p>
          <h2
            className={`mt-1 font-black leading-[1.05] tracking-tight ${compact ? "text-xl" : "text-3xl sm:text-4xl"}`}
          >
            {sale.percentOff === 50 ? t("proSale.titleHalf") : t("proSale.title", { percent: sale.percentOff })}
          </h2>
          <p className={`mt-1.5 text-white/70 ${compact ? "text-xs" : "text-sm"}`}>
            {t(gift ? "proSale.subtitleGift" : "proSale.subtitle", { until })}
          </p>
          <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 ${compact ? "mt-2.5" : "mt-4"}`}>
            <span className="text-xs font-semibold uppercase tracking-wider text-white/60">{t("proSale.endsIn")}</span>
            {left !== null ? <Clock ms={left} /> : <span className="h-7" />}
          </div>
        </div>
        <PriceTag percent={sale.percentOff} small={compact} />
      </div>
      <p
        className={`border-t border-dashed border-white/15 text-white/55 ${
          compact ? "px-4 py-2 text-[11px]" : "px-5 py-2.5 text-xs sm:px-6"
        }`}
      >
        {fine}
      </p>
    </section>
  );
}

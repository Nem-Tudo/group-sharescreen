"use client";

import type { ReactNode } from "react";
import { MdCheck } from "react-icons/md";
import { planIcon } from "@/components/planIcons";
import type { BillingCycle, PremiumPlan } from "@/lib/premiumApi";
import { planTierOf } from "@/lib/entitlements";
import { useT } from "@/lib/useI18n";
import type { ComparisonCell, ComparisonRow } from "./PlanComparison";

// The /pro page of the pro-compare-table experiment's "cards" variant: a hero,
// one card per plan, what every plan has, and a flat table. In the colours of
// the home and room redesigns (#0d1117 page, #161b22 cards).
//
// Everything sold here comes from the same rows as the comparison table, so
// these cards cannot promise something the plan document does not grant. The
// buttons only pick a plan: paying stays in ProPanel's checkout card.

const SURFACE = "bg-white dark:bg-[#161b22]";

/** Each plan in the colour of the mark its subscribers wear. */
const TIER_TONES: Record<string, { bar: string; title: string }> = {
  premium: { bar: "bg-blue-500", title: "text-zinc-950 dark:text-zinc-50" },
  premium_max: { bar: "bg-amber-500", title: "text-amber-600 dark:text-amber-400" },
  pro_ultra: { bar: "bg-rose-500", title: "text-rose-600 dark:text-rose-400" },
};

const isAmount = (cell: ComparisonCell): cell is Exclude<ComparisonCell, boolean> => typeof cell === "object";

/** The rows that make this plan worth more than the one below it. */
function planPerks(rows: ComparisonRow[], index: number): ComparisonRow[] {
  const sold = rows.filter((row) => !row.pinned && row.cells[index] !== false);
  if (index > 0) {
    return sold.filter((row) => {
      const cell = row.cells[index];
      const previous = row.cells[index - 1];
      return isAmount(cell) ? !isAmount(previous) || cell.amount !== previous.amount : previous === false;
    });
  }
  // The first plan: what it adds to having no plan, in a list that fits a card.
  // The rest of what it has is under "Em todos os planos".
  return sold
    .filter((row) => {
      const cell = row.cells[0];
      return !(isAmount(cell) && row.free && isAmount(row.free) && row.free.amount === cell.amount);
    })
    .slice(0, 8);
}

function PerkRow({ row, index }: { row: ComparisonRow; index: number }) {
  const cell = row.cells[index];
  return (
    <li className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
      <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
      <span>
        {row.label}
        {isAmount(cell) && <strong className="font-bold text-zinc-950 dark:text-zinc-50">: {cell.label}</strong>}
      </span>
    </li>
  );
}

export function ProCardsHero({
  cycles,
  cycle,
  onCycle,
  topPlan,
  topScreens,
}: {
  cycles: NonNullable<PremiumPlan["cycles"]>;
  cycle: BillingCycle;
  onCycle: (cycle: BillingCycle) => void;
  topPlan: PremiumPlan | null;
  topScreens: number;
}) {
  const t = useT();
  return (
    <section className={`grid items-center gap-8 rounded-[28px] p-6 sm:p-8 md:grid-cols-[minmax(0,1fr)_21rem] ${SURFACE}`}>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-blue-600 uppercase dark:text-blue-400">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {t("pro.cards.eyebrow")}
        </p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-zinc-950 sm:text-5xl dark:text-zinc-50">
          {t("pro.cards.title")} <span className="text-blue-600 dark:text-blue-400">{t("pro.cards.titleAccent")}</span>
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t("pro.cards.subtitle")}</p>
        {cycles.length > 1 && (
          <div className="mt-5 inline-flex rounded-2xl bg-zinc-100 p-1 dark:bg-[#0d1117]">
            {cycles.map((entry) => {
              const active = entry.cycle === cycle;
              return (
                <button
                  key={entry.cycle}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onCycle(entry.cycle)}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    active
                      ? "bg-blue-600 text-white"
                      : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
                  }`}
                >
                  {entry.cycle === "yearly" ? t("pro.proPanel.yearly") : t("pro.proPanel.monthly")}
                  {entry.cycle === "yearly" && entry.discountPercent > 0 && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${active ? "bg-white/20" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"}`}>
                      -{entry.discountPercent}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* The top of the ladder, as a broadcast on a monitor. */}
      <div aria-hidden className="rounded-[24px] bg-blue-600 p-3 shadow-xl shadow-blue-600/20">
        <div className="rounded-2xl bg-[#0d1117] p-5 text-zinc-50">
          <div className="flex items-center justify-between text-[11px] font-bold tracking-widest uppercase">
            <span className="flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2 py-1 text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {t("pro.cards.live")}
            </span>
            <span className="text-zinc-400">{topPlan?.title}</span>
          </div>
          <div className="mt-6 flex items-center gap-4">
            <span className="text-6xl font-extrabold tracking-tighter">4K</span>
            <span className="text-sm font-bold">
              <span className="block">240 <span className="font-medium text-zinc-400">FPS</span></span>
              <span className="block">{topScreens} <span className="font-medium text-zinc-400">{t("pro.cards.statScreens")}</span></span>
            </span>
          </div>
          <div className="mt-6 flex gap-1">
            {Array.from({ length: 20 }, (_, bar) => (
              <span
                key={bar}
                className={`h-2 flex-1 rounded-sm ${bar < 9 ? "bg-blue-500" : bar < 15 ? "bg-amber-500" : "bg-zinc-700"}`}
              />
            ))}
          </div>
          <p className="mt-2 flex justify-between text-[11px] font-bold tracking-widest text-zinc-400 uppercase">
            <span>Bitrate</span>
            <span>{t("pro.cards.upTo32Mbps")}</span>
          </p>
        </div>
      </div>
    </section>
  );
}

export function ProPlanCards({
  plans,
  rows,
  cycle,
  selectedId,
  recommendedId,
  currentId,
  signedIn,
  stats,
  onBuy,
}: {
  plans: PremiumPlan[];
  rows: ComparisonRow[];
  cycle: BillingCycle;
  /** Null until somebody picks: no card is chosen for them. */
  selectedId: string | null;
  recommendedId: string | null;
  currentId: string | null;
  signedIn: boolean;
  stats: (plan: PremiumPlan) => { value: string; label: string }[];
  onBuy: (planId: string) => void;
}) {
  const t = useT();
  return (
    <div className="mt-6 grid items-stretch gap-4 pt-3 md:grid-cols-3">
      {plans.map((plan, index) => {
        const mark = planIcon(plan.iconId);
        const tone = TIER_TONES[planTierOf(plan.id)] ?? TIER_TONES.premium;
        const recommended = plan.id === recommendedId;
        const pricing = plan.cycles?.find((entry) => entry.cycle === cycle);
        const selected = plan.id === selectedId;
        return (
          <article
            key={plan.id}
            className={`relative flex flex-col overflow-visible rounded-[28px] p-5 ${SURFACE} ${
              selected
                ? "ring-2 ring-blue-500"
                : recommended
                  ? "ring-2 ring-amber-500 dark:ring-amber-400"
                  : ""
            }`}
          >
            {recommended ? (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-3 py-0.5 text-xs font-bold whitespace-nowrap text-white">
                {t("pro.proPanel.recommended")}
              </span>
            ) : (
              <span aria-hidden className={`absolute inset-x-8 top-0 h-0.5 rounded-full ${tone.bar}`} />
            )}
            <h2 className={`flex items-center gap-2 text-xl font-extrabold tracking-tight ${tone.title}`}>
              <mark.Icon className={`h-6 w-6 shrink-0 ${mark.className}`} />
              {plan.title}
            </h2>
            <p className="mt-1 min-h-10 text-sm text-zinc-500 dark:text-zinc-400">{plan.description}</p>

            <div className="mt-4 flex divide-x divide-zinc-200 rounded-2xl bg-zinc-100 py-3 dark:divide-zinc-800 dark:bg-[#0d1117]">
              {stats(plan).map((stat) => (
                <div key={stat.label} className="min-w-0 flex-1 px-1 text-center">
                  <p className="text-base font-extrabold text-zinc-950 dark:text-zinc-50">{stat.value}</p>
                  <p className="truncate text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">{stat.label}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-baseline gap-x-2">
              {pricing?.fullPriceLabel && (
                <span className="text-sm text-zinc-400 line-through dark:text-zinc-600">{pricing.fullPriceLabel}</span>
              )}
              <span className="text-3xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50">
                {pricing?.priceLabel ?? plan.priceLabel}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {cycle === "yearly" ? "/ ano" : t("pro.proPanel.month")}
              </span>
            </div>
            {cycle === "yearly" && pricing && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {t("pro.proPanel.equivalentTo")} {pricing.monthlyEquivalentLabel} {t("pro.proPanel.perMonth")}
              </p>
            )}

            <div className="mt-5 mb-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              {index > 0 && (
                <p className="mb-3 text-xs font-bold tracking-wider text-zinc-500 uppercase">
                  {t("pro.cards.everythingFrom", { plan: plans[index - 1].title })}
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {planPerks(rows, index).map((row) => (
                  <PerkRow key={row.key} row={row} index={index} />
                ))}
              </ul>
            </div>

            <button
              type="button"
              onClick={() => onBuy(plan.id)}
              className={`mt-auto w-full cursor-pointer rounded-2xl px-4 py-3 text-sm font-bold transition ${
                recommended
                  ? "bg-amber-500 text-white hover:bg-amber-600"
                  : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              }`}
            >
              {plan.id === currentId
                ? t("pro.cards.yourPlan")
                : signedIn
                  ? `${t("pro.compare.getPlan")} ${plan.title}`
                  : t("pro.cards.signUpAndSubscribe", { plan: plan.title })}
            </button>
          </article>
        );
      })}
    </div>
  );
}

export function ProEveryPlan({ rows }: { rows: ComparisonRow[] }) {
  const t = useT();
  const shared = rows.filter((row) => !row.pinned && row.cells.every((cell) => cell === true));
  if (shared.length === 0) return null;
  return (
    <section className={`mt-6 rounded-[28px] p-6 sm:p-8 ${SURFACE}`}>
      <h2 className="text-lg font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50">{t("pro.cards.everyPlanTitle")}</h2>
      <ul className="mt-4 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
        {shared.map((row) => (
          <PerkRow key={row.key} row={row} index={0} />
        ))}
      </ul>
    </section>
  );
}

export function ProCardsTable({
  plans,
  rows,
  recommendedId,
}: {
  plans: PremiumPlan[];
  rows: ComparisonRow[];
  recommendedId: string | null;
}) {
  const t = useT();
  const cell = (value: ComparisonCell | undefined): ReactNode => {
    if (value === true) return <MdCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-500" aria-label="✓" />;
    if (!value) return <span aria-label="✕">—</span>;
    return (
      <span className="inline-flex items-center gap-1">
        {value.icon}
        {value.label}
      </span>
    );
  };
  const tint = (planId: string) => (planId === recommendedId ? "bg-amber-500/10 font-semibold text-zinc-950 dark:text-zinc-50" : "");
  return (
    <section className="mt-8">
      <h2 className="text-lg font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50">{t("pro.cards.tableTitle")}</h2>
      <div className={`mt-3 overflow-x-auto rounded-[20px] ${SURFACE}`}>
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="text-xs font-bold tracking-wider text-zinc-500 uppercase">
            <tr>
              <th className="px-4 py-3" />
              <th className="px-3 py-3">{t("pro.compare.noPlan")}</th>
              {plans.map((plan) => (
                <th key={plan.id} className={`px-3 py-3 ${plan.id === recommendedId ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : ""}`}>
                  {plan.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-zinc-600 dark:text-zinc-400">
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="px-4 py-2.5 font-semibold text-zinc-900 dark:text-zinc-100">{row.label}</td>
                <td className="px-3 py-2.5">{cell(row.free)}</td>
                {plans.map((plan, index) => (
                  <td key={plan.id} className={`px-3 py-2.5 ${tint(plan.id)}`}>
                    {cell(row.cells[index])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

"use client";

import type { ReactNode } from "react";
import { MdArrowUpward, MdCheck, MdClose } from "react-icons/md";
import { planIcon } from "@/components/planIcons";
import type { PremiumPlan } from "@/lib/premiumApi";
import { useT } from "@/lib/useI18n";

// The plans side by side — one column per plan, one row per benefit — in the
// shape of Discord's "What you've got" table.
//
// The experiment behind it is PRO_COMPARE_FEATURE: ProPanel shows this instead
// of the plan picker and the single plan's benefit list, and the admin panel
// compares sales per plan between those who got it and those who did not.
//
// Kept short on purpose, because the buy button lives under it:
//   - the rows are ordered by how many plans miss them, so the ✕s gather at
//     the bottom and the table reads as a staircase;
//   - numbers that grow from one plan to the next are highlighted.

/** The feature key in the admin panel's "Features" tab. */
export const PRO_COMPARE_FEATURE = "pro-compare-table";
/**
 * The treatments: "on" keeps the price and checkout card under the table,
 * "buy-top" moves it above (see ProPanel).
 */
export const PRO_COMPARE_BUY_TOP = "buy-top";

/** A number worth comparing: `amount` orders it, `label` is what is shown. */
export type ComparisonAmount = { label: string; amount: number; icon?: ReactNode };
export type ComparisonCell = boolean | ComparisonAmount;

export interface ComparisonRow {
  key: string;
  label: ReactNode;
  /** One per plan, in the same order as `plans`. */
  cells: ComparisonCell[];
  /** Pinned first (the price). Pinned rows are never highlighted. */
  pinned?: boolean;
  /**
   * Which block the row belongs to — lower comes first (the broadcast perks
   * are 0, everything else 1). The staircase ordering applies inside a block.
   */
  priority?: number;
  /** Keep this row directly under the row with this key, wherever it lands. */
  after?: string;
}

const isAmount = (cell: ComparisonCell): cell is ComparisonAmount => typeof cell === "object" && cell !== null;
const has = (cell: ComparisonCell) => cell !== false;

export function PlanComparison({
  plans,
  rows,
  selectedId,
  recommendedId,
  onSelect,
  onBuy,
}: {
  plans: PremiumPlan[];
  rows: ComparisonRow[];
  selectedId: string | null;
  recommendedId: string | null;
  onSelect: (planId: string) => void;
  /** Picks the plan and takes the person to the checkout. */
  onBuy: (planId: string) => void;
}) {
  const t = useT();

  const pinned = rows.filter((row) => row.pinned);
  const rest = rows.filter((row) => !row.pinned);
  // By block first (broadcast perks on top), then by how many plans lack the
  // row, amounts before ticks. Stable, so equal rows keep the catalogue's order.
  const differing = rest
    .map((row, index) => ({
      row,
      index,
      priority: row.priority ?? 1,
      missing: row.cells.filter((cell) => !has(cell)).length,
      amount: row.cells.some(isAmount) ? 0 : 1,
    }))
    .sort((a, b) => a.priority - b.priority || a.missing - b.missing || a.amount - b.amount || a.index - b.index)
    .map((entry) => entry.row);
  // Rows that belong under another one are moved there after sorting.
  for (const row of [...differing]) {
    if (!row.after) continue;
    const anchor = differing.findIndex((entry) => entry.key === row.after);
    if (anchor < 0) continue;
    differing.splice(differing.indexOf(row), 1);
    differing.splice(differing.findIndex((entry) => entry.key === row.after) + 1, 0, row);
  }

  // Each plan column is one rounded box: its cells carry the side borders,
  // the header the top and the footer the bottom. The recommended plan is
  // amber; the selected one (when different) violet; both get a tint.
  const column = (planId: string, position: "top" | "middle" | "bottom") => {
    const recommended = planId === recommendedId;
    const selected = planId === selectedId;
    if (!recommended && !selected) return "border-x-2 border-transparent";
    const edge = position === "top" ? "rounded-t-xl border-t-2" : position === "bottom" ? "rounded-b-xl border-b-2" : "";
    const colour = recommended
      ? "border-amber-500 dark:border-amber-400"
      : "border-violet-500 dark:border-violet-400";
    const tint = selected ? "bg-violet-500/10 dark:bg-violet-400/10" : "bg-amber-500/5";
    return `border-x-2 ${colour} ${tint} ${edge}`;
  };

  const renderCell = (row: ComparisonRow, index: number) => {
    const cell = row.cells[index];
    if (cell === true) return <MdCheck className="mx-auto h-5 w-5 text-zinc-900 dark:text-zinc-100" aria-label="✓" />;
    if (cell === false) return <MdClose className="mx-auto h-5 w-5 text-zinc-300 dark:text-zinc-700" aria-label="✕" />;
    // Growth against the plan to the left — the thing the eye should catch.
    const previous = index > 0 ? row.cells[index - 1] : false;
    const grew = !row.pinned && index > 0 && (!isAmount(previous) || cell.amount > previous.amount);
    return grew ? (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">
        <MdArrowUpward className="h-3.5 w-3.5" />
        {cell.icon}
        {cell.label}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {cell.icon}
        {cell.label}
      </span>
    );
  };

  const cellClass = (planId: string, bordered: boolean) =>
    `cursor-pointer px-2 py-2.5 text-center ${bordered ? "border-b border-b-zinc-200 dark:border-b-zinc-800" : ""} ${column(planId, "middle")}`;
  const labelClass = "py-2.5 pr-3 text-sm text-zinc-700 dark:text-zinc-300 border-b border-zinc-200 dark:border-zinc-800";

  const bodyRow = (row: ComparisonRow) => (
    <tr key={row.key}>
      <td className={labelClass}>{row.label}</td>
      {plans.map((plan, index) => (
        <td key={plan.id} onClick={() => onSelect(plan.id)} className={cellClass(plan.id, true)}>
          {renderCell(row, index)}
        </td>
      ))}
    </tr>
  );

  const buyButton = (planId: string) => (
    <button
      type="button"
      onClick={() => onBuy(planId)}
      className={`w-full rounded-lg px-2 py-2 text-xs font-semibold transition sm:text-sm ${
        planId === recommendedId
          ? "bg-amber-500 text-white hover:bg-amber-600"
          : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      }`}
    >
      {t("pro.compare.getPlan")}
    </button>
  );

  return (
    <section className="mt-6">
      <h2 className="text-center text-xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
        {t("pro.compare.title")}
      </h2>
      {/* pt-3: a horizontal scroller clips vertically too, and the
          "Recomendado" tag sits half above its column. */}
      <div className="mt-1 overflow-x-auto pt-3">
        <table className="w-full min-w-[30rem] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="pb-3 pr-3 text-left align-bottom text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("pro.compare.pricingAndFeatures")}
              </th>
              {plans.map((plan) => {
                const mark = planIcon(plan.iconId);
                const selected = plan.id === selectedId;
                return (
                  <th key={plan.id} className={`w-[22%] p-0 align-bottom ${column(plan.id, "top")}`}>
                    <button
                      type="button"
                      onClick={() => onSelect(plan.id)}
                      aria-pressed={selected}
                      className="relative flex w-full flex-col items-center gap-0.5 px-2 pt-5 pb-3 transition hover:opacity-80"
                    >
                      {plan.id === recommendedId && (
                        <span className="absolute -top-2.5 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] leading-4 font-semibold whitespace-nowrap text-white">
                          {t("pro.proPanel.recommended")}
                        </span>
                      )}
                      <mark.Icon className={`h-6 w-6 ${mark.className}`} />
                      <span className="text-xs font-extrabold tracking-wide text-zinc-950 uppercase italic sm:text-sm dark:text-zinc-50">
                        {plan.title}
                      </span>
                      <span className={`text-[11px] font-medium ${selected ? "text-violet-600 dark:text-violet-300" : "text-zinc-400"}`}>
                        {selected ? t("pro.compare.selected") : t("pro.compare.choose")}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pinned.map(bodyRow)}
            {differing.map(bodyRow)}
            {/* The buy buttons, at the foot of each column — the table is
                where the decision is made, so the action sits right there. */}
            <tr>
              <td />
              {plans.map((plan) => (
                <td key={plan.id} className={`px-2 pt-3 pb-3 ${column(plan.id, "bottom")}`}>
                  {buyButton(plan.id)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

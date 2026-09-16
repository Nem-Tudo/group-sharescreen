"use client";

import type { ReactNode } from "react";
import { MdCheck, MdClose } from "react-icons/md";
import { planIcon } from "@/components/planIcons";
import type { PremiumPlan } from "@/lib/premiumApi";
import { useT } from "@/lib/useI18n";

// The plans side by side — one column per plan, one row per benefit — in the
// shape of Discord's "What you've got" table.
//
// The experiment behind it is PRO_COMPARE_FEATURE: ProPanel shows this instead
// of the plan picker and the single plan's benefit list, and the admin panel
// compares sales per plan between those who got it and those who did not.
// Clicking a column selects that plan; the price, cycle and checkout below the
// table keep working exactly as before.

/** The feature key in the admin panel's "Features" tab. */
export const PRO_COMPARE_FEATURE = "pro-compare-table";

export type ComparisonCell = boolean | ReactNode;

export interface ComparisonRow {
  key: string;
  label: ReactNode;
  /** One per plan, in the same order as `plans`. `true`/`false` draw ✓/✕. */
  cells: ComparisonCell[];
}

export function PlanComparison({
  plans,
  rows,
  selectedId,
  recommendedId,
  onSelect,
}: {
  plans: PremiumPlan[];
  rows: ComparisonRow[];
  selectedId: string | null;
  recommendedId: string;
  onSelect: (planId: string) => void;
}) {
  const t = useT();
  const last = rows.length - 1;

  // The selected column is drawn as one rounded box running down the table:
  // each of its cells carries the side borders, the header the top, the last
  // row the bottom.
  const column = (planId: string, position: "top" | "middle" | "bottom") => {
    const selected = planId === selectedId;
    if (!selected) return "";
    const edge =
      position === "top"
        ? "rounded-t-xl border-t-2"
        : position === "bottom"
          ? "rounded-b-xl border-b-2"
          : "";
    return `border-x-2 border-violet-500 bg-violet-500/10 dark:border-violet-400 dark:bg-violet-400/10 ${edge}`;
  };

  const renderCell = (cell: ComparisonCell) => {
    if (cell === true) {
      return <MdCheck className="mx-auto h-5 w-5 text-zinc-900 dark:text-zinc-100" aria-label="✓" />;
    }
    if (cell === false || cell === null || cell === undefined) {
      return <MdClose className="mx-auto h-5 w-5 text-zinc-400 dark:text-zinc-600" aria-label="✕" />;
    }
    return <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{cell}</span>;
  };

  return (
    <section className="mt-7">
      <h2 className="text-center text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
        {t("pro.compare.title")}
      </h2>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[30rem] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="pb-4 pr-3 text-left align-bottom text-base font-semibold text-zinc-900 dark:text-zinc-100">
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
                      className="relative flex w-full flex-col items-center gap-1 px-2 pt-5 pb-4 transition hover:opacity-80"
                    >
                      {plan.id === recommendedId && (
                        <span className="absolute top-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] leading-4 font-semibold text-white">
                          {t("pro.proPanel.recommended")}
                        </span>
                      )}
                      <mark.Icon className={`h-7 w-7 ${mark.className}`} />
                      <span className="text-sm font-extrabold tracking-wide text-zinc-950 uppercase italic dark:text-zinc-50">
                        {plan.title}
                      </span>
                      <span
                        className={`text-[11px] font-medium ${
                          selected ? "text-violet-600 dark:text-violet-300" : "text-zinc-400"
                        }`}
                      >
                        {selected ? t("pro.compare.selected") : t("pro.compare.choose")}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key}>
                <td
                  className={`py-4 pr-3 text-sm text-zinc-700 dark:text-zinc-300 ${
                    index < last ? "border-b border-zinc-200 dark:border-zinc-800" : ""
                  }`}
                >
                  {row.label}
                </td>
                {plans.map((plan, planIndex) => (
                  <td
                    key={plan.id}
                    onClick={() => onSelect(plan.id)}
                    className={`cursor-pointer px-2 py-4 text-center ${
                      index < last ? "border-b border-b-zinc-200 dark:border-b-zinc-800" : ""
                    } ${column(plan.id, index === last ? "bottom" : "middle")}`}
                  >
                    {renderCell(row.cells[planIndex])}
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

"use client";

import { MdClose, MdCalendarToday, MdCreditCard, MdEventRepeat, MdSwapVert, MdCancel } from "react-icons/md";
import { useT } from "@/lib/useI18n";

/**
 * Shown before subscribing to a plan *lower* than the one still running.
 *
 * The purchase is unusual enough to need saying out loud before the money
 * moves: the card is charged today, but the plan bought only starts when the
 * higher one ends, and the renewal date follows that start — not today. See
 * the API's /premium/subscribe (`deferred`). Laid out as the dates the person
 * will actually live through, because that is the question they have: "what
 * happens to me, and when am I charged?"
 */
export function DeferredDowngradeModal({
  open,
  currentTitle,
  newTitle,
  priceLabel,
  yearly,
  currentEndLabel,
  nextChargeLabel,
  replacesCardSubscription,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  currentTitle: string;
  newTitle: string;
  priceLabel: string;
  yearly: boolean;
  currentEndLabel: string;
  nextChargeLabel: string;
  /** The higher plan is a card subscription that would otherwise renew. */
  replacesCardSubscription: boolean;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  if (!open) return null;

  const params = { current: currentTitle, plan: newTitle, price: priceLabel };
  const steps = [
    { Icon: MdCreditCard, text: t("deferredDowngrade.today", params) },
    { Icon: MdCalendarToday, text: t("deferredDowngrade.untilEnd", { ...params, date: currentEndLabel }) },
    { Icon: MdSwapVert, text: t("deferredDowngrade.onEnd", { ...params, date: currentEndLabel }) },
    {
      Icon: MdEventRepeat,
      text: t(yearly ? "deferredDowngrade.nextChargeYearly" : "deferredDowngrade.nextChargeMonthly", {
        ...params,
        date: nextChargeLabel,
      }),
    },
    ...(replacesCardSubscription
      ? [{ Icon: MdCancel, text: t("deferredDowngrade.oldSubscriptionEnds", params) }]
      : []),
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
            {t("deferredDowngrade.title", params)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="-mr-1 shrink-0 rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-5">
          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t("deferredDowngrade.intro", { ...params, date: currentEndLabel })}
          </p>

          <ul className="mt-4 space-y-2.5 rounded-xl bg-zinc-50 p-3.5 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            {steps.map(({ Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
                <span>{text}</span>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{t("deferredDowngrade.cardOnly")}</p>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              {t("deferredDowngrade.back")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {t("deferredDowngrade.confirm", params)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

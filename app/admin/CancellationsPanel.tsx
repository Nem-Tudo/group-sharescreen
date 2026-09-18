"use client";

import { useCallback, useEffect, useState } from "react";
import { MdRefresh } from "react-icons/md";
import { fetchCancellations, type AdminCancellation } from "@/lib/adminApi";
import { useI18n } from "@/lib/useI18n";

// What people said on their way out.
//
// This panel is the reason the questions are asked at all. A survey whose
// answers nobody can read is a form that exists to annoy people, and the
// cancellation flow is deliberately annoying enough already (see the site's
// CancelSurveyDialog and the API's /premium/cancel, which refuses to cancel
// anything without a complete one).
//
// Read-only, and it stays that way. There is no "responder" button and no
// export: this is a page somebody scrolls once a week to notice that four of
// the last ten said the same thing. A tool that tried to be a CRM would be a
// tool nobody opens.
//
// Because every question is required, the rows are not a self-selected sample
// — which is the one property that makes counting the reasons meaningful at
// all.

/** How many to ask for. Enough to see a pattern, few enough to scroll. */
const LIMIT = 100;

/** "3 meses", "11 dias" — how long they had been paying, roughly. */
function subscribedLabel(ms: number | null): string | null {
  if (!ms || ms < 0) return null;
  const days = Math.round(ms / 86_400_000);
  if (days < 1) return "<1d";
  if (days < 45) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months}m`;
  return `${(days / 365).toFixed(1)}a`;
}

function when(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

export function CancellationsPanel() {
  const { t } = useI18n();
  const [rows, setRows] = useState<AdminCancellation[]>([]);
  const [reasons, setReasons] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Every setState here is after an await or inside a handler, never in an
    // effect body — see the first load below, which starts in a microtask for
    // exactly that reason.
    setError(null);
    try {
      const data = await fetchCancellations(LIMIT);
      setRows(data.cancellations);
      setReasons(data.reasons);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.cancellations.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Biggest first, because the question this answers is "what is the main
  // reason" and a list in declaration order makes that a counting exercise.
  const tally = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  const total = tally.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {t("admin.cancellations.title")}
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {t("admin.cancellations.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          disabled={loading}
          aria-label={t("admin.cancellations.reload")}
          className="shrink-0 rounded-lg border border-zinc-300 p-1.5 text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          <MdRefresh className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* The tally first, because it is the only part anybody reads every
          time. The rows below are what you go to once it says something
          surprising. */}
      {tally.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tally.map(([reason, count]) => (
            <span
              key={reason}
              className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              {t(`cancelSurvey.reason.${reason}`)}
              {" · "}
              <b className="font-semibold">{count}</b>
              {total > 0 && <span className="text-zinc-500"> ({Math.round((count / total) * 100)}%)</span>}
            </span>
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          {t("admin.cancellations.empty")}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((row) => {
          const tenure = subscribedLabel(row.subscribedForMs);
          return (
            <li
              key={row.id}
              className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">@{row.username}</span>
                <span>·</span>
                <span>{row.planTitle}</span>
                {row.cycle && <span>· {row.cycle}</span>}
                {/* Which processor held it. With two live at once, a pattern
                    that is really about one of them would otherwise look like
                    a pattern about the product. */}
                <span>· {row.provider}</span>
                {tenure && <span>· {t("admin.cancellations.subscribedFor", { value: tenure })}</span>}
                <span className="ml-auto">{when(row.createdAt)}</span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {t(`cancelSurvey.reason.${row.reason}`)}
                  {row.reasonOther ? `: ${row.reasonOther}` : ""}
                </span>
                <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {t("admin.cancellations.usage")}: {t(`cancelSurvey.usage.${row.usage}`)}
                </span>
              </div>

              {/* The two free-text answers, whole. Truncating them would defeat
                  the point of having asked: the useful sentence is as likely
                  to be the third one as the first. */}
              <Answer label={t("admin.cancellations.improvement")} value={row.improvement} />
              <Answer label={t("admin.cancellations.comeback")} value={row.comeback} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Answer({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      <p className="whitespace-pre-wrap break-words text-xs text-zinc-700 dark:text-zinc-300">
        {value}
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MdOutlineAddCircleOutline, MdOutlineFavoriteBorder, MdOutlinePeopleAlt } from "react-icons/md";
import { StatTile, TimeSeriesChart, formatCount } from "@/app/ad/[token]/charts";
import {
  EffectReportDeniedError,
  fetchEffectReport,
  workshopPreviewUrl,
  type EffectReport,
  type EffectReportBucket,
  type EffectReportRange,
} from "@/lib/cameraEffectWorkshop";
import { useT } from "@/lib/useI18n";

// An effect's panel, for the person who made it, on the same charts as a theme's.
// No "wearing it now" as a theme has: an effect runs from a copy in the browser of
// whoever took it, and nothing here can see that. What it can say is who took it
// and who liked it, and when.

const POLL_INTERVAL_MS = 15_000;
const RANGES: { value: EffectReportRange; label: string }[] = [
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 d" },
  { value: "30d", label: "30 d" },
];

export function EffectReportClient({ id }: { id: string }) {
  const t = useT();
  const [range, setRange] = useState<EffectReportRange>("7d");
  const [report, setReport] = useState<EffectReport | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function load() {
      try {
        const data = await fetchEffectReport(id, range, controller.signal);
        if (cancelled) return;
        setReport(data);
        setError(false);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof EffectReportDeniedError) {
          setDenied(true);
          return;
        }
        setError(true);
      }
      // Only once the previous one settled, so a slow connection cannot race itself.
      if (!cancelled) timer = setTimeout(() => void load(), POLL_INTERVAL_MS);
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [id, range]);

  if (denied) {
    return (
      <main className="mx-auto w-full max-w-md grow px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{t("cameraWorkshop.panelNotYours")}</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("cameraWorkshop.panelNotYoursHint")}</p>
        <Link
          href="/workshop/effects"
          className="mt-4 inline-block rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
        >
          {t("cameraWorkshop.discover")}
        </Link>
      </main>
    );
  }

  if (!report) {
    return (
      <main className="mx-auto w-full max-w-5xl grow px-4 py-16">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>
      </main>
    );
  }

  const { effect, totals, window: win } = report;
  const likesInWindow = win.buckets.reduce((sum, bucket) => sum + bucket.likes, 0);

  return (
    // The palette the charts read: they hardcode no colour of their own.
    <main className="report-viz mx-auto w-full max-w-5xl grow px-4 py-6 sm:px-6">
      <style>{`
        .report-viz {
          --surface: #ffffff;
          --hairline: #e4e4e7;
          --track: #f0efec;
          --grid: #ececea;
          --ink-1: #09090b;
          --ink-2: #52525b;
          --ink-3: #a1a1aa;
          --series-1: #2a78d6;
          --series-2: #eb6834;
          --series-3: #1baf7a;
          --ordinal-1: #1c5cab;
          --ordinal-2: #2a78d6;
          --ordinal-3: #5598e7;
        }
        [data-theme="dark"] .report-viz {
          --surface: #0c0c0e;
          --hairline: #27272a;
          --track: #26262a;
          --grid: #242428;
          --ink-1: #fafafa;
          --ink-2: #a1a1aa;
          --ink-3: #71717a;
          --series-1: #3987e5;
          --series-2: #d95926;
          --series-3: #199e70;
          --ordinal-1: #86b6ef;
          --ordinal-2: #5598e7;
          --ordinal-3: #2a78d6;
        }
      `}</style>

      <div className="flex flex-wrap items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- served by the API, with its own cache */}
        <img src={workshopPreviewUrl(effect)} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-[var(--ink-1)]">{effect.name}</h1>
          <Link href={`/effect/${encodeURIComponent(effect.id)}`} className="text-xs text-[var(--ink-2)] hover:underline">
            {t("cameraWorkshop.viewPage")}
          </Link>
        </div>
        <div className="flex gap-1">
          {RANGES.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={range === item.value}
              onClick={() => setRange(item.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                range === item.value
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{t("cameraWorkshop.panelOffline")}</p>}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={t("cameraWorkshop.panelTotalUses")} value={formatCount(totals.uses)} icon={<MdOutlineAddCircleOutline />} accent="--series-1" />
        <StatTile label={t("cameraWorkshop.panelTotalLikes")} value={formatCount(totals.likes)} icon={<MdOutlineFavoriteBorder />} accent="--series-2" />
        <StatTile
          label={t("cameraWorkshop.panelPeople")}
          value={formatCount(win.people)}
          hint={t("cameraWorkshop.panelLikesInWindow", { count: formatCount(likesInWindow) })}
          icon={<MdOutlinePeopleAlt />}
          accent="--series-1"
        />
      </div>

      <section className="mt-4 rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--ink-1)]">{t("cameraWorkshop.panelUsesChart")}</h2>
        <div className="mt-3">
          <TimeSeriesChart<EffectReportBucket>
            buckets={win.buckets}
            step={win.step}
            series={{ label: t("cameraWorkshop.panelUsesChart"), valueOf: (bucket) => bucket.uses, color: "--series-1" }}
            emptyLabel={t("cameraWorkshop.panelNoUses")}
          />
        </div>
        <h2 className="mt-5 text-sm font-semibold text-[var(--ink-1)]">{t("cameraWorkshop.panelLikesChart")}</h2>
        <div className="mt-3">
          <TimeSeriesChart<EffectReportBucket>
            buckets={win.buckets}
            step={win.step}
            series={{ label: t("cameraWorkshop.panelLikesChart"), valueOf: (bucket) => bucket.likes, color: "--series-2" }}
            emptyLabel={t("cameraWorkshop.panelNoLikes")}
          />
        </div>
        <p className="mt-3 text-[11px] text-[var(--ink-3)]">{t("cameraWorkshop.panelHint")}</p>
      </section>
    </main>
  );
}

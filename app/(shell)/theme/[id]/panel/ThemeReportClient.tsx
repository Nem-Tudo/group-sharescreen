"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BsCoin } from "react-icons/bs";
import {
  MdOutlineAddCircleOutline,
  MdOutlineFavoriteBorder,
  MdOutlineMeetingRoom,
  MdOutlinePeopleAlt,
  MdOutlinePodcasts,
  MdOutlineRemoveCircleOutline,
  MdOutlineShowChart,
} from "react-icons/md";
import {
  FunnelChart,
  SplitBar,
  StatTile,
  TimeSeriesChart,
  bucketFullLabel,
  formatCount,
} from "@/app/ad/[token]/charts";
import {
  THEME_REPORT_RANGES,
  ThemeReportDeniedError,
  fetchThemeReport,
  formatPoints,
  type ThemeReport,
  type ThemeReportBucket,
  type ThemeReportRange,
} from "@/lib/themeReport";
import { gradientCss, isDarkTheme } from "@/lib/roomThemes";
import { useI18n } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";
import { formatLocale } from "@/lib/i18n";

// A theme's dashboard, for the person who made it.
//
// Built on the advertiser report's own charts (see app/ad/[token]) rather
// than beside them: they are the same job — somebody who made a thing wanting
// to know how it is doing — and two pages that answer it in two visual
// languages is how a site stops looking like one site.
//
// What is different is what the numbers *are*. An advertiser's report is about
// events that already happened; a theme is worn, so half of this is a gauge
// rather than a tally: how many people have it on right now, how many of those
// are online, how many rooms are wearing it. Those live at the top, because
// they are the ones that change while somebody is looking.

const POLL_INTERVAL_MS = 4000;

const dateTimeFormat = () => new Intl.DateTimeFormat(formatLocale(), {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function relativeSeconds(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 5) return "agora mesmo";
  if (seconds < 60) return translate("common.secondsSAgo", { seconds });
  return translate("common.valueMinAgo", { value: Math.round(seconds / 60) });
}

export function ThemeReportClient({ id }: { id: string }) {
  const { t, tc } = useI18n();
  const [range, setRange] = useState<ThemeReportRange>("24h");
  // undefined = the first load has not landed. A failed *poll* keeps the last
  // report on screen: numbers four seconds old beat a blank page.
  const [report, setReport] = useState<ThemeReport | undefined>(undefined);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const data = await fetchThemeReport(id, range, controller.signal);
        if (cancelled) return;
        setReport(data);
        setUpdatedAt(Date.now());
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ThemeReportDeniedError) {
          setDenied(true);
          return;
        }
        setError(t("theme.panel.themeReportClient.noConnectionShowingTheLatestNumbers"));
      }
      // Scheduled only once the previous one settled, so a slow connection
      // cannot end up racing itself and landing answers out of order.
      if (!cancelled) timer = setTimeout(load, POLL_INTERVAL_MS);
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [id, range, t]);

  if (denied) {
    return (
      <main className="mx-auto w-full max-w-md grow px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
          {t("theme.panel.themeReportClient.thisDashboardIsNotYours")}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {t("theme.panel.themeReportClient.onlyWhoeverCreatedAThemeSees")}
        </p>
        <Link
          href="/workshop"
          className="mt-4 inline-block rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
        >
          {t("common.seeDiscover")}
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

  const { theme, live, totals, window: win } = report;
  const dropped = Math.max(0, totals.adopters - live.wearing);
  const lastBucket = win.buckets[win.buckets.length - 1];
  const { palette, accent } = theme.spec;

  return (
    // The same palette the advertiser's report declares, and for the same
    // reason: the charts read these and hardcode no colour of their own.
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

      {/* ── Cabeçalho ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* The theme itself, at thumbnail size. A dashboard about a look
              should show the look — otherwise it is a page of numbers about a
              name. */}
          <span
            className="flex h-12 w-12 shrink-0 overflow-hidden rounded-xl border"
            style={{
              borderColor: palette.border,
              background: gradientCss(theme.spec) ?? palette.page,
            }}
          >
            {[palette.surface, palette.raised, accent].map((colour, index) => (
              <span key={index} className="h-full flex-1" style={{ background: colour }} />
            ))}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
              {t("common.themeDashboard")}
            </p>
            <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-[var(--ink-1)]">
              {theme.name}
            </h1>
            <p className="mt-1 text-xs text-[var(--ink-3)]">
              {t("theme.panel.themeReportClient.createdOn")} {dateTimeFormat().format(theme.createdAt)} ·{" "}
              {isDarkTheme(theme.spec) ? t("common.dark") : t("common.light")}
              {theme.price > 0 ? t("theme.panel.themeReportClient.valuePoints", { value: formatPoints(theme.price) }) : t("theme.panel.themeReportClient.free")}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {theme.published ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {t("theme.panel.themeReportClient.onDiscover")}
            </span>
          ) : (
            <span className="rounded-full bg-zinc-500/10 px-2.5 py-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              {t("common.private")}
            </span>
          )}
          <span className="text-[11px] text-[var(--ink-3)]">
            {error ?? t("common.updatedValue", { value: relativeSeconds(Math.max(0, now - updatedAt)) })}
          </span>
        </div>
      </header>

      {/* ── Agora ─────────────────────────────────────────────────────── */}
      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold text-[var(--ink-1)]">{t("theme.panel.themeReportClient.now")}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={t("theme.panel.themeReportClient.using")}
            icon={<MdOutlinePeopleAlt />}
            accent="--series-3"
            value={formatCount(live.wearing)}
            hint={t("theme.panel.themeReportClient.accountsWithYourThemeSelectedRight")}
          />
          <StatTile
            label={t("theme.panel.themeReportClient.onlineNow")}
            icon={<MdOutlinePodcasts />}
            accent="--series-1"
            value={formatCount(live.online)}
            hint={t("theme.panel.themeReportClient.ofThoseHowManyHaveGolive")}
          />
          <StatTile
            label={t("theme.panel.themeReportClient.roomsWithTheTheme")}
            icon={<MdOutlineMeetingRoom />}
            accent="--series-2"
            value={formatCount(live.rooms)}
            hint={t("theme.panel.themeReportClient.liveRoomsWhereSomeoneAppliedYour")}
          />
          <StatTile
            label={t("theme.panel.themeReportClient.keptIt")}
            icon={<MdOutlineShowChart />}
            value={totals.retention === null ? "—" : `${Math.round(totals.retention * 100)}%`}
            hint={t("theme.panel.themeReportClient.ofEveryoneWhoHasUsedIt")}
          />
        </div>
      </section>

      {/* ── Sempre ────────────────────────────────────────────────────── */}
      <section className="mt-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--ink-1)]">{t("theme.panel.themeReportClient.sinceTheBeginning")}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={t("theme.panel.themeReportClient.distinctPeople")}
            icon={<MdOutlinePeopleAlt />}
            accent="--series-1"
            value={formatCount(totals.adopters)}
            hint={t("theme.panel.themeReportClient.distinctPeopleWhoAppliedTheTheme")}
          />
          <StatTile
            label={t("theme.panel.themeReportClient.timesItWasApplied")}
            icon={<MdOutlineAddCircleOutline />}
            accent="--series-3"
            value={formatCount(totals.applies)}
            hint={t("theme.panel.themeReportClient.includesWhoeverRemovedItAndApplied")}
          />
          <StatTile
            label={t("theme.panel.themeReportClient.timesItWasRemoved")}
            icon={<MdOutlineRemoveCircleOutline />}
            accent="--series-2"
            value={formatCount(totals.removes)}
            hint={t("theme.panel.themeReportClient.switchingToAnotherThemeCountsHere")}
          />
          <StatTile
            label={t("theme.panel.themeReportClient.likes")}
            icon={<MdOutlineFavoriteBorder />}
            value={formatCount(totals.likes)}
            hint={t("theme.panel.themeReportClient.onePerPerson")}
          />
        </div>
      </section>

      {/* Only for a theme that is actually sold. A row of zeroes about money
          on a free theme is a page telling somebody about a business they are
          not in. */}
      {theme.price > 0 && (
        <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={t("theme.panel.themeReportClient.sales")}
            icon={<BsCoin />}
            accent="--series-3"
            value={formatCount(totals.sales)}
            hint={t("theme.panel.themeReportClient.howManyPeopleBoughtTheTheme")}
          />
          <StatTile
            label={t("theme.panel.themeReportClient.pointsEarned")}
            icon={<BsCoin />}
            accent="--series-1"
            value={formatPoints(totals.earned)}
            hint={t("theme.panel.themeReportClient.yourShareOfTheSalesAlready")}
          />
        </section>
      )}

      {/* ── Ao longo do tempo ─────────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--ink-1)]">{t("common.overTime")}</h2>
          <div className="flex gap-1 rounded-lg bg-[var(--track)] p-0.5">
            {THEME_REPORT_RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                aria-pressed={range === option.value}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  range === option.value
                    ? "bg-[var(--surface)] text-[var(--ink-1)] shadow-sm"
                    : "text-[var(--ink-2)] hover:text-[var(--ink-1)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-[var(--ink-3)]">
          {formatCount(win.people)} {tc("common.personNoun", win.people)} {t("theme.panel.themeReportClient.appliedTheThemeInThisPeriod")}
        </p>
        <div className="mt-3">
          <TimeSeriesChart<ThemeReportBucket>
            buckets={win.buckets}
            step={win.step}
            series={{
              label: t("theme.panel.themeReportClient.appliedTheTheme"),
              valueOf: (bucket) => bucket.applies,
              color: "--series-1",
            }}
            emptyLabel={t("theme.panel.themeReportClient.nobodyAppliedTheThemeInThis")}
          />
        </div>
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-[var(--ink-2)]">{t("theme.panel.themeReportClient.removedIt")}</p>
          <TimeSeriesChart<ThemeReportBucket>
            buckets={win.buckets}
            step={win.step}
            series={{
              label: t("theme.panel.themeReportClient.removedTheTheme"),
              valueOf: (bucket) => bucket.removes,
              color: "--series-2",
            }}
            emptyLabel={t("theme.panel.themeReportClient.nobodyRemovedTheThemeInThis")}
          />
        </div>
        {/* Only when there is a last bucket to name. The fallback used to be
            `Date.now()`, which is a clock read during render — a value React
            cannot know changed, and one this line does not need: with no
            buckets there is nothing to say about the last one. */}
        {lastBucket && (
          <p className="mt-2 text-[11px] text-[var(--ink-3)]">
            {t("theme.panel.themeReportClient.eachPointIs")} {win.step === "hour" ? "uma hora" : "um dia"} {t("theme.panel.themeReportClient.theLastOneRunsUntil")}{" "}
            {bucketFullLabel(lastBucket.t, win.step)}.
          </p>
        )}
      </section>

      {/* ── O caminho ─────────────────────────────────────────────────── */}
      <section className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--ink-1)]">{t("theme.panel.themeReportClient.fromTheFirstClickUntilNow")}</h2>
          <p className="mt-1 text-xs text-[var(--ink-3)]">
            {t("theme.panel.themeReportClient.howManyPeopleAreLeftAt")}
          </p>
          <div className="mt-3">
            <FunnelChart
              stages={[
                {
                  label: t("theme.panel.themeReportClient.haveUsedIt"),
                  value: totals.adopters,
                  hint: t("theme.panel.themeReportClient.distinctPeopleWhoAppliedTheTheme2"),
                },
                {
                  label: t("theme.panel.themeReportClient.stillUsingIt"),
                  value: live.wearing,
                  hint: t("theme.panel.themeReportClient.stillHaveItSelected"),
                },
                {
                  label: t("theme.panel.themeReportClient.onlineNow"),
                  value: live.online,
                  hint: t("theme.panel.themeReportClient.andHaveGoliveOpenRightNow"),
                },
              ]}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--ink-1)]">{t("theme.panel.themeReportClient.whoStayedAndWhoLeft")}</h2>
          <p className="mt-1 text-xs text-[var(--ink-3)]">
            {t("theme.panel.themeReportClient.ofThePeopleWhoHaveApplied")}
          </p>
          <div className="mt-4">
            <SplitBar
              parts={[
                { label: t("theme.panel.themeReportClient.stayed"), value: live.wearing, color: "var(--series-3)" },
                { label: t("theme.panel.themeReportClient.left"), value: dropped, color: "var(--series-2)" },
              ]}
            />
          </div>
          {totals.adopters === 0 && (
            <p className="mt-3 text-xs text-[var(--ink-3)]">
              {t("theme.panel.themeReportClient.nobodyHasUsedTheThemeYet")}
              {theme.published
                ? t("theme.panel.themeReportClient.itIsAlreadyOnDiscover")
                : t("theme.panel.themeReportClient.publishItOnDiscoverSoOther")}
            </p>
          )}
        </div>
      </section>

      <p className="mt-4 text-[11px] text-[var(--ink-3)]">
        {t("theme.panel.themeReportClient.theNowNumbersAreCountedAt")}
      </p>
    </main>
  );
}

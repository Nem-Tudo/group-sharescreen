"use client";

import { useEffect, useState } from "react";
import { BsCoin } from "react-icons/bs";
import {
  MdOutlineAdsClick,
  MdOutlinePeopleAlt,
  MdOutlineRemoveRedEye,
  MdOutlineShowChart,
  MdOutlineTableChart,
  MdOutlineOpenInNew,
  MdPauseCircleOutline,
} from "react-icons/md";
import {
  PARTNER_REPORT_RANGES,
  PartnerReportNotFoundError,
  fetchPartnerReport,
  partnerCtr,
  totalPartnerClicks,
  type PartnerReport,
  type PartnerReportRange,
} from "@/lib/partnerReport";
import { useVideoDurationLabel } from "@/lib/useVideoDuration";
import { partnerWideImage } from "@/lib/partner";
import {
  FunnelChart,
  SplitBar,
  StatTile,
  TimeSeriesChart,
  bucketFullLabel,
  formatCount,
} from "./charts";
import { useT } from "@/lib/useI18n";
import useNtPopups from "ntpopups";
import { partnerRewardPopupSize, type PartnerRewardPopupData } from "@/components/PartnerRewardModal";
import { translate } from "@/lib/i18n";
import { formatLocale } from "@/lib/i18n";

// How long to wait after one refresh lands before asking for the next. Half a
// second: the page promises "em tempo real", and this is close enough to it
// that a click made in front of you shows up while you are still looking at
// the number.
//
// It is a gap between responses, not a fixed cadence (see the effect below,
// which schedules the next load only once the previous one settles). At this
// interval a request that takes longer than the gap would otherwise overlap
// the next one, and on a slow connection the page would spend its time racing
// itself — the responses could even land out of order and make the numbers go
// backwards. The API's rate limit for this route is set well above the ~120
// requests a minute this produces (see GET /partner-report/:token).
const POLL_INTERVAL_MS = 500;

const dateTimeFormat = () => new Intl.DateTimeFormat(formatLocale(), {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function relativeSeconds(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 5) return "agora mesmo";
  if (seconds < 60) return translate("common.secondsSAgo", { seconds });
  return translate("common.valueMinAgo", { value: Math.round(seconds / 60) });
}

export function PartnerReportClient({ token }: { token: string }) {
  const t = useT();
  const { openPopup } = useNtPopups();
  const [range, setRange] = useState<PartnerReportRange>("24h");
  // undefined = the first load hasn't landed yet. A failed *poll* deliberately
  // keeps the last report on screen (see the effect below): a blank page is a
  // worse answer to a dropped packet than numbers half a second old.
  const [report, setReport] = useState<PartnerReport | undefined>(undefined);
  // How long the reward video runs, for the button in the preview below —
  // read off the video itself, the same way the real card reads it. Up here
  // rather than beside the button because there are early returns between the
  // two, and a hook cannot sit after one.
  const adRewardDuration = useVideoDurationLabel(report?.ad.rewardVideoUrl ?? null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [showTable, setShowTable] = useState(false);
  // Re-rendered once a second purely so the "atualizado há Xs" line stays
  // honest between polls.
  const [now, setNow] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const data = await fetchPartnerReport(token, range, controller.signal);
        if (cancelled) return;
        setReport(data);
        setUpdatedAt(Date.now());
        setError(null);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        if (err instanceof PartnerReportNotFoundError) {
          setNotFound(true);
          return;
        }
        // Transient — say so in the corner and keep the last numbers up.
        setError(t("ad.partnerReportClient.noConnectionToTheServerTrying"));
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    async function loop() {
      await load();
      if (cancelled) return;
      timer = setTimeout(loop, POLL_INTERVAL_MS);
    }

    void loop();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [token, range, t]);

  if (notFound) {
    return (
      <main className="mx-auto flex w-full max-w-md grow flex-col items-center justify-center gap-3 px-4 py-20 text-center">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{t("ad.partnerReportClient.invalidLink")}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("ad.partnerReportClient.thisReportNoLongerExistsThe")}
        </p>
      </main>
    );
  }

  if (!report) {
    return (
      <main className="mx-auto flex w-full max-w-md grow flex-col items-center justify-center gap-3 px-4 py-20 text-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent dark:border-zinc-700 dark:border-t-transparent" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("ad.partnerReportClient.loadingTheReport")}</p>
      </main>
    );
  }

  const { ad, stats, history } = report;

  function openRewardPreview(videoUrl: string, points: number) {
    const clickPoints =
      ad.clickRewardPoints && ad.clickRewardPlacement !== "card" ? ad.clickRewardPoints : null;
    const data: PartnerRewardPopupData = {
      partnerId: `report-preview-${token}`,
      videoUrl,
      points,
      title: ad.title,
      description: ad.description,
      extendedDescription: ad.extendedDescription ?? null,
      imageUrl: ad.imageUrl,
      buttonLabel: ad.buttonLabel,
      buttonUrl: ad.buttonUrl,
      buttonBackgroundColor: ad.buttonBackgroundColor,
      buttonTextColor: ad.buttonTextColor,
      clickRewardPoints: clickPoints,
      preview: true,
    };
    openPopup("partner_reward", {
      ...partnerRewardPopupSize(Boolean(ad.extendedDescription)),
      closeOnEscape: false,
      closeOnClickOutside: false,
      requireAction: true,
      data,
    });
  }
  const clicks = totalPartnerClicks(stats);
  const ctr = partnerCtr(stats);
  const hasVideoReward = Boolean(ad.rewardVideoUrl && ad.rewardPoints);
  const hasClickReward = Boolean(ad.clickRewardPoints);
  // The ad gate only ever serves ads that have a reward video, so an ad
  // without one has no gate numbers and never will. Shown from the first
  // impression rather than from the first click, so an advertiser whose gate
  // is converting badly still sees that it ran — a block that only appears
  // once something goes well is a block that hides bad news.
  const gateImpressions = stats.gateImpressions ?? 0;
  const gateCompletions = stats.gateCompletions ?? 0;
  const gateSkips = stats.gateSkips ?? 0;
  const gateClicks = stats.gateClicks ?? 0;
  const hasGate = gateImpressions > 0;

  return (
    // Every colour the charts use is declared here, once, for both themes —
    // see charts.tsx, which reads these and hardcodes no hex of its own.
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
          /* A fourth source of clicks (the ad gate). Purple rather than
             another blue: it sits in the same bar as series-1 and series-3,
             and two hues a viewer has to squint at is the same as one. */
          --series-4: #8b5cf6;
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
          --series-4: #a78bfa;
          --ordinal-1: #86b6ef;
          --ordinal-2: #5598e7;
          --ordinal-3: #2a78d6;
        }
      `}</style>

      {/* ── Cabeçalho ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
            {t("common.adReport")}
          </p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-[var(--ink-1)]">
            {ad.title}
          </h1>
          <p className="mt-1 text-xs text-[var(--ink-3)]">
            {t("ad.partnerReportClient.liveSince")} {dateTimeFormat().format(ad.createdAt)}
            {ad.expiresAt
              ? t("ad.partnerReportClient.valueOnValue2", { value: ad.active ? t("common.expiresVerb") : t("common.expiredVerb"), value2: dateTimeFormat().format(ad.expiresAt) })
              : t("ad.partnerReportClient.noEndDate")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {ad.active ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {t("ad.partnerReportClient.liveNow")}
            </span>
          ) : (
            <span className="rounded-full bg-zinc-500/10 px-2.5 py-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              {t("ad.partnerReportClient.campaignEnded")}
            </span>
          )}
          <span className="text-[11px] text-[var(--ink-3)]">
            {error ?? t("common.updatedValue", { value: relativeSeconds(Math.max(0, now - updatedAt)) })}
          </span>
        </div>
      </header>

      {/* ── Números principais ────────────────────────────────────────── */}
      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t("ad.partnerReportClient.impressions")}
          icon={<MdOutlineRemoveRedEye />}
          accent="--series-1"
          value={formatCount(stats.views)}
          hint={t("ad.partnerReportClient.everyTimeTheAdAppearedTo")}
        />
        <StatTile
          label={t("ad.partnerReportClient.peopleReached")}
          icon={<MdOutlinePeopleAlt />}
          accent="--series-3"
          value={formatCount(stats.uniqueViews)}
          hint={t("ad.partnerReportClient.differentPeopleWhoSawTheAd")}
        />
        <StatTile
          label={t("ad.partnerReportClient.clicks")}
          icon={<MdOutlineAdsClick />}
          accent="--series-2"
          value={formatCount(clicks)}
          hint={t("ad.partnerReportClient.clicksOnTheButtonOnThe")}
        />
        <StatTile
          label={t("ad.partnerReportClient.clickThroughRate")}
          icon={<MdOutlineShowChart />}
          value={ctr === null ? "—" : `${ctr.toFixed(1)}%`}
          hint={t("ad.partnerReportClient.ofThoseReachedHowManyClicked")}
        />
      </section>

      {/* ── Ao longo do tempo ─────────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--ink-1)]">{t("common.overTime")}</h2>
          <div className="flex gap-1 rounded-lg bg-[var(--track)] p-0.5">
            {PARTNER_REPORT_RANGES.map((option) => (
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

        {/* Duas escalas diferentes, dois gráficos: nunca dois eixos no mesmo. */}
        <div className="mt-3 grid gap-5 lg:grid-cols-2">
          <TimeSeriesChart
            buckets={history.buckets}
            step={history.step}
            emptyLabel={t("ad.partnerReportClient.noImpressionInThatPeriod")}
            series={{ label: t("ad.partnerReportClient.impressions"), color: "--series-1", valueOf: (b) => b.views }}
          />
          <TimeSeriesChart
            buckets={history.buckets}
            step={history.step}
            emptyLabel={t("ad.partnerReportClient.noClickInThatPeriod")}
            series={{
              label: t("ad.partnerReportClient.clicks"),
              color: "--series-2",
              valueOf: (b) => b.clicks + b.clicksByVideo,
            }}
          />
        </div>

        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="mt-3 flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)] underline underline-offset-2 hover:text-[var(--ink-1)]"
        >
          <MdOutlineTableChart className="h-3.5 w-3.5" />
          {showTable ? t("ad.partnerReportClient.hideTheNumbers") : t("ad.partnerReportClient.seeTheNumbersAsATable")}
        </button>

        {showTable && (
          <div className="mt-2 max-h-80 overflow-auto rounded-xl border border-[var(--hairline)]">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead className="sticky top-0 bg-[var(--surface)] text-[var(--ink-3)]">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {history.step === "hour" ? t("ad.partnerReportClient.hour") : t("ad.partnerReportClient.day")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t("ad.partnerReportClient.impressions")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t("ad.partnerReportClient.clicks")}
                  </th>
                </tr>
              </thead>
              <tbody className="text-[var(--ink-1)]">
                {[...history.buckets].reverse().map((bucket) => (
                  <tr key={bucket.t} className="border-t border-[var(--hairline)]">
                    <td className="px-3 py-1.5 whitespace-nowrap text-[var(--ink-2)]">
                      {bucketFullLabel(bucket.t, history.step)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatCount(bucket.views)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatCount(bucket.clicks + bucket.clicksByVideo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Detalhe + preview ─────────────────────────────────────────── */}
      <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--ink-1)]">{t("ad.partnerReportClient.whereTheClicksCameFrom")}</h2>
            <p className="mt-0.5 mb-3 text-xs text-[var(--ink-3)]">
              {t("ad.partnerReportClient.theSameButtonAppearsOnThe")}
            </p>
            <SplitBar
              parts={[
                { label: t("ad.partnerReportClient.onTheCard"), value: stats.clicks, color: "--series-2" },
                { label: t("ad.partnerReportClient.onTheVideo"), value: stats.clicksByVideo, color: "--series-3" },
                ...(hasGate
                  ? [
                      {
                        label: t("ad.partnerReportClient.onThePause"),
                        value: gateClicks,
                        color: "--series-4",
                      },
                    ]
                  : []),
              ]}
            />
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--hairline)] pt-3 text-xs">
              <div>
                <dt className="text-[var(--ink-3)]">{t("ad.partnerReportClient.sessionsReached")}</dt>
                <dd className="mt-0.5 text-base font-semibold tabular-nums text-[var(--ink-1)]">
                  {formatCount(stats.sessionViews)}
                </dd>
                <p className="text-[10px] leading-snug text-[var(--ink-3)]">
                  {t("ad.partnerReportClient.onePerOpenTabBetweenThe")}
                </p>
              </div>
              <div>
                <dt className="text-[var(--ink-3)]">{t("ad.partnerReportClient.minimises")}</dt>
                <dd className="mt-0.5 text-base font-semibold tabular-nums text-[var(--ink-1)]">
                  {formatCount(stats.minimizes)}
                </dd>
                <p className="text-[10px] leading-snug text-[var(--ink-3)]">
                  {t("ad.partnerReportClient.timesSomeoneCollapsedTheSidebarWith")}
                </p>
              </div>
            </dl>
          </div>

          {hasGate && (
            <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ink-1)]">
                <MdPauseCircleOutline className="h-4 w-4 text-sky-500" />
                {t("ad.partnerReportClient.gateTitle")}
              </h2>
              <p className="mt-0.5 mb-3 text-xs text-[var(--ink-3)]">
                {t("ad.partnerReportClient.gateDescription")}
              </p>
              <FunnelChart
                stages={[
                  {
                    label: t("ad.partnerReportClient.gateShown"),
                    value: gateImpressions,
                    hint: t("ad.partnerReportClient.gateShownHint"),
                  },
                  {
                    label: t("ad.partnerReportClient.gateWatchedFully"),
                    value: gateCompletions,
                    hint: t("ad.partnerReportClient.gateWatchedFullyHint"),
                  },
                  { label: t("ad.partnerReportClient.gateClicked"), value: gateClicks },
                ]}
              />
              {gateSkips > 0 && (
                <p className="mt-3 border-t border-[var(--hairline)] pt-3 text-xs text-[var(--ink-2)]">
                  <strong className="text-base font-semibold tabular-nums text-[var(--ink-1)]">
                    {formatCount(gateSkips)}
                  </strong>{" "}
                  {t("ad.partnerReportClient.gateSkippedHint")}
                </p>
              )}
            </div>
          )}

          {(hasVideoReward || hasClickReward) && (
            <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ink-1)]">
                <BsCoin className="h-3.5 w-3.5 text-amber-500" />
                {t("ad.partnerReportClient.rewards")}
              </h2>
              {hasVideoReward && (
                <div className="mt-3">
                  <p className="mb-2 text-xs text-[var(--ink-3)]">
                    {t("ad.partnerReportClient.whoeverWatchesTheWholeVideoEarns")} {formatCount(ad.rewardPoints ?? 0)} {t("ad.partnerReportClient.points")}
                  </p>
                  <FunnelChart
                    stages={[
                      { label: t("ad.partnerReportClient.openedTheVideo"), value: stats.rewardVideoOpens },
                      { label: t("ad.partnerReportClient.watchedToTheEnd"), value: stats.rewardVideoCompletions },
                      {
                        label: t("ad.partnerReportClient.redeemedThePoints"),
                        value: stats.rewardClaims,
                        hint: t("ad.partnerReportClient.differentAccountsNobodyRedeemsTwice"),
                      },
                    ]}
                  />
                </div>
              )}
              {hasClickReward && (
                <p className="mt-3 border-t border-[var(--hairline)] pt-3 text-xs text-[var(--ink-2)]">
                  <strong className="text-base font-semibold tabular-nums text-[var(--ink-1)]">
                    {formatCount(stats.clickRewardClaims)}
                  </strong>{" "}
                  contas resgataram os {formatCount(ad.clickRewardPoints ?? 0)} {t("ad.partnerReportClient.pointsForClickingTheButton")}
                </p>
              )}
            </div>
          )}
        </div>

        {/* O anúncio como as pessoas realmente veem — a mesma marcação do card
            na barra lateral, para o relatório não descrever um anúncio que o
            leitor nunca viu. */}
        <div className="lg:w-72">
          <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--ink-1)]">{t("ad.partnerReportClient.howItLooks")}</h2>
            <div
              className="mt-3 overflow-hidden rounded-xl p-4"
              style={{
                backgroundColor: ad.backgroundColor ?? "#111827",
                color: ad.textColor ?? "#f4f4f5",
              }}
            >
              <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70 dark:bg-white/10">
                {t("common.sponsored")}
              </span>
              {/* Banner at the head of the card, square mark standing in as a
                  square when there is none — the rule the real card follows
                  (see lib/partner's partnerWideImage), so this preview stays a
                  preview. */}
              {partnerWideImage(ad) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={partnerWideImage(ad)!}
                  alt=""
                  className={
                    ad.imageUrl
                      ? "mt-2 max-h-32 w-full rounded-lg object-cover"
                      : "mx-auto mt-2 aspect-square w-16 rounded-xl object-cover ring-1 ring-black/10"
                  }
                />
              )}
              <p className="mt-2 text-sm font-semibold">{ad.title}</p>
              <p className="mt-1 whitespace-pre-line text-xs opacity-80">{ad.description}</p>
              <div
                className="mt-3 rounded-lg px-3 py-2 text-center text-sm font-semibold"
                style={{
                  backgroundColor: ad.buttonBackgroundColor ?? "#10b981",
                  color: ad.buttonTextColor ?? "#ffffff",
                }}
              >
                {ad.buttonLabel}
              </div>
              {/* The card's own "Resgatar X" button, and it works: it opens
                  the real reward popup in preview mode (nothing counted, no
                  points), so the advertiser sees what viewers see. */}
              {ad.rewardVideoUrl && ad.rewardPoints && (
                <button
                  type="button"
                  onClick={() => openRewardPreview(ad.rewardVideoUrl!, ad.rewardPoints!)}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-current px-3 py-1.5 text-xs font-semibold opacity-90 transition hover:opacity-100"
                >
                  <span className="truncate">
                    {adRewardDuration
                      ? t("partnerCard.watchAndRedeem", { duration: adRewardDuration })
                      : t("common.redeem")}
                  </span>
                  <BsCoin className="h-3.5 w-3.5 shrink-0" />
                  <span className="shrink-0 tabular-nums">{ad.rewardPoints}</span>
                </button>
              )}
            </div>
            {ad.rewardVideoUrl && ad.rewardPoints && (
              <p className="mt-2 text-[11px] text-[var(--ink-3)]">
                {t("ad.partnerReportClient.clickTheRewardButtonToPreview")}
              </p>
            )}
            <a
              href={ad.buttonUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-3 flex items-center gap-1 text-xs text-[var(--ink-2)] underline underline-offset-2 hover:text-[var(--ink-1)]"
            >
              <MdOutlineOpenInNew className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{ad.buttonUrl}</span>
            </a>
          </div>
        </div>
      </section>

      <p className="mt-6 text-center text-[11px] leading-relaxed text-[var(--ink-3)]">
        {t("ad.partnerReportClient.theNumbersUpdateOnTheirOwn")}
      </p>
    </main>
  );
}

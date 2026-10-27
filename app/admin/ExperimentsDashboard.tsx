"use client";

import { useEffect, useMemo, useState } from "react";
import { MdArrowDownward, MdArrowUpward, MdRefresh } from "react-icons/md";
import { fetchFeatureStats, type AdminFeature, type FeatureStats } from "@/lib/adminApi";
import { TIP_CLICK_EVENT } from "@/lib/clipsMode";
import { formatLocale } from "@/lib/i18n";
import { useT } from "@/lib/useI18n";

// Every experiment's numbers side by side. FeaturesPanel's per-feature stats
// answer "how is this one doing"; this answers "which ones are moving
// anything" — pick all, one, or a few, and read them against each other.
//
// Each experiment is boiled down to its primary event (the first pinned one,
// else its first site event, else whatever was counted most) and control vs.
// every treatment summed, tested with a two-proportion z-test.

const SELECTED_KEY = "admin:features:dashSelected";
const DAYS_KEY = "admin:features:dashDays";
const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#ef4444", "#84cc16", "#06b6d4", "#f97316", "#a855f7", "#64748b"];
const GROUP_COLORS = ["#71717a", "#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#ef4444", "#84cc16"];
const DETAIL_LIMIT = 3;
const FETCH_CONCURRENCY = 4;

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const inputClass =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const cardClass = "rounded-lg border border-zinc-200 p-3 dark:border-zinc-800";

function number(value: number): string {
  return value.toLocaleString(formatLocale());
}

function pct(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function signedPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

// Abramowitz–Stegun 7.1.26; plenty for a p-value shown with two digits.
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

function pValue(hitsA: number, nA: number, hitsB: number, nB: number): number | null {
  if (nA <= 0 || nB <= 0) return null;
  const pooled = (hitsA + hitsB) / (nA + nB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  if (!se) return null;
  const z = (hitsB / nB - hitsA / nA) / se;
  return 2 * (1 - normalCdf(Math.abs(z)));
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

const isRunning = (feature: AdminFeature) =>
  !feature.archived && feature.enabled && feature.rolloutBp > 0 && feature.rolloutBp < 10_000;

interface Summary {
  feature: AdminFeature;
  stats: FeatureStats;
  color: string;
  groups: string[];
  /** Pinned first, then the rest by count; never the tooltip click. */
  events: string[];
  controlUnique: number;
  treatedUnique: number;
  exposures: number;
  eventCount: number;
  tipClicks: number;
}

interface Comparison {
  event: string;
  controlHits: number;
  treatedHits: number;
  controlRate: number | null;
  treatedRate: number | null;
  lift: number | null;
  p: number | null;
}

function summarize(feature: AdminFeature, stats: FeatureStats, color: string): Summary {
  const ordered = ["control", ...feature.variants, ...Object.keys(stats.groups)];
  const groups = ordered.filter((name, index) => ordered.indexOf(name) === index);
  const unique = (group: string) => stats.groups[group]?.uniqueExposures ?? 0;
  const countOf = (event: string) =>
    Object.values(stats.events[event] ?? {}).reduce((sum, entry) => sum + (entry?.count ?? 0), 0);
  const pinned = (feature.pinnedEvents?.length ? feature.pinnedEvents : feature.clientEvents ?? []).filter(
    (event) => event !== TIP_CLICK_EVENT
  );
  const rest = Object.keys(stats.events)
    .filter((event) => event !== TIP_CLICK_EVENT && !pinned.includes(event))
    .sort((a, b) => countOf(b) - countOf(a));
  const events = [...pinned, ...rest];
  return {
    feature,
    stats,
    color,
    groups,
    events,
    controlUnique: unique("control"),
    treatedUnique: groups.filter((group) => group !== "control").reduce((sum, group) => sum + unique(group), 0),
    exposures: Object.values(stats.groups).reduce((sum, entry) => sum + entry.exposures, 0),
    eventCount: events.reduce((sum, event) => sum + countOf(event), 0),
    tipClicks: countOf(TIP_CLICK_EVENT),
  };
}

function compare(summary: Summary, event: string | undefined): Comparison | null {
  if (!event) return null;
  const byGroup = summary.stats.events[event] ?? {};
  const { controlUnique, treatedUnique } = summary;
  // An event can reach the API from someone the exposure was not counted for
  // (an old tab); never let that push a rate past 100%.
  const controlHits = Math.min(byGroup.control?.unique ?? 0, controlUnique);
  const treatedHits = Math.min(
    summary.groups.filter((group) => group !== "control").reduce((sum, group) => sum + (byGroup[group]?.unique ?? 0), 0),
    treatedUnique
  );
  const controlRate = controlUnique ? controlHits / controlUnique : null;
  const treatedRate = treatedUnique ? treatedHits / treatedUnique : null;
  const lift = controlRate && treatedRate !== null ? treatedRate / controlRate - 1 : null;
  return {
    event,
    controlHits,
    treatedHits,
    controlRate,
    treatedRate,
    lift,
    p: pValue(controlHits, controlUnique, treatedHits, treatedUnique),
  };
}

type Metric = "exposures" | "events" | "tip";
type SortKey = "name" | "exposed" | "lift" | "p" | "events";

export function ExperimentsDashboard({ features }: { features: AdminFeature[] }) {
  const t = useT();
  const [selected, setSelected] = useState<string[] | null>(null);
  const [days, setDays] = useState(14);
  const [query, setQuery] = useState("");
  const [cache, setCache] = useState<Record<string, FeatureStats>>({});
  const [loading, setLoading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("exposures");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "exposed", desc: true });
  const [eventChoice, setEventChoice] = useState<Record<string, string>>({});

  // Restored after mount (localStorage is not there on the server render).
  useEffect(() => {
    const storedDays = Number(readStorage(DAYS_KEY));
    if ([7, 14, 30, 90].includes(storedDays)) setDays(storedDays);
  }, []);
  useEffect(() => {
    if (selected !== null || features.length === 0) return;
    const known = new Set(features.map((feature) => feature.key));
    let stored: string[] = [];
    try {
      stored = (JSON.parse(readStorage(SELECTED_KEY) ?? "[]") as string[]).filter((key) => known.has(key));
    } catch {}
    if (stored.length === 0) stored = features.filter(isRunning).map((feature) => feature.key);
    if (stored.length === 0) stored = features.filter((feature) => !feature.archived).map((feature) => feature.key);
    setSelected(stored);
  }, [features, selected]);

  const choose = (next: string[]) => {
    setSelected(next);
    writeStorage(SELECTED_KEY, JSON.stringify(next));
  };
  const toggle = (key: string) => {
    const current = selected ?? [];
    choose(current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]);
  };

  // Fetch whatever is selected and not cached for this window, a few at a time.
  const selectedKeys = selected ?? [];
  const missing = selectedKeys.filter((key) => !cache[`${days}:${key}`]);
  const missingSignature = missing.join(",");
  useEffect(() => {
    if (!missingSignature) return;
    let cancelled = false;
    const queue = missingSignature.split(",");
    setLoading((value) => value + 1);
    const worker = async () => {
      for (let key = queue.shift(); key; key = queue.shift()) {
        try {
          const stats = await fetchFeatureStats(key, days);
          if (!cancelled) setCache((current) => ({ ...current, [`${days}:${key}`]: stats }));
        } catch (err) {
          if (!cancelled) setError((err as Error).message);
        }
      }
    };
    void Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker)).finally(() => setLoading((value) => value - 1));
    return () => {
      cancelled = true;
    };
  }, [missingSignature, days]);

  const featureColor = useMemo(() => {
    const map: Record<string, string> = {};
    features.forEach((feature, index) => (map[feature.key] = COLORS[index % COLORS.length]));
    return map;
  }, [features]);

  const summaries = useMemo(
    () =>
      features
        .filter((feature) => selectedKeys.includes(feature.key) && cache[`${days}:${feature.key}`])
        .map((feature) => summarize(feature, cache[`${days}:${feature.key}`], featureColor[feature.key])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [features, selectedKeys.join(","), cache, days, featureColor]
  );

  const rows = useMemo(() => {
    const list = summaries.map((summary) => ({
      summary,
      comparison: compare(summary, eventChoice[summary.feature.key] ?? summary.events[0]),
    }));
    const value = (row: (typeof list)[number]): number | string => {
      switch (sort.key) {
        case "name":
          return row.summary.feature.name.toLowerCase();
        case "exposed":
          return row.summary.controlUnique + row.summary.treatedUnique;
        case "lift":
          return row.comparison?.lift ?? -Infinity;
        case "p":
          return -(row.comparison?.p ?? 2);
        case "events":
          return row.summary.eventCount;
      }
    };
    return list.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const order = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -order : order;
    });
  }, [summaries, eventChoice, sort]);

  const totals = useMemo(() => {
    let exposed = 0;
    let events = 0;
    let tip = 0;
    let wins = 0;
    let losses = 0;
    for (const { summary, comparison } of rows) {
      exposed += summary.controlUnique + summary.treatedUnique;
      events += summary.eventCount;
      tip += summary.tipClicks;
      if (comparison?.p !== null && comparison?.p !== undefined && comparison.p < 0.05 && comparison.lift !== null) {
        if (comparison.lift > 0) wins++;
        else if (comparison.lift < 0) losses++;
      }
    }
    return { exposed, events, tip, wins, losses };
  }, [rows]);

  const chart = useMemo(() => {
    const daySet = new Set<string>();
    for (const summary of summaries) for (const entry of summary.stats.daily) daySet.add(entry.day);
    const dayList = [...daySet].sort();
    const series = summaries.map((summary) => {
      const byDay = new Map(summary.stats.daily.map((entry) => [entry.day, entry]));
      return {
        label: summary.feature.name,
        color: summary.color,
        values: dayList.map((day) => {
          const entry = byDay.get(day);
          if (!entry) return 0;
          if (metric === "exposures") return Object.values(entry.exposures).reduce((a, b) => a + b, 0);
          if (metric === "tip") return Object.values(entry.events[TIP_CLICK_EVENT] ?? {}).reduce((a, b) => a + b, 0);
          return Object.entries(entry.events)
            .filter(([event]) => event !== TIP_CLICK_EVENT)
            .reduce((sum, [, groups]) => sum + Object.values(groups).reduce((a, b) => a + b, 0), 0);
        }),
      };
    });
    return { days: dayList, series };
  }, [summaries, metric]);

  const shown = features.filter(
    (feature) =>
      !query ||
      feature.key.toLowerCase().includes(query.toLowerCase()) ||
      feature.name.toLowerCase().includes(query.toLowerCase())
  );

  const sortHeader = (key: SortKey, label: string, align = "text-right") => (
    <th className={`py-1.5 pr-3 font-medium ${align}`}>
      <button
        type="button"
        onClick={() => setSort((current) => ({ key, desc: current.key === key ? !current.desc : key !== "name" }))}
        className="inline-flex items-center gap-0.5 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {label}
        {sort.key === key &&
          (sort.desc ? <MdArrowDownward className="h-3 w-3" /> : <MdArrowUpward className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <div className="mt-4 flex flex-col gap-3">
      {/* Picking experiments */}
      <div className={cardClass}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.dash.search")}
            className={`${inputClass} w-56 max-w-full`}
          />
          <button type="button" className={buttonClass} onClick={() => choose([...new Set([...selectedKeys, ...shown.map((f) => f.key)])])}>
            {t("admin.dash.all")}
          </button>
          <button type="button" className={buttonClass} onClick={() => choose(features.filter(isRunning).map((f) => f.key))}>
            {t("admin.dash.running")}
          </button>
          <button type="button" className={buttonClass} onClick={() => choose([])}>
            {t("admin.dash.none")}
          </button>
          <span className="text-xs text-zinc-500">{t("admin.dash.selected", { count: selectedKeys.length })}</span>
          <span className="ml-auto flex items-center gap-2">
            {loading > 0 && <span className="text-xs text-zinc-500">{t("admin.dash.loading")}</span>}
            <select
              value={days}
              onChange={(e) => {
                setDays(Number(e.target.value));
                writeStorage(DAYS_KEY, e.target.value);
              }}
              className={inputClass}
            >
              {[7, 14, 30, 90].map((value) => (
                <option key={value} value={value}>
                  {t("admin.features.lastDays", { count: value })}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={buttonClass}
              aria-label={t("admin.features.refresh")}
              onClick={() => {
                setError(null);
                setCache({});
              }}
            >
              <MdRefresh className="h-4 w-4" />
            </button>
          </span>
        </div>
        <div className="mt-3 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {shown.map((feature) => {
            const on = selectedKeys.includes(feature.key);
            return (
              <button
                key={feature.key}
                type="button"
                onClick={() => toggle(feature.key)}
                title={feature.key}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                  on
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                } ${feature.archived ? "opacity-60" : ""}`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: featureColor[feature.key] }} />
                {feature.name}
                <span className="opacity-60">{feature.rolloutBp / 100}%</span>
              </button>
            );
          })}
        </div>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </div>

      {selectedKeys.length === 0 ? (
        <p className={`${cardClass} text-xs text-zinc-500`}>{t("admin.dash.empty")}</p>
      ) : (
        <>
          {/* Headline numbers */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label={t("admin.dash.kpiExperiments")} value={number(summaries.length)} />
            <Kpi label={t("admin.dash.kpiExposed")} value={number(totals.exposed)} />
            <Kpi label={t("admin.dash.kpiEvents")} value={number(totals.events)} />
            <Kpi label={t("admin.dash.kpiTipClicks")} value={number(totals.tip)} />
            <Kpi label={t("admin.dash.kpiWins")} value={number(totals.wins)} hint={t("admin.dash.kpiWinsHint")} tone="green" />
            <Kpi label={t("admin.dash.kpiLosses")} value={number(totals.losses)} hint={t("admin.dash.kpiWinsHint")} tone="red" />
          </div>

          {/* Over time */}
          <div className={cardClass}>
            <div className="flex flex-wrap items-center gap-2">
              <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} className={inputClass}>
                <option value="exposures">{t("admin.dash.metricExposures")}</option>
                <option value="events">{t("admin.dash.metricEvents")}</option>
                <option value="tip">{t("admin.dash.metricTip")}</option>
              </select>
            </div>
            <LineChart days={chart.days} series={chart.series} />
          </div>

          {/* Side by side */}
          <div className={`${cardClass} overflow-x-auto`}>
            <table className="w-full min-w-[760px] text-xs tabular-nums">
              <thead>
                <tr className="text-left text-zinc-500">
                  {sortHeader("name", t("admin.dash.colExperiment"), "text-left")}
                  {sortHeader("exposed", t("admin.dash.colExposed"))}
                  <th className="py-1.5 pr-3 font-medium">{t("admin.dash.colEvent")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("admin.dash.colControl")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("admin.dash.colTreated")}</th>
                  {sortHeader("lift", t("admin.dash.colLift"))}
                  {sortHeader("p", t("admin.dash.colConfidence"))}
                  {sortHeader("events", t("admin.dash.kpiEvents"))}
                  <th className="py-1.5 font-medium">{t("admin.dash.colTrend")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ summary, comparison }) => (
                  <tr key={summary.feature.key} className="border-t border-zinc-100 align-middle dark:border-zinc-900">
                    <td className="py-1.5 pr-3">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: summary.color }} />
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{summary.feature.name}</span>
                      </span>
                      <span className="ml-3.5 text-[10px] text-zinc-500">
                        {summary.feature.archived
                          ? t("admin.features.archived")
                          : !summary.feature.enabled
                            ? t("admin.features.killed")
                            : `${summary.feature.rolloutBp / 100}%`}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {number(summary.controlUnique)} / {number(summary.treatedUnique)}
                    </td>
                    <td className="py-1.5 pr-3">
                      {summary.events.length === 0 ? (
                        <span className="text-zinc-400">{t("admin.dash.noEvent")}</span>
                      ) : (
                        <select
                          value={comparison?.event ?? ""}
                          onChange={(e) => setEventChoice((current) => ({ ...current, [summary.feature.key]: e.target.value }))}
                          className={`${inputClass} max-w-44 py-0.5 font-mono text-[11px]`}
                        >
                          {summary.events.map((event) => (
                            <option key={event} value={event}>
                              {event}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{comparison ? pct(comparison.controlRate) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right">{comparison ? pct(comparison.treatedRate) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right">
                      <LiftValue lift={comparison?.lift ?? null} p={comparison?.p ?? null} />
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <Confidence p={comparison?.p ?? null} />
                    </td>
                    <td className="py-1.5 pr-3 text-right">{number(summary.eventCount)}</td>
                    <td className="py-1.5">
                      <Sparkline
                        color={summary.color}
                        values={summary.stats.daily.map((entry) => Object.values(entry.exposures).reduce((a, b) => a + b, 0))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-zinc-500">{t("admin.dash.confidenceHint")}</p>
          </div>

          {/* One by one, when there are few enough to read */}
          {summaries.length > DETAIL_LIMIT ? (
            <p className="text-[11px] text-zinc-500">{t("admin.dash.detailHint", { count: DETAIL_LIMIT })}</p>
          ) : (
            <div className={`grid gap-3 ${summaries.length > 1 ? "lg:grid-cols-2" : ""}`}>
              {summaries.map((summary) => (
                <DetailCard key={summary.feature.key} summary={summary} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "green" | "red" }) {
  const color =
    tone === "green" ? "text-emerald-600 dark:text-emerald-400" : tone === "red" ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-100";
  return (
    <div className={cardClass} title={hint}>
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function LiftValue({ lift, p }: { lift: number | null; p: number | null }) {
  const significant = p !== null && p < 0.05;
  const color =
    lift === null || !significant
      ? "text-zinc-600 dark:text-zinc-400"
      : lift > 0
        ? "font-semibold text-emerald-600 dark:text-emerald-400"
        : "font-semibold text-red-600 dark:text-red-400";
  return <span className={color}>{signedPct(lift)}</span>;
}

function Confidence({ p }: { p: number | null }) {
  const t = useT();
  if (p === null) return <span className="text-zinc-400">{t("admin.dash.notEnough")}</span>;
  const confidence = 1 - p;
  const color = confidence >= 0.95 ? "#10b981" : confidence >= 0.8 ? "#f59e0b" : "#a1a1aa";
  return (
    <span className="inline-flex items-center gap-1.5" title={`p = ${p.toFixed(4)}`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <span className="block h-full" style={{ width: `${confidence * 100}%`, background: color }} />
      </span>
      {(confidence * 100).toFixed(0)}%
    </span>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 80;
  const height = 22;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-5 w-20" preserveAspectRatio="none" aria-hidden>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        points={values.map((value, i) => `${i * step},${height - (value / max) * (height - 2) - 1}`).join(" ")}
      />
    </svg>
  );
}

function LineChart({ days, series }: { days: string[]; series: { label: string; color: string; values: number[] }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 800;
  const height = 200;
  const max = Math.max(1, ...series.flatMap((entry) => entry.values));
  const step = days.length > 1 ? width / (days.length - 1) : width;
  const y = (value: number) => height - (value / max) * (height - 10) - 5;

  if (days.length === 0) return <div className="mt-3 h-48" />;

  return (
    <div className="relative mt-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-48 w-full"
        preserveAspectRatio="none"
        role="img"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const index = Math.round(((e.clientX - rect.left) / rect.width) * (days.length - 1));
          setHover(Math.max(0, Math.min(days.length - 1, index)));
        }}
      >
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <line key={fraction} x1={0} x2={width} y1={y(max * fraction)} y2={y(max * fraction)} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {hover !== null && (
          <line x1={hover * step} x2={hover * step} y1={0} y2={height} stroke="currentColor" className="text-zinc-400" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        {series.map((entry) => (
          <polyline
            key={entry.label}
            fill="none"
            stroke={entry.color}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            points={entry.values.map((value, i) => `${i * step},${y(value)}`).join(" ")}
          />
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-zinc-200 bg-white/95 p-2 text-[11px] shadow-sm dark:border-zinc-800 dark:bg-zinc-950/95"
          style={hover / Math.max(1, days.length - 1) > 0.6 ? { right: `${(1 - hover / Math.max(1, days.length - 1)) * 100 + 1}%` } : { left: `${(hover / Math.max(1, days.length - 1)) * 100 + 1}%` }}
        >
          <p className="font-semibold text-zinc-700 dark:text-zinc-300">{days[hover]}</p>
          {[...series]
            .sort((a, b) => b.values[hover] - a.values[hover])
            .map((entry) => (
              <p key={entry.label} className="flex items-center gap-1.5 whitespace-nowrap tabular-nums">
                <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
                <span className="text-zinc-600 dark:text-zinc-400">{entry.label}</span>
                <span className="ml-auto pl-3 font-semibold text-zinc-900 dark:text-zinc-100">{number(entry.values[hover])}</span>
              </p>
            ))}
        </div>
      )}
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500 tabular-nums">
        <span>{days[0]?.slice(5)}</span>
        <span>max {number(max)}</span>
        <span>{days[days.length - 1]?.slice(5)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {series.map((entry) => (
          <span key={entry.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
            <span className="text-zinc-700 dark:text-zinc-300">{entry.label}</span>
            <span className="text-zinc-500 tabular-nums">{number(entry.values.reduce((a, b) => a + b, 0))}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function DetailCard({ summary }: { summary: Summary }) {
  const t = useT();
  const { stats, groups } = summary;
  const totalUnique = groups.reduce((sum, group) => sum + (stats.groups[group]?.uniqueExposures ?? 0), 0);
  const groupName = (group: string) => (group === "control" ? t("admin.features.control") : group);
  const color = (index: number) => GROUP_COLORS[index % GROUP_COLORS.length];

  return (
    <div className={cardClass}>
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: summary.color }} />
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{summary.feature.name}</h3>
        <span className="font-mono text-[11px] text-zinc-500">{summary.feature.key}</span>
      </div>

      <p className="mt-3 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">{t("admin.dash.groupShare")}</p>
      <div className="mt-1 flex h-3 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        {groups.map((group, index) => {
          const unique = stats.groups[group]?.uniqueExposures ?? 0;
          return totalUnique ? (
            <span key={group} title={`${groupName(group)}: ${number(unique)}`} style={{ width: `${(unique / totalUnique) * 100}%`, background: color(index) }} />
          ) : null;
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px]">
        {groups.map((group, index) => (
          <span key={group} className="flex items-center gap-1 tabular-nums">
            <span className="h-2 w-2 rounded-full" style={{ background: color(index) }} />
            <span className="text-zinc-700 dark:text-zinc-300">{groupName(group)}</span>
            <span className="text-zinc-500">{number(stats.groups[group]?.uniqueExposures ?? 0)}</span>
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {summary.events.length === 0 && <p className="text-xs text-zinc-500">{t("admin.dash.noEvent")}</p>}
        {summary.events.slice(0, 8).map((event) => {
          const byGroup = stats.events[event] ?? {};
          const controlN = stats.groups.control?.uniqueExposures ?? 0;
          const controlHits = Math.min(byGroup.control?.unique ?? 0, controlN);
          const rates = groups.map((group) => {
            const n = stats.groups[group]?.uniqueExposures ?? 0;
            const hits = Math.min(byGroup[group]?.unique ?? 0, n);
            return { group, n, hits, rate: n ? hits / n : null };
          });
          const maxRate = Math.max(0.0001, ...rates.map((entry) => entry.rate ?? 0));
          const controlRate = controlN ? controlHits / controlN : null;
          return (
            <div key={event}>
              <p className="font-mono text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">{event}</p>
              <div className="mt-1 flex flex-col gap-1">
                {rates.map(({ group, n, hits, rate }, index) => {
                  const lift = group !== "control" && controlRate && rate !== null ? rate / controlRate - 1 : null;
                  const p = group !== "control" ? pValue(controlHits, controlN, hits, n) : null;
                  return (
                    <div key={group} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-[11px] tabular-nums">
                      <span className="truncate text-zinc-600 dark:text-zinc-400">{groupName(group)}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                        <span className="block h-full" style={{ width: `${((rate ?? 0) / maxRate) * 100}%`, background: color(index) }} />
                      </span>
                      <span className="w-40 text-right">
                        <span className="text-zinc-900 dark:text-zinc-100">{pct(rate)}</span>
                        <span className="text-zinc-500"> ({number(hits)}/{number(n)})</span>
                        {group !== "control" && (
                          <span className="ml-1">
                            <LiftValue lift={lift} p={p} />
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">{t("admin.dash.rateHint")}</p>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MdRefresh } from "react-icons/md";
import { fetchSalesAnalytics, type SalesAnalytics, type SalesRow } from "@/lib/adminApi";
import { useI18n } from "@/lib/useI18n";

// The "Vendas" tab: how much is being sold, how, by whom and through what.
//
// Everything below the snapshot is computed here from the raw rows the API
// sends (see its salesRoutes.ts), so a new cut is a new chart and nothing else.
// The filters at the top apply to every chart that is drawn from those rows;
// the two things the API has to compute across every account — what is being
// paid for right now, and how buyers differ from everybody else — say so.
//
// Charts are plain SVG, like the rest of /admin: the site carries no chart
// library and one page of bars is not a reason to add one. Colours follow one
// fixed categorical order (the --s1…--s5 variables on the wrapper), assigned
// to a category for good — Pix is always the same colour, whatever is beside it.

const DAY = 86_400_000;

const RANGES = [
  { days: 1, key: "admin.sales.range.today" },
  { days: 7, key: "admin.sales.range.d7" },
  { days: 30, key: "admin.sales.range.d30" },
  { days: 90, key: "admin.sales.range.d90" },
  { days: 365, key: "admin.sales.range.y1" },
  { days: 730, key: "admin.sales.range.y2" },
] as const;

const TIERS = ["premium", "premium_max", "pro_ultra"] as const;
const TIER_LABEL: Record<string, string> = { premium: "Pro", premium_max: "Pro Max", pro_ultra: "Pro Ultra" };

const SALE_TYPES = ["new", "renewal", "returning", "upgrade", "gift"] as const;
type SaleType = (typeof SALE_TYPES)[number];

const PLATFORMS = [
  "desktop-browser",
  "desktop-app",
  "desktop-webview",
  "mobile-browser",
  "mobile-app",
  "mobile-webview",
  "unknown",
];

const DEVICE_LABEL: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
};

// Categorical slots, light and dark. Fixed order; never cycled.
const PALETTE_CLASS =
  "[--s1:#2a78d6] [--s2:#eb6834] [--s3:#1baf7a] [--s4:#eda100] [--s5:#e87ba4] [--prev:#a3a29c] " +
  "dark:[--s1:#3987e5] dark:[--s2:#d95926] dark:[--s3:#199e70] dark:[--s4:#c98500] dark:[--s5:#d55181] dark:[--prev:#6b6a65]";
const SLOT = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)"];

const METHOD_COLOR: Record<string, string> = { subscription: SLOT[0], pix: SLOT[1] };
const TIER_COLOR: Record<string, string> = { premium: SLOT[0], premium_max: SLOT[1], pro_ultra: SLOT[2] };
const TYPE_COLOR: Record<SaleType, string> = {
  new: SLOT[0],
  renewal: SLOT[1],
  returning: SLOT[2],
  upgrade: SLOT[3],
  gift: SLOT[4],
};

type Metric = "revenue" | "count";
type Grain = "hour" | "day" | "week" | "month";
type KindFilter = "all" | "plan" | "gift" | "upgrade";
type MethodFilter = "all" | "pix" | "subscription";

function saleType(row: SalesRow): SaleType {
  if (row.kind === "gift") return "gift";
  if (row.kind === "upgrade") return "upgrade";
  if (row.renewal) return "renewal";
  if (row.returning) return "returning";
  return "new";
}

const isFirstPurchase = (row: SalesRow) => saleType(row) === "new";

function intlLocale(locale: string): string {
  if (locale.startsWith("pt")) return "pt-BR";
  if (locale.startsWith("es")) return "es";
  return "en-US";
}

function grainFor(days: number): Grain {
  if (days <= 2) return "hour";
  if (days <= 92) return "day";
  if (days <= 400) return "week";
  return "month";
}

function floorTo(time: number, grain: Grain): Date {
  const d = new Date(time);
  if (grain === "hour") {
    d.setMinutes(0, 0, 0);
    return d;
  }
  d.setHours(0, 0, 0, 0);
  if (grain === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (grain === "month") d.setDate(1);
  return d;
}

function advance(d: Date, grain: Grain): void {
  if (grain === "hour") d.setHours(d.getHours() + 1);
  else if (grain === "day") d.setDate(d.getDate() + 1);
  else if (grain === "week") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
}

/** Local-time bucket starts covering [from, to). */
function bucketStarts(from: number, to: number, grain: Grain): number[] {
  const d = floorTo(from, grain);
  const out: number[] = [];
  while (d.getTime() < to && out.length < 2000) {
    out.push(d.getTime());
    advance(d, grain);
  }
  return out;
}

/** The bucket a time falls in, or -1. */
function bucketOf(starts: number[], time: number, end: number): number {
  if (starts.length === 0 || time < starts[0] || time >= end) return -1;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface Totals {
  cents: number;
  count: number;
  buyers: number;
  newCustomers: number;
  avg: number;
}

function totalsOf(rows: SalesRow[]): Totals {
  let cents = 0;
  let newCustomers = 0;
  const buyers = new Set<number>();
  for (const row of rows) {
    cents += row.cents;
    buyers.add(row.b);
    if (isFirstPurchase(row)) newCustomers += 1;
  }
  return { cents, count: rows.length, buyers: buyers.size, newCustomers, avg: rows.length ? cents / rows.length : 0 };
}

/** Least-squares slope of a series, as a fraction of its mean per step. */
function relativeSlope(values: number[]): number | null {
  const n = values.length;
  if (n < 4) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (mean <= 0) return null;
  const xMean = (n - 1) / 2;
  let num = 0;
  let den = 0;
  values.forEach((value, i) => {
    num += (i - xMean) * (value - mean);
    den += (i - xMean) ** 2;
  });
  return num / den / mean;
}

function movingAverage(values: number[], size: number): number[] {
  return values.map((_, i) => {
    const from = Math.max(0, i - size + 1);
    const slice = values.slice(from, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

function useFormat() {
  const { t, locale } = useI18n();
  return useMemo(() => {
    const tag = intlLocale(locale);
    const money = new Intl.NumberFormat(tag, { style: "currency", currency: "BRL" });
    const moneyRound = new Intl.NumberFormat(tag, { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
    const moneyCompact = new Intl.NumberFormat(tag, {
      style: "currency",
      currency: "BRL",
      notation: "compact",
      maximumFractionDigits: 1,
    });
    const num = new Intl.NumberFormat(tag);
    const pct = new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 1 });
    return {
      t,
      tag,
      money: (cents: number) => (Math.abs(cents) >= 100_000 ? moneyRound : money).format(cents / 100),
      moneyCompact: (cents: number) => moneyCompact.format(cents / 100),
      num: (value: number) => num.format(value),
      pct: (value: number) => pct.format(value),
      value: (metric: Metric, cents: number, count: number) =>
        metric === "revenue" ? (Math.abs(cents) >= 100_000 ? moneyRound : money).format(cents / 100) : num.format(count),
      bucketLabel: (start: number, grain: Grain) => {
        const d = new Date(start);
        if (grain === "hour") return d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
        if (grain === "month") return d.toLocaleDateString(tag, { month: "short", year: "2-digit" });
        return d.toLocaleDateString(tag, { day: "2-digit", month: "2-digit" });
      },
      dateTime: (time: number) =>
        new Date(time).toLocaleString(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
      date: (time: number) => new Date(time).toLocaleDateString(tag, { day: "2-digit", month: "2-digit", year: "numeric" }),
    };
  }, [t, locale]);
}

type Fmt = ReturnType<typeof useFormat>;

// ─── Building blocks ────────────────────────────────────────────────────────

function Card({
  title,
  hint,
  children,
  className = "",
  right,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  right?: React.ReactNode;
}) {
  return (
    <section
      className={`min-w-0 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{title}</h3>
          {hint && <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</p>}
        </div>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Delta({ value, inverse = false }: { value: number | null; inverse?: boolean }) {
  const { pct } = useFormat();
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-[11px] text-zinc-400">—</span>;
  }
  const up = value > 0.0005;
  const down = value < -0.0005;
  const good = inverse ? down : up;
  const bad = inverse ? up : down;
  return (
    <span
      className={`text-[11px] font-medium tabular-nums ${
        good
          ? "text-[#006300] dark:text-[#0ca30c]"
          : bad
            ? "text-[#d03b3b] dark:text-[#e66767]"
            : "text-zinc-500"
      }`}
    >
      {up ? "▲" : down ? "▼" : "■"} {pct(Math.abs(value))}
    </span>
  );
}

function Stat({
  label,
  value,
  delta,
  sub,
  inverse,
}: {
  label: string;
  value: string;
  delta?: number | null;
  sub?: React.ReactNode;
  inverse?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        {delta !== undefined && <Delta value={delta} inverse={inverse} />}
        {sub}
      </div>
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-3.5 rounded"
            style={
              item.dashed
                ? { backgroundImage: `linear-gradient(90deg, ${item.color} 60%, transparent 0)`, backgroundSize: "5px 2px" }
                : { background: item.color, height: 8, width: 8, borderRadius: 2 }
            }
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            value === option.value
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Lines over time, one y-axis, crosshair + tooltip. */
function LineChart({
  labels,
  series,
  format,
}: {
  labels: string[];
  series: { label: string; color: string; values: number[]; dashed?: boolean; width?: number }[];
  format: (value: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 800;
  const height = 220;
  const max = Math.max(1, ...series.flatMap((entry) => entry.values));
  const step = labels.length > 1 ? width / (labels.length - 1) : width;
  const y = (value: number) => height - (value / max) * (height - 12) - 6;
  if (labels.length === 0) return <div className="h-52" />;
  const tickIdx = labels.length <= 1 ? [0] : [0, Math.floor((labels.length - 1) / 2), labels.length - 1];
  return (
    <div className="relative">
      <div className="flex">
        <div className="flex h-52 w-14 shrink-0 flex-col justify-between pr-1 text-right text-[10px] tabular-nums text-zinc-400">
          <span>{format(max)}</span>
          <span>{format(max / 2)}</span>
          <span>{format(0)}</span>
        </div>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-52 min-w-0 flex-1"
          preserveAspectRatio="none"
          role="img"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const index = Math.round(((e.clientX - rect.left) / rect.width) * (labels.length - 1));
            setHover(Math.max(0, Math.min(labels.length - 1, index)));
          }}
        >
          {[0, 0.5, 1].map((fraction) => (
            <line
              key={fraction}
              x1={0}
              x2={width}
              y1={y(max * fraction)}
              y2={y(max * fraction)}
              stroke="currentColor"
              className="text-zinc-200 dark:text-zinc-800"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {hover !== null && (
            <line
              x1={hover * step}
              x2={hover * step}
              y1={0}
              y2={height}
              stroke="currentColor"
              className="text-zinc-400"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {series.map((entry) => (
            <polyline
              key={entry.label}
              fill="none"
              stroke={entry.color}
              strokeWidth={entry.width ?? 2}
              strokeDasharray={entry.dashed ? "5 4" : undefined}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              points={entry.values.map((value, i) => `${i * step},${y(value)}`).join(" ")}
            />
          ))}
        </svg>
      </div>
      <div className="ml-14 mt-1 flex justify-between text-[10px] text-zinc-400">
        {tickIdx.map((i) => (
          <span key={i}>{labels[i]}</span>
        ))}
      </div>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95"
          style={{
            left: `calc(3.5rem + (100% - 3.5rem) * ${hover / Math.max(1, labels.length - 1)})`,
            transform: hover > labels.length / 2 ? "translateX(-105%)" : "translateX(8px)",
          }}
        >
          <p className="font-medium text-zinc-800 dark:text-zinc-100">{labels[hover]}</p>
          {series.map((entry) => (
            <p key={entry.label} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: entry.color }} />
              {entry.label}: <b className="font-semibold tabular-nums">{format(entry.values[hover] ?? 0)}</b>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Stacked columns over time. */
function StackedBars({
  labels,
  stacks,
  format,
}: {
  labels: string[];
  stacks: { label: string; color: string; values: number[] }[];
  format: (value: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = labels.map((_, i) => stacks.reduce((sum, stack) => sum + (stack.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const n = Math.max(1, labels.length);
  const gap = n > 60 ? 0 : 2;
  const tickIdx = labels.length <= 1 ? [0] : [0, Math.floor((labels.length - 1) / 2), labels.length - 1];
  return (
    <div className="relative">
      <div className="flex">
        <div className="flex h-44 w-14 shrink-0 flex-col justify-between pr-1 text-right text-[10px] tabular-nums text-zinc-400">
          <span>{format(max)}</span>
          <span>{format(0)}</span>
        </div>
        <div
          className="flex h-44 min-w-0 flex-1 items-end border-b border-zinc-300 dark:border-zinc-700"
          style={{ gap }}
          onMouseLeave={() => setHover(null)}
        >
          {labels.map((label, i) => (
            <div
              key={`${label}-${i}`}
              className={`flex h-full min-w-0 flex-1 flex-col-reverse ${hover === i ? "opacity-100" : hover === null ? "" : "opacity-60"}`}
              onMouseEnter={() => setHover(i)}
            >
              {stacks.map((stack) => {
                const value = stack.values[i] ?? 0;
                if (value <= 0) return null;
                return (
                  <div
                    key={stack.label}
                    className="w-full first:rounded-b-none last:rounded-t-[3px]"
                    style={{ height: `${(value / max) * 100}%`, background: stack.color, minHeight: 1 }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="ml-14 mt-1 flex justify-between text-[10px] text-zinc-400">
        {tickIdx.map((i) => (
          <span key={i}>{labels[i]}</span>
        ))}
      </div>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95"
          style={{
            left: `calc(3.5rem + (100% - 3.5rem) * ${(hover + 0.5) / n})`,
            transform: hover > n / 2 ? "translateX(-105%)" : "translateX(8px)",
          }}
        >
          <p className="font-medium text-zinc-800 dark:text-zinc-100">
            {labels[hover]} · {format(totals[hover])}
          </p>
          {stacks.map((stack) => (
            <p key={stack.label} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: stack.color }} />
              {stack.label}: <b className="font-semibold tabular-nums">{format(stack.values[hover] ?? 0)}</b>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** One row split into shares — Pix vs card, gift vs not. */
function SplitBar({
  parts,
  format,
}: {
  parts: { label: string; color: string; value: number }[];
  format: (value: number) => string;
}) {
  const { pct } = useFormat();
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
        {total > 0 &&
          parts.map((part) =>
            part.value > 0 ? (
              <div
                key={part.label}
                title={`${part.label}: ${format(part.value)} (${pct(part.value / total)})`}
                style={{ width: `${(part.value / total) * 100}%`, background: part.color }}
              />
            ) : null
          )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
        {parts.map((part) => (
          <span key={part.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: part.color }} />
            {part.label}
            <b className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">{format(part.value)}</b>
            {total > 0 && <span className="tabular-nums">({pct(part.value / total)})</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

interface Group {
  key: string;
  label: string;
  cents: number;
  count: number;
}

function groupRows(rows: SalesRow[], keyOf: (row: SalesRow) => string): Map<string, { cents: number; count: number }> {
  const out = new Map<string, { cents: number; count: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    const entry = out.get(key) ?? { cents: 0, count: 0 };
    entry.cents += row.cents;
    entry.count += 1;
    out.set(key, entry);
  }
  return out;
}

/** Ranked horizontal bars, with the other measure and the share beside each. */
function BarList({
  groups,
  metric,
  fmt,
  keepOrder = false,
  color = SLOT[0],
}: {
  groups: Group[];
  metric: Metric;
  fmt: Fmt;
  keepOrder?: boolean;
  color?: string;
}) {
  const measure = (group: Group) => (metric === "revenue" ? group.cents : group.count);
  const list = keepOrder ? groups : [...groups].sort((a, b) => measure(b) - measure(a));
  const total = list.reduce((sum, group) => sum + measure(group), 0);
  const max = Math.max(1, ...list.map(measure));
  if (list.length === 0 || total === 0) {
    return <p className="text-xs text-zinc-500 dark:text-zinc-400">{fmt.t("admin.sales.noData")}</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {list.map((group) => (
        <li key={group.key} className="group">
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="truncate text-zinc-700 dark:text-zinc-300">{group.label}</span>
            <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
              <b className="font-semibold text-zinc-800 dark:text-zinc-200">
                {fmt.value(metric, group.cents, group.count)}
              </b>
              {" · "}
              {metric === "revenue"
                ? fmt.t("admin.sales.nSales", { count: fmt.num(group.count) })
                : fmt.money(group.cents)}
              {" · "}
              {fmt.pct(measure(group) / total)}
            </span>
          </div>
          <div className="mt-0.5 h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-900">
            <div
              className="h-2 rounded-full transition-[width] group-hover:opacity-80"
              style={{ width: `${(measure(group) / max) * 100}%`, background: color, minWidth: measure(group) > 0 ? 3 : 0 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── The panel ──────────────────────────────────────────────────────────────

export function SalesPanel() {
  const fmt = useFormat();
  const { t } = fmt;
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<SalesAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("revenue");
  const [kind, setKind] = useState<KindFilter>("all");
  const [method, setMethod] = useState<MethodFilter>("all");
  const [tier, setTier] = useState<string>("all");

  const load = useCallback(
    async (range: number, fresh: boolean) => {
      setError(null);
      try {
        setData(await fetchSalesAnalytics(range, fresh));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("admin.sales.loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load(days, false);
    });
    return () => {
      cancelled = true;
    };
  }, [load, days]);

  const view = useMemo(() => {
    if (!data) return null;
    const now = data.now;
    const windowStart = data.windowStart;
    const prevStart = windowStart - data.days * DAY;
    const filtered = data.rows.filter(
      (row) =>
        (kind === "all" || row.kind === kind) &&
        (method === "all" || row.method === method) &&
        (tier === "all" || row.tier === tier)
    );
    const cur = filtered.filter((row) => row.at >= windowStart);
    const prev = filtered.filter((row) => row.at >= prevStart && row.at < windowStart);

    // Today against yesterday up to this same time of day.
    const todayStart = floorTo(now, "day").getTime();
    const yesterdayStart = floorTo(todayStart - 1, "day").getTime();
    const today = totalsOf(filtered.filter((row) => row.at >= todayStart));
    const yesterdaySoFar = totalsOf(
      filtered.filter((row) => row.at >= yesterdayStart && row.at < yesterdayStart + (now - todayStart))
    );
    const yesterdayAll = totalsOf(filtered.filter((row) => row.at >= yesterdayStart && row.at < todayStart));

    // This month so far, and where it is heading at this pace.
    const monthStart = floorTo(now, "month").getTime();
    const monthDate = new Date(monthStart);
    const nextMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1).getTime();
    const monthCents = filtered.filter((row) => row.at >= monthStart).reduce((sum, row) => sum + row.cents, 0);
    const monthElapsed = Math.max(1, now - monthStart);
    const monthProjection = monthStart >= data.sendSince ? (monthCents / monthElapsed) * (nextMonth - monthStart) : null;

    const grain = grainFor(data.days);
    const starts = bucketStarts(windowStart, now, grain);
    const labels = starts.map((start) => fmt.bucketLabel(start, grain));
    const measure = (row: SalesRow) => (metric === "revenue" ? row.cents : 1);
    const series = (rows: SalesRow[], shift = 0) => {
      const values = starts.map(() => 0);
      for (const row of rows) {
        const i = bucketOf(starts, row.at + shift, now + shift + 1);
        if (i >= 0) values[i] += measure(row);
      }
      return values;
    };
    const split = <K extends string>(keys: readonly K[], keyOf: (row: SalesRow) => K) =>
      keys.map((key) => series(cur.filter((row) => keyOf(row) === key)));

    const current = series(cur);
    const previous = series(prev, data.days * DAY);
    const slope = relativeSlope(current);
    const perWeek =
      slope === null ? null : grain === "hour" ? null : slope * (grain === "day" ? 7 : grain === "week" ? 1 : 0.25);
    // Last seven days against the seven before, from the rows themselves.
    const last7 = totalsOf(filtered.filter((row) => row.at >= now - 7 * DAY));
    const prior7 = totalsOf(filtered.filter((row) => row.at >= now - 14 * DAY && row.at < now - 7 * DAY));

    const events = data.events;
    const ended = events.filter((event) => event.type === "ended" && event.at >= windowStart);
    const refused = events.filter((event) => event.type === "refused" && event.at >= windowStart);
    const newSubs = cur.filter((row) => row.method === "subscription" && row.kind === "plan" && !row.renewal);
    const endedSeries = starts.map(() => 0);
    for (const event of ended) {
      const i = bucketOf(starts, event.at, now + 1);
      if (i >= 0) endedSeries[i] += 1;
    }
    const newSubSeries = starts.map(() => 0);
    for (const row of newSubs) {
      const i = bucketOf(starts, row.at, now + 1);
      if (i >= 0) newSubSeries[i] += 1;
    }

    // Weekday × hour, Monday first.
    const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const row of cur) {
      const d = new Date(row.at);
      heat[(d.getDay() + 6) % 7][d.getHours()] += measure(row);
    }

    const firstPurchases = cur.filter(isFirstPurchase);
    const ages = firstPurchases.map((row) => row.ageDays).filter((v): v is number => v !== null);

    return {
      cur,
      prev,
      totals: totalsOf(cur),
      prevTotals: totalsOf(prev),
      today,
      yesterdaySoFar,
      yesterdayAll,
      monthCents,
      monthProjection,
      grain,
      labels,
      current,
      previous,
      ma: grain === "day" && current.length >= 14 ? movingAverage(current, 7) : null,
      perWeek,
      last7,
      prior7,
      byMethod: split(["subscription", "pix"] as const, (row) => row.method),
      byType: split(SALE_TYPES, saleType),
      byTier: split(TIERS, (row) => row.tier as (typeof TIERS)[number]),
      ended,
      refused,
      newSubs,
      endedSeries,
      newSubSeries,
      heat,
      medianAge: median(ages),
      legacyCount: cur.filter((row) => row.legacy).length,
    };
  }, [data, kind, method, tier, metric, fmt]);

  const fmtMetric = useCallback(
    (value: number) => (metric === "revenue" ? fmt.moneyCompact(value) : fmt.num(Math.round(value * 10) / 10)),
    [metric, fmt]
  );

  const header = (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t("admin.sales.title")}</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.sales.description")}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load(days, true);
          }}
          disabled={loading}
          aria-label={t("admin.sales.reload")}
          className="shrink-0 rounded-lg border border-zinc-300 p-1.5 text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          <MdRefresh className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={days}
          options={RANGES.map((range) => ({ value: range.days, label: t(range.key) }))}
          onChange={(next) => {
            setLoading(true);
            setDays(next);
          }}
        />
        <Segmented
          value={metric}
          options={[
            { value: "revenue" as Metric, label: t("admin.sales.metric.revenue") },
            { value: "count" as Metric, label: t("admin.sales.metric.count") },
          ]}
          onChange={setMetric}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={kind}
          options={[
            { value: "all" as KindFilter, label: t("admin.sales.filter.allKinds") },
            { value: "plan" as KindFilter, label: t("admin.sales.filter.plan") },
            { value: "gift" as KindFilter, label: t("admin.sales.type.gift") },
            { value: "upgrade" as KindFilter, label: t("admin.sales.type.upgrade") },
          ]}
          onChange={setKind}
        />
        <Segmented
          value={method}
          options={[
            { value: "all" as MethodFilter, label: t("admin.sales.filter.allMethods") },
            { value: "subscription" as MethodFilter, label: t("admin.sales.method.subscription") },
            { value: "pix" as MethodFilter, label: t("admin.sales.method.pix") },
          ]}
          onChange={setMethod}
        />
        <Segmented
          value={tier}
          options={[
            { value: "all", label: t("admin.sales.filter.allPlans") },
            ...TIERS.map((key) => ({ value: key as string, label: TIER_LABEL[key] })),
          ]}
          onChange={setTier}
        />
      </div>
    </div>
  );

  if (!data || !view) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        {error ? (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>
        )}
      </div>
    );
  }

  const { totals, prevTotals, snapshot } = { totals: view.totals, prevTotals: view.prevTotals, snapshot: data.snapshot };
  const activeSubs = Object.values(snapshot.subs).reduce((sum, entry) => sum + entry.monthly + entry.yearly, 0);
  const activePix = Object.values(snapshot.pix).reduce((sum, value) => sum + value, 0);
  const paying = activeSubs + activePix;
  const cur = view.cur;
  const metricOf = (row: SalesRow) => (metric === "revenue" ? row.cents : 1);
  const sumBy = (rows: SalesRow[]) => rows.reduce((sum, row) => sum + metricOf(row), 0);

  const trendWord =
    view.perWeek === null
      ? null
      : view.perWeek > 0.03
        ? { text: t("admin.sales.trend.up"), cls: "text-[#006300] dark:text-[#0ca30c]", arrow: "▲" }
        : view.perWeek < -0.03
          ? { text: t("admin.sales.trend.down"), cls: "text-[#d03b3b] dark:text-[#e66767]", arrow: "▼" }
          : { text: t("admin.sales.trend.flat"), cls: "text-zinc-500", arrow: "■" };

  const methodTotals = (["subscription", "pix"] as const).map((key) => {
    const rows = cur.filter((row) => row.method === key);
    const withNet = rows.filter((row) => row.netCents !== null);
    const gross = withNet.reduce((sum, row) => sum + row.cents, 0);
    const net = withNet.reduce((sum, row) => sum + (row.netCents ?? 0), 0);
    return {
      key,
      rows,
      totals: totalsOf(rows),
      fee: gross > 0 ? 1 - net / gross : null,
      firsts: rows.filter(isFirstPurchase).length,
    };
  });

  const ageBuckets: [string, (v: number) => boolean][] = [
    ["sameDay", (v) => v < 1],
    ["d1_3", (v) => v >= 1 && v <= 3],
    ["d4_7", (v) => v >= 4 && v <= 7],
    ["d8_30", (v) => v >= 8 && v <= 30],
    ["d31_90", (v) => v >= 31 && v <= 90],
    ["d91_365", (v) => v >= 91 && v <= 365],
    ["y1plus", (v) => v > 365],
  ];
  const ageRows = cur.filter((row) => row.ageDays !== null);
  const ageGroups: Group[] = ageBuckets.map(([key, test]) => {
    const rows = ageRows.filter((row) => test(row.ageDays!));
    return { key, label: t(`admin.sales.age.${key}`), cents: rows.reduce((s, r) => s + r.cents, 0), count: rows.length };
  });

  const hourBuckets: [string, (v: number) => boolean][] = [
    ["none", (v) => v <= 0],
    ["lt1", (v) => v > 0 && v < 1],
    ["h1_5", (v) => v >= 1 && v < 5],
    ["h5_20", (v) => v >= 5 && v < 20],
    ["h20_100", (v) => v >= 20 && v < 100],
    ["h100plus", (v) => v >= 100],
  ];
  const usageRows = cur.filter((row) => row.callHours !== null);
  const usageGroups: Group[] = hourBuckets.map(([key, test]) => {
    const rows = usageRows.filter((row) => test(row.callHours!));
    return { key, label: t(`admin.sales.usage.${key}`), cents: rows.reduce((s, r) => s + r.cents, 0), count: rows.length };
  });

  const toGroups = (map: Map<string, { cents: number; count: number }>, label: (key: string) => string): Group[] =>
    [...map.entries()].map(([key, value]) => ({ key, label: label(key), ...value }));

  const platformGroups = toGroups(groupRows(cur, (row) => row.platform ?? "unknown"), (key) =>
    PLATFORMS.includes(key) ? t(`admin.sales.platform.${key}`) : key
  );
  const deviceGroups = toGroups(groupRows(cur, (row) => row.device ?? "unknown"), (key) =>
    DEVICE_LABEL[key] ?? t("admin.sales.unknown")
  );
  const doorRows = cur.filter((row) => row.kind !== "gift" && !(row.method === "subscription" && row.renewal && row.kind === "plan"));
  const doorGroups = toGroups(groupRows(doorRows, (row) => (row.legacy ? "legacy" : row.door ?? "none")), (key) =>
    key === "none" ? t("admin.sales.door.none") : key === "legacy" ? t("admin.sales.door.legacy") : key
  );
  const providerGroups = toGroups(groupRows(cur, (row) => row.provider ?? "mercadopago"), (key) =>
    key === "stripe" ? "Stripe" : key === "mercadopago" ? "Mercado Pago" : key
  );
  const cycleGroups = toGroups(groupRows(cur, (row) => row.cycle), (key) => t(`admin.sales.cycle.${key}`));
  const tierGroups: Group[] = TIERS.map((key) => {
    const rows = cur.filter((row) => row.tier === key);
    return { key, label: TIER_LABEL[key], cents: rows.reduce((s, r) => s + r.cents, 0), count: rows.length };
  });

  const giftRows = cur.filter((row) => row.kind === "gift");
  const ownRows = cur.filter((row) => row.kind !== "gift");

  // Top customers in the window.
  const byBuyer = new Map<number, { cents: number; count: number; last: SalesRow }>();
  for (const row of cur) {
    const entry = byBuyer.get(row.b) ?? { cents: 0, count: 0, last: row };
    entry.cents += row.cents;
    entry.count += 1;
    entry.last = row;
    byBuyer.set(row.b, entry);
  }
  const topBuyers = [...byBuyer.entries()].sort((a, b) => b[1].cents - a[1].cents).slice(0, 10);
  const recent = [...cur].reverse().slice(0, 25);

  // Buyers vs active non-buyers.
  const traitRows = data.traits.rows
    .map((row) => {
      const buyersPct = data.traits.buyersTotal ? row.buyers / data.traits.buyersTotal : 0;
      const basePct = data.traits.baseTotal ? row.base / data.traits.baseTotal : 0;
      return { ...row, buyersPct, basePct, lift: basePct > 0 ? buyersPct / basePct : null };
    })
    .sort((a, b) => (b.lift ?? 99) - (a.lift ?? 99));

  const heatMax = Math.max(1, ...view.heat.flat());
  const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(fmt.tag, { weekday: "short" })
  );

  const netSubs = view.newSubs.length - view.ended.length;
  const renewalCents = cur.filter((row) => saleType(row) === "renewal").reduce((s, r) => s + r.cents, 0);

  return (
    <div className={`flex flex-col gap-4 ${PALETTE_CLASS}`}>
      {header}

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* The numbers somebody opens this tab for. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Stat
          label={t("admin.sales.kpi.today")}
          value={fmt.money(view.today.cents)}
          delta={pctChange(view.today.cents, view.yesterdaySoFar.cents)}
          sub={
            <span>
              {t("admin.sales.nSales", { count: fmt.num(view.today.count) })} ·{" "}
              {t("admin.sales.kpi.yesterday", { value: fmt.money(view.yesterdayAll.cents) })}
            </span>
          }
        />
        <Stat
          label={t("admin.sales.kpi.revenue")}
          value={fmt.money(totals.cents)}
          delta={pctChange(totals.cents, prevTotals.cents)}
          sub={t("admin.sales.kpi.vsPrevious")}
        />
        <Stat
          label={t("admin.sales.kpi.sales")}
          value={fmt.num(totals.count)}
          delta={pctChange(totals.count, prevTotals.count)}
          sub={t("admin.sales.kpi.buyers", { count: fmt.num(totals.buyers) })}
        />
        <Stat
          label={t("admin.sales.kpi.avgTicket")}
          value={fmt.money(totals.avg)}
          delta={pctChange(totals.avg, prevTotals.avg)}
        />
        <Stat
          label={t("admin.sales.kpi.newCustomers")}
          value={fmt.num(totals.newCustomers)}
          delta={pctChange(totals.newCustomers, prevTotals.newCustomers)}
          sub={
            view.medianAge !== null
              ? t("admin.sales.kpi.medianAge", { value: fmt.num(Math.round(view.medianAge)) })
              : undefined
          }
        />
        <Stat
          label={t("admin.sales.kpi.mrr")}
          value={fmt.money(snapshot.mrrCents)}
          sub={t("admin.sales.kpi.arr", { value: fmt.money(snapshot.mrrCents * 12) })}
        />
        <Stat
          label={t("admin.sales.kpi.paying")}
          value={fmt.num(paying)}
          sub={t("admin.sales.kpi.payingSplit", { subs: fmt.num(activeSubs), pix: fmt.num(activePix) })}
        />
        <Stat
          label={t("admin.sales.kpi.monthProjection")}
          value={view.monthProjection === null ? "—" : fmt.money(view.monthProjection)}
          sub={t("admin.sales.kpi.monthSoFar", { value: fmt.money(view.monthCents) })}
        />
        <Stat
          label={t("admin.sales.kpi.conversion")}
          value={snapshot.active > 0 ? fmt.pct(paying / snapshot.active) : "—"}
          sub={t("admin.sales.kpi.conversionHint", {
            paying: fmt.num(paying),
            active: fmt.num(snapshot.active),
            days: snapshot.activeDays,
          })}
        />
        <Stat
          label={t("admin.sales.kpi.recurring")}
          value={totals.cents > 0 ? fmt.pct(renewalCents / totals.cents) : "—"}
          sub={t("admin.sales.kpi.recurringHint", { value: fmt.money(renewalCents) })}
        />
        <Stat
          label={t("admin.sales.kpi.netSubs")}
          value={(netSubs > 0 ? "+" : "") + fmt.num(netSubs)}
          sub={t("admin.sales.kpi.netSubsHint", { added: fmt.num(view.newSubs.length), ended: fmt.num(view.ended.length) })}
        />
        <Stat
          label={t("admin.sales.kpi.refused")}
          value={fmt.num(view.refused.length)}
          sub={t("admin.sales.kpi.refusedHint", {
            renewals: fmt.num(view.refused.filter((event) => event.renewal).length),
          })}
        />
      </div>

      {view.legacyCount > 0 && (
        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-[11px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          {t("admin.sales.legacyNote", {
            count: fmt.num(view.legacyCount),
            date: data.salesSince ? fmt.date(data.salesSince) : t("admin.sales.legacyToday"),
          })}
        </p>
      )}

      {/* Is it going up or down? */}
      <Card
        title={t("admin.sales.trend.title")}
        hint={t("admin.sales.trend.hint")}
        right={
          <div className="flex flex-col items-end gap-0.5 text-[11px]">
            {trendWord && view.perWeek !== null && (
              <span className={`font-semibold ${trendWord.cls}`}>
                {trendWord.arrow} {trendWord.text} ({view.perWeek > 0 ? "+" : "−"}
                {fmt.pct(Math.abs(view.perWeek))} {t("admin.sales.trend.perWeek")})
              </span>
            )}
            {data.days >= 14 && (
              <span className="text-zinc-500 dark:text-zinc-400">
                {t("admin.sales.trend.last7")} <Delta value={pctChange(view.last7.cents, view.prior7.cents)} />
              </span>
            )}
          </div>
        }
      >
        <Legend
          items={[
            { label: t("admin.sales.trend.current"), color: SLOT[0] },
            ...(view.ma ? [{ label: t("admin.sales.trend.ma7"), color: SLOT[1] }] : []),
            { label: t("admin.sales.trend.previous"), color: "var(--prev)", dashed: true },
          ]}
        />
        <div className="mt-2">
          <LineChart
            labels={view.labels}
            format={fmtMetric}
            series={[
              { label: t("admin.sales.trend.previous"), color: "var(--prev)", values: view.previous, dashed: true, width: 1.5 },
              { label: t("admin.sales.trend.current"), color: SLOT[0], values: view.current },
              ...(view.ma ? [{ label: t("admin.sales.trend.ma7"), color: SLOT[1], values: view.ma, width: 2.5 }] : []),
            ]}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Card vs Pix. */}
        <Card title={t("admin.sales.method.title")} hint={t("admin.sales.method.hint")}>
          <SplitBar
            format={(v) => (metric === "revenue" ? fmt.money(v) : fmt.num(v))}
            parts={methodTotals.map((entry) => ({
              label: t(`admin.sales.method.${entry.key}`),
              color: METHOD_COLOR[entry.key],
              value: sumBy(entry.rows),
            }))}
          />
          <div className="mt-3">
            <StackedBars
              labels={view.labels}
              format={fmtMetric}
              stacks={(["subscription", "pix"] as const).map((key, i) => ({
                label: t(`admin.sales.method.${key}`),
                color: METHOD_COLOR[key],
                values: view.byMethod[i],
              }))}
            />
          </div>
          <table className="mt-3 w-full text-[11px]">
            <thead>
              <tr className="text-left text-zinc-500 dark:text-zinc-400">
                <th className="font-medium" />
                <th className="font-medium">{t("admin.sales.kpi.avgTicket")}</th>
                <th className="font-medium">{t("admin.sales.method.firsts")}</th>
                <th className="font-medium">{t("admin.sales.method.fee")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-zinc-700 dark:text-zinc-300">
              {methodTotals.map((entry) => (
                <tr key={entry.key}>
                  <td className="py-0.5">{t(`admin.sales.method.${entry.key}`)}</td>
                  <td>{fmt.money(entry.totals.avg)}</td>
                  <td>
                    {fmt.num(entry.firsts)}
                    {totals.newCustomers > 0 && ` (${fmt.pct(entry.firsts / totals.newCustomers)})`}
                  </td>
                  <td>{entry.fee === null ? "—" : fmt.pct(entry.fee)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* New money vs money that came back. */}
        <Card title={t("admin.sales.recurrence.title")} hint={t("admin.sales.recurrence.hint")}>
          <SplitBar
            format={(v) => (metric === "revenue" ? fmt.money(v) : fmt.num(v))}
            parts={SALE_TYPES.map((key) => ({
              label: t(`admin.sales.type.${key}`),
              color: TYPE_COLOR[key],
              value: sumBy(cur.filter((row) => saleType(row) === key)),
            }))}
          />
          <div className="mt-3">
            <StackedBars
              labels={view.labels}
              format={fmtMetric}
              stacks={SALE_TYPES.map((key, i) => ({
                label: t(`admin.sales.type.${key}`),
                color: TYPE_COLOR[key],
                values: view.byType[i],
              }))}
            />
          </div>
        </Card>

        {/* Subscriptions gained and lost. */}
        <Card title={t("admin.sales.churn.title")} hint={t("admin.sales.churn.hint")}>
          <Legend
            items={[
              { label: t("admin.sales.churn.added"), color: SLOT[0] },
              { label: t("admin.sales.churn.ended"), color: SLOT[1] },
            ]}
          />
          <div className="mt-2">
            <LineChart
              labels={view.labels}
              format={(v) => fmt.num(Math.round(v * 10) / 10)}
              series={[
                { label: t("admin.sales.churn.added"), color: SLOT[0], values: view.newSubSeries },
                { label: t("admin.sales.churn.ended"), color: SLOT[1], values: view.endedSeries },
              ]}
            />
          </div>
        </Card>

        {/* Pro vs Pro Max vs Pro Ultra. */}
        <Card title={t("admin.sales.plans.title")} hint={t("admin.sales.plans.hint")}>
          <BarList groups={tierGroups} metric={metric} fmt={fmt} keepOrder />
          <div className="mt-3">
            <StackedBars
              labels={view.labels}
              format={fmtMetric}
              stacks={TIERS.map((key, i) => ({ label: TIER_LABEL[key], color: TIER_COLOR[key], values: view.byTier[i] }))}
            />
          </div>
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("admin.sales.plans.cycle")}</p>
            <SplitBar
              format={(v) => (metric === "revenue" ? fmt.money(v) : fmt.num(v))}
              parts={(["monthly", "yearly"] as const).map((key, i) => {
                const group = cycleGroups.find((entry) => entry.key === key);
                return {
                  label: t(`admin.sales.cycle.${key}`),
                  color: SLOT[i],
                  value: group ? (metric === "revenue" ? group.cents : group.count) : 0,
                };
              })}
            />
          </div>
        </Card>

        {/* Who holds what right now. */}
        <Card title={t("admin.sales.active.title")} hint={t("admin.sales.active.hint")}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-zinc-500 dark:text-zinc-400">
                <th className="font-medium" />
                <th className="font-medium">{t("admin.sales.cycle.monthly")}</th>
                <th className="font-medium">{t("admin.sales.cycle.yearly")}</th>
                <th className="font-medium">{t("admin.sales.method.pix")}</th>
                <th className="font-medium">{t("admin.sales.active.free")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-zinc-700 dark:text-zinc-300">
              {TIERS.map((key) => (
                <tr key={key} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="py-1 font-medium">{TIER_LABEL[key]}</td>
                  <td>{fmt.num(snapshot.subs[key]?.monthly ?? 0)}</td>
                  <td>{fmt.num(snapshot.subs[key]?.yearly ?? 0)}</td>
                  <td>{fmt.num(snapshot.pix[key] ?? 0)}</td>
                  <td>{fmt.num(snapshot.free[key] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            {t("admin.sales.active.accounts", {
              accounts: fmt.num(snapshot.accounts),
              active: fmt.num(snapshot.active),
              days: snapshot.activeDays,
            })}
          </p>
        </Card>

        {/* Presents vs buying for yourself. */}
        <Card title={t("admin.sales.gift.title")} hint={t("admin.sales.gift.hint")}>
          <SplitBar
            format={(v) => (metric === "revenue" ? fmt.money(v) : fmt.num(v))}
            parts={[
              { label: t("admin.sales.gift.own"), color: SLOT[0], value: sumBy(ownRows) },
              { label: t("admin.sales.type.gift"), color: TYPE_COLOR.gift, value: sumBy(giftRows) },
            ]}
          />
          <div className="mt-3">
            <BarList
              groups={TIERS.map((key) => {
                const rows = giftRows.filter((row) => row.tier === key);
                return { key, label: TIER_LABEL[key], cents: rows.reduce((s, r) => s + r.cents, 0), count: rows.length };
              })}
              metric={metric}
              fmt={fmt}
              keepOrder
              color={TYPE_COLOR.gift}
            />
          </div>
        </Card>

        {/* What they buy on. */}
        <Card title={t("admin.sales.device.title")} hint={t("admin.sales.device.hint")}>
          <BarList groups={platformGroups} metric={metric} fmt={fmt} />
          <p className="mb-1 mt-4 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            {t("admin.sales.device.os")}
          </p>
          <BarList groups={deviceGroups} metric={metric} fmt={fmt} color={SLOT[2]} />
        </Card>

        {/* Where the pay click came from. */}
        <Card title={t("admin.sales.door.title")} hint={t("admin.sales.door.hint")}>
          <BarList groups={doorGroups} metric={metric} fmt={fmt} />
        </Card>

        {/* How long they had been around. */}
        <Card title={t("admin.sales.age.title")} hint={t("admin.sales.age.hint")}>
          <BarList groups={ageGroups} metric={metric} fmt={fmt} keepOrder />
          <p className="mb-1 mt-4 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            {t("admin.sales.usage.title")}
          </p>
          <BarList groups={usageGroups} metric={metric} fmt={fmt} keepOrder color={SLOT[2]} />
        </Card>

        {/* When people pay. */}
        <Card title={t("admin.sales.heat.title")} hint={t("admin.sales.heat.hint")}>
          <div className="overflow-x-auto">
            <div className="grid min-w-[480px] gap-0.5" style={{ gridTemplateColumns: "2.5rem repeat(24, minmax(0, 1fr))" }}>
              <span />
              {Array.from({ length: 24 }, (_, hour) => (
                <span key={hour} className="text-center text-[9px] text-zinc-400">
                  {hour % 3 === 0 ? hour : ""}
                </span>
              ))}
              {view.heat.map((row, day) => (
                <div key={day} className="contents">
                  <span className="pr-1 text-right text-[10px] leading-4 text-zinc-500">{weekdayLabels[day]}</span>
                  {row.map((value, hour) => (
                    <span
                      key={hour}
                      title={`${weekdayLabels[day]} ${hour}h: ${metric === "revenue" ? fmt.money(value) : fmt.num(value)}`}
                      className="h-4 rounded-[3px] bg-zinc-100 dark:bg-zinc-900"
                      style={
                        value > 0
                          ? { background: SLOT[0], opacity: 0.15 + 0.85 * (value / heatMax) }
                          : undefined
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Which processor took the money. */}
        <Card title={t("admin.sales.provider.title")} hint={t("admin.sales.provider.hint")}>
          <BarList groups={providerGroups} metric={metric} fmt={fmt} />
        </Card>
      </div>

      {/* Buyers vs everybody else. */}
      <Card
        title={t("admin.sales.traits.title")}
        hint={t("admin.sales.traits.hint", {
          buyers: fmt.num(data.traits.buyersTotal),
          base: fmt.num(data.traits.baseTotal),
          days: snapshot.activeDays,
        })}
      >
        <Legend
          items={[
            { label: t("admin.sales.traits.buyers"), color: SLOT[0] },
            { label: t("admin.sales.traits.base"), color: "var(--prev)" },
          ]}
        />
        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
          {traitRows.map((row) => (
            <div key={row.key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="truncate text-zinc-700 dark:text-zinc-300">{t(`admin.sales.trait.${row.key}`)}</span>
                <span
                  className={`shrink-0 font-semibold tabular-nums ${
                    row.lift === null
                      ? "text-zinc-400"
                      : row.lift >= 1.2
                        ? "text-[#006300] dark:text-[#0ca30c]"
                        : row.lift <= 0.8
                          ? "text-[#d03b3b] dark:text-[#e66767]"
                          : "text-zinc-500"
                  }`}
                  title={t("admin.sales.traits.liftHint")}
                >
                  {row.lift === null ? "—" : `${row.lift >= 1 ? "▲" : "▼"} ${fmt.num(Math.round(row.lift * 10) / 10)}×`}
                </span>
              </div>
              <div className="mt-0.5 flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-zinc-100 dark:bg-zinc-900">
                    <div className="h-1.5 rounded-full" style={{ width: `${row.buyersPct * 100}%`, background: SLOT[0] }} />
                  </div>
                  <span className="w-10 text-right text-[10px] tabular-nums text-zinc-500">{fmt.pct(row.buyersPct)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-zinc-100 dark:bg-zinc-900">
                    <div className="h-1.5 rounded-full" style={{ width: `${row.basePct * 100}%`, background: "var(--prev)" }} />
                  </div>
                  <span className="w-10 text-right text-[10px] tabular-nums text-zinc-500">{fmt.pct(row.basePct)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">{t("admin.sales.traits.note")}</p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t("admin.sales.top.title")} hint={t("admin.sales.top.hint")}>
          {topBuyers.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("admin.sales.noData")}</p>
          ) : (
            <ol className="flex flex-col gap-1 text-xs">
              {topBuyers.map(([b, entry], i) => (
                <li key={b} className="flex items-center gap-2">
                  <span className="w-4 text-right text-[11px] text-zinc-400">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-200">
                    @{data.buyers[b]?.username ?? "?"}
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    {TIER_LABEL[entry.last.tier] ?? entry.last.tier} ·{" "}
                    {t("admin.sales.nSales", { count: fmt.num(entry.count) })}
                  </span>
                  <span className="w-24 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {fmt.money(entry.cents)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title={t("admin.sales.recent.title")} hint={t("admin.sales.recent.hint")}>
          {recent.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("admin.sales.noData")}</p>
          ) : (
            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto pr-1 text-xs">
              {recent.map((row, i) => {
                const type = saleType(row);
                return (
                  <li
                    key={`${row.at}-${i}`}
                    className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-zinc-100 pb-1 last:border-0 dark:border-zinc-900"
                  >
                    <span className="w-20 shrink-0 text-[11px] tabular-nums text-zinc-500">{fmt.dateTime(row.at)}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-200">
                      @{data.buyers[row.b]?.username ?? "?"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: TYPE_COLOR[type] }} />
                      {t(`admin.sales.type.${type}`)}
                    </span>
                    <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
                      {TIER_LABEL[row.tier] ?? row.tier}
                      {row.cycle === "yearly" ? ` · ${t("admin.sales.cycle.yearly")}` : ""} ·{" "}
                      {t(`admin.sales.method.${row.method}`)}
                    </span>
                    <span className="w-20 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {fmt.money(row.cents)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

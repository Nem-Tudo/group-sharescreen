"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PartnerReportBucket } from "@/lib/partnerReport";

// The report's drawing kit: a time-series chart, a funnel and a split bar,
// all hand-rolled SVG.
//
// No chart library on purpose — the site ships no charting dependency and
// these three shapes are the only ones it needs, so a library would be a new
// megabyte on every advertiser's phone to draw three things. The colours all
// come from the CSS custom properties declared in PartnerReportClient's
// `.report-viz` block, which is also where light and dark are decided; nothing
// here hardcodes a hex, so the two themes can never drift apart.

const numberFormat = new Intl.NumberFormat("pt-BR");
const compactFormat = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export function formatCount(value: number): string {
  return numberFormat.format(value);
}

/** The chart's own width, measured rather than guessed.
 *
 *  An SVG stretched with preserveAspectRatio would scale its text and strokes
 *  along with the plot (2px lines becoming 3.4px, labels becoming ellipses),
 *  and hover would have to undo that scaling to find out which bucket the
 *  pointer is over. Measuring instead keeps one pixel one pixel. */
function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

// A round-ish upper bound, so the top gridline reads as a number a person
// would say out loud (50, 200, 1k) instead of whatever the peak happened to
// be. Never below 1: an all-zero series still needs an axis to sit on.
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

const hourLabel = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayLabel = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const fullHourLabel = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const fullDayLabel = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

export function bucketAxisLabel(t: number, step: "hour" | "day"): string {
  return step === "hour" ? hourLabel.format(t) : dayLabel.format(t);
}

export function bucketFullLabel(t: number, step: "hour" | "day"): string {
  return step === "hour" ? fullHourLabel.format(t) : fullDayLabel.format(t);
}

/**
 * The least a bucket has to be for these charts to draw it: a point in time.
 *
 * Generic rather than tied to the partner report, because the theme dashboard
 * draws the same shapes from a different set of numbers (see
 * app/tema/[id]). Everything here only ever reads `t` and whatever `valueOf`
 * pulls out, so widening the type costs nothing and saves a second copy of a
 * chart — which is how two pages that should look identical stop looking
 * identical.
 */
export type ChartBucket = { t: number };

type Series<B extends ChartBucket = ChartBucket> = {
  label: string;
  // Which number of each bucket this line draws.
  valueOf: (bucket: B) => number;
  // A `--series-N` custom property name, resolved against .report-viz.
  color: string;
};

const CHART_HEIGHT = 190;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const PAD_LEFT = 42;
const PAD_RIGHT = 10;

/**
 * One metric over time: a 2px line over a soft fill, a recessive baseline, and
 * a crosshair that follows the pointer.
 *
 * Deliberately one series per chart. Impressions and clicks live on scales
 * that differ by an order of magnitude, and the two ways of putting them in
 * one frame are both wrong: a second y-axis invites a comparison of two
 * unrelated scales, and a shared axis flattens the smaller series into the
 * baseline. Two charts side by side, sharing an x-axis and read one at a time,
 * say the true thing.
 */
export function TimeSeriesChart<B extends ChartBucket>({
  buckets,
  series,
  step,
  emptyLabel,
}: {
  buckets: B[];
  series: Series<B>;
  step: "hour" | "day";
  emptyLabel: string;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const values = buckets.map(series.valueOf);
  const peak = values.reduce((max, v) => (v > max ? v : max), 0);
  const yMax = niceMax(peak);
  const innerWidth = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const innerHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const xOf = useCallback(
    (index: number) =>
      PAD_LEFT + (buckets.length <= 1 ? innerWidth / 2 : (index / (buckets.length - 1)) * innerWidth),
    [buckets.length, innerWidth]
  );
  const yOf = (value: number) => PAD_TOP + innerHeight - (value / yMax) * innerHeight;

  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (buckets.length === 0 || innerWidth <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const ratio = (x - PAD_LEFT) / innerWidth;
    const index = Math.round(ratio * (buckets.length - 1));
    setHover(Math.max(0, Math.min(buckets.length - 1, index)));
  };

  const linePath = values.map((v, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(v)}`).join(" ");
  const areaPath =
    values.length > 0
      ? `${linePath} L${xOf(values.length - 1)},${PAD_TOP + innerHeight} L${xOf(0)},${PAD_TOP + innerHeight} Z`
      : "";

  // Four labels at most, evenly spaced — enough to place the eye in time,
  // few enough that they never collide on a phone.
  const labelCount = width < 380 ? 3 : 5;
  const labelStep = Math.max(1, Math.ceil(buckets.length / labelCount));
  const gradientId = `grad-${series.label.replace(/\W/g, "")}`;

  const total = values.reduce((sum, v) => sum + v, 0);

  return (
    <div className="relative" ref={ref}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)]">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: `var(${series.color})` }}
          />
          {series.label}
        </span>
        <span className="text-xs tabular-nums text-[var(--ink-2)]">
          {formatCount(total)} no período
        </span>
      </div>

      {width > 0 && (
        <svg
          width={width}
          height={CHART_HEIGHT}
          role="img"
          aria-label={`${series.label} ao longo do tempo`}
          onPointerMove={handleMove}
          onPointerLeave={() => setHover(null)}
          className="touch-none"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`var(${series.color})`} stopOpacity="0.28" />
              <stop offset="100%" stopColor={`var(${series.color})`} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Gridlines and their labels: three is all a chart this size can
              carry without the grid competing with the data. */}
          {[0, 0.5, 1].map((fraction) => {
            const y = PAD_TOP + innerHeight * (1 - fraction);
            return (
              <g key={fraction}>
                <line
                  x1={PAD_LEFT}
                  x2={width - PAD_RIGHT}
                  y1={y}
                  y2={y}
                  stroke="var(--grid)"
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-[var(--ink-3)] text-[10px] tabular-nums"
                >
                  {compactFormat.format(yMax * fraction)}
                </text>
              </g>
            );
          })}

          {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={`var(${series.color})`}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {buckets.map((bucket, i) =>
            i % labelStep === 0 || i === buckets.length - 1 ? (
              <text
                key={bucket.t}
                x={xOf(i)}
                y={CHART_HEIGHT - 8}
                textAnchor={i === 0 ? "start" : i === buckets.length - 1 ? "end" : "middle"}
                className="fill-[var(--ink-3)] text-[10px] tabular-nums"
              >
                {bucketAxisLabel(bucket.t, step)}
              </text>
            ) : null
          )}

          {hover !== null && buckets[hover] && (
            <g pointerEvents="none">
              <line
                x1={xOf(hover)}
                x2={xOf(hover)}
                y1={PAD_TOP}
                y2={PAD_TOP + innerHeight}
                stroke="var(--ink-3)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {/* A 2px surface ring so the marker stays visible wherever it
                  lands on the fill. */}
              <circle
                cx={xOf(hover)}
                cy={yOf(values[hover])}
                r={5}
                fill={`var(${series.color})`}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
      )}

      {peak === 0 && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-xs text-[var(--ink-3)]">
          {emptyLabel}
        </p>
      )}

      {hover !== null && buckets[hover] && width > 0 && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(xOf(hover), 60), width - 60),
            top: 8,
          }}
        >
          <p className="whitespace-nowrap text-[10px] text-[var(--ink-3)]">
            {bucketFullLabel(buckets[hover].t, step)}
          </p>
          <p className="whitespace-nowrap font-semibold tabular-nums text-[var(--ink-1)]">
            {formatCount(values[hover])} {series.label.toLowerCase()}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The watch-to-earn funnel, as horizontal bars on one shared scale.
 *
 * Bars rather than a tapering funnel shape: a funnel's slanted sides encode
 * nothing, and its width at any point is not proportional to anything a reader
 * can measure. Each stage is also labelled with its share of the *first*
 * stage, which is the number that says whether people are dropping out.
 */
export function FunnelChart({
  stages,
}: {
  stages: { label: string; value: number; hint?: string }[];
}) {
  const first = stages[0]?.value ?? 0;
  const max = Math.max(first, 1);
  // An ordinal ramp of one hue, darkest first — the stages are ordered, and
  // order is what a single-hue ramp encodes. Steps stay clear of the surface
  // (see the palette's ordinal floor) so the last bar is still a bar.
  const ramp = ["var(--ordinal-1)", "var(--ordinal-2)", "var(--ordinal-3)"];

  return (
    <ul className="flex flex-col gap-3">
      {stages.map((stage, i) => {
        const share = first > 0 ? (stage.value / first) * 100 : null;
        return (
          <li key={stage.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-[var(--ink-2)]">{stage.label}</span>
              <span className="shrink-0 tabular-nums text-[var(--ink-1)]">
                <strong className="font-semibold">{formatCount(stage.value)}</strong>
                {i > 0 && share !== null && (
                  <span className="ml-1.5 text-[var(--ink-3)]">{share.toFixed(0)}%</span>
                )}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--track)]">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max(stage.value > 0 ? 2 : 0, (stage.value / max) * 100)}%`,
                  backgroundColor: ramp[Math.min(i, ramp.length - 1)],
                }}
              />
            </div>
            {stage.hint && <p className="text-[10px] text-[var(--ink-3)]">{stage.hint}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Where the clicks came from: one bar, two segments, a 2px surface gap between
 * them so they read as two quantities rather than one two-toned one.
 */
export function SplitBar({
  parts,
}: {
  parts: { label: string; value: number; color: string }[];
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-[var(--track)]">
        {total > 0 &&
          parts.map((part) => (
            <div
              key={part.label}
              className="h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-500"
              style={{
                width: `${(part.value / total) * 100}%`,
                backgroundColor: `var(${part.color})`,
              }}
            />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((part) => (
          <li key={part.label} className="flex items-center gap-1.5 text-xs text-[var(--ink-2)]">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: `var(${part.color})` }}
            />
            {part.label}
            <strong className="font-semibold tabular-nums text-[var(--ink-1)]">
              {formatCount(part.value)}
            </strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A single headline number. No plot, so no hover — the number *is* the
 *  chart. */
export function StatTile({
  label,
  value,
  hint,
  accent,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)]">
        {icon && (
          <span style={accent ? { color: `var(${accent})` } : undefined} className="flex text-sm">
            {icon}
          </span>
        )}
        {label}
      </div>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-[var(--ink-1)]">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-[var(--ink-3)]">{hint}</p>}
    </div>
  );
}

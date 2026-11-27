"use client";

import { useCallback, useEffect, useState } from "react";
import { MdRefresh } from "react-icons/md";
import { fetchLiteMetrics, type LiteConfig, type LiteDailyRow, type LiteMetrics } from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";
import { formatLocale } from "@/lib/i18n";

// Go Live - Lite metrics: downloads → setup → installs → active use, uninstalls,
// modifications, versions, and the RAM budget the project is held to (50 MB with
// no media, +50 MB per stream). Read from GET /admin/lite/stats.

const RANGES = [7, 30, 90] as const;

const smallButton =
  "flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(formatLocale(), { maximumFractionDigits: digits });
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
      {hint && (
        <p
          className={`mt-0.5 text-[11px] ${
            tone === "bad"
              ? "text-red-600 dark:text-red-400"
              : tone === "good"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-zinc-500"
          }`}
        >
          {tone === "bad" ? "▲ " : tone === "good" ? "✓ " : ""}
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * One series per chart, bars by day. Hover shows the day and value (native title,
 * on a hit area the full column tall). `budget` draws a dashed reference line.
 */
function DailyBars({
  title,
  rows,
  value,
  unit,
  budget,
  budgetLabel,
}: {
  title: string;
  rows: LiteDailyRow[];
  value: (r: LiteDailyRow) => number | null;
  unit?: string;
  budget?: number;
  budgetLabel?: string;
}) {
  const values = rows.map(value);
  const max = Math.max(1, budget ?? 0, ...values.map((v) => v ?? 0)) * 1.1;
  const total = values.reduce<number>((a, v) => a + (v ?? 0), 0);
  const latest = [...values].reverse().find((v) => v !== null) ?? null;
  const H = 72;
  const dayLabel = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(formatLocale(), { day: "2-digit", month: "2-digit" });
  return (
    <figure className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <figcaption className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{title}</span>
        <span className="text-zinc-500">{unit ? `${fmt(latest, 1)} ${unit}` : fmt(total)}</span>
      </figcaption>
      <div className="relative" style={{ height: H }}>
        {budget !== undefined && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-zinc-400 dark:border-zinc-500"
            style={{ bottom: (budget / max) * H }}
          >
            <span className="absolute -top-4 right-0 text-[10px] text-zinc-500">{budgetLabel}</span>
          </div>
        )}
        <div className="flex h-full items-end gap-[2px]">
          {rows.map((r, i) => {
            const v = values[i];
            const h = v ? Math.max(2, (v / max) * H) : 0;
            return (
              <div
                key={r.date}
                className="group flex h-full flex-1 items-end"
                title={`${dayLabel(r.date)}: ${v === null ? "—" : `${fmt(v, unit ? 1 : 0)}${unit ? ` ${unit}` : ""}`}`}
              >
                <div
                  className="w-full rounded-t-[4px] bg-emerald-600 transition-colors group-hover:bg-emerald-500 dark:bg-emerald-500 dark:group-hover:bg-emerald-400"
                  style={{ height: h }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-zinc-500">
        <span>{rows[0] ? dayLabel(rows[0].date) : ""}</span>
        <span>{rows.length ? dayLabel(rows[rows.length - 1].date) : ""}</span>
      </div>
    </figure>
  );
}

export function LiteMetricsPanel({ config }: { config: LiteConfig | null }) {
  const t = useT();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<LiteMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTable, setShowTable] = useState(false);

  // State is only set once the request settles, so the effect below never sets
  // it synchronously; the refresh button flags "loading" itself.
  const fetchData = useCallback(
    () =>
      fetchLiteMetrics(days)
        .then((m) => {
          setData(m);
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false)),
    [days]
  );

  const load = () => {
    setLoading(true);
    void fetchData();
  };

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const modName = (id: string) => config?.modifications.find((m) => m.id === id)?.name ?? id;
  const p = data?.period;
  const tot = data?.totals;
  const budget = data?.budget ?? { idleMb: 50, perMediaMb: 50 };
  const idleOk = p?.ramIdleAvg !== null && p?.ramIdleAvg !== undefined ? p.ramIdleAvg <= budget.idleMb : null;
  const perMediaOk =
    p?.ramPerMediaAvg !== null && p?.ramPerMediaAvg !== undefined ? p.ramPerMediaAvg <= budget.perMediaMb : null;
  const liveVersions = Object.entries(data?.live.versions ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("admin.liteMetrics.title")}</h3>
        <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700" role="group">
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`px-2 py-1 text-xs font-medium ${
                days === d
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {t("admin.liteMetrics.days", { n: d })}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className={smallButton} title={t("admin.litePanel.reload")}>
          <MdRefresh className="h-4 w-4" />
        </button>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {!data && !error && <p className="text-sm text-zinc-500">{t("admin.liteMetrics.loading")}</p>}

      {data && p && tot && (
        <>
          {/* Agora */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label={t("admin.liteMetrics.onlineNow")} value={fmt(data.live.online)} />
            <Tile label={t("admin.liteMetrics.inRooms")} value={fmt(data.live.inRooms)} />
            <Tile label={t("admin.liteMetrics.sharing")} value={fmt(data.live.sharing)} />
            <Tile label={t("admin.liteMetrics.micOn")} value={fmt(data.live.micOn)} />
          </div>

          {/* Instalações e uso */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label={t("admin.liteMetrics.installsTotal")} value={fmt(tot.installs)} hint={t("admin.liteMetrics.installsTotalHint")} />
            <Tile label={t("admin.liteMetrics.active1d")} value={fmt(tot.active1d)} />
            <Tile label={t("admin.liteMetrics.active7d")} value={fmt(tot.active7d)} />
            <Tile label={t("admin.liteMetrics.active30d")} value={fmt(tot.active30d)} />
            <Tile label={t("admin.liteMetrics.uninstalled")} value={fmt(tot.uninstalled)} hint={t("admin.liteMetrics.uninstalledHint")} />
            <Tile label={t("admin.liteMetrics.downloadsTotal")} value={fmt(tot.downloads)} />
            <Tile
              label={t("admin.liteMetrics.setupInstalls")}
              value={fmt(tot.setupInstall + tot.setupOffline)}
              hint={t("admin.liteMetrics.setupInstallsHint", { updates: fmt(tot.setupUpdate), offline: fmt(tot.setupOffline) })}
            />
            <Tile
              label={t("admin.liteMetrics.setupFails")}
              value={fmt(tot.setupFail)}
              hint={
                tot.setupInstall + tot.setupUpdate + tot.setupFail > 0
                  ? t("admin.liteMetrics.failRate", {
                      pct: fmt((tot.setupFail / (tot.setupInstall + tot.setupUpdate + tot.setupFail)) * 100, 1),
                    })
                  : undefined
              }
              tone={tot.setupFail > 0 ? "bad" : undefined}
            />
          </div>

          {/* Período */}
          <p className="text-xs text-zinc-500">
            {t("admin.liteMetrics.periodSummary", {
              days: data.days,
              dau: fmt(p.dauAvg, 1),
              downloads: fmt(p.downloads),
              unique: fmt(p.downloadsUnique),
              newInstalls: fmt(p.newInstalls),
              uninstalls: fmt(p.uninstalls),
              updates: fmt(p.updates),
            })}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <DailyBars title={t("admin.liteMetrics.chartDau")} rows={data.daily} value={(r) => r.dau} />
            <DailyBars title={t("admin.liteMetrics.chartDownloads")} rows={data.daily} value={(r) => r.downloads} />
            <DailyBars title={t("admin.liteMetrics.chartNewInstalls")} rows={data.daily} value={(r) => r.newInstalls} />
            <DailyBars title={t("admin.liteMetrics.chartUninstalls")} rows={data.daily} value={(r) => r.uninstalls} />
            <DailyBars title={t("admin.liteMetrics.chartUpdates")} rows={data.daily} value={(r) => r.updates} />
            <DailyBars title={t("admin.liteMetrics.chartUseHours")} rows={data.daily} value={(r) => Math.round((r.useMinutes / 60) * 10) / 10} />
          </div>

          {/* Desempenho: a meta do projeto */}
          <h4 className="mt-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            {t("admin.liteMetrics.perfTitle", { idle: budget.idleMb, perMedia: budget.perMediaMb })}
          </h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile
              label={t("admin.liteMetrics.ramIdle")}
              value={p.ramIdleAvg === null ? "—" : `${fmt(p.ramIdleAvg, 1)} MB`}
              hint={
                p.ramIdleOverPct === null
                  ? undefined
                  : t("admin.liteMetrics.overBudget", { pct: fmt(p.ramIdleOverPct, 1) })
              }
              tone={idleOk === null ? undefined : idleOk ? "good" : "bad"}
            />
            <Tile
              label={t("admin.liteMetrics.ramPerMedia")}
              value={p.ramPerMediaAvg === null ? "—" : `${fmt(p.ramPerMediaAvg, 1)} MB`}
              hint={
                p.ramMediaOverPct === null
                  ? undefined
                  : t("admin.liteMetrics.overBudget", { pct: fmt(p.ramMediaOverPct, 1) })
              }
              tone={perMediaOk === null ? undefined : perMediaOk ? "good" : "bad"}
            />
            <Tile label={t("admin.liteMetrics.ramMedia")} value={p.ramMediaAvg === null ? "—" : `${fmt(p.ramMediaAvg, 1)} MB`} />
            <Tile
              label={t("admin.liteMetrics.cpu")}
              value={p.cpuAvg === null ? "—" : `${fmt(p.cpuAvg, 1)}%`}
              hint={t("admin.liteMetrics.samples", { n: fmt(p.ramSamples) })}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <DailyBars
              title={t("admin.liteMetrics.chartRamIdle")}
              rows={data.daily}
              value={(r) => r.ramIdleAvg}
              unit="MB"
              budget={budget.idleMb}
              budgetLabel={t("admin.liteMetrics.budgetLine", { mb: budget.idleMb })}
            />
            <DailyBars
              title={t("admin.liteMetrics.chartRamPerMedia")}
              rows={data.daily}
              value={(r) => r.ramPerMediaAvg}
              unit="MB"
              budget={budget.perMediaMb}
              budgetLabel={t("admin.liteMetrics.budgetLine", { mb: budget.perMediaMb })}
            />
          </div>

          {/* Versões e modificações */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">{t("admin.liteMetrics.versionsTitle")}</h4>
              <table className="w-full text-left text-xs">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="py-1 font-medium">{t("admin.litePanel.version")}</th>
                    <th className="py-1 text-right font-medium">{t("admin.liteMetrics.colInstalls30d")}</th>
                    <th className="py-1 text-right font-medium">{t("admin.liteMetrics.colOnline")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {Array.from(new Set([...data.versions.map((v) => v.version), ...liveVersions.map(([v]) => v)])).map((v) => (
                    <tr key={v}>
                      <td className="py-1 font-mono">v{v}</td>
                      <td className="py-1 text-right">{fmt(data.versions.find((x) => x.version === v)?.installs ?? 0)}</td>
                      <td className="py-1 text-right">{fmt(data.live.versions[v] ?? 0)}</td>
                    </tr>
                  ))}
                  {data.versions.length === 0 && liveVersions.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-1 text-zinc-500">{t("admin.liteMetrics.noData")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-1">
              <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">{t("admin.liteMetrics.modsTitle")}</h4>
              <table className="w-full text-left text-xs">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="py-1 font-medium">{t("admin.liteMetrics.colMod")}</th>
                    <th className="py-1 text-right font-medium" title={t("admin.liteMetrics.colInstalledHint")}>
                      {t("admin.liteMetrics.colInstalled")}
                    </th>
                    <th className="py-1 text-right font-medium">{t("admin.liteMetrics.colAdded")}</th>
                    <th className="py-1 text-right font-medium">{t("admin.liteMetrics.colRemoved")}</th>
                    <th className="py-1 text-right font-medium">{t("admin.liteMetrics.colSetupPicks")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {data.mods.map((m) => (
                    <tr key={m.id}>
                      <td className="py-1">{modName(m.id)}</td>
                      <td className="py-1 text-right">{fmt(m.installs)}</td>
                      <td className="py-1 text-right">{fmt(m.added)}</td>
                      <td className="py-1 text-right">{fmt(m.removed)}</td>
                      <td className="py-1 text-right">{fmt(m.setupPicks)}</td>
                    </tr>
                  ))}
                  {data.mods.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-1 text-zinc-500">{t("admin.liteMetrics.noData")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabela por dia (os mesmos números dos gráficos) */}
          <button type="button" onClick={() => setShowTable((v) => !v)} className={`${smallButton} self-start`}>
            {showTable ? t("admin.liteMetrics.hideTable") : t("admin.liteMetrics.showTable")}
          </button>
          {showTable && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-right text-xs">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="py-1 text-left font-medium">{t("admin.liteMetrics.colDay")}</th>
                    <th className="py-1 font-medium">{t("admin.liteMetrics.colDau")}</th>
                    <th className="py-1 font-medium">{t("admin.liteMetrics.colDownloads")}</th>
                    <th className="py-1 font-medium">{t("admin.liteMetrics.colSetupOpen")}</th>
                    <th className="py-1 font-medium">{t("admin.liteMetrics.colNew")}</th>
                    <th className="py-1 font-medium">{t("admin.liteMetrics.colUpdates")}</th>
                    <th className="py-1 font-medium">{t("admin.liteMetrics.colFails")}</th>
                    <th className="py-1 font-medium">{t("admin.liteMetrics.colUninstalls")}</th>
                    <th className="py-1 font-medium">{t("admin.liteMetrics.colRoomJoins")}</th>
                    <th className="py-1 font-medium">{t("admin.liteMetrics.colUseHours")}</th>
                    <th className="py-1 font-medium">{t("admin.liteMetrics.colRamIdle")}</th>
                    <th className="py-1 font-medium">{t("admin.liteMetrics.colRamPerMedia")}</th>
                    <th className="py-1 font-medium">CPU</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {[...data.daily].reverse().map((r) => (
                    <tr key={r.date}>
                      <td className="py-1 text-left font-mono">{r.date}</td>
                      <td className="py-1">{fmt(r.dau)}</td>
                      <td className="py-1">
                        {fmt(r.downloads)} <span className="text-zinc-500">({fmt(r.downloadsUnique)})</span>
                      </td>
                      <td className="py-1">{fmt(r.setupOpen)}</td>
                      <td className="py-1">{fmt(r.newInstalls)}</td>
                      <td className="py-1">{fmt(r.updates)}</td>
                      <td className="py-1">{fmt(r.setupFail)}</td>
                      <td className="py-1">{fmt(r.uninstalls)}</td>
                      <td className="py-1">{fmt(r.roomJoins)}</td>
                      <td className="py-1">{fmt(r.useMinutes / 60, 1)}</td>
                      <td className="py-1">{fmt(r.ramIdleAvg, 1)}</td>
                      <td className="py-1">{fmt(r.ramPerMediaAvg, 1)}</td>
                      <td className="py-1">{r.cpuAvg === null ? "—" : `${fmt(r.cpuAvg, 1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-zinc-500">{t("admin.liteMetrics.footnote")}</p>
        </>
      )}
    </section>
  );
}

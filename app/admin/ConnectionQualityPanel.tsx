"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  fetchConnectionQuality,
  type ConnectionQualityOverview,
  type QualityBucket,
  type QualityPerson,
} from "@/lib/adminApi";
import {
  QUALITY_SAMPLE_RATE,
  estimateBadRate,
  estimateSessions,
} from "@/lib/connectionTelemetrySummary";
import { useT } from "@/lib/useI18n";

// What the connection-quality reports add up to.
//
// The one question this panel exists to answer is whether "a bad stream with
// certain people" is the broadcaster's machine, the pair's route, or our TURN
// server — so every table is a cut along one of those lines, and every rate
// on it is corrected for the sampling (all bad sessions are reported, only a
// share of good ones). A raw rate would make everything look several times
// worse than it is, and worse by different amounts per bucket.

const DAY_OPTIONS = [1, 3, 7, 14];

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function Card({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{sub}</p>}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{title}</h3>
      {hint && <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{hint}</p>}
      <div className="mt-3 overflow-x-auto">{children}</div>
    </div>
  );
}

function BucketTable({
  rows,
  columns,
  label,
}: {
  rows: QualityBucket[];
  columns: string[];
  label: (row: QualityBucket) => string[];
}) {
  const t = useT();
  if (rows.length === 0) {
    return <p className="text-xs text-zinc-400">{t("admin.connectionQualityPanel.noData")}</p>;
  }
  const estimates = rows.map((row) => estimateSessions(row.total, row.bad));
  const all = estimates.reduce((a, b) => a + b, 0);
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="border-b border-zinc-100 text-zinc-400 dark:border-zinc-800/80">
          {columns.map((c) => (
            <th key={c} className="pb-2 font-medium">{c}</th>
          ))}
          <th className="pb-2 text-right font-medium">{t("admin.connectionQualityPanel.share")}</th>
          <th className="pb-2 text-right font-medium">{t("admin.connectionQualityPanel.reports")}</th>
          <th className="pb-2 text-right font-medium">{t("admin.connectionQualityPanel.badSessions")}</th>
          <th className="pb-2 text-right font-medium">{t("admin.connectionQualityPanel.badRate")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
        {rows.map((row, i) => {
          const rate = estimateBadRate(row.total, row.bad);
          return (
            <tr key={JSON.stringify(row.key)}>
              {label(row).map((cell, j) => (
                <td key={j} className="py-2 text-zinc-800 dark:text-zinc-200">{cell}</td>
              ))}
              <td className="py-2 text-right tabular-nums text-zinc-500">{all > 0 ? pct(estimates[i] / all) : "—"}</td>
              <td className="py-2 text-right tabular-nums text-zinc-500">{row.total}</td>
              <td className="py-2 text-right tabular-nums text-zinc-500">{row.bad}</td>
              <td
                className={`py-2 text-right font-semibold tabular-nums ${
                  rate >= 0.2 ? "text-red-600 dark:text-red-400" : rate >= 0.08 ? "text-amber-600 dark:text-amber-500" : "text-zinc-800 dark:text-zinc-200"
                }`}
              >
                {pct(rate)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PeopleTable({ rows, onPick }: { rows: QualityPerson[]; onPick: (userId: string) => void }) {
  const t = useT();
  if (rows.length === 0) {
    return <p className="text-xs text-zinc-400">{t("admin.connectionQualityPanel.noData")}</p>;
  }
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="border-b border-zinc-100 text-zinc-400 dark:border-zinc-800/80">
          <th className="pb-2 font-medium">{t("admin.connectionQualityPanel.user")}</th>
          <th className="pb-2 text-right font-medium">{t("admin.connectionQualityPanel.reports")}</th>
          <th className="pb-2 text-right font-medium">{t("admin.connectionQualityPanel.badSessions")}</th>
          <th className="pb-2 text-right font-medium">TURN</th>
          <th className="pb-2 text-right font-medium">{t("admin.connectionQualityPanel.cpu")}</th>
          <th className="pb-2 text-right font-medium">{t("admin.connectionQualityPanel.upload")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
        {rows.map((row) => (
          <tr key={row.userId}>
            <td className="py-2">
              <button
                type="button"
                onClick={() => onPick(row.userId)}
                className="max-w-[16rem] truncate font-mono text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                title={t("admin.connectionQualityPanel.filterByUser")}
              >
                {row.userId}
              </button>
            </td>
            <td className="py-2 text-right tabular-nums">{row.total}</td>
            <td className="py-2 text-right tabular-nums">{row.bad}</td>
            <td className="py-2 text-right tabular-nums">{row.relayed}</td>
            <td className="py-2 text-right tabular-nums">{row.senderCpu}</td>
            <td className="py-2 text-right tabular-nums">{row.senderBandwidth}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ConnectionQualityPanel() {
  const t = useT();
  const [days, setDays] = useState(3);
  const [room, setRoom] = useState("");
  const [user, setUser] = useState("");
  const [applied, setApplied] = useState({ days: 3, room: "", user: "" });
  const [data, setData] = useState<ConnectionQualityOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True from the start: the first load begins on mount.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Only ever sets state once the request settles, and not at all for a
    // request a newer filter has already superseded.
    let cancelled = false;
    fetchConnectionQuality({
      days: applied.days,
      room: applied.room.trim() || undefined,
      user: applied.user.trim() || undefined,
    }).then(
      (overview) => {
        if (cancelled) return;
        setData(overview);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        if (err instanceof Error && err.message === "unauthorized") return;
        setError(err instanceof Error ? err.message : String(err));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [applied]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setApplied({ days, room, user });
  }

  function pickUser(userId: string) {
    setUser(userId);
    setLoading(true);
    setApplied({ days, room, user: userId });
  }

  const routeLabel = (kind: unknown) =>
    ({
      direct: t("connectionStats.routeDirect"),
      "relay-local": t("admin.connectionQualityPanel.relayReporterSide"),
      "relay-remote": t("admin.connectionQualityPanel.relayOtherSide"),
      "relay-both": t("connectionStats.routeRelayBoth"),
    })[String(kind)] ?? t("admin.connectionQualityPanel.unknown");
  const directionLabel = (d: unknown) =>
    d === "send" ? t("admin.connectionQualityPanel.sending") : t("admin.connectionQualityPanel.receiving");
  const hardwareLabel = (h: unknown) =>
    h === true ? t("connectionStats.hardware") : h === false ? t("connectionStats.software") : t("admin.connectionQualityPanel.unknown");
  const text = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

  const relayedEstimate = data
    ? data.byRoute
        .filter((r) => String(r.key.routeKind).startsWith("relay"))
        .reduce((sum, r) => sum + estimateSessions(r.total, r.bad), 0)
    : 0;
  const allEstimate = data ? data.byRoute.reduce((sum, r) => sum + estimateSessions(r.total, r.bad), 0) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
          {t("admin.connectionQualityPanel.title")}
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {t("admin.connectionQualityPanel.subtitle", { sample: Math.round(QUALITY_SAMPLE_RATE * 100) })}
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">{t("admin.connectionQualityPanel.period")}</span>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {t("admin.connectionQualityPanel.lastDays", { days: d })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">{t("common.room")}</span>
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="w-40 rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">{t("admin.connectionQualityPanel.user")}</span>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            className="w-64 rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {loading ? t("common.loading") : t("admin.connectionQualityPanel.apply")}
        </button>
      </form>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card label={t("admin.connectionQualityPanel.reports")} value={data.total} />
            <Card label={t("admin.connectionQualityPanel.badSessions")} value={data.bad} />
            <Card
              label={t("admin.connectionQualityPanel.badRate")}
              value={pct(estimateBadRate(data.total, data.bad))}
              sub={t("admin.connectionQualityPanel.correctedForSampling")}
            />
            <Card
              label={t("admin.connectionQualityPanel.viaTurn")}
              value={allEstimate > 0 ? pct(relayedEstimate / allEstimate) : "—"}
              sub={t("admin.connectionQualityPanel.ofAllSessions")}
            />
          </div>

          <Section title={t("admin.connectionQualityPanel.byRoute")} hint={t("admin.connectionQualityPanel.byRouteHint")}>
            <BucketTable
              rows={data.byRoute}
              columns={[t("admin.connectionQualityPanel.side"), t("connectionStats.route")]}
              label={(r) => [directionLabel(r.key.direction), routeLabel(r.key.routeKind)]}
            />
          </Section>

          <Section title={t("admin.connectionQualityPanel.byRelayProtocol")}>
            <BucketTable
              rows={data.byRelayProtocol}
              columns={[t("admin.connectionQualityPanel.protocol")]}
              label={(r) => [text(r.key.relayProtocol).toUpperCase()]}
            />
          </Section>

          <Section title={t("admin.connectionQualityPanel.byEncoder")} hint={t("admin.connectionQualityPanel.byEncoderHint")}>
            <BucketTable
              rows={data.byEncoder}
              columns={[t("admin.connectionQualityPanel.side"), t("admin.connectionQualityPanel.implementation")]}
              label={(r) => [directionLabel(r.key.direction), hardwareLabel(r.key.hardware)]}
            />
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title={t("admin.connectionQualityPanel.byCodec")}>
              <BucketTable
                rows={data.byCodec}
                columns={[t("admin.connectionQualityPanel.side"), "Codec"]}
                label={(r) => [directionLabel(r.key.direction), text(r.key.codec)]}
              />
            </Section>
            <Section title={t("admin.connectionQualityPanel.byProfile")}>
              <BucketTable
                rows={data.byProfile}
                columns={[t("admin.connectionQualityPanel.profile")]}
                label={(r) => [text(r.key.profile)]}
              />
            </Section>
            <Section title={t("admin.connectionQualityPanel.byApp")}>
              <BucketTable
                rows={data.byApp}
                columns={[t("admin.connectionQualityPanel.side"), "App"]}
                label={(r) => [directionLabel(r.key.direction), text(r.key.app)]}
              />
            </Section>
            <Section title={t("admin.connectionQualityPanel.byBrowser")}>
              <BucketTable
                rows={data.byBrowser}
                columns={[t("admin.connectionQualityPanel.browser")]}
                label={(r) => [text(r.key.browser)]}
              />
            </Section>
          </div>

          <Section title={t("admin.connectionQualityPanel.causes")}>
            {data.causes.length === 0 ? (
              <p className="text-xs text-zinc-400">{t("admin.connectionQualityPanel.noData")}</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {data.causes.map((c) => (
                  <li key={c.cause} className="flex justify-between gap-4">
                    <span className="text-zinc-800 dark:text-zinc-200">{t(`connectionStats.cause.${c.cause}`)}</span>
                    <span className="tabular-nums text-zinc-500">{c.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title={t("admin.connectionQualityPanel.topSenders")} hint={t("admin.connectionQualityPanel.topSendersHint")}>
              <PeopleTable rows={data.topSenders} onPick={pickUser} />
            </Section>
            <Section title={t("admin.connectionQualityPanel.topReceivers")} hint={t("admin.connectionQualityPanel.topReceiversHint")}>
              <PeopleTable rows={data.topReceivers} onPick={pickUser} />
            </Section>
          </div>

          <Section title={t("admin.connectionQualityPanel.recentBad")}>
            {data.recentBad.length === 0 ? (
              <p className="text-xs text-zinc-400">{t("admin.connectionQualityPanel.noData")}</p>
            ) : (
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-zinc-100 text-zinc-400 dark:border-zinc-800/80">
                    <th className="pb-2 font-medium">{t("admin.connectionQualityPanel.when")}</th>
                    <th className="pb-2 font-medium">{t("common.room")}</th>
                    <th className="pb-2 font-medium">{t("admin.connectionQualityPanel.side")}</th>
                    <th className="pb-2 font-medium">{t("connectionStats.route")}</th>
                    <th className="pb-2 font-medium">{t("admin.connectionQualityPanel.picture")}</th>
                    <th className="pb-2 font-medium">{t("admin.connectionQualityPanel.device")}</th>
                    <th className="pb-2 font-medium">{t("admin.connectionQualityPanel.causes")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {data.recentBad.map((s) => (
                    <tr key={`${s.ts}-${s.roomId}-${s.senderUserId}-${s.receiverUserId}-${s.direction}`} className="align-top">
                      <td className="py-2 whitespace-nowrap text-zinc-500">{new Date(s.ts).toLocaleString()}</td>
                      <td className="py-2 max-w-[10rem] truncate">{s.roomId}</td>
                      <td className="py-2 whitespace-nowrap">
                        {directionLabel(s.direction)} · {s.channel}
                        {s.viaRelay && ` · ${t("admin.connectionQualityPanel.cascade")}`}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        {routeLabel(s.routeKind)}
                        {s.relayProtocol && ` (${s.relayProtocol.toUpperCase()})`}
                        {s.rttAvgMs != null && ` · ${s.rttAvgMs} ms`}
                      </td>
                      <td className="py-2 whitespace-nowrap font-mono">
                        {text(s.heightAvg)}p · {text(s.fpsAvg)} fps · {s.kbpsAvg != null ? (s.kbpsAvg / 1000).toFixed(1) : "—"} Mbps
                        {s.codec && ` · ${s.codec}`}
                        {s.hardware !== null && ` · ${hardwareLabel(s.hardware)}`}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        {s.device.browser} · {s.device.app}
                        {s.device.cores ? ` · ${t("connectionStats.cores", { value: s.device.cores })}` : ""}
                        {s.settings && (
                          <span className="block text-zinc-400">
                            {s.settings.resolution} {s.settings.fps}fps · {s.settings.bitrate} · {s.settings.profile}
                          </span>
                        )}
                      </td>
                      <td className="py-2">
                        {s.causes.length === 0
                          ? "—"
                          : s.causes.map((c) => (
                              <span key={c} className="block">
                                • {t(`connectionStats.cause.${c}`)}
                              </span>
                            ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

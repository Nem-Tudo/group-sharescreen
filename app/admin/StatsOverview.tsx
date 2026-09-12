"use client";

import { useEffect, useState } from "react";
import { fetchAdminStats, type AdminStats } from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";

const POLL_INTERVAL_MS = 5000;

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
    </div>
  );
}

export function StatsOverview() {
  const t = useT();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchAdminStats();
        if (!cancelled) {
          setStats(data);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.message === "unauthorized") return;
        setError(t("admin.statsOverview.couldNotLoadTheStats"));
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [t]);

  if (error) {
    return (
      <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
        {error}
      </p>
    );
  }

  if (!stats) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("admin.statsOverview.loadingStats")}</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatCard label={t("admin.statsOverview.peopleOnline")} value={stats.peopleOnline} />
      <StatCard label={t("admin.statsOverview.sharingScreen")} value={stats.sharingCount} />
      <StatCard label={t("admin.statsOverview.openConnections")} value={stats.connectedSockets} />
      <StatCard label={t("common.streamersOnline")} value={stats.streamersOnline ?? 0} />
      <StatCard label={t("admin.statsOverview.externalBroadcasts")} value={stats.externalStreams ?? 0} />
      <StatCard label={t("common.publicRooms")} value={stats.publicRooms} />
      <StatCard label={t("common.privateRooms")} value={stats.privateRooms} />
      <StatCard label={t("admin.statsOverview.bannedIps")} value={stats.bannedIps} />
      {/* "—" rather than 0 on a server that predates per-subject bans: an
          unimplemented count shown as zero reads as a real measurement. */}
      <StatCard label={t("admin.statsOverview.bannedAccounts")} value={stats.bannedAccounts ?? "—"} />
      <StatCard label={t("admin.statsOverview.bannedBrowsers")} value={stats.bannedFingerprints ?? "—"} />
      <StatCard label={t("admin.statsOverview.filteredWords")} value={stats.bannedWords} />
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t("admin.statsOverview.mongodb")}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-zinc-950 dark:text-zinc-50">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              !stats.mongo.enabled
                ? "bg-zinc-400"
                : stats.mongo.connected
                  ? "bg-emerald-500"
                  : "bg-red-500"
            }`}
          />
          {!stats.mongo.enabled ? t("admin.statsOverview.notConfigured") : stats.mongo.connected ? t("admin.statsOverview.connected") : t("admin.statsOverview.disconnected")}
        </p>
      </div>
    </div>
  );
}

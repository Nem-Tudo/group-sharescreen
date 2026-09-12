"use client";

import { useEffect, useState } from "react";
import { fetchStreamStats, type StreamStats } from "@/lib/adminApi";
import {
  ScreenIcon,
  CameraIcon,
  VideoSourceIcon,
  ObsSourceIcon,
  CheckIcon,
} from "@/components/icons";
import { copyText } from "@/lib/clipboard";
import { MdContentCopy } from "react-icons/md";
import { useT } from "@/lib/useI18n";

const POLL_INTERVAL_MS = 4000;

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

function StatCard({
  label,
  value,
  subtext,
  highlight = false,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 transition ${
        highlight
          ? "border-purple-500/30 bg-purple-500/5 dark:bg-purple-950/20"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      }`}
    >
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
      {subtext && (
        <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{subtext}</p>
      )}
    </div>
  );
}

export function StreamStatsPanel() {
  const t = useT();
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchStreamStats();
        if (!cancelled) {
          setStats(data);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.message === "unauthorized") return;
        setError(t("admin.streamStatsPanel.couldNotLoadTheBroadcastMetrics"));
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [t]);

  async function handleCopyStreamUrl(streamId: string, room: string, target: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/stream/${encodeURIComponent(room)}/${encodeURIComponent(target)}`;
    await copyText(url);
    setCopiedId(streamId);
    setTimeout(() => {
      setCopiedId((curr) => (curr === streamId ? null : curr));
    }, 2000);
  }

  if (error) {
    return (
      <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
        {error}
      </p>
    );
  }

  if (!stats) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("admin.streamStatsPanel.loadingBroadcastMetrics")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header Info */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
            <ObsSourceIcon className="h-5 w-5 text-purple-500" />
            {t("admin.streamStatsPanel.streamerModeAndBroadcastingSoftwareMetrics")}
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {t("admin.streamStatsPanel.realTimeMonitoringOfStreamersAnd")}
          </p>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={t("common.streamersOnline")}
          value={stats.streamersOnline}
          subtext={t("admin.streamStatsPanel.usersWithStreamerModeOn")}
          highlight={stats.streamersOnline > 0}
        />
        <StatCard
          label={t("admin.streamStatsPanel.roomsBroadcasting")}
          value={stats.roomsWithStreamerMode}
          subtext={t("admin.streamStatsPanel.activeRoomsWithStreamerMode")}
        />
        <StatCard
          label={t("admin.streamStatsPanel.connectedSoftware")}
          value={stats.externalStreamClients}
          subtext={t("admin.streamStatsPanel.activeObsVmixConnections")}
          highlight={stats.externalStreamClients > 0}
        />
        <StatCard
          label={t("admin.streamStatsPanel.videosOutsideGolive")}
          value={stats.activeExternalStreams}
          subtext={t("admin.streamStatsPanel.mediaStreamsBroadcasting")}
          highlight={stats.activeExternalStreams > 0}
        />
      </div>

      {/* Breakdown by Media Type */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
          {t("admin.streamStatsPanel.mediaTypesBroadcastOutside")}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800/80 dark:bg-zinc-900/50">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-500">
              <ScreenIcon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("admin.streamStatsPanel.sharedScreens")}</p>
              <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{stats.byKind.screens}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800/80 dark:bg-zinc-900/50">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
              <CameraIcon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("admin.streamStatsPanel.camerasWebcams")}</p>
              <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{stats.byKind.cameras}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800/80 dark:bg-zinc-900/50">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-500">
              <VideoSourceIcon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("admin.streamStatsPanel.mediaFiles")}</p>
              <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{stats.byKind.files}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800/80 dark:bg-zinc-900/50">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-purple-500/10 text-purple-500">
              <VideoSourceIcon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("admin.streamStatsPanel.youtubeTwitchKick")}</p>
              <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{stats.byKind.videoSources}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Active Streams Table */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
          {t("admin.streamStatsPanel.broadcastsActiveRightNow")}{stats.streams.length})
        </h3>

        {stats.streams.length === 0 ? (
          <div className="py-10 text-center text-zinc-400 dark:text-zinc-500">
            <ObsSourceIcon className="mx-auto mb-2.5 h-8 w-8 opacity-40" />
            <p className="text-sm font-medium">{t("admin.streamStatsPanel.noVideoIsBeingBroadcastOutside")}</p>
            <p className="text-xs mt-0.5">{t("admin.streamStatsPanel.asSoonAsAnObsBrowser")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-100 text-zinc-400 dark:border-zinc-800/80">
                  <th className="pb-2 font-medium">{t("common.room")}</th>
                  <th className="pb-2 font-medium">{t("admin.streamStatsPanel.mediaType")}</th>
                  <th className="pb-2 font-medium">{t("admin.streamStatsPanel.target")}</th>
                  <th className="pb-2 font-medium">{t("admin.streamStatsPanel.authorisedBy")}</th>
                  <th className="pb-2 font-medium">{t("admin.streamStatsPanel.timeConnected")}</th>
                  <th className="pb-2 font-medium text-right">{t("common.action")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                {stats.streams.map((stream) => {
                  const isCopied = copiedId === stream.id;
                  return (
                    <tr key={stream.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                      <td className="py-3 font-semibold text-zinc-900 dark:text-zinc-100">
                        {stream.room}
                      </td>
                      <td className="py-3">
                        <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 px-2 py-0.5 text-[11px] font-medium text-purple-600 dark:text-purple-400">
                          {stream.targetKind === "screen" && t("common.screen")}
                          {stream.targetKind === "camera" && t("common.camera")}
                          {stream.targetKind === "file" && t("common.file")}
                          {stream.targetKind === "video-source" && t("admin.streamStatsPanel.externalVideo")}
                          {stream.targetKind === "other" && t("common.media")}
                        </span>
                      </td>
                      <td className="py-3 font-mono text-[11px] text-zinc-600 dark:text-zinc-400 max-w-[180px] truncate">
                        {stream.target}
                      </td>
                      <td className="py-3 text-zinc-600 dark:text-zinc-300">
                        {stream.authorName ? `@${stream.authorName}` : stream.authorId ?? "—"}
                      </td>
                      <td className="py-3 text-zinc-500 dark:text-zinc-400">
                        {formatDuration(stream.connectedSeconds)}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void handleCopyStreamUrl(stream.id, stream.room, stream.target)}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition"
                          title={t("admin.streamStatsPanel.copyBroadcastRoute")}
                        >
                          {isCopied ? (
                            <>
                              <CheckIcon className="h-3 w-3 text-emerald-500" />
                              {t("common.copied")}
                            </>
                          ) : (
                            <>
                              <MdContentCopy className="h-3 w-3" />
                              {t("common.copy")}
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


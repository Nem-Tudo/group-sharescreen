"use client";

import { useCallback, useEffect, useState } from "react";
import { MdDelete } from "react-icons/md";
import { deleteAdminLogEntry, fetchAdminLog, type AdminLogEntry } from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";
import { formatLocale } from "@/lib/i18n";

// What administrators did, in the order it happened.
//
// Written by a hook on the API rather than by each route, so this is every
// mutating /admin request there is — including the ones added after the hook
// was written (see the API's index.ts). Reads are deliberately absent: "who
// opened the panel" would bury "who granted somebody a year of Pro".
//
// The delete control appears only for ADMIN_MASTER, and only because the
// server said so. That is a rendering decision, never the permission: the
// route refuses anybody else regardless of what this page draws.

function when(ts: number): string {
  try {
    return new Date(ts).toLocaleString(formatLocale(), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** Green for applied, red for refused. A refused action is still an action. */
function statusClass(status: number): string {
  if (status >= 200 && status < 300) return "text-emerald-600 dark:text-emerald-500";
  return "text-red-600 dark:text-red-400";
}

export function AdminLogPanel() {
  const t = useT();
  const [entries, setEntries] = useState<AdminLogEntry[]>([]);
  const [canDelete, setCanDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadSeq, setReloadSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchAdminLog()
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries);
        setCanDelete(data.canDelete);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadSeq]);

  const loadMore = useCallback(() => {
    const oldest = entries[entries.length - 1]?.ts;
    if (!oldest) return;
    void fetchAdminLog(oldest)
      .then((data) => setEntries((current) => [...current, ...data.entries]))
      .catch(() => undefined);
  }, [entries]);

  async function handleDelete(entry: AdminLogEntry) {
    if (busyId) return;
    if (!window.confirm(t("admin.adminLogPanel.deleteThisLogEntryThisCannot"))) return;
    setBusyId(entry.id);
    setError(null);
    try {
      await deleteAdminLogEntry(entry.id);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.adminLogPanel.couldNotDelete"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {t("admin.adminLogPanel.actionLog")}
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {t("admin.adminLogPanel.everyActionThatChangesSomethingFrom")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReloadSeq((n) => n + 1)}
          className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {t("admin.adminLogPanel.refresh")}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          {t("admin.adminLogPanel.noActionRecordedYet")}
        </p>
      ) : (
        <>
          <ul className="mt-3 flex flex-col gap-1.5">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      @{entry.adminUsername}
                    </span>
                    <span className="font-mono text-zinc-600 dark:text-zinc-400">
                      {entry.method} {entry.path}
                    </span>
                    <span className={`font-mono ${statusClass(entry.status)}`}>
                      {entry.status}
                    </span>
                  </span>
                  {entry.details && (
                    <span className="mt-0.5 block break-all font-mono text-[11px] text-zinc-500 dark:text-zinc-500">
                      {entry.details}
                    </span>
                  )}
                  <span className="mt-0.5 block text-[11px] text-zinc-400 dark:text-zinc-600">
                    {when(entry.ts)}
                    {entry.ip && ` · ${entry.ip}`}
                  </span>
                </span>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => handleDelete(entry)}
                    disabled={busyId === entry.id}
                    aria-label={t("admin.adminLogPanel.deleteEntry")}
                    className="shrink-0 rounded-lg p-1.5 text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    <MdDelete className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={loadMore}
            className="mt-3 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {t("admin.adminLogPanel.loadMore")}
          </button>
        </>
      )}
    </div>
  );
}

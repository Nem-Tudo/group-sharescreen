"use client";

import { useCallback, useEffect, useState } from "react";
import { MdRefresh } from "react-icons/md";
import { fetchDesktopUpdateClicks, launchDesktopUpdate, type DesktopUpdateClicks } from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";
import { formatLocale } from "@/lib/i18n";

// One button, for the minute right after a GitHub release goes from draft to
// published (see electron-builder.yml's `releaseType: draft` — that press is
// the real go-live moment, this one just spreads the word).
//
// It does not push a version, and it cannot make the install button appear on
// a machine that has nothing to install. All it does is collapse the six-hour
// wait until each app would have noticed on its own.
//
// Beside it, how the rollout is going: every press of the app's own install
// button is counted (see components/UpdateAppButton and the API's
// desktopUpdateClickStore.ts), and launching starts the count over — the
// number always belongs to the release being rolled out now.

/** How often the count re-reads itself while the panel is open. */
const REFRESH_MS = 15_000;

export function DesktopUpdatePanel() {
  const t = useT();
  const [launching, setLaunching] = useState(false);
  const [notified, setNotified] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clicks, setClicks] = useState<DesktopUpdateClicks | null>(null);

  const readClicks = useCallback(
    () =>
      fetchDesktopUpdateClicks()
        .then(setClicks)
        // The count is beside the button, not the button itself: failing to
        // read it must not put an error over the one control that matters.
        .catch(() => {}),
    []
  );

  useEffect(() => {
    const timer = setInterval(() => void readClicks(), REFRESH_MS);
    void readClicks();
    return () => clearInterval(timer);
  }, [readClicks]);

  async function handleLaunch() {
    if (launching) return;
    setLaunching(true);
    setError(null);
    setNotified(null);
    try {
      setNotified(await launchDesktopUpdate());
      // The launch is what zeroes the count, so it is read again at once
      // rather than waiting for the next tick to stop showing the old one.
      await readClicks();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.desktopUpdatePanel.couldNotNotify"));
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {t("admin.desktopUpdatePanel.releaseAppUpdate")}
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.desktopUpdatePanel.tellsEveryOpenAppOverWebsocket")}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleLaunch}
          disabled={launching}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {launching ? t("admin.desktopUpdatePanel.notifying") : t("admin.desktopUpdatePanel.releaseUpdate")}
        </button>
        {notified !== null && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {/* Connections, not desktop apps: the server can't tell a browser
                tab from the app — both are the same site on the same socket. */}
            {t("admin.desktopUpdatePanel.notified")} {notified} {notified === 1 ? t("admin.desktopUpdatePanel.connection") : t("admin.desktopUpdatePanel.connections")} (apps e navegadores).
          </span>
        )}
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>

      <div className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t("admin.desktopUpdatePanel.installsTitle")}
          </span>
          <button
            type="button"
            onClick={() => void readClicks()}
            aria-label={t("common.refresh")}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            <MdRefresh className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {clicks ? clicks.clicks : "—"}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {clicks?.launchedAt
            ? t("admin.desktopUpdatePanel.installsSince", {
                date: new Date(clicks.launchedAt).toLocaleString(formatLocale(), {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })
            : t("admin.desktopUpdatePanel.installsNoRollout")}
        </p>
        {/* Presses, not machines updated: the shell also installs on quit
            without anybody pressing anything, and those are invisible here. */}
        <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
          {t("admin.desktopUpdatePanel.installsHint")}
        </p>
        {clicks && clicks.byVersion.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {clicks.byVersion.map((entry) => (
              <li
                key={entry.version}
                className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 tabular-nums dark:bg-zinc-900 dark:text-zinc-300"
              >
                {entry.version}: {entry.clicks}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

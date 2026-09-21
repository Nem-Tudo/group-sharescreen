"use client";

import { useEffect, useState } from "react";
import {
  fetchAdsEnabled,
  setAdsEnabled,
  fetchBroadcastGateHours,
  setBroadcastGateHours,
  type BroadcastGateHours,
} from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";

// The Monetag switch: turns the site's ad network on and off.
//
// Live in both directions: the API pushes the new value down every open
// socket before it answers this request (see broadcastAdsConfig), so slots
// empty or appear on tabs that are already open, and it stores the value in
// the database, so a restart does not quietly turn advertising back on.
//
// What it deliberately does *not* touch is the partner ad above. Those are
// two different advertisers sharing one square in the room, and switching off
// the network that pays per impression should hand the slot back to the ad
// the room sold itself — not leave the room with no ad at all.
export function MonetagPanel() {
  const t = useT();
  // undefined = still loading the current state from the server.
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdsEnabled()
      .then((value) => {
        if (!cancelled) setEnabled(value);
      })
      .catch(() => {
        // Matches what the site itself assumes when the config cannot be
        // read (see lib/useAdsEnabled.ts): on. A panel that showed
        // "Desativado" after a failed read would be reporting a state the
        // visitors are not in.
        if (!cancelled) setEnabled(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggle() {
    if (enabled === undefined || saving) return;
    setSaving(true);
    setError(null);
    try {
      setEnabled(await setAdsEnabled(!enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.couldNotUpdate"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {t("admin.monetagPanel.title")}
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.monetagPanel.description")}
      </p>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.monetagPanel.partnerNote")}
      </p>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleToggle}
          disabled={enabled === undefined || saving}
          aria-pressed={enabled === true}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
            enabled ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
          }`}
        >
          {enabled === undefined
            ? t("common.loading2")
            : saving
              ? t("common.saving")
              : enabled
                ? t("admin.monetagPanel.enabled")
                : t("admin.monetagPanel.disabled")}
        </button>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>

      <BroadcastGatePanel adsEnabled={enabled} />
    </div>
  );
}

/**
 * The two dials behind the ad gate on long broadcasts (see the site's
 * lib/broadcastAdGate.ts).
 *
 * Inside the Monetag card rather than in a card of its own: it is the same
 * document, the same route, and the same question — how much advertising does
 * somebody who is not paying see. Two panels for one answer is how the two
 * drift apart in somebody's head.
 *
 * Saved together and only on a press, unlike the switch above. The switch is
 * an emergency control and wants one click; these are numbers being typed,
 * and a field that saved on every keystroke would push a gate at "2" on the
 * way to typing "20".
 */
function BroadcastGatePanel({ adsEnabled }: { adsEnabled: boolean | undefined }) {
  const t = useT();
  const [hours, setHours] = useState<BroadcastGateHours | null>(null);
  const [first, setFirst] = useState("");
  const [interval, setIntervalValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBroadcastGateHours()
      .then((value) => {
        if (cancelled) return;
        setHours(value);
        setFirst(String(value.firstHours));
        setIntervalValue(String(value.intervalHours));
      })
      .catch(() => {
        // Left blank rather than filled with a guess: a number in these boxes
        // is read as what the site is doing, and inventing one here would be
        // the panel lying about the live configuration.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    if (saving || adsEnabled === undefined) return;
    const firstHours = Number(first.replace(",", "."));
    const intervalHours = Number(interval.replace(",", "."));
    if (!Number.isFinite(firstHours) || !Number.isFinite(intervalHours) || firstHours < 0 || intervalHours < 0) {
      setError(t("common.couldNotUpdate"));
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await setBroadcastGateHours(adsEnabled, { firstHours, intervalHours });
      setHours(next);
      setFirst(String(next.firstHours));
      setIntervalValue(String(next.intervalHours));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.couldNotUpdate"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {t("admin.monetagPanel.gateTitle")}
      </h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.monetagPanel.gateDescription")}
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("admin.monetagPanel.gateFirstHours")}
          </span>
          <input
            type="number"
            min={0}
            step="0.5"
            value={first}
            onChange={(e) => {
              setFirst(e.target.value);
              setSaved(false);
            }}
            className="w-32 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("admin.monetagPanel.gateIntervalHours")}
          </span>
          <input
            type="number"
            min={0}
            step="0.5"
            value={interval}
            onChange={(e) => {
              setIntervalValue(e.target.value);
              setSaved(false);
            }}
            className="w-32 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
          />
        </label>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || hours === null || adsEnabled === undefined}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {saving ? t("common.saving") : t("admin.monetagPanel.gateSave")}
        </button>
        {saved && (
          <span className="text-sm text-emerald-500">{t("admin.monetagPanel.gateSaved")}</span>
        )}
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    </div>
  );
}

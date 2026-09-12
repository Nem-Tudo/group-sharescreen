"use client";

import { useEffect, useState } from "react";
import { fetchAntiSpamEnabled, setAntiSpamEnabled } from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";

export function AntiSpamPanel() {
  const t = useT();
  // undefined = still loading the current state from the server.
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAntiSpamEnabled()
      .then((value) => {
        if (!cancelled) setEnabled(value);
      })
      .catch(() => {
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
      const next = await setAntiSpamEnabled(!enabled);
      setEnabled(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.couldNotUpdate"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.antiSpamPanel.automaticAntispam")}</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.antiSpamPanel.automaticallyBansFor60MinutesAny")}
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
                ? t("common.on")
                : t("common.off")}
        </button>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    </div>
  );
}

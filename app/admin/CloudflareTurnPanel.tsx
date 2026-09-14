"use client";

import { useEffect, useState } from "react";
import { fetchCloudflareTurn, setCloudflareTurnEnabled, type CloudflareTurnSetting } from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";

// The switch for Cloudflare's TURN (see the API's cloudflareTurn.ts). Same
// shape as AntiSpamPanel: one button that shows the state and flips it.
export function CloudflareTurnPanel() {
  const t = useT();
  // undefined = still loading the current state from the server.
  const [setting, setSetting] = useState<CloudflareTurnSetting | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCloudflareTurn()
      .then((value) => {
        if (!cancelled) setSetting(value);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("common.couldNotUpdate"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function handleToggle() {
    if (!setting || saving) return;
    setSaving(true);
    setError(null);
    try {
      setSetting(await setCloudflareTurnEnabled(!setting.enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.couldNotUpdate"));
    } finally {
      setSaving(false);
    }
  }

  const enabled = setting?.enabled;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {t("admin.cloudflareTurnPanel.title")}
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.cloudflareTurnPanel.description")}</p>
      {setting && !setting.configured && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
          {t("admin.cloudflareTurnPanel.notConfigured")}
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleToggle}
          disabled={!setting || saving}
          aria-pressed={enabled === true}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
            enabled ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
          }`}
        >
          {!setting ? t("common.loading2") : saving ? t("common.saving") : enabled ? t("common.on") : t("common.off")}
        </button>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    </div>
  );
}

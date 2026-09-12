"use client";

import { useEffect, useState, type FormEvent } from "react";
import { fetchAdminSupporters, setSupporters, type Supporter } from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";

function supportersToText(supporters: Supporter[]): string {
  return supporters.map((s) => `${s.name},${s.amount}`).join("\n");
}

// Parses "Nome,Valor" per line — throws with a line-specific message on the
// first bad line, so the admin knows exactly what to fix instead of a
// generic "invalid list" from the server's own validation.
function parseSupportersText(text: string): Supporter[] {
  const parsed: Supporter[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  for (const line of lines) {
    const commaIndex = line.lastIndexOf(",");
    if (commaIndex === -1) {
      throw new Error(translate("admin.supportersPanel.invalidLineUseNameValueLine", { line }));
    }
    const name = line.slice(0, commaIndex).trim();
    const amount = Number(line.slice(commaIndex + 1).trim());
    if (!name || !Number.isFinite(amount) || amount < 0) {
      throw new Error(translate("admin.supportersPanel.invalidLineUseNameValueLine", { line }));
    }
    parsed.push({ name, amount });
  }
  return parsed;
}

export function SupportersPanel() {
  const t = useT();
  // undefined = still loading the current list from the server.
  const [text, setText] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdminSupporters()
      .then((list) => {
        if (!cancelled) setText(supportersToText(list));
      })
      .catch(() => {
        if (!cancelled) setText("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const list = parseSupportersText(text ?? "");
      const saved = await setSupporters(list);
      setText(supportersToText(saved));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.couldNotSaveTheList"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.supportersPanel.supporters")}</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.supportersPanel.oneSupporterPerLineInThe")} <span className="font-mono">{t("admin.supportersPanel.nameValue")}</span>{t("admin.supportersPanel.shownOnTheSupportTheProject")}
      </p>

      <form onSubmit={handleSave} className="mt-3 flex flex-col gap-2">
        <textarea
          value={text ?? ""}
          onChange={(e) => setText(e.target.value)}
          disabled={text === undefined}
          rows={8}
          placeholder={t("admin.supportersPanel.exMaria50John2550")}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-950 outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || text === undefined}
            className="self-start rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {saving ? t("common.saving") : t("common.saveList")}
          </button>
          {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">{t("common.saved")}</span>}
        </div>
      </form>
    </div>
  );
}

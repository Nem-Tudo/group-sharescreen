"use client";

import { useEffect, useState, type FormEvent } from "react";
import { fetchBannedWords, setBannedWords } from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";

export function BannedWordsPanel() {
  const t = useT();
  // undefined = still loading the current list from the server.
  const [words, setWords] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBannedWords()
      .then((list) => {
        if (!cancelled) setWords(list.join("\n"));
      })
      .catch(() => {
        if (!cancelled) setWords("");
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
      const list = (words ?? "")
        .split("\n")
        .map((w) => w.trim())
        .filter((w) => w.length > 0);
      const saved = await setBannedWords(list);
      setWords(saved.join("\n"));
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
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.bannedWordsPanel.chatFilter")}</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.bannedWordsPanel.oneWordOrExpressionPerLine")}
      </p>

      <form onSubmit={handleSave} className="mt-3 flex flex-col gap-2">
        <textarea
          value={words ?? ""}
          onChange={(e) => setWords(e.target.value)}
          disabled={words === undefined}
          rows={6}
          placeholder={t("admin.bannedWordsPanel.exSwearwordAnotherExpression")}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-950 outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || words === undefined}
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

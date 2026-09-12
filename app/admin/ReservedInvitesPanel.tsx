"use client";

import { useEffect, useState, type FormEvent } from "react";
import { fetchReservedInvites, setReservedInvites } from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";

// The names no group may take as its custom invite link (/invite/<nome>) — so
// a link can never pass for the site's own. Kept in the database by the API
// (see its reservedInvites.ts) and read every time a link is set, so a change
// here holds at once. Whoever carries GROUP_SET_RESERVED_CUSTOM_INVITES may
// still set these names on a group they run.

export function ReservedInvitesPanel() {
  const t = useT();
  // undefined = still loading the current list from the server.
  const [names, setNames] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchReservedInvites()
      .then((list) => {
        if (!cancelled) setNames(list.join("\n"));
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setNames("");
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
      const list = (names ?? "")
        .split("\n")
        .map((n) => n.trim())
        .filter((n) => n.length > 0);
      // What comes back is what was stored: lowercased, sorted, and without
      // anything that could never be a link.
      const stored = await setReservedInvites(list);
      setNames(stored.join("\n"));
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
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.reservedInvitesPanel.reservedInvites")}</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.reservedInvitesPanel.oneNamePerLineNoGroup")}
        <span className="font-mono">/invite/nome</span>{t("admin.reservedInvitesPanel.exceptWhoeverHasTheFlag")}{" "}
        <span className="font-mono">GROUP_SET_RESERVED_CUSTOM_INVITES</span>{t("admin.reservedInvitesPanel.inAGroupTheyAdministerA")}
      </p>

      <form onSubmit={handleSave} className="mt-3 flex flex-col gap-2">
        <textarea
          value={names ?? ""}
          onChange={(e) => setNames(e.target.value)}
          disabled={names === undefined}
          rows={8}
          placeholder={t("admin.reservedInvitesPanel.exGoliveSupport")}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-950 outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || names === undefined}
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

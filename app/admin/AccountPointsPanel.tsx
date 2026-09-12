"use client";

import { useEffect, useState } from "react";
import {
  searchAdminAccounts,
  setAccountPoints,
  type AdminAccountHit,
  type PointsMode,
} from "@/lib/adminApi";
import { useI18n } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";

// Changing somebody's points.
//
// Three operations rather than one editable total, and that is the whole
// design: "definir" answers a different question from "adicionar", and only
// one of them is dangerous to get wrong. Typing a new total by hand silently
// erases anything the account earned between the search and the save, which
// on a live site is a real amount of somebody's time. Increments do not have
// that problem, which is why adding is the default here.

const MODES: { id: PointsMode; label: string; verb: string }[] = [
  { id: "add", get label() { return translate("common.add"); }, get verb() { return translate("common.add"); } },
  { id: "remove", get label() { return translate("common.remove"); }, get verb() { return translate("common.remove"); } },
  { id: "set", get label() { return translate("admin.accountPointsPanel.set"); }, get verb() { return translate("admin.accountPointsPanel.setTo"); } },
];

export function AccountPointsPanel() {
  const { t, tc } = useI18n();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AdminAccountHit[]>([]);
  const [selected, setSelected] = useState<AdminAccountHit | null>(null);
  const [mode, setMode] = useState<PointsMode>("add");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchAdminAccounts(query)
        .then((data) => {
          // Two searches in flight can land out of order; the effect is keyed
          // on the query, so a stale answer belongs to one already torn down.
          if (!cancelled) setHits(data.accounts);
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function pick(account: AdminAccountHit) {
    setSelected(account);
    setError(null);
    setDone(null);
  }

  const parsed = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isInteger(parsed) && parsed >= 0;

  async function handleSave() {
    if (!selected || busy || !validAmount) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const total = await setAccountPoints(selected.id, mode, parsed);
      // The server's answer, never a total computed here: it is the one that
      // accounts for anything that changed while this form was open.
      setSelected({ ...selected, points: total });
      setHits((current) =>
        current.map((hit) => (hit.id === selected.id ? { ...hit, points: total } : hit))
      );
      setAmount("");
      setDone(t("admin.accountPointsPanel.newTotalTotalPoints", { total }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.couldNotSave"));
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("common.points")}</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.accountPointsPanel.findSomeoneAndAdjustTheirPoints")}
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <label
            htmlFor="points-search"
            className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            {t("common.person")}
          </label>
          <input
            id="points-search"
            value={selected ? `${selected.displayName} (@${selected.username})` : query}
            onChange={(e) => {
              setSelected(null);
              setQuery(e.target.value);
            }}
            placeholder={t("common.nameOrUsername")}
            className={inputClass}
          />
          {!selected && hits.length > 0 && (
            <ul className="mt-1 flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-lg border border-zinc-200 p-1 dark:border-zinc-800">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => pick(hit)}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  >
                    <span className="block truncate text-zinc-900 dark:text-zinc-100">
                      {hit.displayName}
                    </span>
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      @{hit.username} · {tc("common.pointsCount", hit.points)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!selected && query.trim().length >= 2 && hits.length === 0 && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("common.nobodyFound")}</p>
          )}
        </div>

        {selected && (
          <>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {t("admin.accountPointsPanel.currentBalance")}{" "}
              <span className="font-semibold text-zinc-950 dark:text-zinc-50">
                {selected.points}
              </span>{" "}
              {t("common.pointsNoun")}
            </p>

            <div className="flex flex-wrap gap-2">
              {MODES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setMode(option.id)}
                  aria-pressed={mode === option.id}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    mode === option.id
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div>
              <label
                htmlFor="points-amount"
                className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
              >
                {MODES.find((option) => option.id === mode)?.verb}
              </label>
              <input
                id="points-amount"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className={inputClass}
              />
              {mode === "remove" && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {/* Said before the save rather than discovered after it. */}
                  {t("admin.accountPointsPanel.removingMoreThanThePersonHas")}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={busy || !validAmount}
                className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {busy ? t("common.saving") : t("admin.accountPointsPanel.apply")}
              </button>
              {done && (
                <span className="text-sm text-emerald-600 dark:text-emerald-500">{done}</span>
              )}
              {error && <span className="text-sm text-red-500">{error}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

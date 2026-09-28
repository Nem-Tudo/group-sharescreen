"use client";

import { useEffect, useState } from "react";
import {
  searchAdminAccounts,
  setAccountUsername,
  type AdminAccountHit,
} from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";

// Renaming somebody's @username.
//
// Looser than the person's own form, and that is why it exists: an
// administrator can hand out a handle as short as one character (the site asks
// for three), without the weekly limit and without spending the person's own
// changes. Everything else is the same rename — unique, and the old name is
// released at once. The rules live on the API (changeAccountUsername's
// byAdmin); the check here only saves a round trip.

const ADMIN_USERNAME_RE = /^[a-zA-Z0-9_]{1,20}$/;
const BOT_SUFFIX = "_bot";

export function AccountUsernamePanel() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AdminAccountHit[]>([]);
  const [selected, setSelected] = useState<AdminAccountHit | null>(null);
  const [draft, setDraft] = useState("");
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
    setDraft(account.username);
    setError(null);
    setDone(null);
  }

  const trimmed = draft.trim();
  // A bot keeps its suffix whatever is typed (see the API's botUsernameFor).
  const isBot = Boolean(selected?.username.endsWith(BOT_SUFFIX));
  const valid = ADMIN_USERNAME_RE.test(trimmed);
  const unchanged = trimmed === selected?.username;

  async function handleSave() {
    if (!selected || busy || !valid || unchanged) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const saved = await setAccountUsername(selected.id, trimmed);
      setSelected({ ...selected, username: saved });
      setDraft(saved);
      setHits((current) =>
        current.map((hit) => (hit.id === selected.id ? { ...hit, username: saved } : hit))
      );
      setDone(t("admin.accountUsernamePanel.nowValue", { value: saved }));
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
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {t("admin.accountUsernamePanel.title")}
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.accountUsernamePanel.description")}
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <label
            htmlFor="username-search"
            className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            {t("common.person")}
          </label>
          <input
            id="username-search"
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
                      @{hit.username}
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
            <div>
              <label
                htmlFor="username-value"
                className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
              >
                {t("admin.accountUsernamePanel.newUsername")}
              </label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-zinc-500 dark:text-zinc-400">@</span>
                <input
                  id="username-value"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setDone(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSave();
                    }
                  }}
                  maxLength={20}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="off"
                  className={`${inputClass} font-mono`}
                />
              </div>
              {trimmed !== "" && !valid && (
                <p className="mt-1 text-xs text-red-500">{t("admin.accountUsernamePanel.invalid")}</p>
              )}
              {isBot && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {t("admin.accountUsernamePanel.botNote")}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={busy || !valid || unchanged}
                className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {busy ? t("common.saving") : t("admin.accountUsernamePanel.rename")}
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

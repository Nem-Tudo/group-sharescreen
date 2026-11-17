"use client";

import { useEffect, useState } from "react";
import {
  createPasswordResetLink,
  searchAdminAccounts,
  type AdminAccountHit,
} from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";

// "Gerar link de nova senha": pick an account, get a link, send it to the
// person. Whoever opens it sets that account's password — logged in or not —
// so the link is as good as the account itself. One use, 24 hours, and
// generating another kills the previous one (which is also how to revoke a
// link sent to the wrong place). The rules live on the API
// (passwordResetLinkRoutes.ts); an administrator's account needs ADMIN_MASTER.

type Generated = { accountId: string; username: string; url: string; expiresAt: number };

export function AccountPasswordResetPanel() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AdminAccountHit[]>([]);
  const [selected, setSelected] = useState<AdminAccountHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchAdminAccounts(query)
        .then((data) => {
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
    setGenerated(null);
    setCopied(false);
  }

  async function handleGenerate() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const { token, expiresAt } = await createPasswordResetLink(selected.id);
      setGenerated({
        accountId: selected.id,
        username: selected.username,
        url: `${window.location.origin}/reset-password/${token}`,
        expiresAt,
      });
    } catch (err) {
      setGenerated(null);
      setError(err instanceof Error ? err.message : t("common.couldNotSave"));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.url);
      setCopied(true);
    } catch {
      // Clipboard refused (permissions, insecure context): the box is
      // selectable, so copying by hand still works.
    }
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
  const isAdminAccount = Boolean(selected?.flags.includes("ADMIN"));
  const isBot = Boolean(selected?.flags.includes("BOT") || selected?.username.endsWith("_bot"));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {t("admin.passwordResetPanel.title")}
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.passwordResetPanel.description")}
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <label
            htmlFor="password-reset-search"
            className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            {t("common.person")}
          </label>
          <input
            id="password-reset-search"
            value={selected ? `${selected.displayName} (@${selected.username})` : query}
            onChange={(e) => {
              setSelected(null);
              setGenerated(null);
              setQuery(e.target.value);
            }}
            placeholder={t("common.nameOrUsername")}
            autoComplete="off"
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
            {isAdminAccount && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                {t("admin.passwordResetPanel.adminNote")}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={busy || isBot}
                className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {busy
                  ? t("admin.passwordResetPanel.generating")
                  : generated
                    ? t("admin.passwordResetPanel.generateAgain")
                    : t("admin.passwordResetPanel.generate")}
              </button>
              {isBot && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t("admin.passwordResetPanel.botNote")}
                </span>
              )}
              {error && <span className="text-sm text-red-500">{error}</span>}
            </div>

            {generated && generated.accountId === selected.id && (
              <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={generated.url}
                    onFocus={(e) => e.currentTarget.select()}
                    spellCheck={false}
                    className={`${inputClass} font-mono text-xs`}
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    {copied ? t("common.copied") : t("common.copy")}
                  </button>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t("admin.passwordResetPanel.linkNote", {
                    username: generated.username,
                    time: new Date(generated.expiresAt).toLocaleString(),
                  })}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

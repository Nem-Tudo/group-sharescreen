"use client";

import { useEffect, useState } from "react";
import {
  searchAdminAccounts,
  setAccountFlags,
  type AdminAccountHit,
} from "@/lib/adminApi";

// Editing what an account is allowed to be.
//
// A text field of comma-separated flags rather than a list of checkboxes, and
// that is a deliberate trade: flags are open-ended — they are added by whoever
// needs one, and a fixed set of checkboxes here would be a second list to keep
// in step with the code that reads them. What it costs is typo-safety, which
// the server buys back by validating every entry.
//
// Two flags are special, and the panel says so rather than hiding it: ADMIN
// and ADMIN_MASTER can only be changed by an ADMIN_MASTER — in *either*
// direction. Being able only to grant would still leave a screen where any
// administrator can demote every other one.

/** Shown under the field so the vocabulary is not folklore. */
const KNOWN_FLAGS = [
  "ADMIN",
  "ADMIN_MASTER",
  "VERIFIED",
  "STAFF",
  "BUG_HUNTER",
  "CONTRIBUITOR",
  "BETA_MOBILE",
  "BETA_TESTER",
  // Editable here like any other, but the panel next door is the place to
  // set it: that one records who did it and shows the themes it was about.
  "THEME_BANNED",
];
const RESTRICTED = ["ADMIN", "ADMIN_MASTER"];

export function AccountFlagsPanel() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AdminAccountHit[]>([]);
  const [canEditAdminFlags, setCanEditAdminFlags] = useState(false);
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
          if (cancelled) return;
          setHits(data.accounts);
          setCanEditAdminFlags(data.canEditAdminFlags);
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
    // Exactly what is stored, in the order it is stored. Round-tripping the
    // list unchanged has to be a no-op, or "I only added one flag" would
    // quietly reorder or drop the others.
    setDraft(account.flags.join(","));
    setError(null);
    setDone(null);
  }

  async function handleSave() {
    if (!selected || busy) return;
    const flags = draft
      .split(",")
      .map((flag) => flag.trim().toUpperCase())
      .filter(Boolean);
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const saved = await setAccountFlags(selected.id, flags);
      setSelected({ ...selected, flags: saved });
      setDraft(saved.join(","));
      setHits((current) =>
        current.map((hit) => (hit.id === selected.id ? { ...hit, flags: saved } : hit))
      );
      setDone("Flags salvas.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Flags da conta</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Procure alguém e edite as flags separadas por vírgula.{" "}
        {canEditAdminFlags
          ? "Como ADMIN_MASTER, você pode alterar qualquer flag, inclusive ADMIN e ADMIN_MASTER."
          : "ADMIN e ADMIN_MASTER só podem ser alteradas por um ADMIN_MASTER — dar ou tirar."}
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <label
            htmlFor="flags-search"
            className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Pessoa
          </label>
          <input
            id="flags-search"
            value={selected ? `${selected.displayName} (@${selected.username})` : query}
            onChange={(e) => {
              setSelected(null);
              setQuery(e.target.value);
            }}
            placeholder="Nome ou @usuário"
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
                      {hit.flags.length > 0 && ` · ${hit.flags.join(", ")}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!selected && query.trim().length >= 2 && hits.length === 0 && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Ninguém encontrado.</p>
          )}
        </div>

        {selected && (
          <div>
            <label
              htmlFor="flags-value"
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Flags
            </label>
            <input
              id="flags-value"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="ADMIN,VERIFIED"
              spellCheck={false}
              autoCapitalize="characters"
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Conhecidas: {KNOWN_FLAGS.join(", ")}.{" "}
              {!canEditAdminFlags && `Você não pode mexer em ${RESTRICTED.join(" nem ")}.`}
            </p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">
              {/* Said plainly because the field would otherwise seem to be
                  missing one: PRO is not stored, it is derived from a paying
                  subscription on every read (see the API's toPublicAccount). */}
              PRO não aparece aqui: ela é derivada da assinatura ativa, não guardada na conta.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={busy || draft === selected.flags.join(",")}
                className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {busy ? "Salvando..." : "Salvar"}
              </button>
              <button
                type="button"
                onClick={() => setDraft(selected.flags.join(","))}
                disabled={busy || draft === selected.flags.join(",")}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Desfazer
              </button>
              {done && (
                <span className="text-sm text-emerald-600 dark:text-emerald-500">{done}</span>
              )}
              {error && <span className="text-sm text-red-500">{error}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

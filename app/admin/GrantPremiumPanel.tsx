"use client";

import { useEffect, useState } from "react";
import {
  fetchAdminPlans,
  grantPremium,
  revokePremiumGrant,
  searchAdminAccounts,
  type AdminAccountHit,
  type AdminPlanOption,
} from "@/lib/adminApi";
import { useI18n } from "@/lib/useI18n";
import { formatLocale } from "@/lib/i18n";

// Comping somebody a plan.
//
// Three fields, in the order the decision is actually made: who, which plan,
// how long. The person is picked first because everything else is meaningless
// without one, and because it is the only field that can fail to match.
//
// Grants *extend* rather than replace — somebody with a week left who is
// comped thirty days ends up with thirty-seven. The API does that (see its
// grant route); it is repeated in the copy here so nobody has to guess.

const DEFAULT_DAYS = 30;
/** The handful of lengths actually used, plus a way out for anything else. */
const DAY_PRESETS = [7, 15, 30, 90, 365];

function endLabel(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleDateString(formatLocale(), {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function GrantPremiumPanel() {
  const { t, tc } = useI18n();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<(AdminAccountHit & { active: boolean })[]>([]);
  const [selected, setSelected] = useState<AdminAccountHit | null>(null);
  const [plans, setPlans] = useState<AdminPlanOption[]>([]);
  const [planId, setPlanId] = useState("");
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Bumped after a grant so the selected person's row is re-read, and the
  // panel shows the date it actually landed on rather than the one before.
  const [refreshSeq, setRefreshSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchAdminPlans()
      .then((loaded) => {
        if (cancelled) return;
        setPlans(loaded);
        setPlanId((current) => current || loaded[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) setError(t("common.couldNotLoadThePlans"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  // Debounced, because this runs per keystroke and the answer for a
  // half-typed name is never the one being looked for.
  useEffect(() => {
    if (query.trim().length < 2) return;
    // Cancelled on cleanup rather than compared against a ref: the effect is
    // keyed on the query, so a stale answer belongs to an effect that has
    // already been torn down. Two searches in flight can land out of order.
    let cancelled = false;
    const timer = setTimeout(() => {
      searchAdminAccounts(query)
        .then(({ accounts: found }) => {
          if (cancelled) return;
          // "Is this access live" is decided here, once, rather than in the
          // render — a clock read while rendering is a value React cannot
          // know changed.
          const now = Date.now();
          setHits(
            found.map((hit) => ({
              ...hit,
              active: Boolean(hit.premium && hit.premium.currentPeriodEnd > now),
            }))
          );
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, refreshSeq]);

  async function handleGrant() {
    if (!selected || !planId || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await grantPremium(selected.id, planId, days);
      setDone(`${days} dias concedidos a ${selected.displayName}.`);
      setRefreshSeq((n) => n + 1);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.grantPremiumPanel.couldNotGrant"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(account: AdminAccountHit) {
    if (busy) return;
    if (!window.confirm(t("admin.grantPremiumPanel.endDisplaynameSAccessNow", { displayName: account.displayName }))) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await revokePremiumGrant(account.id);
      setDone(t("admin.grantPremiumPanel.displaynameSAccessEnded", { displayName: account.displayName }));
      setRefreshSeq((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.grantPremiumPanel.couldNotEnd"));
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {t("admin.grantPremiumPanel.grantPlan")}
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.grantPremiumPanel.givesSomeoneAccessWithNoCharge")}
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <label
            htmlFor="grant-search"
            className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            {t("common.person")}
          </label>
          <input
            id="grant-search"
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
              {hits.map((hit) => {
                const active = hit.active;
                return (
                  <li key={hit.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelected(hit)}
                      className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    >
                      <span className="block truncate text-zinc-900 dark:text-zinc-100">
                        {hit.displayName}
                      </span>
                      <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                        @{hit.username}
                        {active && t("admin.grantPremiumPanel.activeUntilValue", { value: endLabel(hit.premium!.currentPeriodEnd) })}
                        {active && hit.premium?.method === "admin" && " · concedido"}
                      </span>
                    </button>
                    {active && hit.premium?.method === "admin" && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(hit)}
                        disabled={busy}
                        className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        {t("admin.grantPremiumPanel.end")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {!selected && query.trim().length >= 2 && hits.length === 0 && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("common.nobodyFound")}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="min-w-40 flex-1">
            <label
              htmlFor="grant-plan"
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              {t("common.plan")}
            </label>
            <select
              id="grant-plan"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className={inputClass}
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.title} ({plan.priceLabel}){plan.active ? "" : t("common.notForSale")}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-40 flex-1">
            <label
              htmlFor="grant-days"
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              {t("common.duration")}
            </label>
            <div className="flex gap-2">
              <select
                id="grant-days"
                value={DAY_PRESETS.includes(days) ? String(days) : "custom"}
                onChange={(e) => {
                  if (e.target.value === "custom") return;
                  setDays(Number(e.target.value));
                }}
                className={inputClass}
              >
                {DAY_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {tc("common.dayCount", preset)}
                  </option>
                ))}
                <option value="custom">{t("common.other")}</option>
              </select>
              <input
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                aria-label={t("common.days")}
                className={`${inputClass} w-24`}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleGrant}
            disabled={!selected || !planId || busy || days < 1}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("admin.grantPremiumPanel.granting") : t("admin.grantPremiumPanel.grant")}
          </button>
          {done && <span className="text-sm text-emerald-600 dark:text-emerald-500">{done}</span>}
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
      </div>
    </div>
  );
}

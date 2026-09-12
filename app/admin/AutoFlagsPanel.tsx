"use client";

import { useEffect, useState } from "react";
import { MdDelete, MdPlayArrow } from "react-icons/md";
import {
  createAutoFlagRule,
  deleteAutoFlagRule,
  fetchAdminPlans,
  fetchAutoFlagRules,
  runAutoFlagRules,
  setAutoFlagRuleEnabled,
  type AdminPlanOption,
  type AutoFlagRule,
} from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";
import { formatLocale } from "@/lib/i18n";

// Flags handed out by a rule instead of by hand.
//
// Two conditions today — signed up in a window, subscribed in a window — which
// is what Beta Tester and Apoiador Inicial need. Neither is written into the
// code, because the next one will not be either: a rule is a row.
//
// The panel is deliberate about one thing, and it is the thing that surprises
// people: a rule *grants*. Switching it off or deleting it stops new grants
// and takes nothing back, because "you were here early" is a fact about the
// past. Undoing one account is the flag editor's job, above.

function when(ms: number | null): string {
  if (ms === null) return "sem limite";
  try {
    return new Date(ms).toLocaleDateString(formatLocale(), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

/** A rule read back as the sentence it is. */
function describe(rule: AutoFlagRule, plans: AdminPlanOption[]): string {
  const plan =
    rule.kind === "subscription"
      ? rule.planId
        ? `assinou ${plans.find((p) => p.id === rule.planId)?.title ?? rule.planId}`
        : "assinou qualquer plano"
      : "criou a conta";
  if (rule.from !== null && rule.to !== null) {
    return translate("admin.autoFlagsPanel.whoeverPlanBetweenValueAndValue2", { plan, value: when(rule.from), value2: when(rule.to) });
  }
  if (rule.to !== null) return translate("admin.autoFlagsPanel.whoeverPlanBeforeValue", { plan, value: when(rule.to) });
  return translate("admin.autoFlagsPanel.whoeverPlanFromValueOn", { plan, value: when(rule.from) });
}

export function AutoFlagsPanel() {
  const t = useT();
  const [rules, setRules] = useState<AutoFlagRule[]>([]);
  const [plans, setPlans] = useState<AdminPlanOption[]>([]);
  const [kind, setKind] = useState<"signup" | "subscription">("signup");
  const [planId, setPlanId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [flag, setFlag] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAutoFlagRules()
      .then((loaded) => {
        if (!cancelled) setRules(loaded);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    void fetchAdminPlans()
      .then((loaded) => {
        if (!cancelled) setPlans(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const rule = await createAutoFlagRule({
        label: label.trim(),
        kind,
        planId: kind === "subscription" && planId ? planId : null,
        // The date inputs give a day; the window has to mean the whole of it,
        // so the end is midnight of the following day — an end of "18/09"
        // that stopped at 00:00 would quietly exclude the 18th.
        from: from ? `${from}T00:00:00-03:00` : null,
        to: to ? `${to}T23:59:59-03:00` : null,
        flag: flag.trim().toUpperCase(),
      });
      setRules((current) => [rule, ...current]);
      setFlag("");
      setLabel("");
      setDone(t("admin.autoFlagsPanel.ruleCreatedUseApplyNowTo"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.autoFlagsPanel.couldNotCreateTheRule"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRun() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await runAutoFlagRules();
      setDone(
        result.grants === 0
          ? t("admin.autoFlagsPanel.noNewAccountMatchedTheRules")
          : `${result.grants} flag(s) dada(s) para ${result.accounts} conta(s).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.autoFlagsPanel.couldNotApply"));
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {t("admin.autoFlagsPanel.automaticFlags")}
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {t("admin.autoFlagsPanel.theyGrantAFlagOnTheir")}{" "}
            <span className="font-medium">concede</span>{t("admin.autoFlagsPanel.turningItOffOrDeletingIt")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleRun}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <MdPlayArrow className="h-4 w-4" />
          {t("admin.autoFlagsPanel.applyNow")}
        </button>
      </div>

      {/* Creating one */}
      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "signup", label: t("admin.autoFlagsPanel.createdTheAccount") },
              { id: "subscription", label: t("admin.autoFlagsPanel.subscribedToAPlan") },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setKind(option.id)}
              aria-pressed={kind === option.id}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                kind === option.id
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {kind === "subscription" && (
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t("common.plan")}
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className={inputClass}
            >
              {/* Any plan first, because it is the question these rules
                  usually ask — and naming every plan to express it would
                  break the day one is added. */}
              <option value="">{t("admin.autoFlagsPanel.anyPlan")}</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t("admin.autoFlagsPanel.fromOptional")}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t("admin.autoFlagsPanel.toOptional")}
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t("admin.autoFlagsPanel.flag")}
            <input
              value={flag}
              onChange={(e) => setFlag(e.target.value)}
              placeholder="EARLY_SUPPORTER"
              spellCheck={false}
              autoCapitalize="characters"
              className={`${inputClass} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t("admin.autoFlagsPanel.nameJustForYou")}
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("admin.autoFlagsPanel.earlySupporters")}
              className={inputClass}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !flag.trim() || (!from && !to)}
            className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {busy ? t("common.saving") : t("admin.autoFlagsPanel.createRule")}
          </button>
          {done && <span className="text-sm text-emerald-600 dark:text-emerald-500">{done}</span>}
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
      </div>

      {/* The rules there are */}
      {rules.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{t("admin.autoFlagsPanel.noRulesYet")}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-start gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 text-xs dark:border-zinc-800"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                    {rule.flag}
                  </span>
                  {rule.label && (
                    <span className="text-zinc-500 dark:text-zinc-400">{rule.label}</span>
                  )}
                  {!rule.enabled && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-900">
                      desligada
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">
                  {describe(rule, plans)}
                </span>
              </span>
              <button
                type="button"
                onClick={() =>
                  void setAutoFlagRuleEnabled(rule.id, !rule.enabled).then(setRules).catch(() => undefined)
                }
                className="shrink-0 rounded-lg border border-zinc-300 px-2 py-1 font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {rule.enabled ? t("admin.autoFlagsPanel.turnOff") : t("common.turnOn")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(t("admin.autoFlagsPanel.deleteTheRuleWhoeverAlreadyGot")))
                    return;
                  void deleteAutoFlagRule(rule.id).then(setRules).catch(() => undefined);
                }}
                aria-label={t("admin.autoFlagsPanel.deleteRule")}
                className="shrink-0 rounded-lg p-1.5 text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <MdDelete className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

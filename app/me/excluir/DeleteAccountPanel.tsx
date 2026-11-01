"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { useAuth } from "@/lib/AuthContext";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { ACCOUNT_DELETE_EVENTS, ACCOUNT_DELETE_FEATURE, deleteOwnAccount } from "@/lib/accountDelete";
import { useT } from "@/lib/useI18n";

// Deleting your own account: sign in again, read what it means, type the
// username, delete.
//
// Shaped like /pro/cancelar, and for the same reason: the API refuses to
// delete on a session that did not sign in within the last few minutes (see
// its requireRecentAuth), so the page asks for the sign-in first instead of
// letting somebody confirm and then be refused. Typing the username back is
// the second guard — a button alone is one misclick from the end of an
// account that cannot be brought back.
//
// What the API refuses on (a group still owned, a card still charging) is
// shown as the way out of it, not as an error: the groups to hand over, the
// cancellation page.

type Step = "login" | "confirm" | "done";

const card =
  "rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950 sm:p-8";
const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const dangerButton =
  "flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton =
  "rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

export function DeleteAccountPanel() {
  const t = useT();
  const router = useRouter();
  const { account, loading, logout } = useAuth();
  // Not counted as an exposure: the row on /me is where it is offered.
  const feature = useFeature(ACCOUNT_DELETE_FEATURE, { track: false });
  const [step, setStep] = useState<Step>("login");
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<{ id: string; name: string }[] | null>(null);
  const [subscriptionActive, setSubscriptionActive] = useState(false);

  useEffect(() => {
    trackFeatureEvent(ACCOUNT_DELETE_EVENTS.open, { feature: ACCOUNT_DELETE_FEATURE });
  }, []);

  const backToMe = () => router.push("/me");

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    if (!account || busy) return;
    setBusy(true);
    setError(null);
    setGroups(null);
    setSubscriptionActive(false);
    const result = await deleteOwnAccount(typed);
    setBusy(false);
    if (result.ok) {
      trackFeatureEvent(ACCOUNT_DELETE_EVENTS.done, { feature: ACCOUNT_DELETE_FEATURE });
      setStep("done");
      // The server already closed every socket of this account; this clears
      // the token this browser still holds.
      logout();
      return;
    }
    if (result.reauthRequired) {
      setLoginNotice(t("accountDelete.signInExpired"));
      setStep("login");
      return;
    }
    if (result.groups?.length) {
      trackFeatureEvent(ACCOUNT_DELETE_EVENTS.blockedGroups, { feature: ACCOUNT_DELETE_FEATURE });
      setGroups(result.groups);
      return;
    }
    if (result.subscriptionActive) {
      trackFeatureEvent(ACCOUNT_DELETE_EVENTS.blockedSubscription, { feature: ACCOUNT_DELETE_FEATURE });
      setSubscriptionActive(true);
      return;
    }
    setError(result.usernameMismatch ? t("accountDelete.usernameMismatch") : result.error);
  }

  if (step === "done") {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <div className={card}>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {t("accountDelete.doneTitle")}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t("accountDelete.doneBody")}</p>
          <Link
            href="/"
            className="mt-5 inline-block rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {t("accountDelete.goHome")}
          </Link>
        </div>
      </main>
    );
  }

  if (!feature.ready || loading) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-20">
        <span
          aria-hidden
          className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100"
        />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>
      </main>
    );
  }

  // Outside the experiment, or nobody signed in: nothing to delete from here.
  if (!feature.enabled || !account || account.bot) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <div className={card}>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("accountDelete.unavailable")}</p>
          <Link href="/me" className={`mt-5 inline-block ${secondaryButton}`}>
            {t("common.back")}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      {step === "login" && (
        <div className={card}>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {t("cancelPage.confirmItsYou")}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t("accountDelete.signInExplanation")}</p>
          {loginNotice && (
            <p
              role="status"
              className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
            >
              {loginNotice}
            </p>
          )}
          <LoginForm
            onSuccess={() => {
              setLoginNotice(null);
              setStep("confirm");
              trackFeatureEvent(ACCOUNT_DELETE_EVENTS.confirmShown, { feature: ACCOUNT_DELETE_FEATURE });
            }}
            onCancel={backToMe}
            // A social login that turned out to be a new account is not the
            // account being deleted.
            onTicket={() => setLoginNotice(t("accountDelete.notThisAccount"))}
          />
        </div>
      )}

      {step === "confirm" && (
        <form onSubmit={handleDelete} className={card}>
          <h1 className="text-xl font-semibold tracking-tight text-red-600 dark:text-red-500">
            {t("accountDelete.title")}
          </h1>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
            <li>{t("accountDelete.pointForever")}</li>
            <li>{t("accountDelete.pointProfile")}</li>
            <li>{t("accountDelete.pointUsername")}</li>
            <li>{t("accountDelete.pointBots")}</li>
          </ul>

          {groups && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              <p>{t("accountDelete.ownsGroups")}</p>
              <ul className="mt-1.5 space-y-1">
                {groups.map((group) => (
                  <li key={group.id}>
                    <Link href={`/groups/${group.id}`} className="font-medium underline">
                      {group.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {subscriptionActive && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              <p>{t("accountDelete.subscriptionActive")}</p>
              <Link href="/pro/cancelar" className="mt-1.5 inline-block font-medium underline">
                {t("accountDelete.cancelSubscription")}
              </Link>
            </div>
          )}

          <label htmlFor="delete-account-username" className="mt-5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t("accountDelete.typeUsername", { value: account.username })}
          </label>
          <input
            id="delete-account-username"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={account.username}
            className={`mt-1.5 ${inputClass}`}
          />
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          <div className="mt-5 flex gap-2">
            <button
              type="submit"
              disabled={busy || typed.trim().toLowerCase() !== account.username.toLowerCase()}
              className={`flex-1 ${dangerButton}`}
            >
              {busy && <ButtonSpinner />}
              {t("accountDelete.deleteForever")}
            </button>
            <button type="button" onClick={backToMe} className={secondaryButton}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}

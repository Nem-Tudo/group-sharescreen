"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CancelSurveyDialog } from "@/components/CancelSurveyDialog";
import { LoginForm } from "@/components/LoginForm";
import { useAuth } from "@/lib/AuthContext";
import { formatLocale } from "@/lib/i18n";
import {
  cancelPremium,
  fetchPremiumPlans,
  isPremiumActive,
  type CancelSurvey,
} from "@/lib/premiumApi";
import { useT } from "@/lib/useI18n";

// The cancellation page: sign in again, answer the survey, cancel.
//
// The sign-in comes first and is asked of *everybody*, including somebody who
// is plainly signed in already. That is the feature, not an oversight: the API
// refuses to cancel on a session that did not sign in within the last few
// minutes (see its requireRecentAuth), because a session left open on a shared
// computer or a borrowed phone can do a great deal — but should not be able to
// end somebody's paid plan. The page asks up front rather than letting the
// survey be answered and then refused, which would be the most annoying way to
// learn the rule.
//
// What happens after it is exactly what /pro used to do: the four questions
// (CancelSurveyDialog) and the confirmation, then one request.

type Step = "login" | "survey" | "done";

/** How long the page waits before showing anything. */
const LOAD_DELAY_MS = 10000;

function dateLabel(timestamp: number): string {
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

export function CancelSubscriptionPanel() {
  const t = useT();
  const router = useRouter();
  const { account, refresh } = useAuth();
  const [step, setStep] = useState<Step>("login");
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The plan's name for the confirmation. Only a label — the plan being
  // cancelled is whatever the account holds, never this.
  const [planTitles, setPlanTitles] = useState<Record<string, string>>({});
  // Captured when the cancellation goes through, so the last screen can say
  // when access ends even after the account below has been re-read.
  const [accessUntil, setAccessUntil] = useState<number | null>(null);
  // A deliberate pause before the page shows anything — one more small step
  // between wanting to cancel and cancelling.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), LOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPremiumPlans(controller.signal).then((plans) =>
      setPlanTitles(Object.fromEntries(plans.map((plan) => [plan.id, plan.title])))
    );
    return () => controller.abort();
  }, []);

  const premium = account?.premium ?? null;
  // The same test /pro uses for "a card mandate that is still charging" — the
  // only thing there is to cancel. Pix, a gift and a comped grant all simply
  // end on their date, and the API says so if asked; this says it first.
  const cancellable =
    isPremiumActive(premium) && premium?.method !== "pix" && premium?.status !== "cancelled";

  const backToPro = useCallback(() => router.push("/pro"), [router]);

  const handleCancel = useCallback(
    async (survey: CancelSurvey) => {
      if (!premium) return;
      setBusy(true);
      setError(null);
      const result = await cancelPremium(survey);
      if (!result.ok) {
        setBusy(false);
        if (result.reauthRequired) {
          // Took longer than the window allows between signing in and
          // confirming. Back to the start of the page, saying why — the
          // answers are lost, which is the cost of the rule being real.
          setLoginNotice(t("cancelPage.signInExpired"));
          setStep("login");
          return;
        }
        setError(result.error ?? t("common.couldNotCancelRightNow"));
        return;
      }
      setAccessUntil(premium.currentPeriodEnd);
      await refresh();
      setBusy(false);
      setStep("done");
    },
    [premium, refresh, t]
  );

  if (!ready) {
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

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      {step === "login" && (
        <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {t("cancelPage.confirmItsYou")}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {t("cancelPage.signInAgainExplanation")}
          </p>
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
              setStep("survey");
            }}
            onCancel={backToPro}
            // A social login that turned out to be a *new* account is by
            // definition not the account with the subscription. Said here
            // rather than walking them into a username form for an account
            // they never meant to create.
            onTicket={() => setLoginNotice(t("cancelPage.notTheSubscribedAccount"))}
          />
        </div>
      )}

      {step === "survey" && !cancellable && (
        <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {t("cancelPage.nothingToCancel")}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {premium && isPremiumActive(premium)
              ? t("cancelPage.endsOnItsOwn", { value: dateLabel(premium.currentPeriodEnd) })
              : t("cancelPage.noActiveSubscription")}
          </p>
          <Link
            href="/pro"
            className="mt-5 inline-block rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {t("cancelPage.backToPro")}
          </Link>
        </div>
      )}

      {step === "survey" && cancellable && premium && (
        <CancelSurveyDialog
          open
          accessUntilLabel={dateLabel(premium.currentPeriodEnd)}
          planTitle={planTitles[premium.plan] ?? t("common.golivePro")}
          busy={busy}
          error={error}
          onCancelSubscription={handleCancel}
          // Closing keeps the subscription — and on a page whose only purpose
          // is cancelling, there is nowhere else to leave it for.
          onClose={backToPro}
        />
      )}

      {step === "done" && (
        <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {t("cancelPage.cancelledTitle")}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {t("cancelPage.cancelledBody", { value: dateLabel(accessUntil ?? 0) })}
          </p>
          <Link
            href="/pro"
            className="mt-5 inline-block rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {t("cancelPage.backToPro")}
          </Link>
        </div>
      )}
    </main>
  );
}

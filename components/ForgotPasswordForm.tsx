"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { prewarmCaptcha } from "@/lib/turnstile";
import { requestPasswordReset, resetPassword } from "@/lib/emailApi";
import { useT } from "@/lib/useI18n";

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const primaryButtonClass =
  "rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButtonClass =
  "rounded-lg border border-zinc-300 px-4 py-2.5 font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const linkButtonClass =
  "self-start text-sm font-medium underline underline-offset-2 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";
const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

// "Esqueci minha senha" — reached from LoginForm, and shaped like it on
// purpose: same inputs, same buttons, same onSuccess contract, so whatever
// rendered the login form can render this one in its place without knowing
// anything else about it.
//
// Two steps in one component rather than two screens, because the second one
// is meaningless without the first: leaving the page between them would throw
// away the identifier the code belongs to, and the person would have to start
// over. `step` is the whole of that state.
//
// One thing deliberately not shown: whether the account exists. The API
// answers step one identically for a real username and a made-up one (see its
// emailRoutes.ts), and this form goes on to the code step either way. Saying
// "no such user" here would undo that in one line.

const CODE_LENGTH = 6;
const MIN_PASSWORD = 6;

export function ForgotPasswordForm({
  initialIdentifier = "",
  onSuccess,
  onCancel,
}: {
  /** Whatever was already typed into the login form's username box. */
  initialIdentifier?: string;
  onSuccess?: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { refresh } = useAuth();
  const [step, setStep] = useState<"identify" | "code">("identify");
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Seconds left before "enviar de novo" is offered again, mirroring the
  // API's own floor between two sends. Counted down here so the answer is on
  // screen rather than only in a 429 nobody asked for.
  const [resendIn, setResendIn] = useState(0);

  // Same reasoning as the login and signup forms: Turnstile does its work when
  // its widget renders, so minting at submit time puts a second or two between
  // the button and anything happening.
  useEffect(() => {
    prewarmCaptcha("password_reset");
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const trimmedIdentifier = identifier.trim();

  async function submitIdentify() {
    setSubmitting(true);
    setFormError(null);
    try {
      await requestPasswordReset(trimmedIdentifier);
      trackEvent("password_reset_requested");
      setStep("code");
      setResendIn(60);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("email.couldNotSend"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReset() {
    setSubmitting(true);
    setFormError(null);
    try {
      await resetPassword(trimmedIdentifier, code.trim(), password);
      // resetPassword already stored the session token; refresh() is what
      // turns it into a resolved account (and, through AuthContext's own
      // effect, a signaling registration) — the same ending as login().
      await refresh();
      trackEvent("password_reset_completed");
      onSuccess?.();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("email.wrongCode"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (step === "identify") {
      if (!trimmedIdentifier) return;
      void submitIdentify();
      return;
    }
    if (code.trim().length < CODE_LENGTH || password.length < MIN_PASSWORD) return;
    void submitReset();
  }

  return (
    <div className="mt-8 flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t("email.forgotTitle")}
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {step === "identify"
            ? t("email.forgotIntro")
            : // Says "if there is an account" rather than "we sent it": that
              // is the whole of what is actually known here.
              t("email.forgotCodeSent")}
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label htmlFor="forgot-identifier" className={labelClass}>
          {t("email.usernameOrEmail")}
        </label>
        <input
          id="forgot-identifier"
          autoFocus={step === "identify"}
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          // Locked once a code is out: the code belongs to this identifier,
          // and editing the box would only produce a code that cannot match.
          readOnly={step === "code"}
          className={`${inputClass} ${step === "code" ? "opacity-60" : ""}`}
        />
        {step === "code" && (
          <>
            <label htmlFor="forgot-code" className={labelClass}>
              {t("email.codeLabel")}
            </label>
            <input
              id="forgot-code"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              placeholder="000000"
              value={code}
              // Digits only, so a code pasted as "123 456" out of the email
              // still fits the box instead of being silently truncated.
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
              className={`${inputClass} text-center text-lg tracking-[0.4em]`}
            />
            <label htmlFor="forgot-password" className={labelClass}>
              {t("email.newPassword")}
            </label>
            <input
              id="forgot-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </>
        )}
        {formError && <p className="text-sm text-red-500">{formError}</p>}
        <div className="mt-2 flex gap-2">
          <button
            type="submit"
            disabled={
              submitting ||
              (step === "identify"
                ? !trimmedIdentifier
                : code.trim().length < CODE_LENGTH || password.length < MIN_PASSWORD)
            }
            className={`flex flex-1 items-center justify-center gap-2 ${primaryButtonClass}`}
          >
            {submitting && <ButtonSpinner />}
            {step === "identify" ? t("email.sendCode") : t("email.changePassword")}
          </button>
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t("common.back")}
          </button>
        </div>
        {step === "code" && (
          <button
            type="button"
            disabled={submitting || resendIn > 0}
            onClick={() => void submitIdentify()}
            className={`${linkButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {resendIn > 0 ? t("email.resendIn", { seconds: resendIn }) : t("email.resend")}
          </button>
        )}
      </form>
    </div>
  );
}

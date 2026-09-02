"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { prewarmCaptcha } from "@/lib/turnstile";
import { OAuthButtons } from "./OAuthButtons";
import { CompleteOAuthSignupForm } from "./CompleteOAuthSignupForm";
import type { OAuthResult } from "@/lib/oauthApi";

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const primaryButtonClass =
  "rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButtonClass =
  "rounded-lg border border-zinc-300 px-4 py-2.5 font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const linkButtonClass =
  "self-start text-sm font-medium underline underline-offset-2 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";
const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

// The login half of the identity flow, split out of the home page so
// WatchRoom's account modal can offer "entrar" without a second copy of it.
// Counterpart to CreateAccountForm, and deliberately shaped the same way:
// login() stores the token, AuthContext's own effect turns it into a
// signaling registration, so the caller only has to react to onSuccess.
export function LoginForm({
  onSuccess,
  onCancel,
  onSwitchToCreate,
  onTicket,
}: {
  onSuccess?: () => void;
  onCancel: () => void;
  // Omitted where there's nowhere to switch to.
  onSwitchToCreate?: () => void;
  // A social login that turned out to be a signup. Passing this in takes
  // the username step over (the home page renders it above its whole
  // identity area); leaving it out renders that step here instead.
  onTicket?: (ticket: Extract<OAuthResult, { kind: "ticket" }>) => void;
}) {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthTicket, setOAuthTicket] = useState<
    Extract<OAuthResult, { kind: "ticket" }> | null
  >(null);

  // Mint the captcha token while this form is being filled in, not when it is
  // submitted. Turnstile does its work when its widget renders, so asking for
  // a token at submit time puts a second or two between the button and
  // anything happening; the seconds somebody spends typing a password are free.
  useEffect(() => {
    prewarmCaptcha("login");
  }, []);

  // No captcha branch here any more: login() mints a Turnstile token on the
  // way out, and Cloudflare shows this person a challenge itself if it wants
  // one, before the request is sent. A refusal that reaches the catch is
  // therefore an ordinary error — and, notably, no longer arrives disguised as
  // "Usuário ou senha inválidos." when the password was in fact fine.
  async function submitLogin() {
    setSubmitting(true);
    setFormError(null);
    try {
      await login(username.trim(), password);
      trackEvent("account_login");
      onSuccess?.();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Usuário ou senha inválidos.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!username.trim() || !password) return;
    void submitLogin();
  }

  if (oauthTicket) {
    return (
      <div className="mt-8">
        <CompleteOAuthSignupForm
          ticket={oauthTicket.ticket}
          provider={oauthTicket.provider}
          suggestedUsername={oauthTicket.suggestedUsername}
          suggestedDisplayName={oauthTicket.suggestedDisplayName}
          onSuccess={onSuccess}
          // Back to the password form rather than out of the whole flow:
          // whoever got here still meant to end up with an account.
          onCancel={() => setOAuthTicket(null)}
        />
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-3">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label htmlFor="login-username" className={labelClass}>
          Usuário
        </label>
        <input
          id="login-username"
          autoFocus
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={inputClass}
        />
        <label htmlFor="login-password" className={labelClass}>
          Senha
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        {formError && <p className="text-sm text-red-500">{formError}</p>}
        <div className="mt-2 flex gap-2">
          <button
            type="submit"
            disabled={submitting || !username.trim() || !password}
            className={`flex flex-1 items-center justify-center gap-2 ${primaryButtonClass}`}
          >
            {submitting && <ButtonSpinner />}
            {submitting ? "Entrando..." : "Entrar"}
          </button>
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Voltar
          </button>
        </div>
        {onSwitchToCreate && (
          <button type="button" onClick={onSwitchToCreate} className={linkButtonClass}>
            Criar uma conta
          </button>
        )}
      </form>
      {/* Outside the <form>: the username step this can lead to is a form
          of its own, and forms can't nest. Renders nothing when no provider
          is configured. */}
      <OAuthButtons onSuccess={onSuccess} onTicket={onTicket ?? setOAuthTicket} />
    </div>
  );
}

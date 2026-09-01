"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { CaptchaChallengeRequiredError } from "@/lib/turnstile";
import { CaptchaChallengeModal } from "./CaptchaChallengeModal";
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
  // Open when the server refused the invisible reCAPTCHA check but offered a
  // challenge instead of just saying no - see CaptchaChallengeRequiredError.
  // Without this the refusal reached the form as a bare "Usuario ou senha
  // invalidos.", which is both wrong and unactionable: the password was fine,
  // and there was nothing on screen to do about what actually failed.
  const [challenge, setChallenge] = useState(false);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [oauthTicket, setOAuthTicket] = useState<
    Extract<OAuthResult, { kind: "ticket" }> | null
  >(null);

  // `challengeToken` is present only on the retry that follows a solved
  // challenge; the first attempt always goes through the invisible check.
  async function submitLogin(challengeToken?: string) {
    setSubmitting(true);
    setFormError(null);
    // Cleared before every attempt so the modal can tell a fresh refusal from
    // the one it is already showing (it compares `error` by value).
    setChallengeError(null);
    try {
      await login(username.trim(), password, challengeToken);
      trackEvent("account_login");
      setChallenge(false);
      onSuccess?.();
    } catch (err) {
      if (err instanceof CaptchaChallengeRequiredError) {
        setChallenge(true);
        // Nothing to say on the way in - the challenge itself explains what to
        // do, and the reason only means anything once an answer was refused.
        if (challengeToken) setChallengeError(err.message);
        return;
      }
      setChallenge(false);
      setFormError(err instanceof Error ? err.message : "Usuário ou senha inválidos.");
    } finally {
      setSubmitting(false);
    }
  }

  // Giving up on the challenge. The login has genuinely failed at this point,
  // so it says so under the form rather than leaving a form that looks
  // untouched next to a password that was never accepted.
  function cancelChallenge() {
    setChallenge(false);
    setChallengeError(null);
    setFormError("Verificação de segurança não concluída. Tente entrar de novo.");
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
            className={`flex-1 ${primaryButtonClass}`}
          >
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
      {/* Fixed-position and full-screen, so it sits above whichever surface
          this form was rendered into - the home page, the account menu's
          dropdown, or WatchRoom's account modal. */}
      {challenge && (
        <CaptchaChallengeModal
          error={challengeError}
          action="login"
          submittingLabel="Entrando..."
          onToken={(token) => void submitLogin(token)}
          onCancel={cancelChallenge}
        />
      )}
    </div>
  );
}

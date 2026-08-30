"use client";

import { useEffect, useState, type FormEvent } from "react";
import { checkUsernameAvailable, type UsernameCheck } from "@/lib/accountApi";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { OAuthButtons } from "./OAuthButtons";
import { CompleteOAuthSignupForm } from "./CompleteOAuthSignupForm";
import type { OAuthResult } from "@/lib/oauthApi";

// Mirrors server-side validation (see accountApi.ts / the account routes) —
// duplicated here only so a bad username is caught before a round trip.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// How long the availability check waits after the last keystroke. Long enough
// that typing a name is one request rather than one per letter, short enough
// that the answer feels like it is answering as you type.
const USERNAME_CHECK_DEBOUNCE_MS = 400;

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const primaryButtonClass =
  "rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButtonClass =
  "rounded-lg border border-zinc-300 px-4 py-2.5 font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const linkButtonClass =
  "self-start text-sm font-medium underline underline-offset-2 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";
const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

// The account-creation form — shared between the home page (its "create"
// identity mode) and WatchRoom's first-time name gate, so a guest who lands
// straight in a room link can create an account without leaving it. Calling
// register() here stores the new token; AuthContext's own effect picks that
// up and turns it into a signaling registration, so the caller just needs to
// react to onSuccess (reset whatever local UI mode led here) rather than
// drive the actual identity switch itself.
export function CreateAccountForm({
  initialDisplayName = "",
  onSuccess,
  onCancel,
  onSwitchToLogin,
}: {
  initialDisplayName?: string;
  onSuccess?: () => void;
  onCancel: () => void;
  // Omitted where there's no login mode to switch to (e.g. WatchRoom's
  // inline gate, which only ever offers "pick a name" or "create account").
  onSwitchToLogin?: () => void;
}) {
  const { register } = useAuth();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set when a social login turned out to be a signup. While it's here this
  // component renders *only* the username step — the fields below ask for
  // the same two names plus a password the social account doesn't have, so
  // showing both at once was just two stacked forms.
  const [oauthTicket, setOAuthTicket] = useState<
    Extract<OAuthResult, { kind: "ticket" }> | null
  >(null);
  // Whether the username someone is typing is free — asked while they type
  // instead of on submit. Before this, the only way to find out was to send
  // the form and read the error, and a handful of those in a row is exactly
  // what the signup rate limit and the auto-ban are built to stop: people
  // were being banned for trying to sign up.
  //
  // Tagged with the username it answers, so a reply for two keystrokes ago is
  // never shown under a different word.
  const [usernameCheck, setUsernameCheck] = useState<UsernameCheck | null>(null);

  const trimmedUsername = username.trim();
  const usernameWellFormed = USERNAME_RE.test(trimmedUsername);
  useEffect(() => {
    if (!usernameWellFormed) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      checkUsernameAvailable(trimmedUsername, controller.signal)
        .then((result) => setUsernameCheck(result))
        // A failed check is not a verdict: leave it unanswered and let the
        // submit decide, rather than blocking a name that may well be free.
        .catch(() => {});
    }, USERNAME_CHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmedUsername, usernameWellFormed]);

  // Only ever the answer for what is in the box right now. An answer for two
  // keystrokes ago is simply not shown — which is also what makes
  // "verificando" the absence of an answer rather than a second piece of state
  // that has to be kept in step with this one.
  const check =
    usernameCheck && usernameCheck.username === trimmedUsername.toLowerCase()
      ? usernameCheck
      : null;
  const usernameTaken = check?.valid === true && check.available === false;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmedUser = username.trim();
    const trimmedDisplay = displayName.trim();
    if (!USERNAME_RE.test(trimmedUser)) {
      setFormError("Usuário deve ter 3 a 20 letras, números ou _.");
      return;
    }
    if (!trimmedDisplay) {
      setFormError("Escolha um nome de exibição.");
      return;
    }
    if (password.length < 6) {
      setFormError("Senha deve ter ao menos 6 caracteres.");
      return;
    }
    setSubmitting(true);
    try {
      await register(trimmedUser, trimmedDisplay, password);
      trackEvent("account_created");
      onSuccess?.();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao criar conta.");
    } finally {
      setSubmitting(false);
    }
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
          // whoever cancels here still meant to create an account.
          onCancel={() => setOAuthTicket(null)}
        />
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-3">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label htmlFor="create-username" className={labelClass}>
          Usuário
        </label>
        <input
          id="create-username"
          autoFocus
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={20}
          placeholder="Ex: maria123"
          className={`${inputClass} ${
            usernameTaken
              ? "border-red-400 dark:border-red-800"
              : check?.available
                ? "border-emerald-500 dark:border-emerald-700"
                : ""
          }`}
        />
        {/* Says nothing until there is something to say: an empty box and a
            half-typed name are not errors, they are somebody typing. */}
        {trimmedUsername.length > 0 && (
          <p className="-mt-1 text-xs">
            {!usernameWellFormed ? (
              <span className="text-zinc-500 dark:text-zinc-400">
                Use 3 a 20 letras, números ou _.
              </span>
            ) : !check ? (
              <span className="text-zinc-500 dark:text-zinc-400">Verificando...</span>
            ) : check.available ? (
              <span className="text-emerald-600 dark:text-emerald-500">
                @{check.username} está livre.
              </span>
            ) : (
              <span className="text-red-500">@{check.username} já está em uso.</span>
            )}
          </p>
        )}
        <label htmlFor="create-displayName" className={labelClass}>
          Nome de exibição
        </label>
        <input
          id="create-displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={24}
          placeholder="Ex: Maria"
          className={inputClass}
        />
        {/* Worth saying out loud: it used to have to be unique, and the error
            that produced was the main reason signing up turned into a hunt. */}
        <p className="-mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          É como seu nome aparece na sala. Pode ser igual ao de outra pessoa.
        </p>
        <label htmlFor="create-password" className={labelClass}>
          Senha
        </label>
        <input
          id="create-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        {formError && <p className="text-sm text-red-500">{formError}</p>}
        <div className="mt-2 flex gap-2">
          <button type="submit" disabled={submitting} className={`flex-1 ${primaryButtonClass}`}>
            {submitting ? "Criando..." : "Criar conta"}
          </button>
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Voltar
          </button>
        </div>
        {onSwitchToLogin && (
          <button type="button" onClick={onSwitchToLogin} className={linkButtonClass}>
            Já tenho uma conta
          </button>
        )}
      </form>
      {/* Outside the <form> on purpose: the username step this can turn
          into is itself a form, and forms can't nest. Renders nothing at all
          when the API has no provider configured — social signup lands in
          the same place as the password one (an account either way), so
          onSuccess is the same callback. */}
      <OAuthButtons onSuccess={onSuccess} onTicket={setOAuthTicket} />
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import type { OAuthProviderId } from "@/lib/oauthApi";

// Mirrors server-side validation (see the API's USERNAME_RE) — duplicated
// here only so a bad username is caught before a round trip, same as
// CreateAccountForm does.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const primaryButtonClass =
  "rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButtonClass =
  "rounded-lg border border-zinc-300 px-4 py-2.5 font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

const PROVIDER_LABEL: Record<OAuthProviderId, string> = {
  discord: "Discord",
  google: "Google",
};

// The second (and last) step of a *first* login with Discord/Google: the
// provider identity is already verified server-side and is riding in
// `ticket`, so all that's left is the name this account will have here.
//
// It exists because a provider's name is a bad username: it can collide with
// someone already registered, it can be an email prefix or a display name
// with spaces and emoji, and it's not something the user chose for this
// site. The fields start pre-filled with a cleaned-up suggestion (see the
// API's suggestUsername) so accepting the default is one click.
export function CompleteOAuthSignupForm({
  ticket,
  provider,
  suggestedUsername,
  suggestedDisplayName,
  onSuccess,
  onCancel,
}: {
  ticket: string;
  provider: OAuthProviderId;
  suggestedUsername: string;
  suggestedDisplayName: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const { completeOAuthSignup } = useAuth();
  const [username, setUsername] = useState(suggestedUsername);
  const [displayName, setDisplayName] = useState(suggestedDisplayName);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // This step used to be the worst place in the app to be refused by the
  // captcha: the provider has already been through its consent screen, the
  // identity is verified and riding in `ticket`, and the person is one field
  // short of an account — and what they got was "Recarregue a página", which
  // loses the ticket and sends them back to the start of a flow that would
  // refuse them again for the same reason. Nothing here has to handle that any
  // more: Cloudflare puts a challenge on screen itself when it wants one,
  // before the request leaves, and the ticket is untouched either way.
  async function submitSignup() {
    const trimmedUser = username.trim();
    const trimmedDisplay = displayName.trim();
    setSubmitting(true);
    setFormError(null);
    try {
      await completeOAuthSignup(ticket, trimmedUser, trimmedDisplay);
      trackEvent("account_created_oauth");
      onSuccess?.();
    } catch (err) {
      // The realistic failure is the name being taken — the ticket is still
      // good, so the user just picks another one right here instead of
      // starting the whole provider flow over.
      setFormError(err instanceof Error ? err.message : "Falha ao criar conta.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
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
    void submitSignup();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
          Quase lá
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Conectado com {PROVIDER_LABEL[provider]}. Escolha como você vai aparecer no GoLive.
        </p>
      </div>
      <label htmlFor="oauth-username" className={labelClass}>
        Usuário
      </label>
      <input
        id="oauth-username"
        autoFocus
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        maxLength={20}
        className={inputClass}
      />
      <label htmlFor="oauth-display-name" className={labelClass}>
        Nome de exibição
      </label>
      <input
        id="oauth-display-name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={24}
        className={inputClass}
      />
      {formError && <p className="text-sm text-red-500">{formError}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={submitting || !username.trim() || !displayName.trim()}
          className={`flex-1 ${primaryButtonClass}`}
        >
          {submitting ? "Criando..." : "Criar conta"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

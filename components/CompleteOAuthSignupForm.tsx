"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { prewarmCaptcha } from "@/lib/turnstile";
import type { OAuthProviderId } from "@/lib/oauthApi";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";

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
const linkButtonClass =
  "text-sm font-medium underline underline-offset-2 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

const PROVIDER_LABEL: Record<OAuthProviderId, string> = {
  get discord() { return translate("completeOAuthSignupForm.discord"); },
  get google() { return translate("completeOAuthSignupForm.google"); },
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
  const t = useT();
  const { completeOAuthSignup, linkOAuthToExisting } = useAuth();
  const [username, setUsername] = useState(suggestedUsername);
  const [displayName, setDisplayName] = useState(suggestedDisplayName);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The other way out of this step (see `claiming` below): the person already
  // has an account here and is claiming it with its password instead of
  // creating a second one.
  const [claiming, setClaiming] = useState(false);
  const [claimUsername, setClaimUsername] = useState(suggestedUsername);
  const [claimPassword, setClaimPassword] = useState("");

  // Mint the captcha token while this form is being filled in, not when it is
  // submitted. Turnstile does its work when its widget renders, so asking for
  // a token at submit time puts a second or two between the button and
  // anything happening; the seconds somebody spends typing confirming the suggested name are free.
  useEffect(() => {
    prewarmCaptcha("oauth_signup");
  }, []);

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
      setFormError(err instanceof Error ? err.message : t("common.couldNotCreateTheAccount"));
    } finally {
      setSubmitting(false);
    }
  }

  // Claiming an account that already exists here. The ticket is the same one
  // the signup above would have used — the server links this provider to that
  // account once the password checks out, and the login ends there.
  async function submitClaim() {
    setSubmitting(true);
    setFormError(null);
    try {
      await linkOAuthToExisting(ticket, claimUsername.trim(), claimPassword);
      trackEvent("account_login_oauth_linked");
      onSuccess?.();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("common.invalidUsernameOrPassword"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleClaimSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!claimUsername.trim() || !claimPassword) return;
    void submitClaim();
  }

  if (claiming) {
    return (
      <form onSubmit={handleClaimSubmit} className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            {t("completeOAuthSignupForm.signInToTheAccountYou")}
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t("completeOAuthSignupForm.confirmYourPasswordAndThe")} {PROVIDER_LABEL[provider]} {t("completeOAuthSignupForm.staysConnectedToItNextTime")}
          </p>
        </div>
        <label htmlFor="claim-username" className={labelClass}>
          {t("common.username")}
        </label>
        <input
          id="claim-username"
          autoFocus
          autoComplete="username"
          value={claimUsername}
          onChange={(e) => setClaimUsername(e.target.value)}
          maxLength={20}
          className={inputClass}
        />
        <label htmlFor="claim-password" className={labelClass}>
          {t("common.password")}
        </label>
        <input
          id="claim-password"
          type="password"
          autoComplete="current-password"
          value={claimPassword}
          onChange={(e) => setClaimPassword(e.target.value)}
          className={inputClass}
        />
        {formError && <p className="text-sm text-red-500">{formError}</p>}
        <div className="mt-2 flex gap-2">
          <button
            type="submit"
            disabled={submitting || !claimUsername.trim() || !claimPassword}
            className={`flex flex-1 items-center justify-center gap-2 ${primaryButtonClass}`}
          >
            {submitting && <ButtonSpinner />}
            {submitting ? t("common.joining") : t("completeOAuthSignupForm.signInAndConnect")}
          </button>
          <button
            type="button"
            onClick={() => {
              setClaiming(false);
              setFormError(null);
            }}
            className={secondaryButtonClass}
          >
            {t("common.back")}
          </button>
        </div>
      </form>
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmedUser = username.trim();
    const trimmedDisplay = displayName.trim();
    if (!USERNAME_RE.test(trimmedUser)) {
      setFormError(t("common.usernameMustHave3To20"));
      return;
    }
    if (!trimmedDisplay) {
      setFormError(t("common.chooseADisplayName"));
      return;
    }
    void submitSignup();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
          {t("completeOAuthSignupForm.almostThere")}
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {t("completeOAuthSignupForm.connectedWith")} {PROVIDER_LABEL[provider]}{t("completeOAuthSignupForm.chooseHowYouWillAppearOn")}
        </p>
      </div>
      <label htmlFor="oauth-username" className={labelClass}>
        {t("common.username")}
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
        {t("common.displayName")}
      </label>
      <input
        id="oauth-display-name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={24}
        className={inputClass}
      />
      {formError && <p className="text-sm text-red-500">{formError}</p>}
      {/* Offered here rather than only at the bottom, because this is the
          exact moment it is needed: the name that was refused is, more often
          than not, the person's own — the suggestion comes from the same
          provider handle they registered with. Before this existed, that
          refusal was the end of the road. */}
      <button
        type="button"
        onClick={() => {
          setClaiming(true);
          setClaimUsername(username.trim() || suggestedUsername);
          setFormError(null);
        }}
        className={`self-start ${linkButtonClass}`}
      >
        {t("completeOAuthSignupForm.iAlreadyHaveAGoliveAccount")}
      </button>
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={submitting || !username.trim() || !displayName.trim()}
          className={`flex flex-1 items-center justify-center gap-2 ${primaryButtonClass}`}
        >
          {submitting && <ButtonSpinner />}
            {submitting ? t("common.creating2") : t("common.createAccount")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t("common.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}

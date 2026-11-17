"use client";

import { useEffect, useState, type FormEvent } from "react";
import { checkUsernameAvailable, type UsernameCheck } from "@/lib/accountApi";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { prewarmCaptcha } from "@/lib/turnstile";
import { OAuthButtons } from "./OAuthButtons";
import { CompleteOAuthSignupForm } from "./CompleteOAuthSignupForm";
import type { OAuthResult } from "@/lib/oauthApi";
import { useT } from "@/lib/useI18n";
import {
  AuthBack,
  AuthField,
  AuthSwitch,
  PasswordInput,
  authInputClass,
  authInputInvalidClass,
  authInputValidClass,
  authPrimaryButtonClass,
  useFocusWithMouse,
} from "./auth/authUi";

// Mirrors server-side validation (see accountApi.ts / the account routes) —
// duplicated here only so a bad username is caught before a round trip.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

// How long the availability check waits after the last keystroke. Long enough
// that typing a name is one request rather than one per letter, short enough
// that the answer feels like it is answering as you type.
const USERNAME_CHECK_DEBOUNCE_MS = 400;

/**
 * A username made from the display name ("João Silva" -> "joao_silva"), the
 * same folding the API applies to a social login's name. Only a suggestion:
 * it fills the username field until the person types in it themselves.
 */
function usernameFromDisplayName(name: string): string {
  const folded = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 20);
  return folded.length >= 3 ? folded : "";
}

type Field = "displayName" | "username" | "email" | "password";

// The account-creation form — shared between the home page (its "create"
// identity mode), the account modal, WatchRoom's first-time name gate and the
// /login popup. Laid out like LoginForm (see components/auth/authUi.tsx).
// Calling register() here stores the new token; AuthContext's own effect
// picks that up and turns it into a signaling registration, so the caller
// just needs to react to onSuccess.
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
  const t = useT();
  const { register } = useAuth();
  const focusWithMouse = useFocusWithMouse();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  // null while the person has not typed in the username box: it then follows
  // the display name (see usernameFromDisplayName). The first keystroke there
  // makes it theirs for good.
  const [typedUsername, setTypedUsername] = useState<string | null>(null);
  const username = typedUsername ?? usernameFromDisplayName(displayName);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  // Per field, so each message sits under the box it is about. Filled on
  // submit (and on leaving a field that is clearly wrong), cleared as soon as
  // the field is edited.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
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

  // Mint the captcha token while this form is being filled in, not when it is
  // submitted. Turnstile does its work when its widget renders, so asking for
  // a token at submit time puts a second or two between the button and
  // anything happening; the seconds somebody spends typing choosing a username are free.
  useEffect(() => {
    prewarmCaptcha("register_account");
  }, []);

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

  function clearFieldError(field: Field) {
    setFormError(null);
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  function validate(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    if (!displayName.trim()) errors.displayName = t("common.chooseADisplayName");
    if (!USERNAME_RE.test(trimmedUsername)) errors.username = t("common.usernameMustHave3To20");
    else if (usernameTaken) errors.username = `@${trimmedUsername} ${t("createAccountForm.isAlreadyInUse")}`;
    // Shape only, matching the API's own check — nothing here can prove an
    // address, and a stricter pattern would reject valid ones while letting a
    // plausible typo through just the same.
    if (!EMAIL_RE.test(email.trim())) errors.email = t("createAccountForm.enterAValidEmail");
    if (password.length < MIN_PASSWORD) errors.password = t("createAccountForm.passwordMustBeAtLeast6");
    return errors;
  }

  // No captcha branch here any more. register() mints a Turnstile token on the
  // way out (see lib/accountApi.ts), and if Cloudflare wants to challenge this
  // person it does so itself, on screen, before the request is even sent — so
  // by the time anything lands in the catch below, the check has already had
  // its say and a refusal is just an error like any other.
  async function submitRegister() {
    setSubmitting(true);
    setFormError(null);
    try {
      await register(trimmedUsername, displayName.trim(), password, email.trim().toLowerCase());
      trackEvent("account_created");
      onSuccess?.();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("common.couldNotCreateTheAccount"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const errors = validate();
    setFieldErrors(errors);
    const first = (["displayName", "username", "email", "password"] as Field[]).find((f) => errors[f]);
    if (first) {
      document.getElementById(`create-${first}`)?.focus();
      return;
    }
    void submitRegister();
  }

  if (oauthTicket) {
    return (
      <div className="mt-6">
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

  // Live feedback under the username, when there is no submit error for it.
  const usernameHint =
    trimmedUsername.length === 0 ? (
      t("createAccountForm.use3To20LettersNumbers")
    ) : !usernameWellFormed ? (
      t("createAccountForm.use3To20LettersNumbers")
    ) : !check ? (
      t("common.checking")
    ) : check.available ? (
      <span className="text-emerald-600 dark:text-emerald-500">
        @{check.username} {t("createAccountForm.isAvailable")}
      </span>
    ) : (
      <span className="text-red-500">
        @{check.username} {t("createAccountForm.isAlreadyInUse")}
      </span>
    );

  return (
    <div className="mt-6 flex flex-col gap-4">
      {/* On top, so a scrolling dialog shows them without scrolling; outside
          the <form> because the username step this can turn into is itself a
          form. Renders nothing when the API has no provider configured —
          social signup ends in an account too, so onSuccess is the same. */}
      <OAuthButtons onSuccess={onSuccess} onTicket={setOAuthTicket} dividerPosition="below" />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <AuthField
          label={t("common.displayName")}
          htmlFor="create-displayName"
          // Worth saying out loud: it used to have to be unique, and the error
          // that produced was the main reason signing up turned into a hunt.
          hint={t("createAccountForm.itIsHowYourNameAppears")}
          error={fieldErrors.displayName}
        >
          <input
            id="create-displayName"
            ref={focusWithMouse}
            autoComplete="nickname"
            enterKeyHint="next"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              clearFieldError("displayName");
              if (typedUsername === null) clearFieldError("username");
            }}
            maxLength={24}
            placeholder={t("common.exMaria")}
            aria-invalid={fieldErrors.displayName ? true : undefined}
            className={`${authInputClass} ${fieldErrors.displayName ? authInputInvalidClass : ""}`}
          />
        </AuthField>
        <AuthField
          label={t("common.username")}
          htmlFor="create-username"
          hint={usernameHint}
          error={fieldErrors.username}
        >
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-zinc-400 dark:text-zinc-500">
              @
            </span>
            <input
              id="create-username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              value={username}
              onChange={(e) => {
                setTypedUsername(e.target.value.replace(/^@/, ""));
                clearFieldError("username");
              }}
              maxLength={20}
              // Just the handle: the "@" is already drawn in front of it.
              placeholder="maria123"
              aria-invalid={fieldErrors.username || usernameTaken ? true : undefined}
              className={`${authInputClass} pl-8 ${
                fieldErrors.username || usernameTaken
                  ? authInputInvalidClass
                  : check?.available
                    ? authInputValidClass
                    : ""
              }`}
            />
          </div>
        </AuthField>
        <AuthField label={t("createAccountForm.email")} htmlFor="create-email" error={fieldErrors.email}>
          <input
            id="create-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearFieldError("email");
            }}
            // Said when leaving the field, not while typing: half an address
            // is not a mistake yet.
            onBlur={() => {
              if (email.trim() && !EMAIL_RE.test(email.trim())) {
                setFieldErrors((prev) => ({ ...prev, email: t("createAccountForm.enterAValidEmail") }));
              }
            }}
            placeholder={t("authForms.emailPlaceholder")}
            aria-invalid={fieldErrors.email ? true : undefined}
            className={`${authInputClass} ${fieldErrors.email ? authInputInvalidClass : ""}`}
          />
        </AuthField>
        <AuthField
          label={t("common.password")}
          htmlFor="create-password"
          // The rule up front, instead of only as the error after a try.
          hint={t("authForms.passwordRule", { min: MIN_PASSWORD })}
          error={fieldErrors.password}
        >
          <PasswordInput
            id="create-password"
            autoComplete="new-password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              clearFieldError("password");
            }}
            invalid={Boolean(fieldErrors.password)}
          />
        </AuthField>
        {formError && <p className="text-sm text-red-500">{formError}</p>}
        <button type="submit" disabled={submitting} className={`mt-1 ${authPrimaryButtonClass}`}>
          {submitting && <ButtonSpinner />}
          {submitting ? t("common.creating2") : t("common.createAccount")}
        </button>
      </form>
      {onSwitchToLogin && (
        <AuthSwitch prompt={t("authForms.alreadyHaveAccount")} action={t("common.signIn")} onClick={onSwitchToLogin} />
      )}
      <AuthBack onClick={onCancel} />
    </div>
  );
}

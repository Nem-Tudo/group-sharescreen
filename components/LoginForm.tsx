"use client";

import { errorText } from "@/lib/errorText";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { prewarmCaptcha } from "@/lib/turnstile";
import { OAuthButtons } from "./OAuthButtons";
import { CompleteOAuthSignupForm } from "./CompleteOAuthSignupForm";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import type { OAuthResult } from "@/lib/oauthApi";
import { useT } from "@/lib/useI18n";
import {
  AuthAsideLink,
  AuthBack,
  AuthField,
  AuthSwitch,
  PasswordInput,
  authInputClass,
  authInputInvalidClass,
  authPrimaryButtonClass,
  useFocusWithMouse,
} from "./auth/authUi";

// The login half of the identity flow, split out of the home page so
// WatchRoom's account modal can offer "entrar" without a second copy of it.
// Counterpart to CreateAccountForm, and laid out exactly the same way (see
// components/auth/authUi.tsx): social buttons, fields, one primary button,
// the switch to the other form, "Voltar". login() stores the token,
// AuthContext's own effect turns it into a signaling registration, so the
// caller only has to react to onSuccess.
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
  const t = useT();
  const { login } = useAuth();
  const focusWithMouse = useFocusWithMouse();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthTicket, setOAuthTicket] = useState<
    Extract<OAuthResult, { kind: "ticket" }> | null
  >(null);
  // "Esqueci minha senha" takes this whole component over rather than opening
  // a dialog: it ends in a session exactly like the password form does, so the
  // caller's onSuccess is the right ending for both and nothing else here has
  // to know which of the two the person went through.
  const [forgot, setForgot] = useState(false);

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
      setFormError(errorText(err, t("common.invalidUsernameOrPassword")));
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

  if (forgot) {
    return (
      <ForgotPasswordForm
        // Whatever is already in the username box — somebody clicking this
        // link has usually just typed their name and had the password refused.
        initialIdentifier={username.trim()}
        onSuccess={onSuccess}
        // Back to the password form, not out of the flow: whoever got here
        // still meant to sign in.
        onCancel={() => setForgot(false)}
      />
    );
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
          // whoever got here still meant to end up with an account.
          onCancel={() => setOAuthTicket(null)}
        />
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      {/* On top, so a scrolling dialog shows them without scrolling; outside
          the <form> because the username step this can lead to is a form of
          its own. Renders nothing when no provider is configured. */}
      <OAuthButtons onSuccess={onSuccess} onTicket={onTicket ?? setOAuthTicket} dividerPosition="below" />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <AuthField label={t("authForms.usernameOrEmail")} htmlFor="login-username">
          <input
            id="login-username"
            ref={focusWithMouse}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setFormError(null);
            }}
            aria-invalid={formError ? true : undefined}
            className={`${authInputClass} ${formError ? authInputInvalidClass : ""}`}
          />
        </AuthField>
        <AuthField
          label={t("common.password")}
          htmlFor="login-password"
          // Next to the field it is about, where people look the moment the
          // password is refused — not under the buttons.
          aside={<AuthAsideLink onClick={() => setForgot(true)}>{t("email.forgotPassword")}</AuthAsideLink>}
          error={formError}
        >
          <PasswordInput
            id="login-password"
            autoComplete="current-password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setFormError(null);
            }}
            invalid={Boolean(formError)}
          />
        </AuthField>
        <button
          type="submit"
          disabled={submitting || !username.trim() || !password}
          className={`mt-1 ${authPrimaryButtonClass}`}
        >
          {submitting && <ButtonSpinner />}
          {submitting ? t("common.joining") : t("common.signIn")}
        </button>
      </form>
      {onSwitchToCreate && (
        <AuthSwitch prompt={t("authForms.noAccountYet")} action={t("common.createAccount")} onClick={onSwitchToCreate} />
      )}
      <AuthBack onClick={onCancel} />
    </div>
  );
}

"use client";

import { useCallback, useState, type ReactNode } from "react";
import { MdVisibility, MdVisibilityOff } from "react-icons/md";
import { FINE_POINTER_QUERY } from "@/lib/useMediaQuery";
import { useT } from "@/lib/useI18n";

// The pieces every sign-in / sign-up form shares, so LoginForm,
// CreateAccountForm, ForgotPasswordForm and CompleteOAuthSignupForm look and
// behave as one flow wherever they are mounted (home page, account modal,
// room gate, /login popup...).
//
// The layout they all follow, top to bottom, never reordered between forms:
//   1. social buttons ("Continuar com ...") and an "ou" divider
//   2. the fields, label above each, hint or error right under its field
//   3. one full-width primary button
//   4. "Não tem uma conta? Criar conta" / "Já tem uma conta? Entrar"
//   5. "Voltar", as plain text — never a button beside the primary one, where
//      it competed with it and swapped places between forms.

export const authInputClass =
  "h-11 w-full rounded-lg border border-zinc-300 bg-white px-3.5 text-base text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500";
// "!" because the base class sets its own (dark) border colors, and which of
// two same-specificity utilities wins depends on stylesheet order, not on the
// order they are written in className.
export const authInputInvalidClass = "border-red-400! focus:ring-red-500/20! dark:border-red-800!";
export const authInputValidClass = "border-emerald-500! dark:border-emerald-700!";
export const authPrimaryButtonClass =
  "flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
export const authSecondaryButtonClass =
  "flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900";
export const authLabelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";
const textLinkClass =
  "cursor-pointer font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100";

/**
 * Focuses the field on arrival only with a mouse. On a phone, autofocus throws
 * the keyboard over half the screen — and over the social buttons above the
 * fields — before anybody has decided how to sign in. Same rule as the home
 * page's own fields.
 */
export function useFocusWithMouse() {
  return useCallback((el: HTMLInputElement | null) => {
    if (el && window.matchMedia(FINE_POINTER_QUERY).matches) el.focus();
  }, []);
}

/** A label, its field, and whatever has to be said about that field — kept together. */
export function AuthField({
  label,
  htmlFor,
  aside,
  children,
  hint,
  error,
}: {
  label: ReactNode;
  htmlFor: string;
  /** Right-aligned on the label's line (e.g. "Esqueci minha senha"). */
  aside?: ReactNode;
  children: ReactNode;
  /** Neutral help, shown while there is no error. */
  hint?: ReactNode;
  error?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className={authLabelClass}>
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-red-500">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A password field with a show/hide button — mistyped passwords are the most common reason a signup or login fails. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  invalid?: boolean;
}) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : `${id}-hint`}
        className={`${authInputClass} pr-11 ${invalid ? authInputInvalidClass : ""}`}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? t("authForms.hidePassword") : t("authForms.showPassword")}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-lg text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        {shown ? <MdVisibilityOff className="h-5 w-5" /> : <MdVisibility className="h-5 w-5" />}
      </button>
    </div>
  );
}

/** "Não tem uma conta? Criar conta" — the one way across between the two forms, always in the same spot. */
export function AuthSwitch({ prompt, action, onClick }: { prompt: string; action: string; onClick: () => void }) {
  return (
    <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
      {prompt}{" "}
      <button type="button" onClick={onClick} className={textLinkClass}>
        {action}
      </button>
    </p>
  );
}

/** "Voltar", last and quiet: leaving is always possible, never the thing the eye lands on. */
export function AuthBack({ onClick, label }: { onClick: () => void; label?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-auto cursor-pointer rounded-md px-2 py-1 text-sm text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      {label ?? t("common.back")}
    </button>
  );
}

/** Small right-aligned text button on a field's label line. */
export function AuthAsideLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      {children}
    </button>
  );
}

/** The thin line with a word in it ("ou"). */
export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</span>
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

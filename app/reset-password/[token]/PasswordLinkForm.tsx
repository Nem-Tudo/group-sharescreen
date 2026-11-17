"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { setAccountToken } from "@/lib/accountApi";
import { trackEvent } from "@/lib/analytics";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { UserAvatar } from "@/components/UserAvatar";
import {
  fetchPasswordLink,
  PasswordLinkGoneError,
  setPasswordWithLink,
  type PasswordLinkInfo,
} from "@/lib/passwordLinkApi";
import { useT } from "@/lib/useI18n";

// The form behind an administrator's password link. Shows whose account it
// is, takes the new password twice, and spends the link.
//
// Logging in afterwards: automatic when nobody is signed in on this browser
// (or it is the same account). When somebody *else* is signed in — typically
// the administrator testing the link — their session is left alone and a
// button offers the switch instead.

const MIN_PASSWORD = 6;
const MAX_PASSWORD = 200;

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const primaryButtonClass =
  "flex items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";
const cardClass =
  "w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950";

type State =
  | { kind: "loading" }
  | { kind: "gone" }
  | { kind: "error"; message: string }
  | { kind: "ready"; info: PasswordLinkInfo }
  | { kind: "done"; username: string; session: string | null };

export function PasswordLinkForm({ token }: { token: string }) {
  const t = useT();
  const router = useRouter();
  const { account, loading: authLoading, refresh } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPasswordLink(token)
      .then((info) => {
        if (!cancelled) setState({ kind: "ready", info });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState(
          err instanceof PasswordLinkGoneError
            ? { kind: "gone" }
            : { kind: "error", message: err instanceof Error ? err.message : String(err) }
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    !submitting &&
    !authLoading &&
    password.length >= MIN_PASSWORD &&
    password.length <= MAX_PASSWORD &&
    confirm === password;

  async function signIn(session: string) {
    setAccountToken(session);
    await refresh();
    router.push("/");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || state.kind !== "ready") return;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await setPasswordWithLink(token, password);
      trackEvent("password_link_completed");
      const someoneElse = account && account.id !== result.account.id;
      if (someoneElse) {
        setState({ kind: "done", username: result.account.username, session: result.token });
      } else {
        setState({ kind: "done", username: result.account.username, session: null });
        await signIn(result.token);
      }
    } catch (err) {
      if (err instanceof PasswordLinkGoneError) setState({ kind: "gone" });
      else setFormError(err instanceof Error ? err.message : t("common.couldNotSave"));
    } finally {
      setSubmitting(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <div className={cardClass}>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("passwordLink.loading")}</p>
      </div>
    );
  }

  if (state.kind === "gone" || state.kind === "error") {
    return (
      <div className={cardClass}>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t("passwordLink.goneTitle")}
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {state.kind === "gone" ? t("passwordLink.goneBody") : state.message}
        </p>
      </div>
    );
  }

  if (state.kind === "done") {
    return (
      <div className={cardClass}>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t("passwordLink.doneTitle")}
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {state.session
            ? t("passwordLink.doneOtherAccount", { username: state.username })
            : t("passwordLink.doneBody", { username: state.username })}
        </p>
        {state.session && (
          <button
            type="button"
            onClick={() => void signIn(state.session!)}
            className={`mt-4 w-full ${primaryButtonClass}`}
          >
            {t("passwordLink.signInAs", { username: state.username })}
          </button>
        )}
      </div>
    );
  }

  const { info } = state;
  return (
    <div className={cardClass}>
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {t("passwordLink.title")}
      </h1>
      <div className="mt-4 flex items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <UserAvatar src={info.account.avatarUrl} name={info.account.displayName} size={40} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {info.account.displayName}
          </p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            @{info.account.username}
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t("passwordLink.intro")}</p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        {/* Lets password managers file the new password under the right account. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={info.account.username}
          readOnly
          hidden
        />
        <label htmlFor="link-password" className={labelClass}>
          {t("email.newPassword")}
        </label>
        <input
          id="link-password"
          type="password"
          autoFocus
          autoComplete="new-password"
          maxLength={MAX_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        {tooShort && (
          <p className="text-xs text-red-500">
            {t("passwordLink.tooShort", { min: MIN_PASSWORD })}
          </p>
        )}
        <label htmlFor="link-password-confirm" className={labelClass}>
          {t("passwordLink.confirm")}
        </label>
        <input
          id="link-password-confirm"
          type="password"
          autoComplete="new-password"
          maxLength={MAX_PASSWORD}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
        />
        {mismatch && <p className="text-xs text-red-500">{t("passwordLink.mismatch")}</p>}
        {formError && <p className="text-sm text-red-500">{formError}</p>}
        <button type="submit" disabled={!canSubmit} className={`mt-2 ${primaryButtonClass}`}>
          {submitting && <ButtonSpinner />}
          {t("email.changePassword")}
        </button>
      </form>
    </div>
  );
}

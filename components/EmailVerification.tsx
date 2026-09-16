"use client";

import { useCallback, useEffect, useState } from "react";
import { MdMailOutline, MdVerified } from "react-icons/md";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import {
  confirmEmailCode,
  fetchEmailState,
  sendEmailVerificationCode,
  type EmailState,
} from "@/lib/emailApi";
import { useT } from "@/lib/useI18n";

// Confirming the address on an account — optional, and shaped to say so.
// Nothing on this site is gated on a confirmed address; what it buys is that
// "esqueci minha senha" can reach you, which is why the copy leads with that
// rather than with a warning.
//
// Written to the same rules as AccountConnections next to it, which is the
// component it shares a card with: it renders *nothing at all* when it has
// nothing to offer, so the page that drops it in doesn't have to know whether
// this deployment can send email or whether this account even has an address.
// Three cases collapse to null — no session, no address (a Discord/Google
// signup that never had one), and a server with no RESEND_API_KEY — plus a
// fourth the caller asks for, see `hideWhenVerified`.

const rowButtonClass =
  "rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const inputClass =
  "w-32 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-center text-base tracking-[0.3em] text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

const CODE_LENGTH = 6;

export function EmailVerification({
  hideWhenVerified = false,
}: {
  /**
   * Whether a *confirmed* address is worth a row at all.
   *
   * True in the account popover, where the answer is no: that panel is a short
   * list of places to go, and a line that only ever says "sim, está tudo
   * certo" is clutter in it forever. False on /me, which is the page you open
   * precisely to look at settings — there the confirmed state is the useful
   * half, because it is how you check the address on file is the right one.
   */
  hideWhenVerified?: boolean;
}) {
  const t = useT();
  const { account } = useAuth();
  const [state, setState] = useState<EmailState | null>(null);
  const [code, setCode] = useState("");
  // Null when no code is outstanding; the masked address once one is.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const load = useCallback((signal?: AbortSignal) => {
    return fetchEmailState(signal)
      .then((next) => setState(next))
      // A card that could not load is a card that isn't shown. This is a
      // secondary block on a settings page; an error banner for it would be
      // louder than the thing itself.
      .catch(() => setState(null));
  }, []);

  useEffect(() => {
    // Nothing to load without a session — and nothing to clear either: the
    // render below already bails on `!account`, so a stale answer from a
    // previous session is never on screen, and signing back in refetches.
    if (!account) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [account, load]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function handleSend() {
    if (!state) return;
    setError(null);
    setPending(true);
    try {
      const result = await sendEmailVerificationCode();
      if (result.alreadyVerified) {
        // Confirmed from somewhere else in the meantime (another tab, or the
        // password reset, which confirms the address as a side effect).
        await load();
        return;
      }
      setSentTo(result.email ?? null);
      setResendIn(Math.ceil((state.cooldownMs || 60_000) / 1000));
      trackEvent("email_verification_sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("email.couldNotSend"));
    } finally {
      setPending(false);
    }
  }

  async function handleConfirm() {
    setError(null);
    setPending(true);
    try {
      await confirmEmailCode(code.trim());
      trackEvent("email_verified");
      setCode("");
      setSentTo(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("email.wrongCode"));
    } finally {
      setPending(false);
    }
  }

  // See the note at the top: nothing to offer means nothing on screen.
  if (!account || !state || !state.configured || !state.email) return null;
  // Confirmed *and* the caller only wanted the prompt — but not while a code
  // is still on screen, so the row does not vanish out from under somebody the
  // instant they finish typing it.
  if (state.verified && hideWhenVerified && !sentTo) return null;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {state.verified ? (
            <MdVerified className="h-5 w-5 shrink-0 text-emerald-500" />
          ) : (
            <MdMailOutline className="h-5 w-5 shrink-0 text-zinc-500" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {state.email}
            </p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {state.verified ? t("email.confirmed") : t("email.notConfirmed")}
            </p>
          </div>
        </div>
        {!state.verified && !sentTo && (
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={pending}
            className={`${rowButtonClass} flex items-center gap-2 border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
          >
            {pending && <ButtonSpinner />}
            {t("email.confirmAction")}
          </button>
        )}
      </div>

      {!state.verified && sentTo && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("email.codeSentTo", { email: sentTo, minutes: state.expiresInMinutes })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              placeholder="000000"
              value={code}
              // Digits only — a code pasted as "123 456" out of the email
              // would otherwise be truncated by maxLength halfway through.
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={pending || code.trim().length < CODE_LENGTH}
              className={`${rowButtonClass} flex items-center gap-2 border-transparent bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200`}
            >
              {pending && <ButtonSpinner />}
              {t("email.confirmAction")}
            </button>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={pending || resendIn > 0}
              className={`${rowButtonClass} border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
            >
              {resendIn > 0 ? t("email.resendIn", { seconds: resendIn }) : t("email.resend")}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}

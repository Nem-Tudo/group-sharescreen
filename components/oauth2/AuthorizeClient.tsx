"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MdCheck, MdLock } from "react-icons/md";
import { BotTag } from "@/components/BotTag";
import { LoginForm } from "@/components/LoginForm";
import { DEFAULT_AVATAR_PATH } from "@/components/UserAvatar";
import { useAuth } from "@/lib/AuthContext";
import { useAccountToken } from "@/lib/accountApi";
import {
  authorizeQuery,
  decideAuthorize,
  fetchAuthorizeInfo,
  type AuthorizeError,
  type AuthorizeInfo,
} from "@/lib/oauth2Api";
import { useI18n } from "@/lib/useI18n";

// The consent screen: who is asking, what for, and two buttons.
//
// Everything that decides anything is the API's — whether the application
// exists, whether the address it wants the answer sent to is one it
// registered, which scopes survive, whether this person has agreed before.
// This page renders that answer and carries the decision back; it never
// composes a redirect of its own, which is what keeps "where does the
// authorization go" a question only the API can answer.

const primaryButtonClass =
  "rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButtonClass =
  "rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900";

export function AuthorizeClient() {
  const { t } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const { account, loading } = useAuth();
  const token = useAccountToken();
  const query = useMemo(() => authorizeQuery(new URLSearchParams(search.toString())), [search]);

  // undefined while loading.
  const [info, setInfo] = useState<AuthorizeInfo | undefined>(undefined);
  const [failure, setFailure] = useState<AuthorizeError | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set the moment a decision is made, so the card is replaced by "levando
  // você de volta" instead of flickering back to the buttons while the
  // browser navigates away.
  const [leaving, setLeaving] = useState(false);

  // Read again whenever the signed-in account changes: signing in on this
  // very page is what turns "entre para continuar" into the buttons.
  useEffect(() => {
    const controller = new AbortController();
    // Both pieces of state are written from the answer rather than cleared
    // first: signing in re-runs this, and blanking the card in between would
    // make the application flash away and back for no reason.
    fetchAuthorizeInfo(query, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setInfo(result.ok ? result.info : undefined);
      setFailure(result.ok ? null : result.error);
    });
    return () => controller.abort();
  }, [query, token]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const result = await decideAuthorize(query, approve);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    setLeaving(true);
    // A full navigation, not router.push: the destination belongs to the
    // application, and leaving this site is exactly what is supposed to
    // happen next.
    window.location.href = result.redirect;
  }

  if (failure) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            {t("oauth2.authorize.couldNotContinue")}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{failure.description}</p>
          {failure.redirect ? (
            <a href={failure.redirect} className={primaryButtonClass}>
              {t("oauth2.authorize.backToTheApp")}
            </a>
          ) : (
            <Link href="/" className="text-sm font-medium underline underline-offset-4">
              {t("groups.inviteClient.goToHome")}
            </Link>
          )}
        </div>
      </Card>
    );
  }

  if (info === undefined || loading) {
    return (
      <Card>
        <p className="py-6 text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>
      </Card>
    );
  }

  const { application } = info;
  let host = "";
  try {
    host = new URL(info.redirectUri).host;
  } catch {
    host = info.redirectUri;
  }

  return (
    <Card>
      <div className="flex flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- an avatar from any host */}
        <img
          src={application.avatarUrl ?? DEFAULT_AVATAR_PATH}
          alt=""
          className="h-20 w-20 rounded-full object-cover ring-4 ring-white dark:ring-zinc-950"
        />
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            {application.displayName}
          </h1>
          <BotTag />
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("oauth2.authorize.wantsToAccessYourAccount")}
        </p>
        {application.owner && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            {t("oauth2.authorize.madeBy", { owner: `@${application.owner.username}` })}
          </p>
        )}
      </div>

      <div className="mt-6 w-full text-left">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t("oauth2.authorize.itWillBeAbleTo")}
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          {info.scopes.map((scope) => (
            <li key={scope} className="flex items-start gap-2">
              <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span className="text-sm text-zinc-600 dark:text-zinc-300">
                {t(`oauth2.scope.${scope}`)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {leaving ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          {t("oauth2.authorize.takingYouBack", { host })}
        </p>
      ) : !account ? (
        <div className="mt-6 flex w-full flex-col gap-3 text-left">
          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
            {t("oauth2.authorize.signInToContinue")}
          </p>
          <LoginForm onCancel={() => router.push("/")} />
        </div>
      ) : (
        <div className="mt-6 flex w-full flex-col gap-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("oauth2.authorize.youWillGoBackTo", { host })}
          </p>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => decide(false)}
              className={`flex-1 ${secondaryButtonClass}`}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide(true)}
              className={`flex-1 ${primaryButtonClass}`}
            >
              {info.alreadyGranted
                ? t("oauth2.authorize.continueAs", { name: account.displayName })
                : t("oauth2.authorize.authorize")}
            </button>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
            <MdLock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t("oauth2.authorize.youCanUndoThisLater")}</span>
          </p>
        </div>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <main className="flex w-full max-w-md flex-col items-center rounded-2xl border border-black/10 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-zinc-950">
        {children}
      </main>
    </div>
  );
}

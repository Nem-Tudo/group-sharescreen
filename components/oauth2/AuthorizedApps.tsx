"use client";

import { useEffect, useState } from "react";
import { BotTag } from "@/components/BotTag";
import { DEFAULT_AVATAR_PATH } from "@/components/UserAvatar";
import { useAuth } from "@/lib/AuthContext";
import { fetchAuthorizations, revokeAuthorization, type Authorization } from "@/lib/oauth2Api";
import { useT } from "@/lib/useI18n";

// The applications this account has said yes to, and the button that takes it
// back — the other half of the consent screen (see AuthorizeClient).
//
// A consent screen without this is a one-way door: people agree to things
// once and then have no way to see what they agreed to, which is the reason
// the API keeps a grant per application instead of only issuing tokens.
//
// Shaped like AccountConnections next to it, down to rendering nothing at all
// when there is nothing to show — an account that has never used "Entrar com
// GoLive" anywhere should not be given a section about it.

const rowButtonClass =
  "rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

export function AuthorizedApps() {
  const t = useT();
  const { account } = useAuth();
  // null while loading, and also when the list could not be read — either
  // way there is nothing honest to draw.
  const [apps, setApps] = useState<Authorization[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    fetchAuthorizations(controller.signal).then((next) => {
      if (!controller.signal.aborted) setApps(next);
    });
    return () => controller.abort();
  }, [account]);

  async function revoke(clientId: string) {
    setPending(clientId);
    setError(null);
    const ok = await revokeAuthorization(clientId);
    setPending(null);
    if (!ok) {
      setError(t("oauth2.apps.couldNotRevoke"));
      return;
    }
    setApps((current) => current?.filter((app) => app.clientId !== clientId) ?? null);
  }

  if (!apps || apps.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {t("oauth2.apps.connectedApps")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t("oauth2.apps.connectedApps")}
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {t("accountConnections.hide")}
        </button>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {t("oauth2.apps.theseCanReadYourAccount")}
      </p>
      {apps.map((app) => (
        <div
          key={app.clientId}
          className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- an avatar from any host */}
            <img
              src={app.application?.avatarUrl ?? DEFAULT_AVATAR_PATH}
              alt=""
              className="h-8 w-8 shrink-0 rounded-full object-cover"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm text-zinc-800 dark:text-zinc-200">
                  {app.application?.displayName ?? t("oauth2.apps.removedApp")}
                </span>
                {app.application && <BotTag />}
              </span>
              <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                {app.scopes.map((scope) => t(`oauth2.scope.${scope}`)).join(" · ")}
              </span>
            </span>
          </span>
          <button
            type="button"
            onClick={() => revoke(app.clientId)}
            disabled={pending !== null}
            className={`${rowButtonClass} shrink-0 border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900`}
          >
            {pending === app.clientId ? "..." : t("oauth2.apps.revoke")}
          </button>
        </div>
      ))}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

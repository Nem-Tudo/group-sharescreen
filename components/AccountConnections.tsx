"use client";

import { useEffect, useState } from "react";
import { FaDiscord } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import {
  fetchOAuthProviders,
  oauthErrorMessage,
  startOAuthLogin,
  type OAuthProvider,
  type OAuthProviderId,
} from "@/lib/oauthApi";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { useT } from "@/lib/useI18n";

// Connect/disconnect Discord and Google on an account that already exists —
// the path for everyone who registered with a username and password before
// social login existed. Linking here keeps the *same* account (same id,
// flags and history); it's a second way in, not a second account.
//
// The flow is the same one OAuthButtons uses, with one difference: the
// caller is logged in, so the session token rides along (see oauthApi's
// `link` option) and the API attaches the provider to that account instead
// of starting a new session.
//
// Collapsed behind its own trigger, and rendering nothing at all when the
// API has no provider configured, so the page that drops this in doesn't
// have to know either thing — it would otherwise need the provider list
// just to decide whether to show a link.

const PROVIDER_ICON: Record<OAuthProviderId, React.ReactNode> = {
  discord: <FaDiscord className="h-5 w-5 text-[#5865F2]" />,
  google: <FcGoogle className="h-5 w-5" />,
};

const rowButtonClass =
  "rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

export function AccountConnections() {
  const t = useT();
  const { connections, refresh, unlinkProvider } = useAuth();
  const [providers, setProviders] = useState<OAuthProvider[] | null>(null);
  const [pending, setPending] = useState<OAuthProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchOAuthProviders(controller.signal)
      .then(setProviders)
      .catch(() => setProviders([]));
    return () => controller.abort();
  }, []);

  async function handleConnect(provider: OAuthProviderId) {
    setError(null);
    setPending(provider);
    try {
      const result = await startOAuthLogin(provider, { link: true });
      if (result.kind === "token") {
        // The API re-issued the session token (same account, freshly
        // signed); oauthApi already stored it, so this only has to pull the
        // updated connection list.
        trackEvent("account_provider_linked");
        await refresh();
        return;
      }
      if (result.kind === "error") {
        if (result.error !== "cancelled") setError(oauthErrorMessage(result.error));
        return;
      }
      // A signup ticket means the API didn't recognise the session token it
      // was handed — the only realistic cause is a token that expired
      // between opening the page and clicking. Creating a *second* account
      // is never what was meant here, so the ticket is dropped.
      setError(t("accountConnections.yourSessionExpiredSignInAgain"));
    } finally {
      setPending(null);
    }
  }

  async function handleDisconnect(provider: OAuthProviderId) {
    setError(null);
    setPending(provider);
    try {
      await unlinkProvider(provider);
      trackEvent("account_provider_unlinked");
    } catch (err) {
      // Most likely the API refusing to remove the last way into the
      // account — its message says exactly that.
      setError(err instanceof Error ? err.message : t("common.couldNotDisconnect"));
    } finally {
      setPending(null);
    }
  }

  // `null` is "still loading", `[]` is "this deployment has no provider
  // configured" — either way there's nothing to offer, so not even the
  // trigger appears.
  if (!providers || providers.length === 0) return null;

  const linkedCount = providers.filter(
    (provider) => connections?.providers.includes(provider.id)
  ).length;

  if (!open) {
    return (
      // Shaped as one of the account menu's rows, which is this component's
      // only home. It used to be a blue underlined link, which read as a
      // stray piece of prose dropped into a list of controls — the one row
      // that looked like it belonged to another screen.
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {/* Spelled out while there's nothing linked: this is the only hint
            someone with an old username/password account gets that they can
            stop typing a password. */}
        {linkedCount === 0 ? t("accountConnections.linkDiscordOrGoogle") : t("accountConnections.connections")}
      </button>
    );
  }

  return (
    // Same horizontal padding as the collapsed row above, so opening the
    // section does not shift its contents sideways.
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("accountConnections.connections")}</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {t("accountConnections.hide")}
        </button>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {t("accountConnections.linkItToSignInWith")}
      </p>
      {providers.map((provider) => {
        const linked = connections?.providers.includes(provider.id) ?? false;
        const busy = pending === provider.id;
        return (
          <div
            key={provider.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
          >
            <span className="flex items-center gap-2.5 text-sm text-zinc-800 dark:text-zinc-200">
              {PROVIDER_ICON[provider.id]}
              {provider.label}
              {linked && (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  conectado
                </span>
              )}
            </span>
            {linked ? (
              <button
                type="button"
                onClick={() => handleDisconnect(provider.id)}
                disabled={pending !== null}
                className={`${rowButtonClass} border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900`}
              >
                {busy ? "..." : t("accountConnections.disconnect")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleConnect(provider.id)}
                disabled={pending !== null}
                className={`${rowButtonClass} border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200`}
              >
                {busy ? t("common.opening") : t("accountConnections.link")}
              </button>
            )}
          </div>
        );
      })}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

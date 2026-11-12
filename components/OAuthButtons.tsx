"use client";

import { useEffect, useState } from "react";
import { FaApple, FaDiscord } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import {
  fetchOAuthProviders,
  oauthErrorMessage,
  startOAuthLogin,
  type OAuthProvider,
  type OAuthProviderId,
  type OAuthResult,
} from "@/lib/oauthApi";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { useT } from "@/lib/useI18n";
import { trackFeatureEvent } from "@/lib/features";
import { APPLE_LOGIN_EVENTS, APPLE_LOGIN_FEATURE, useAppleLoginVisible } from "@/lib/appleLogin";
import { translate } from "@/lib/i18n";

// "Entrar com Discord/Google", wherever a login or signup form is shown.
//
// Which buttons appear comes from the API (only providers it holds
// credentials for), so a deployment without them renders nothing at all
// here rather than a button that 404s — including the surrounding divider.
//
// A first login with a provider comes back as a signup ticket instead of a
// session, and the username step that follows *replaces* the form these
// buttons sit under. That's why the ticket goes out through `onTicket`
// instead of being rendered here: this component can't hide its own parent,
// and rendering the step in place left the two stacked on screen.

const PROVIDER_STYLE: Record<
  OAuthProviderId,
  { className: string; icon: React.ReactNode }
> = {
  discord: {
    className:
      "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 cursor-pointer",
    icon: <FaDiscord className="h-5 w-5 text-[#5865F2]" />,
  },
  google: {
    className:
      "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 cursor-pointer",
    icon: <FcGoogle className="h-5 w-5" />,
  },
  // Apple's own rule for the button: black with the white logo (white on a
  // dark page), never restyled into the other providers' look.
  apple: {
    className:
      "border-black bg-black text-white hover:bg-zinc-800 dark:border-white dark:bg-white dark:text-black dark:hover:bg-zinc-200 cursor-pointer",
    icon: <FaApple className="h-5 w-5" />,
  },
};

export function OAuthButtons({
  onSuccess,
  onTicket,
  // Shown above the buttons; omitted where the surrounding form already
  // makes the context obvious.
  dividerLabel = translate("common.or"),
  // "below" when the buttons sit above a form, so the divider separates
  // them from the fields that follow.
  dividerPosition = "above",
}: {
  // Called for a plain login — the session already exists by then.
  onSuccess?: () => void;
  // Called when the login turned out to be a signup. The owner of the
  // surrounding UI takes it from here and shows the username step in place
  // of whatever form it was displaying.
  onTicket: (ticket: Extract<OAuthResult, { kind: "ticket" }>) => void;
  dividerLabel?: string | null;
  dividerPosition?: "above" | "below";
}) {
  const t = useT();
  const { refresh } = useAuth();
  const [providers, setProviders] = useState<OAuthProvider[] | null>(null);
  const [pending, setPending] = useState<OAuthProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchOAuthProviders(controller.signal)
      .then(setProviders)
      .catch(() => setProviders([]));
    return () => controller.abort();
  }, []);

  const appleVisible = useAppleLoginVisible(Boolean(providers?.some((p) => p.id === "apple")));

  async function handleClick(provider: OAuthProviderId) {
    setError(null);
    setPending(provider);
    if (provider === "apple") trackFeatureEvent(APPLE_LOGIN_EVENTS.click, { feature: APPLE_LOGIN_FEATURE });
    try {
      const result = await startOAuthLogin(provider);
      if (provider === "apple" && result.kind !== "error") {
        trackFeatureEvent(APPLE_LOGIN_EVENTS.done, { feature: APPLE_LOGIN_FEATURE });
      }
      if (result.kind === "error") {
        // A popup the user closed themselves needs no error message — they
        // know what they did.
        if (result.error !== "cancelled") setError(oauthErrorMessage(result.error));
        return;
      }
      if (result.kind === "ticket") {
        onTicket(result);
        return;
      }
      // The token is already stored by the time this resolves; refresh() is
      // what turns it into a resolved account (and a signaling registration)
      // without waiting for a reload.
      trackEvent("account_login_oauth");
      await refresh();
      onSuccess?.();
    } finally {
      setPending(null);
    }
  }

  // `null` is "still loading", `[]` is "this deployment has none" — both
  // render nothing, so the form never flashes an empty divider.
  // Apple first when shown, as its guidelines ask; hidden where it is not on
  // yet (see lib/appleLogin.ts).
  const shown = (providers ?? [])
    .filter((provider) => provider.id !== "apple" || appleVisible)
    .sort((a, b) => Number(b.id === "apple") - Number(a.id === "apple"));
  if (shown.length === 0) return null;

  const divider = dividerLabel && (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {dividerLabel}
      </span>
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {dividerPosition === "above" && divider}
      {shown.map((provider) => {
        const style = PROVIDER_STYLE[provider.id];
        return (
          <button
            key={provider.id}
            type="button"
            onClick={() => handleClick(provider.id)}
            disabled={pending !== null}
            className={`flex items-center justify-center gap-2.5 rounded-lg border px-4 py-2.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${style.className}`}
          >
            {style.icon}
            {pending === provider.id ? t("common.opening") : t("oAuthButtons.signInWithLabel", { label: provider.label })}
          </button>
        );
      })}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {dividerPosition === "below" && divider}
    </div>
  );
}

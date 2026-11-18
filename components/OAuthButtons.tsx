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
import { APPLE_LOGIN_EVENTS, APPLE_LOGIN_FEATURE, isApplePlatform, useAppleLoginVisible } from "@/lib/appleLogin";
import { translate } from "@/lib/i18n";
import { Tooltip } from "@/components/Tooltip";

// "Entrar com Discord/Google", wherever a login or signup form is shown.
//
// Every provider is drawn from the first frame, in its final place, and the
// API's list (only providers it holds credentials for) only decides which of
// them work. One it does not offer stays where it is, disabled, and says so on
// hover — rather than the old behaviour of drawing nothing until the list
// arrived, which made the whole form grow under the cursor a beat after it
// opened, and silently dropped a button somebody may have come looking for.
//
// A first login with a provider comes back as a signup ticket instead of a
// session, and the username step that follows *replaces* the form these
// buttons sit under. That's why the ticket goes out through `onTicket`
// instead of being rendered here: this component can't hide its own parent,
// and rendering the step in place left the two stacked on screen.

// What is drawn before the API answers, and the order it is drawn in.
const DEFAULT_PROVIDERS: OAuthProvider[] = [
  { id: "discord", label: "Discord" },
  { id: "google", label: "Google" },
  { id: "apple", label: "Apple" },
];

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
  // Off Apple devices: one more option, same look as the others.
  apple: {
    className:
      "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 cursor-pointer",
    icon: <FaApple className="h-5 w-5" />,
  },
};

// On Apple devices (and always in the iOS app, where App Review looks at it):
// Apple's own look, black with the white logo (white on a dark page), first.
const APPLE_HIGHLIGHT_STYLE: { className: string; icon: React.ReactNode } = {
  className:
    "border-black bg-black text-white hover:bg-zinc-800 dark:border-white dark:bg-white dark:text-black dark:hover:bg-zinc-200 cursor-pointer",
  icon: <FaApple className="h-5 w-5" />,
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

  // Apple is still behind its experiment (see lib/appleLogin.ts); that decides
  // whether it is drawn at all. Whether it *works* is the API's list, like the
  // others.
  const appleVisible = useAppleLoginVisible(true);

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

  // `null` is "still loading": every button is drawn and clickable, since the
  // list almost always lands before anybody reaches for one, and a provider
  // that turns out to be missing answers with an error message anyway.
  // Apple is hidden where it is not on yet (see lib/appleLogin.ts). On Apple
  // devices it leads, in Apple's look; elsewhere it goes last, looking like
  // the rest.
  const appleDevice = isApplePlatform();
  const offered = new Map((providers ?? []).map((provider) => [provider.id, provider]));
  const shown = DEFAULT_PROVIDERS.map((provider) => offered.get(provider.id) ?? provider)
    .filter((provider) => provider.id !== "apple" || appleVisible)
    .sort((a, b) => (Number(b.id === "apple") - Number(a.id === "apple")) * (appleDevice ? 1 : -1));

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
        const style = provider.id === "apple" && appleDevice ? APPLE_HIGHLIGHT_STYLE : PROVIDER_STYLE[provider.id];
        const unavailable = providers !== null && !offered.has(provider.id);
        return (
          <Tooltip
            key={provider.id}
            content={unavailable ? t("oAuthButtons.unavailable", { label: provider.label }) : null}
            // A disabled button fires no pointer events, so the hint hangs
            // off a wrapper (see Tooltip's wrapperClassName).
            wrapperClassName={unavailable ? "flex w-full" : undefined}
          >
            <button
              type="button"
              onClick={() => handleClick(provider.id)}
              disabled={pending !== null || unavailable}
              aria-disabled={unavailable || undefined}
              className={`flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border px-4 font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${style.className}`}
            >
              {style.icon}
              {pending === provider.id ? t("common.opening") : t("oAuthButtons.continueWithLabel", { label: provider.label })}
            </button>
          </Tooltip>
        );
      })}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {dividerPosition === "below" && divider}
    </div>
  );
}

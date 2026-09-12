"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { setAccountToken } from "@/lib/accountApi";
import {
  oauthErrorMessage,
  parseOAuthFragment,
  type OAuthMessage,
  type OAuthResult,
} from "@/lib/oauthApi";
import { desktopOAuthNonce } from "@/lib/desktop";
import { CompleteOAuthSignupForm } from "@/components/CompleteOAuthSignupForm";
import { useT } from "@/lib/useI18n";

// Custom protocol the desktop build registers with the OS. Handing the
// result over this way is what lets the login itself happen in the user's
// real browser — which is not a stylistic choice: providers refuse to
// authenticate inside an embedded browser window (Google rejects it
// outright as `disallowed_useragent`).
const DESKTOP_PROTOCOL = "golive";

// Where the API sends the browser back at the end of the OAuth dance, with
// the outcome in the URL fragment (see the API's server/oauthRoutes.ts).
//
// Two ways to get here, and this page handles both:
//
//   popup    — the normal case (oauthApi.startOAuthLogin). The result is
//              posted to the opener, which owns the UI, and this window
//              closes. Nothing is rendered for more than a blink.
//   redirect — the fallback when the popup was blocked. There's no opener,
//              so this page finishes the job itself: stores the token, or
//              shows the username step, then returns to where the user was.
export default function OAuthCallbackPage() {
  const t = useT();
  const router = useRouter();
  const [result, setResult] = useState<OAuthResult | null>(null);
  // Only ever true in redirect mode — in popup mode this window is gone
  // before anything is painted.
  const [handledInline, setHandledInline] = useState(false);
  // Set when this page's only remaining job was to hand the result back to
  // the desktop app — there is nothing to render but a "you can close this".
  const [handedToDesktop, setHandedToDesktop] = useState(false);

  useEffect(() => {
    const rawHash = window.location.hash;
    const parsed = parseOAuthFragment(rawHash);
    // Strips the token/ticket out of the address bar (and out of the
    // history entry) as soon as it's been read.
    window.history.replaceState(null, "", window.location.pathname);

    const outcome: OAuthResult = parsed ?? {
      kind: "error",
      error: "unknown",
      next: "/",
    };

    // A login that started in the desktop app. `next` carries the marker
    // path the app planted in `returnTo` (see lib/desktop.ts) — the one
    // part of that URL the API preserves — so this is how a browser tab
    // that has no opener still knows where the result belongs.
    //
    // The whole fragment is forwarded verbatim rather than re-serialised:
    // the app parses it with the very same parseOAuthFragment, so anything
    // reshaped here would be a second format to keep in sync for no gain.
    if (desktopOAuthNonce(outcome.next)) {
      // Not an internal Next route, so the router is the wrong tool and the
      // lint rule's advice does not apply: this is a handoff to another
      // *application* over a custom OS protocol, which only a real
      // navigation can trigger.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `${DESKTOP_PROTOCOL}://oauth${rawHash.startsWith("#") ? rawHash : `#${rawHash}`}`;
      // Every setState in this effect is covered by this one disable — the
      // rule reports once per effect, and this is the first one to run.
      //
      // The rule's usual advice (derive it during render) can't apply here:
      // the result lives in window.location.hash, which doesn't exist during
      // the server render, so reading it in a state initializer would either
      // throw or hydrate into a mismatch. Reading it after mount and setting
      // state once is the only correct order — and it happens exactly once,
      // so there's no cascade to speak of.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHandedToDesktop(true);
      return;
    }

    const opener = window.opener as Window | null;
    if (opener && !opener.closed) {
      const message: OAuthMessage = { source: "golive-oauth", result: outcome };
      // Targeted at this exact origin, never "*": the payload can be a
      // session token, and the opener is same-origin by construction.
      opener.postMessage(message, window.location.origin);
      window.close();
      return;
    }

    // Set after mount rather than derived during render — see the
    // set-state-in-effect note on the desktop branch above, which covers
    // this call too.
    setResult(outcome);
    setHandledInline(true);
    if (outcome.kind === "token") {
      setAccountToken(outcome.token);
      // AuthContext picks the new token up on its own (it subscribes to the
      // same store), so this only has to get the user back where they were.
      router.replace(outcome.next);
    }
  }, [router]);

  if (handedToDesktop) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t("oauth.callback.signInComplete")}
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t("oauth.callback.goBackToTheGoliveApp")}
          </p>
        </div>
      </main>
    );
  }

  if (!handledInline || !result) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("oauth.callback.finishingSignIn")}</p>
      </main>
    );
  }

  if (result.kind === "ticket") {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <CompleteOAuthSignupForm
            ticket={result.ticket}
            provider={result.provider}
            suggestedUsername={result.suggestedUsername}
            suggestedDisplayName={result.suggestedDisplayName}
            onSuccess={() => router.replace(result.next)}
            onCancel={() => router.replace(result.next)}
          />
        </div>
      </main>
    );
  }

  if (result.kind === "error") {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <p className="text-sm text-red-500">{oauthErrorMessage(result.error)}</p>
          <button
            type="button"
            onClick={() => router.replace(result.next)}
            className="mt-4 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {t("common.back")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("common.joining")}</p>
    </main>
  );
}

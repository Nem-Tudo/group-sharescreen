"use client";

import type { CaptchaAction } from "./recaptcha";

// Cloudflare Turnstile — the challenge somebody is actually shown when the
// invisible reCAPTCHA v3 check refuses them (see lib/recaptcha.ts and the
// API's server/captcha.ts).
//
// Turnstile rather than reCAPTCHA v2 for one concrete reason: v2's widget is
// served by the same script from the same domain that a privacy extension has
// usually already blocked, so escalating to it would show a blocked person an
// empty box. This comes from challenges.cloudflare.com — a different origin,
// and one far less often on a blocklist — so it is a genuine second chance
// rather than the same wall twice.
//
// Loaded on demand, unlike reCAPTCHA's script in app/layout.tsx: only the
// people the invisible check turned away ever need it, and making every
// visitor download a challenge almost none of them will see is paying for the
// exception on every page load.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// `render=explicit` because the widget goes into a modal that does not exist
// at load time — the script must wait to be told where to draw rather than
// scanning the document for a container that is not there yet.
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_TIMEOUT_MS = 10_000;

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme?: "auto" | "light" | "dark";
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
    }
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Thrown by an API call the server refused with a captcha 403 that offered a
 * challenge — as opposed to any other failure, which is just an error to print
 * under the form.
 *
 * Its own class rather than a flag on the message, because the callers that
 * care have to tell the two apart: a wrong password and "we are not sure you
 * are a person" both come back as a rejected promise with Portuguese prose the
 * server owns, and matching on that prose to decide whether to open a modal
 * would be a string comparison standing between somebody and their account.
 */
export class CaptchaChallengeRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptchaChallengeRequiredError";
  }
}

/**
 * Reads a failed response and decides which of the two it is.
 *
 * Every captcha-gated call in this app funnels its `!res.ok` through here, so
 * that "the server offered a challenge" is decided once. It escalates only
 * when both halves agree there is a challenge to show: the server holds the
 * Turnstile secret and says so with `challenge`, this app holds the site key —
 * and a modal opened without the latter is an empty box with a cancel button.
 */
export async function errorForFailedCaptchaGatedResponse(
  res: Response,
  fallbackMessage: string
): Promise<Error> {
  const data = (await res.json().catch(() => null)) as {
    error?: string;
    challenge?: boolean;
  } | null;
  const message = data?.error || fallbackMessage;
  if (res.status === 403 && data?.challenge && isTurnstileConfigured()) {
    return new CaptchaChallengeRequiredError(message);
  }
  return new Error(message);
}

/**
 * Whether a challenge can be offered at all on this deployment. The server
 * decides this independently (it holds the secret key), and both halves have
 * to be configured for the fallback to exist — this one only stops the client
 * opening a modal it could never fill.
 */
export function isTurnstileConfigured(): boolean {
  return Boolean(SITE_KEY);
}

// One load per page, shared by every caller. Kept as the promise rather than a
// boolean so two near-simultaneous callers wait on the same <script> instead
// of injecting a second one.
let scriptPromise: Promise<TurnstileApi | null> | null = null;

function loadScript(): Promise<TurnstileApi | null> {
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi | null>((resolve) => {
    let settled = false;
    const settle = (api: TurnstileApi | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      // A failed load is not cached: the usual cause is an extension the
      // person may well switch off before pressing the button again, and a
      // remembered "no" would make that have no effect.
      if (!api) scriptPromise = null;
      resolve(api);
    };
    const timeout = setTimeout(() => settle(null), SCRIPT_TIMEOUT_MS);

    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    // onload fires when the file has run, but `render` is published during
    // that run — polling briefly covers the gap rather than assuming it.
    script.onload = () => {
      const start = Date.now();
      const poll = setInterval(() => {
        if (window.turnstile?.render) {
          clearInterval(poll);
          settle(window.turnstile);
        } else if (Date.now() - start > 2_000) {
          clearInterval(poll);
          settle(null);
        }
      }, 50);
    };
    script.onerror = () => settle(null);
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export type TurnstileWidget = {
  /** Clears the widget so the person can attempt it again. */
  reset: () => void;
  /** Tears it down — the modal is closing, or React is unmounting it. */
  remove: () => void;
};

/**
 * Draws a challenge into `container` and calls `onToken` with the result.
 *
 * Resolves null when the script never arrived, which is the one case the
 * caller has to show something for: at that point both checks have failed to
 * load and there is nothing left to put on screen.
 */
export async function renderTurnstile(
  container: HTMLElement,
  {
    onToken,
    onError,
    action = "join_room",
    theme = "auto",
  }: {
    onToken: (token: string) => void;
    onError?: () => void;
    // Which gated action this challenge is standing in for. Must be the one
    // the API will verify the answer against — a challenge solved for
    // "join_room" and sent to /auth/login is refused as a replay, so this
    // travels with the caller rather than being assumed.
    action?: CaptchaAction;
    theme?: "auto" | "light" | "dark";
  }
): Promise<TurnstileWidget | null> {
  if (!SITE_KEY) return null;
  const api = await loadScript();
  if (!api) return null;

  let widgetId: string;
  try {
    widgetId = api.render(container, {
      sitekey: SITE_KEY,
      // Must match the CaptchaAction the API verifies against, for the same
      // replay reason the reCAPTCHA path names its action.
      action,
      theme,
      callback: onToken,
      "error-callback": onError,
      // A solved challenge goes stale after a few minutes. Clearing it is
      // better than leaving a tick on screen that buys nothing.
      "expired-callback": () => api.reset(widgetId),
    });
  } catch {
    return null;
  }

  return {
    reset: () => {
      try {
        api.reset(widgetId);
      } catch {
        // The widget is already gone; there is nothing to reset.
      }
    },
    remove: () => {
      try {
        api.remove(widgetId);
      } catch {
        // Same.
      }
    },
  };
}

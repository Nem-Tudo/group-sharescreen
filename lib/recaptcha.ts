"use client";

// Google reCAPTCHA v3 — the invisible, score-based check that gates this app's
// handful of destructive actions: creating an account, signing in, finishing an
// OAuth signup, and joining (which is also how you *create*) a room. It
// replaced Cloudflare Turnstile, which gated only the last of those.
//
// v3 never shows a challenge to anyone, ever. There is no widget, no checkbox
// and no image grid — calling execute() below produces a token that encodes
// Google's own confidence that the caller is a person, and server/captcha.ts
// decides what score is good enough. That is why this file has none of the
// widget lifecycle the Turnstile one needed (render, reset, show, hide): there
// is nothing to show.
//
// Opt-in via NEXT_PUBLIC_RECAPTCHA_SITE_KEY. Unset, and getCaptchaToken()
// resolves null immediately — the server no-ops its own check the same way
// when RECAPTCHA_SECRET_KEY isn't configured, so an unconfigured deployment
// (local dev, or before both halves are wired up) behaves exactly as it did
// before any of this existed.
const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

/**
 * What the token is being minted for.
 *
 * Must match server/captcha.ts's CaptchaAction exactly: Google signs the action
 * into the token and the server refuses one minted for anything else, which is
 * what stops a token harvested from a cheap action being replayed against an
 * expensive one. A value that only one side knows about silently turns that
 * check into a rejection, so the two lists move together.
 */
export type CaptchaAction = "join_room" | "register_account" | "login" | "oauth_signup";

interface GrecaptchaApi {
  ready: (cb: () => void) => void;
  execute: (siteKey: string, options: { action: string }) => Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: GrecaptchaApi;
  }
}

// How long to wait for www.google.com/recaptcha/api.js (loaded via <Script> in
// app/layout.tsx, strategy="afterInteractive") before giving up on a call — a
// direct link straight into /watch/[handle] can trigger a join before that
// script has finished, and an ad blocker may mean it never arrives at all.
const SCRIPT_READY_TIMEOUT_MS = 8_000;
// Ceiling on execute() itself. It is normally near-instant, but it is a network
// call to Google and this sits in front of a user pressing a button.
const EXECUTE_TIMEOUT_MS = 10_000;

// Set once the script has been waited out and never arrived — almost always
// an ad blocker or privacy extension, since reCAPTCHA is on most blocklists.
//
// Remembered because the join path retries: without this, four attempts each
// spend the full SCRIPT_READY_TIMEOUT_MS waiting for a script that is not
// coming, so somebody with uBlock sits on "Entrando..." for half a minute
// before being told anything at all. With it, the second attempt onwards
// fails instantly and the person gets a message they can act on.
let scriptUnavailable = false;

/** Whether the last attempt found reCAPTCHA's script missing (see above). */
export function isCaptchaScriptUnavailable(): boolean {
  return scriptUnavailable;
}

/**
 * Forgets that verdict, so the next call waits for the script again.
 *
 * Called when somebody presses "Tentar novamente": the most likely thing they
 * did between the failure and the button is turn off the extension that
 * caused it, and a cached "blocked" would make that have no effect.
 */
export function resetCaptchaScriptCache(): void {
  scriptUnavailable = false;
}

function waitForScript(): Promise<GrecaptchaApi | null> {
  if (window.grecaptcha?.execute) {
    scriptUnavailable = false;
    return Promise.resolve(window.grecaptcha);
  }
  if (scriptUnavailable) return Promise.resolve(null);
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      // `execute` specifically, not just the object: the script defines
      // window.grecaptcha before it has finished setting itself up, so checking
      // for the namespace alone can hand back something that throws.
      if (window.grecaptcha?.execute) {
        clearInterval(interval);
        scriptUnavailable = false;
        resolve(window.grecaptcha);
      } else if (Date.now() - start > SCRIPT_READY_TIMEOUT_MS) {
        clearInterval(interval);
        scriptUnavailable = true;
        resolve(null);
      }
    }, 100);
  });
}

/**
 * Resolves a fresh, single-use token for `action`, or null when reCAPTCHA is
 * not configured, the script never loaded, or Google refused to issue one.
 *
 * Callers send whatever comes back as-is and let the server decide: a null is
 * acceptable exactly when the server has no secret key configured, or has one
 * but RECAPTCHA_ENFORCE is still off. Deciding that here would mean the client
 * enforcing its own gate, which is worth nothing — a real bot does not run this
 * code at all.
 *
 * A token expires after two minutes and is spent by the first verification, so
 * this must be called immediately before the action it protects rather than
 * cached or reused.
 */
export async function getCaptchaToken(action: CaptchaAction): Promise<string | null> {
  if (!SITE_KEY || typeof window === "undefined") return null;
  const grecaptcha = await waitForScript();
  if (!grecaptcha) return null;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(token);
    };
    const timeout = setTimeout(() => settle(null), EXECUTE_TIMEOUT_MS);
    try {
      // ready() queues until the script's own initialisation is done. It can
      // fire synchronously if that already happened, which is the common case
      // for everything except the very first call on a cold page.
      grecaptcha.ready(() => {
        grecaptcha
          .execute(SITE_KEY, { action })
          .then((token) => settle(typeof token === "string" && token ? token : null))
          .catch(() => settle(null));
      });
    } catch {
      settle(null);
    }
  });
}

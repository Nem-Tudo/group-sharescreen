"use client";

// Cloudflare Turnstile — the only bot check this app runs.
//
// It replaced Google reCAPTCHA v3, which used to sit invisibly in front of
// everything with Turnstile bolted on behind it as a manual escalation. The
// two-provider arrangement is gone, and with it a whole protocol: there is no
// "the invisible check refused you, here is a modal" step any more, because
// Turnstile does that part itself. A widget rendered with
// `appearance: "interaction-only"` shows nothing to the overwhelming majority
// of people and quietly hands back a token; when Cloudflare is unsure, it puts
// a real challenge on screen, and the token arrives once it is solved. Same
// call, same return value, either way — which is why every caller here is a
// plain `await getCaptchaToken(action)` and none of them know whether the
// person was shown anything.
//
// What that buys, beyond one provider instead of two:
//
//   - Nobody is refused for a *score* any more. v3 rated people 0..1 and the
//     server picked a threshold, so a VPN, a private window or the Instagram
//     in-app browser could be turned away with nothing to do about it.
//     Turnstile is pass/fail and shows a challenge to whoever it is unsure
//     about, so being unusual costs a click rather than access.
//   - The script that has to load is challenges.cloudflare.com rather than
//     www.google.com/recaptcha/api.js. The latter is on nearly every privacy
//     blocklist, which meant the people most likely to be refused were also
//     the ones whose token never got minted.
//
// The one thing this cannot do is survive its own script being blocked: there
// is no third provider behind it. getCaptchaToken resolves null in that case
// and the server says so in words somebody can act on (see the API's
// CAPTCHA_DENIED_MESSAGE.missing).
//
// Opt-in via NEXT_PUBLIC_TURNSTILE_SITE_KEY. Unset, and getCaptchaToken()
// resolves null immediately — the server no-ops its own check the same way
// when TURNSTILE_SECRET_KEY isn't configured, so an unconfigured deployment
// (local dev, or before both halves are wired up) behaves exactly as it did
// before any of this existed.
//
// Note for whoever configures the key: whether a given person is shown
// anything is decided by the widget mode on the Cloudflare dashboard, not by
// this file. "Managed" is the one that matches the intent here — invisible
// unless Cloudflare wants interaction. "Non-Interactive" never challenges
// anybody (and so refuses the people it is unsure about, which is the failure
// mode this migration existed to remove), and "Invisible" hides the widget
// even when it needs interaction.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * What the token is being minted for.
 *
 * Must match the API's CaptchaAction exactly: Cloudflare signs the action into
 * the token and the server refuses one minted for anything else, which is what
 * stops a token harvested from a cheap action being replayed against an
 * expensive one. A value that only one side knows about silently turns that
 * check into a rejection, so the two lists move together.
 */
export type CaptchaAction = "join_room" | "register_account" | "login" | "oauth_signup";

// `render=explicit` because the widgets here are created on demand, one per
// gated action, rather than existing in the page's markup for the script to
// find on load.
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// How long to wait for the script before giving up on a call. It is normally
// already there — app/layout.tsx loads it on every page — but a direct link
// straight into /watch/[handle] can trigger a join before that finished, and
// an ad blocker may mean it never arrives at all.
const SCRIPT_TIMEOUT_MS = 10_000;

// Ceiling on one widget's whole lifetime, from render to token.
//
// Generous on purpose, and much longer than the old reCAPTCHA equivalent:
// this window may now contain a *person* solving a challenge, not just a
// round trip. Cloudflare's own challenge pages allow minutes; cutting somebody
// off mid-puzzle to tell them the check failed would be inventing a failure.
const TOKEN_TIMEOUT_MS = 120_000;

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme?: "auto" | "light" | "dark";
      appearance?: "always" | "execute" | "interaction-only";
      callback: (token: string) => void;
      "error-callback"?: (code?: string) => void;
      "expired-callback"?: () => void;
      "timeout-callback"?: () => void;
      "before-interactive-callback"?: () => void;
      "after-interactive-callback"?: () => void;
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
 * Whether the check can run at all on this deployment.
 *
 * The server decides this independently (it holds the secret key), and both
 * halves have to be configured for anyone to be verified — this one only stops
 * the client trying to mint a token it has no key for.
 */
export function isCaptchaConfigured(): boolean {
  return Boolean(SITE_KEY);
}

// Set once the script has been waited out and never arrived — almost always
// an ad blocker or privacy extension.
//
// Remembered because the join path retries: without this, four attempts each
// spend the full SCRIPT_TIMEOUT_MS waiting for a script that is not coming, so
// somebody with uBlock sits on "Entrando..." for most of a minute before being
// told anything at all. With it, the second attempt onwards fails instantly
// and the person gets a message they can act on.
let scriptUnavailable = false;

/** Whether the last attempt found Turnstile's script missing (see above). */
export function isCaptchaScriptUnavailable(): boolean {
  return scriptUnavailable;
}

/**
 * Forgets that verdict, so the next call waits for the script again.
 *
 * Called when somebody presses "Tentar novamente": the most likely thing they
 * did between the failure and the button is turn off the extension that caused
 * it, and a cached "blocked" would make that have no effect.
 */
export function resetCaptchaScriptCache(): void {
  scriptUnavailable = false;
}

// One load per page, shared by every caller. Kept as the promise rather than a
// boolean so two near-simultaneous callers wait on the same <script> instead
// of injecting a second one.
let scriptPromise: Promise<TurnstileApi | null> | null = null;

function loadScript(): Promise<TurnstileApi | null> {
  if (window.turnstile?.render) {
    scriptUnavailable = false;
    return Promise.resolve(window.turnstile);
  }
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi | null>((resolve) => {
    let settled = false;
    const settle = (api: TurnstileApi | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      scriptUnavailable = api === null;
      // A failed load is not cached: the usual cause is an extension the
      // person may well switch off before pressing the button again, and a
      // remembered "no" would make that have no effect. (scriptUnavailable
      // above is a *hint* for the retry path, and resetCaptchaScriptCache
      // clears it; this is the actual load.)
      if (!api) scriptPromise = null;
      resolve(api);
    };
    const timeout = setTimeout(() => settle(null), SCRIPT_TIMEOUT_MS);

    // Polled rather than driven by the script's own onload, because the tag
    // may already be in the document: app/layout.tsx renders it on every page,
    // so by the time anything calls this the element usually exists and its
    // load event has either fired or is about to. Watching for the global is
    // the one check that is correct in both cases — and it also covers the gap
    // between the file having run and `render` being published during that
    // run.
    const poll = setInterval(() => {
      if (window.turnstile?.render) settle(window.turnstile);
    }, 50);

    if (!document.querySelector(`script[src="${SCRIPT_URL}"]`)) {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onerror = () => settle(null);
      document.head.appendChild(script);
    }
  });

  return scriptPromise;
}

// ─── Where a challenge appears, on the rare occasion there is one ─────────
//
// Plain DOM rather than a React component, and owned by this module rather
// than by a caller, for one reason that decides it: lib/signalingClient.ts is
// not a component and cannot render one. It calls getCaptchaToken() from a
// plain class on the way into a room, and if Cloudflare decides that person
// needs a challenge, the challenge has to go *somewhere*. Making each caller
// provide a host would mean every one of them — two React forms, an admin
// page, and a WebSocket client — reimplementing the same overlay, and the
// signaling one could not.
//
// It is empty and display:none for almost everybody. Only
// `before-interactive-callback` — Cloudflare telling us it is about to need
// the screen — ever makes it visible.

let overlay: HTMLDivElement | null = null;
let overlayBody: HTMLDivElement | null = null;
let overlayHost: HTMLDivElement | null = null;
// How many widgets currently want the overlay visible. A count rather than a
// boolean because two gated actions can genuinely overlap (a join firing while
// a login is in flight), and the first one to finish must not pull the screen
// out from under the second.
let interactiveCount = 0;

function isDarkTheme(): boolean {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function ensureOverlay(): HTMLDivElement {
  if (overlayHost) return overlayHost;

  overlay = document.createElement("div");
  // Inline styles, not Tailwind classes: this element is created at runtime
  // from a string, and Tailwind only emits the classes it can see in the
  // source. A class name assembled here would compile to nothing.
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483000",
    "display:none",
    "align-items:center",
    "justify-content:center",
    "padding:16px",
    "background:rgba(0,0,0,0.6)",
  ].join(";");

  overlayBody = document.createElement("div");
  overlayBody.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "gap:14px",
    "width:100%",
    "max-width:24rem",
    "padding:24px",
    "border-radius:16px",
    "text-align:center",
    "box-shadow:0 20px 60px rgba(0,0,0,0.35)",
    "font-family:system-ui,-apple-system,'Segoe UI',sans-serif",
  ].join(";");

  const title = document.createElement("h2");
  title.textContent = "Confirme que você não é um robô";
  title.style.cssText = "margin:0;font-size:1.125rem;font-weight:600;";

  const subtitle = document.createElement("p");
  subtitle.textContent =
    "Isso aparece raramente, só quando a verificação automática não tem certeza. É rápido.";
  subtitle.style.cssText = "margin:0;font-size:0.875rem;line-height:1.4;";

  overlayHost = document.createElement("div");
  overlayHost.style.cssText = "min-height:65px;display:flex;align-items:center;justify-content:center;";

  overlayBody.append(title, subtitle, overlayHost);
  overlay.appendChild(overlayBody);
  document.body.appendChild(overlay);

  // Kept in a closure over the two elements the theme actually colours, so
  // paintTheme can be called again every time the overlay is shown — somebody
  // may have flipped the theme since it was built.
  const paintTheme = () => {
    const dark = isDarkTheme();
    overlayBody!.style.background = dark ? "#09090b" : "#ffffff";
    overlayBody!.style.border = dark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.1)";
    title.style.color = dark ? "#fafafa" : "#09090b";
    subtitle.style.color = dark ? "#a1a1aa" : "#71717a";
  };
  paintTheme();
  overlayThemePainter = paintTheme;

  return overlayHost;
}

let overlayThemePainter: (() => void) | null = null;

function showOverlay() {
  interactiveCount += 1;
  if (!overlay) return;
  overlayThemePainter?.();
  overlay.style.display = "flex";
}

function hideOverlay() {
  interactiveCount = Math.max(0, interactiveCount - 1);
  if (overlay && interactiveCount === 0) overlay.style.display = "none";
}

/**
 * Resolves a fresh, single-use token for `action`, or null when Turnstile is
 * not configured, the script never loaded, or Cloudflare refused to issue one.
 *
 * Usually invisible and near-instant. Occasionally it puts a challenge on
 * screen and does not resolve until the person has solved it — so a caller
 * that shows a "carregando" state should be prepared for this to take as long
 * as a human takes, rather than treating a slow answer as a hang.
 *
 * Callers send whatever comes back as-is and let the server decide: a null is
 * acceptable exactly when the server has no secret key configured, or has one
 * but TURNSTILE_ENFORCE is still off. Deciding that here would mean the client
 * enforcing its own gate, which is worth nothing — a real bot does not run this
 * code at all.
 *
 * A token expires after five minutes and is spent by the first verification,
 * so this must be called immediately before the action it protects rather than
 * cached or reused.
 */
export async function getCaptchaToken(action: CaptchaAction): Promise<string | null> {
  if (!SITE_KEY || typeof window === "undefined") return null;
  const api = await loadScript();
  if (!api) return null;

  const host = ensureOverlay();
  // Its own container inside the host, so two overlapping calls each get their
  // own widget instead of rendering over one another.
  const container = document.createElement("div");
  host.appendChild(container);

  return new Promise<string | null>((resolve) => {
    let settled = false;
    let widgetId: string | null = null;
    // Tracked so the cleanup below only un-shows the overlay if this widget is
    // what showed it — decrementing a count we never incremented would hide a
    // challenge somebody else is still solving.
    let wentInteractive = false;

    const settle = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      // Reset alongside the call, not just before it: Cloudflare may still
      // fire after-interactive-callback for a widget that already produced
      // its token, and a second hideOverlay() for the same widget would
      // decrement a count that is holding the screen open for a *different*
      // one — pulling a challenge out from under somebody mid-solve.
      if (wentInteractive) {
        wentInteractive = false;
        hideOverlay();
      }
      if (widgetId !== null) {
        try {
          api.remove(widgetId);
        } catch {
          // Already gone; nothing to remove.
        }
      }
      container.remove();
      resolve(token);
    };

    const timeout = setTimeout(() => settle(null), TOKEN_TIMEOUT_MS);

    try {
      widgetId = api.render(container, {
        sitekey: SITE_KEY,
        action,
        theme: isDarkTheme() ? "dark" : "light",
        // The whole point: draw nothing unless Cloudflare decides this person
        // has to interact. With "always" (the default) every visitor would see
        // a widget on every gated action, which is the reCAPTCHA badge problem
        // in a louder form.
        appearance: "interaction-only",
        callback: (token) => settle(token),
        // A code is passed but deliberately not surfaced: it names Cloudflare's
        // internal failure, and the caller's own message ("could not verify,
        // try again") is the only thing a person can act on either way.
        "error-callback": () => settle(null),
        // The token went stale before it was spent. Nothing here is holding
        // one — settle() ends the widget's life — so this can only fire for a
        // challenge left unsolved on screen.
        "expired-callback": () => settle(null),
        // The person was shown a challenge and did not finish it in the time
        // Cloudflare allows.
        "timeout-callback": () => settle(null),
        "before-interactive-callback": () => {
          wentInteractive = true;
          showOverlay();
        },
        // Fires when the interactive part is done — whether it was solved or
        // abandoned. The token (if there is one) arrives separately through
        // `callback`, so this only puts the screen back.
        "after-interactive-callback": () => {
          if (!wentInteractive) return;
          wentInteractive = false;
          hideOverlay();
        },
      });
    } catch {
      settle(null);
    }
  });
}

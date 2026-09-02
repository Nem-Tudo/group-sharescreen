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
// The rule that decides how this is built, and that the first version got
// wrong: **the widget's container has to be visible and measurable at all
// times**, including while nothing is being shown. Turnstile inspects the
// element it was handed; rendered inside a `display:none` parent it has
// nothing to measure, cannot complete its silent checks, and falls back to
// asking the person to click. That is how "invisible for almost everybody"
// became a challenge on every single join, and how a check that used to cost
// ~200ms started costing ~5s of stalling before showing one.
//
// So the overlay is always in the document and always displayed. What toggles
// is only its *chrome*. Idle, it is transparent and click-through, wrapping a
// widget Turnstile itself renders at zero height — nothing paints, nothing
// intercepts a click. `before-interactive-callback`, Cloudflare telling us it
// is about to need the screen, is what turns on the backdrop and the card.

let overlay: HTMLDivElement | null = null;
let overlayHost: HTMLDivElement | null = null;
let setChromeVisible: ((visible: boolean) => void) | null = null;
// How many widgets currently want the screen. A count rather than a boolean
// because two gated actions can genuinely overlap (a join firing while a
// login is in flight), and the first one to finish must not pull the chrome
// out from under the second.
let interactiveCount = 0;

function isDarkTheme(): boolean {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function ensureOverlay(): HTMLDivElement {
  if (overlayHost) return overlayHost;

  // Inline styles, not Tailwind classes: this element is created at runtime
  // from a string, and Tailwind only emits the classes it can see in the
  // source. A class name assembled here would compile to nothing.
  overlay = document.createElement("div");
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483000",
    // Always laid out — see this section's header. Only the paint changes.
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "padding:16px",
    // Click-through while idle, so a full-screen element that is showing
    // nothing does not sit on top of the whole app eating clicks.
    "pointer-events:none",
    "background:transparent",
  ].join(";");

  const body = document.createElement("div");
  body.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "gap:14px",
    "max-width:24rem",
    "border-radius:16px",
    "text-align:center",
    "font-family:system-ui,-apple-system,'Segoe UI',sans-serif",
  ].join(";");

  const title = document.createElement("h2");
  title.textContent = "Confirme que você não é um robô";
  title.style.cssText = "margin:0;font-size:1.125rem;font-weight:600;";
  title.hidden = true;

  const subtitle = document.createElement("p");
  subtitle.textContent =
    "Isso aparece raramente, só quando a verificação automática não tem certeza. É rápido.";
  subtitle.style.cssText = "margin:0;font-size:0.875rem;line-height:1.4;";
  subtitle.hidden = true;

  overlayHost = document.createElement("div");
  // `pointer-events:auto` unconditionally, and it costs nothing: idle, this
  // element wraps a zero-height widget and therefore has no area to click.
  // Granting it here rather than when the chrome appears means the widget is
  // clickable the instant Cloudflare draws it, with no ordering to get wrong.
  overlayHost.style.cssText =
    "display:flex;align-items:center;justify-content:center;pointer-events:auto;";

  body.append(title, subtitle, overlayHost);
  overlay.appendChild(body);
  document.body.appendChild(overlay);

  setChromeVisible = (visible: boolean) => {
    const dark = isDarkTheme();
    // Re-read the theme on every reveal rather than once at build time —
    // somebody may have flipped it since.
    overlay!.style.background = visible ? "rgba(0,0,0,0.6)" : "transparent";
    overlay!.style.pointerEvents = visible ? "auto" : "none";
    body.style.background = visible ? (dark ? "#09090b" : "#ffffff") : "transparent";
    body.style.border = visible
      ? dark
        ? "1px solid rgba(255,255,255,0.1)"
        : "1px solid rgba(0,0,0,0.1)"
      : "none";
    body.style.boxShadow = visible ? "0 20px 60px rgba(0,0,0,0.35)" : "none";
    body.style.padding = visible ? "24px" : "0";
    body.style.width = visible ? "100%" : "auto";
    title.hidden = !visible;
    subtitle.hidden = !visible;
    title.style.color = dark ? "#fafafa" : "#09090b";
    subtitle.style.color = dark ? "#a1a1aa" : "#71717a";
    overlayHost!.style.minHeight = visible ? "65px" : "0";
  };
  setChromeVisible(false);

  return overlayHost;
}

function showChrome() {
  interactiveCount += 1;
  setChromeVisible?.(true);
}

function hideChrome() {
  interactiveCount = Math.max(0, interactiveCount - 1);
  if (interactiveCount === 0) setChromeVisible?.(false);
}

// ─── Minting, and why a token is fetched before it is needed ──────────────
//
// Turnstile is not reCAPTCHA v3 in one way that is felt directly: v3's script
// set up a single page-wide assessment at load, so execute() was a ~200ms
// lookup of work already done. Turnstile does its work *per widget*, when the
// widget is rendered — a second or three of real browser checks. Minting one
// in front of a button press therefore puts that whole cost on the critical
// path of joining a room, which is exactly where it is most visible.
//
// So a token is minted ahead of time (prewarmCaptcha, called by the screens
// that are about to need one) and parked here until it is spent. A hit costs
// nothing at all; a miss is no worse than not having done it.

// How long a minted token may sit here before it is treated as stale.
// Cloudflare expires one 300s after issue and the server verifies against
// that, so this leaves a wide margin for the request that spends it.
const TOKEN_REUSE_MS = 3 * 60_000;

const cache = new Map<CaptchaAction, { token: string; mintedAt: number }>();

type InflightMint = {
  promise: Promise<string | null>;
  /**
   * Says that somebody is now actually waiting on this token, which is the
   * only thing that allows a challenge to take the screen.
   *
   * A prewarmed mint starts *cold*: if Cloudflare decides it wants
   * interaction, the widget is prepared but stays invisible, because a
   * captcha appearing over a page nobody asked anything of is worse than a
   * slow join. It reveals the moment a real call arrives — and because the
   * widget is already built and waiting, that reveal is faster than not
   * having prewarmed at all.
   */
  markHot: () => void;
};

const inflight = new Map<CaptchaAction, InflightMint>();

function mintToken(action: CaptchaAction): InflightMint {
  let hot = false;
  let wantsScreen = false;
  let showing = false;

  const reveal = () => {
    if (showing || !wantsScreen || !hot) return;
    showing = true;
    showChrome();
  };
  const conceal = () => {
    if (!showing) return;
    showing = false;
    hideChrome();
  };

  const promise = new Promise<string | null>((resolve) => {
    let settled = false;
    let widgetId: string | null = null;
    let container: HTMLDivElement | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const settle = (token: string | null) => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      conceal();
      if (widgetId !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // Already gone; nothing to remove.
        }
      }
      container?.remove();
      resolve(token);
    };

    void loadScript().then((api) => {
      if (!api) {
        settle(null);
        return;
      }
      const host = ensureOverlay();
      // Its own container inside the host, so two overlapping mints each get
      // their own widget instead of rendering over one another.
      container = document.createElement("div");
      host.appendChild(container);
      timeout = setTimeout(() => settle(null), TOKEN_TIMEOUT_MS);
      try {
        widgetId = api.render(container, {
          sitekey: SITE_KEY as string,
          action,
          theme: isDarkTheme() ? "dark" : "light",
          // The whole point: draw nothing unless Cloudflare decides this
          // person has to interact. With "always" (the default) every visitor
          // would see a widget on every gated action, which is the reCAPTCHA
          // badge problem in a louder form.
          appearance: "interaction-only",
          callback: (token) => settle(token),
          // A code is passed but deliberately not surfaced: it names
          // Cloudflare's internal failure, and the caller's own message
          // ("could not verify, try again") is the only thing a person can
          // act on either way.
          "error-callback": () => settle(null),
          // The token went stale before it was spent — only reachable for a
          // challenge left unsolved on screen, since settle() ends the
          // widget's life otherwise.
          "expired-callback": () => settle(null),
          // Shown a challenge and did not finish it in the time Cloudflare
          // allows.
          "timeout-callback": () => settle(null),
          "before-interactive-callback": () => {
            wantsScreen = true;
            reveal();
          },
          // Fires when the interactive part is done — solved or abandoned.
          // The token, if there is one, arrives separately through
          // `callback`, so this only puts the screen back.
          "after-interactive-callback": () => {
            wantsScreen = false;
            conceal();
          },
        });
      } catch {
        settle(null);
      }
    });
  });

  return {
    promise,
    markHot: () => {
      hot = true;
      reveal();
    },
  };
}

function ensureMint(action: CaptchaAction): InflightMint {
  const existing = inflight.get(action);
  if (existing) return existing;
  const mint = mintToken(action);
  inflight.set(action, mint);
  void mint.promise.then((token) => {
    inflight.delete(action);
    if (token) cache.set(action, { token, mintedAt: Date.now() });
  });
  return mint;
}

/**
 * Starts minting a token for `action` now, so the call that needs it later
 * does not have to wait for one.
 *
 * Fire-and-forget: it never throws, never blocks, and a screen that prewarms
 * something nobody ends up doing has wasted an idle widget and nothing else.
 * Call it from wherever a gated action becomes *likely* — mounting the room
 * page, opening the login form — not from wherever it becomes certain, which
 * is far too late to help.
 */
export function prewarmCaptcha(action: CaptchaAction): void {
  if (!SITE_KEY || typeof window === "undefined") return;
  const cached = cache.get(action);
  if (cached && Date.now() - cached.mintedAt < TOKEN_REUSE_MS) return;
  if (inflight.has(action)) return;
  void ensureMint(action).promise;
}

/**
 * Resolves a fresh, single-use token for `action`, or null when Turnstile is
 * not configured, the script never loaded, or Cloudflare refused to issue one.
 *
 * Instant when a prewarm has already landed one (see prewarmCaptcha), a second
 * or two otherwise, and as long as a person takes on the rare occasion
 * Cloudflare wants to challenge them — so a caller showing a "carregando"
 * state should be prepared for this to take human time rather than treating a
 * slow answer as a hang.
 *
 * Callers send whatever comes back as-is and let the server decide: a null is
 * acceptable exactly when the server has no secret key configured, or has one
 * but TURNSTILE_ENFORCE is still off. Deciding that here would mean the client
 * enforcing its own gate, which is worth nothing — a real bot does not run this
 * code at all.
 *
 * A token expires after five minutes and is spent by the first verification,
 * so what comes back is handed over and never held: every path below removes
 * it from the cache on the way out.
 */
export async function getCaptchaToken(action: CaptchaAction): Promise<string | null> {
  if (!SITE_KEY || typeof window === "undefined") return null;
  // Serialized per action, because a token is single-use and two callers that
  // arrived together would otherwise both be handed the *same* one — the
  // second request then failing verification as a duplicate, which looks to
  // the person like an expired captcha they did nothing to deserve. Queueing
  // makes the second caller take (or mint) its own instead. Cross-action
  // calls never queue behind each other: the chain is per action.
  const previous = takeQueue.get(action) ?? Promise.resolve<string | null>(null);
  const mine = previous.catch(() => null).then(() => takeToken(action));
  takeQueue.set(action, mine);
  try {
    return await mine;
  } finally {
    if (takeQueue.get(action) === mine) takeQueue.delete(action);
  }
}

const takeQueue = new Map<CaptchaAction, Promise<string | null>>();

async function takeToken(action: CaptchaAction): Promise<string | null> {
  const cached = cache.get(action);
  cache.delete(action);
  if (cached && Date.now() - cached.mintedAt < TOKEN_REUSE_MS) return cached.token;

  const mint = ensureMint(action);
  // Somebody is waiting on this one now, so a challenge may take the screen —
  // including one a prewarm already prepared and deliberately kept hidden.
  mint.markHot();
  const token = await mint.promise;
  cache.delete(action);
  return token;
}

// Stripe.js, loaded on demand for the card forms that run inside our own page
// (the `checkout-inline` experiment — see components/CardCheckoutModal.tsx).
//
// From Stripe's own CDN rather than an npm package, and on purpose: Stripe
// requires js.stripe.com to be loaded from them (it is what keeps the card
// number inside their iframes and the site out of PCI scope), so a package
// would only be a loader for this same script — and nobody who never presses
// "assinar" pays for it.
//
// Typed by hand, as narrowly as the two forms use it.

export type StripeError = {
  type?: string;
  code?: string;
  decline_code?: string;
  message?: string;
};

export type StripeCardField = {
  mount(element: HTMLElement): void;
  destroy(): void;
  on(event: "change", handler: (event: { complete: boolean; error?: StripeError }) => void): void;
  on(event: "ready", handler: () => void): void;
  focus(): void;
};

export type StripeElements = {
  create(
    type: "cardNumber" | "cardExpiry" | "cardCvc",
    options?: { style?: Record<string, unknown>; showIcon?: boolean; placeholder?: string }
  ): StripeCardField;
};

export type StripeEmbeddedCheckout = {
  mount(element: HTMLElement): void;
  destroy(): void;
};

export type StripeClient = {
  elements(options?: { locale?: string }): StripeElements;
  confirmCardPayment(
    clientSecret: string,
    data: { payment_method: { card: StripeCardField; billing_details?: { name?: string } } }
  ): Promise<{ error?: StripeError; paymentIntent?: { status: string } }>;
  createEmbeddedCheckoutPage(options: {
    fetchClientSecret: () => Promise<string>;
    onComplete?: () => void;
    /** A private preview at Stripe: never fires on an account without access. */
    onAnalyticsEvent?: (event: { eventType: string }) => void;
  }): Promise<StripeEmbeddedCheckout>;
};

type StripeConstructor = (publishableKey: string, options?: { locale?: string }) => StripeClient;

declare global {
  interface Window {
    Stripe?: StripeConstructor;
  }
}

// Versioned to match the sessions the API creates: /v3/ refuses a session with
// ui_mode=embedded_page, the only value Stripe still accepts for a new one.
const SCRIPT_URL = "https://js.stripe.com/dahlia/stripe.js";

let loading: Promise<StripeConstructor> | null = null;
const clients = new Map<string, StripeClient>();

function loadScript(): Promise<StripeConstructor> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (loading) return loading;
  loading = new Promise<StripeConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.Stripe) resolve(window.Stripe);
      else reject(new Error("Stripe.js loaded without Stripe"));
    };
    script.onerror = () => reject(new Error("Stripe.js failed to load"));
    document.head.appendChild(script);
  }).catch((err) => {
    // A blocked or failed load must be retryable on the next press, not
    // remembered as a rejection for the rest of the session.
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * One client per publishable key. The key comes from the API with each
 * checkout (see premiumRoutes' /premium/subscribe) rather than from this
 * build, so a deployment switching between test and live keys needs nothing
 * rebuilt.
 */
export async function getStripe(publishableKey: string, locale: string): Promise<StripeClient> {
  const cacheKey = `${publishableKey}|${locale}`;
  const known = clients.get(cacheKey);
  if (known) return known;
  const Stripe = await loadScript();
  const client = Stripe(publishableKey, { locale });
  clients.set(cacheKey, client);
  return client;
}

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MdCheckCircle, MdClose, MdLock } from "react-icons/md";
import { trackFeatureEvent } from "@/lib/features";
import type { InlineCheckout } from "@/lib/premiumApi";
import {
  getStripe,
  type StripeCardField,
  type StripeClient,
  type StripeEmbeddedCheckout,
} from "@/lib/stripeJs";
import { useI18n } from "@/lib/useI18n";
import { useResolvedTheme } from "@/lib/useTheme";

// The subscription's card form, inside /pro instead of on checkout.stripe.com.
//
// The `checkout-inline` experiment (see premiumRoutes' checkoutUiFor): the
// control group still goes to Stripe's hosted page in a new tab — or, from the
// desktop app, out to the system browser — and that hop is where most people
// who start a subscription never finish one. Two ways of not leaving:
//
//   "embedded" — Stripe's Embedded Checkout: their whole page, in our dialog.
//   "custom"   — our own dialog, with only the card fields being Stripe's
//                (Card Element), confirming the first payment of an
//                incomplete subscription the API created.
//
// In both, the card number lives in Stripe's iframes and never touches this
// page. Nothing here grants anything: the plan is granted by the webhook, and
// `onPaid` only tells the page to go and look.
//
// Events (all counted in the admin's "site events" for checkout-inline):
//   pro_checkout_inline_open / _complete / _close / _load_error
//   pro_checkout_card_submit, pro_checkout_card_error(.<code>)  — custom only

type CardCheckoutModalProps = {
  checkout: InlineCheckout | null;
  /** "Pro Max — R$ 14,99/mês", shown on our own form. */
  planLabel: string;
  onClose: () => void;
  onPaid: () => void;
};

export function CardCheckoutModal({ checkout, ...rest }: CardCheckoutModalProps) {
  if (!checkout) return null;
  // Keyed by the checkout, so a second one starts from a fresh dialog — the
  // "paid" screen and the open/close pair belong to one checkout each.
  return <CheckoutDialog key={checkout.clientSecret} checkout={checkout} {...rest} />;
}

function CheckoutDialog({
  checkout,
  planLabel,
  onClose,
  onPaid,
}: CardCheckoutModalProps & { checkout: InlineCheckout }) {
  const { t } = useI18n();
  const [paid, setPaid] = useState(false);
  const paidRef = useRef(false);

  // One open per checkout, and one close for every open that did not pay —
  // the pair the experiment's completion rate is read from.
  useEffect(() => {
    trackFeatureEvent("pro_checkout_inline_open");
    trackFeatureEvent(`pro_checkout_inline_open.${checkout.ui}`);
    return () => {
      if (!paidRef.current) trackFeatureEvent("pro_checkout_inline_close");
    };
  }, [checkout]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handlePaid = () => {
    if (paidRef.current) return;
    paidRef.current = true;
    trackFeatureEvent("pro_checkout_inline_complete");
    setPaid(true);
    onPaid();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("cardCheckoutModal.title")}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-950 ${
          checkout.ui === "embedded" && !paid ? "max-w-lg" : "max-w-sm"
        }`}
      >
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/10">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <MdLock className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
            {t("cardCheckoutModal.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cardCheckoutModal.close")}
            className="rounded-lg p-1 text-zinc-500 hover:bg-black/5 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-zinc-200"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto">
          {paid ? (
            <PaidScreen onClose={onClose} />
          ) : checkout.ui === "embedded" ? (
            <EmbeddedForm checkout={checkout} onPaid={handlePaid} />
          ) : (
            <CardForm checkout={checkout} planLabel={planLabel} onPaid={handlePaid} />
          )}
        </div>
      </div>
    </div>
  );
}

function stripeLocale(locale: string): string {
  if (locale.startsWith("pt")) return "pt-BR";
  if (locale.startsWith("es")) return "es";
  return "en";
}

function PaidScreen({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      <MdCheckCircle className="h-12 w-12 text-emerald-500" />
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t("cardCheckoutModal.paidTitle")}</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("cardCheckoutModal.paidBody")}</p>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 rounded-xl bg-zinc-900 px-5 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {t("cardCheckoutModal.done")}
      </button>
    </div>
  );
}

function LoadError() {
  const { t } = useI18n();
  return (
    <p className="px-6 py-8 text-center text-sm text-red-600 dark:text-red-400">{t("cardCheckoutModal.loadError")}</p>
  );
}

function Loading() {
  const { t } = useI18n();
  return <p className="px-6 py-8 text-center text-sm text-zinc-500">{t("cardCheckoutModal.loading")}</p>;
}

/** Stripe's Embedded Checkout, mounted into our dialog. */
function EmbeddedForm({ checkout, onPaid }: { checkout: InlineCheckout; onPaid: () => void }) {
  const { locale } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  useEffect(() => {
    let cancelled = false;
    let instance: StripeEmbeddedCheckout | null = null;
    (async () => {
      try {
        const stripe = await getStripe(checkout.publishableKey, stripeLocale(locale));
        const created = await stripe.createEmbeddedCheckoutPage({
          fetchClientSecret: async () => checkout.clientSecret,
          onComplete: () => onPaidRef.current(),
        });
        // Stripe allows one Embedded Checkout on a page at a time: one created
        // after this effect was already torn down must go straight away.
        if (cancelled || !hostRef.current) {
          created.destroy();
          return;
        }
        instance = created;
        created.mount(hostRef.current);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[checkout] Embedded checkout failed to start:", (err as Error).message);
        trackFeatureEvent("pro_checkout_inline_load_error");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, [checkout, locale]);

  return (
    <div className="min-h-[200px]">
      {state === "loading" && <Loading />}
      {state === "error" && <LoadError />}
      <div ref={hostRef} />
    </div>
  );
}

/** Our own form, with Stripe's three card fields (Card Element) in it. */
function CardForm({
  checkout,
  planLabel,
  onPaid,
}: {
  checkout: InlineCheckout;
  planLabel: string;
  onPaid: () => void;
}) {
  const { t, locale } = useI18n();
  const theme = useResolvedTheme();
  const numberRef = useRef<HTMLDivElement>(null);
  const expiryRef = useRef<HTMLDivElement>(null);
  const cvcRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<StripeClient | null>(null);
  const numberFieldRef = useRef<StripeCardField | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [complete, setComplete] = useState({ number: false, expiry: false, cvc: false });
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fields: StripeCardField[] = [];
    (async () => {
      try {
        const stripe = await getStripe(checkout.publishableKey, stripeLocale(locale));
        if (cancelled || !numberRef.current || !expiryRef.current || !cvcRef.current) return;
        stripeRef.current = stripe;
        const dark = theme === "dark";
        const style = {
          base: {
            color: dark ? "#f4f4f5" : "#18181b",
            fontSize: "15px",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            "::placeholder": { color: dark ? "#71717a" : "#a1a1aa" },
            iconColor: dark ? "#a1a1aa" : "#52525b",
          },
          invalid: { color: dark ? "#f87171" : "#dc2626", iconColor: dark ? "#f87171" : "#dc2626" },
        };
        const elements = stripe.elements({ locale: stripeLocale(locale) });
        const entries: [keyof typeof complete, "cardNumber" | "cardExpiry" | "cardCvc", HTMLDivElement][] = [
          ["number", "cardNumber", numberRef.current],
          ["expiry", "cardExpiry", expiryRef.current],
          ["cvc", "cardCvc", cvcRef.current],
        ];
        for (const [key, type, host] of entries) {
          const field = elements.create(type, { style, ...(type === "cardNumber" ? { showIcon: true } : {}) });
          field.on("change", (event) => {
            setComplete((prev) => ({ ...prev, [key]: event.complete }));
            setError(event.error?.message ?? null);
          });
          field.mount(host);
          fields.push(field);
          if (type === "cardNumber") numberFieldRef.current = field;
        }
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[checkout] Card form failed to start:", (err as Error).message);
        trackFeatureEvent("pro_checkout_inline_load_error");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
      for (const field of fields) field.destroy();
      numberFieldRef.current = null;
    };
    // The theme is read once: re-mounting the fields on a theme change would
    // wipe a half-typed card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout, locale]);

  const ready = state === "ready" && complete.number && complete.expiry && complete.cvc && !submitting;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const stripe = stripeRef.current;
    const card = numberFieldRef.current;
    if (!stripe || !card || !ready) return;
    setSubmitting(true);
    setError(null);
    trackFeatureEvent("pro_checkout_card_submit");
    try {
      // 3-D Secure, when the bank asks for it, is handled by this call in a
      // Stripe-owned frame over the page.
      const result = await stripe.confirmCardPayment(checkout.clientSecret, {
        payment_method: { card, ...(name.trim() ? { billing_details: { name: name.trim() } } : {}) },
      });
      if (result.error) {
        const code = result.error.decline_code || result.error.code || result.error.type || "unknown";
        trackFeatureEvent("pro_checkout_card_error");
        trackFeatureEvent(`pro_checkout_card_error.${code}`);
        // Stripe's own message, already in the locale the client was started
        // with — it is the one that knows what the bank said.
        setError(result.error.message ?? t("cardCheckoutModal.genericError"));
        setSubmitting(false);
        return;
      }
      if (result.paymentIntent?.status === "succeeded" || result.paymentIntent?.status === "processing") {
        onPaid();
        return;
      }
      setError(t("cardCheckoutModal.genericError"));
      setSubmitting(false);
    } catch (err) {
      console.error("[checkout] Card confirmation failed:", (err as Error).message);
      trackFeatureEvent("pro_checkout_card_error");
      trackFeatureEvent("pro_checkout_card_error.network");
      setError(t("cardCheckoutModal.genericError"));
      setSubmitting(false);
    }
  };

  if (state === "error") return <LoadError />;

  const fieldClass =
    "rounded-xl border border-black/10 bg-white px-3 py-3 dark:border-white/15 dark:bg-zinc-900";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-5 py-5">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{planLabel}</p>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t("cardCheckoutModal.cardNumber")}</span>
        <div ref={numberRef} className={fieldClass} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t("cardCheckoutModal.expiry")}</span>
          <div ref={expiryRef} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t("cardCheckoutModal.cvc")}</span>
          <div ref={cvcRef} className={fieldClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t("cardCheckoutModal.nameOnCard")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="cc-name"
          className={`${fieldClass} text-[15px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100`}
          placeholder={t("cardCheckoutModal.nameOnCardPlaceholder")}
        />
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={!ready}
        className="mt-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? t("cardCheckoutModal.paying") : state === "loading" ? t("cardCheckoutModal.loading") : t("cardCheckoutModal.pay")}
      </button>
      <p className="flex items-center justify-center gap-1 text-center text-[11px] text-zinc-500">
        <MdLock className="h-3 w-3" />
        {t("cardCheckoutModal.secureNote")}
      </p>
    </form>
  );
}

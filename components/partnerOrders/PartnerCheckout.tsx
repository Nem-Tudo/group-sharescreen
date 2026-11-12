"use client";

import { useEffect, useRef, useState } from "react";
import { MdCreditCard } from "react-icons/md";
import { PixIcon } from "@/components/icons";
import { PixChargeModal } from "@/components/PixChargeModal";
import type { PixCharge } from "@/lib/premiumApi";
import { useT } from "@/lib/useI18n";
import { useSellsHere } from "@/lib/storePolicy";
import { useAuth } from "@/lib/AuthContext";
import { holdPaymentShake } from "@/lib/useShake";
import {
  PartnerOrderError,
  SELF_SERVE_PARTNER_EVENTS,
  fetchPartnerOrder,
  startPartnerCheckout,
  trackPartnerOrderEvent,
  type PartnerOrder,
  type PartnerOrderConfig,
} from "@/lib/partnerOrders";

// Paying for one order: Pix (a code shown here, polled until it lands) or card
// (the processor's own page, which sends the buyer back to the order). Either
// way the API decides the amount — this only says how.

const POLL_MS = 3000;

function PartnerCheckoutInner({
  order,
  amountLabel,
  methods,
  /** Called first, so the caller can save pending edits before money moves. Returns the order to charge. */
  prepare,
  onPaid,
}: {
  order: PartnerOrder | null;
  /** What the button says will be charged — the package's price. */
  amountLabel: string;
  methods: PartnerOrderConfig["methods"];
  prepare: () => Promise<PartnerOrder | null>;
  onPaid: (order: PartnerOrder) => void;
}) {
  const t = useT();
  const { account } = useAuth();
  const [method, setMethod] = useState<"pix" | "card">(methods.pix ? "pix" : "card");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [needsEmail, setNeedsEmail] = useState(false);
  const [taxId, setTaxId] = useState("");
  const [needsTaxId, setNeedsTaxId] = useState(false);
  const [pix, setPix] = useState<PixCharge | null>(null);
  const [paid, setPaid] = useState(false);
  const orderIdRef = useRef<string | null>(order?.id ?? null);
  const paidOrderRef = useRef<PartnerOrder | null>(null);

  async function check() {
    const id = orderIdRef.current;
    if (!id) return;
    try {
      const fresh = await fetchPartnerOrder(id);
      if (fresh.status !== "awaiting_payment") {
        paidOrderRef.current = fresh;
        if (!paid) trackPartnerOrderEvent(SELF_SERVE_PARTNER_EVENTS.paid, fresh.amountCents);
        setPaid(true);
      }
    } catch {
      // The next poll asks again.
    }
  }

  // While a Pix code is on screen, ask whether it was paid.
  useEffect(() => {
    if (!pix || paid) return;
    const id = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pix, paid]);

  async function pay() {
    const startedAt = Date.now();
    setError(null);
    setBusy(true);
    try {
      const target = await prepare();
      if (!target) return;
      orderIdRef.current = target.id;
      const result = await startPartnerCheckout(target.id, method, {
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(taxId.trim() ? { taxId: taxId.trim() } : {}),
      });
      if (result.method === "card") {
        trackPartnerOrderEvent(SELF_SERVE_PARTNER_EVENTS.checkoutCard, target.amountCents);
        window.location.href = result.url;
        return;
      }
      trackPartnerOrderEvent(SELF_SERVE_PARTNER_EVENTS.checkoutPix, target.amountCents);
      // Only a new code from inside the dialog: the page itself does not shake.
      if (pix) await holdPaymentShake(startedAt);
      setPix(result.pix);
    } catch (err) {
      if (err instanceof PartnerOrderError) {
        if (err.needsEmail) setNeedsEmail(true);
        if (err.needsTaxId) setNeedsTaxId(true);
        // "Already paid" — the order moved on under us.
        if (/already paid/i.test(err.message)) {
          await check();
          return;
        }
      }
      setError(err instanceof Error ? err.message : t("partnerOrders.checkout.failed"));
    } finally {
      setBusy(false);
    }
  }

  const methodButton = (id: "pix" | "card", label: string, icon: React.ReactNode, available: boolean) => (
    <button
      type="button"
      disabled={!available}
      onClick={() => setMethod(id)}
      aria-pressed={method === id}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        method === id
          ? "border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-200"
          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  const noMethod = !methods.pix && !methods.card;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {methodButton("pix", "Pix", <PixIcon className="h-4 w-4" />, methods.pix)}
        {methodButton("card", t("partnerOrders.checkout.card"), <MdCreditCard className="h-4 w-4" />, methods.card)}
      </div>
      {method === "card" && <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("partnerOrders.checkout.cardHint")}</p>}

      {/* Only without an account: a signed-in buyer pays with the account's own address. */}
      {needsEmail && !account && (
        <div>
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300" htmlFor="po-email">
            {t("partnerOrders.checkout.email")}
          </label>
          <input
            id="po-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>
      )}
      {needsTaxId && (
        <div>
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300" htmlFor="po-taxid">
            {t("partnerOrders.checkout.taxId")}
          </label>
          <input
            id="po-taxid"
            inputMode="numeric"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
      {noMethod && <p className="text-sm text-red-500">{t("partnerOrders.checkout.unavailable")}</p>}

      <button
        type="button"
        onClick={() => void pay()}
        disabled={busy || noMethod}
        className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy
          ? t("partnerOrders.checkout.preparing")
          : t("partnerOrders.checkout.pay", { amount: amountLabel })}
      </button>

      <PixChargeModal
        charge={pix}
        paid={paid}
        paidMessage={t("partnerOrders.checkout.paidMessage")}
        busy={busy}
        onRegenerate={() => void pay()}
        onCheckNow={() => void check()}
        onClose={() => {
          setPix(null);
          if (paid && paidOrderRef.current) onPaid(paidOrderRef.current);
        }}
      />
    </div>
  );
}

/**
 * Pays for a partner order — but never inside the iOS app, which sells nothing
 * (lib/storePolicy.ts). There the order can still be read; it just has no
 * pay button.
 */
export function PartnerCheckout(props: Parameters<typeof PartnerCheckoutInner>[0]) {
  const sells = useSellsHere();
  if (!sells) return null;
  return <PartnerCheckoutInner {...props} />;
}

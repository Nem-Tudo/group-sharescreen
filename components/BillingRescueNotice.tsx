"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MdClose, MdCreditCardOff, MdQrCode2 } from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { isPremiumActive, startCardUpdate } from "@/lib/premiumApi";
import { useOpenPro } from "@/lib/proModal";
import {
  BILLING_RESCUE_EVENTS,
  PIX_RECOVER_FEATURE,
  PIX_RECOVER_WINDOW_MS,
  RENEWAL_RESCUE_FEATURE,
  canUpdateCard,
  clearPendingPix,
  hasRefusedRenewal,
  readPendingPix,
  rescueSnoozed,
  snoozeRescue,
  type PendingPix,
} from "@/lib/billingRescue";
import { useT } from "@/lib/useI18n";

// A small card in a corner of every page, for two moments when money is about
// to be lost (see lib/billingRescue):
//
//   - renewal-rescue: the card on a running subscription was refused. Stripe
//     keeps retrying for a few days and then the plan ends; this says so while
//     there is still time, with a way to change the card.
//   - pix-recover: a Pix code shown in this browser expired unpaid. One click
//     opens the same plan again, where a fresh code is a button away.
//
// The refused card wins when both apply: it is a subscriber about to be lost,
// the Pix is somebody who has not bought yet. Never on /pro (which says the
// same thing itself) nor in /admin.

type Kind = "rescue" | "pix";

export function BillingRescueNotice() {
  const t = useT();
  const pathname = usePathname();
  const { account } = useAuth();
  const premium = account?.premium ?? null;
  const pixOn = useFeature(PIX_RECOVER_FEATURE, { track: false }).enabled;
  const rescueOn = useFeature(RENEWAL_RESCUE_FEATURE, { track: false }).enabled;
  const openPro = useOpenPro();
  // Read from storage after mount (a microtask, like the rest of the site):
  // the server has no storage, and the first render must match it.
  const [pending, setPending] = useState<PendingPix | null>(null);
  const [snoozed, setSnoozed] = useState(true);
  const [closed, setClosed] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const entry = readPendingPix();
      const now = Date.now();
      // Only a code that already lapsed, and not one so old the moment passed.
      if (entry && (now < entry.expiresAt || now - entry.expiresAt > PIX_RECOVER_WINDOW_MS)) {
        if (now - entry.expiresAt > PIX_RECOVER_WINDOW_MS) clearPendingPix();
        setPending(null);
      } else {
        setPending(entry);
      }
      setSnoozed(rescueSnoozed());
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const hiddenHere = !pathname || pathname.startsWith("/pro") || pathname.startsWith("/admin");
  let kind: Kind | null = null;
  if (account && !closed && !hiddenHere) {
    if (rescueOn && !snoozed && hasRefusedRenewal(premium)) kind = "rescue";
    // Somebody who is paying already does not need a lapsed code back.
    else if (pixOn && pending && !isPremiumActive(premium)) kind = "pix";
  }

  // Counted once per appearance.
  const shownRef = useRef<Kind | null>(null);
  useEffect(() => {
    if (!kind || shownRef.current === kind) return;
    shownRef.current = kind;
    trackFeatureEvent(kind === "rescue" ? BILLING_RESCUE_EVENTS.rescueShown : BILLING_RESCUE_EVENTS.pixShown, {
      feature: kind === "rescue" ? RENEWAL_RESCUE_FEATURE : PIX_RECOVER_FEATURE,
    });
  }, [kind]);

  if (!kind) return null;

  const close = () => {
    if (kind === "rescue") {
      trackFeatureEvent(BILLING_RESCUE_EVENTS.rescueClose, { feature: RENEWAL_RESCUE_FEATURE });
      snoozeRescue();
    } else {
      trackFeatureEvent(BILLING_RESCUE_EVENTS.pixClose, { feature: PIX_RECOVER_FEATURE });
      clearPendingPix();
    }
    setClosed(true);
  };

  const button =
    "rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60";

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-[60] w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
    >
      <button
        type="button"
        onClick={close}
        aria-label={t("common.close")}
        className="absolute right-2 top-2 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
      >
        <MdClose className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-5">
        <span
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${
            kind === "rescue" ? "bg-red-500" : "bg-teal-500"
          }`}
        >
          {kind === "rescue" ? <MdCreditCardOff className="h-5 w-5" /> : <MdQrCode2 className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {kind === "rescue" ? t("billingRescue.rescueTitle") : t("billingRescue.pixTitle")}
          </p>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            {kind === "rescue" ? t("billingRescue.rescueBody") : t("billingRescue.pixBody")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {kind === "rescue" ? (
              <>
                {canUpdateCard(premium) && (
                  <button
                    type="button"
                    disabled={cardBusy}
                    onClick={() => {
                      trackFeatureEvent(BILLING_RESCUE_EVENTS.rescueCard, { feature: RENEWAL_RESCUE_FEATURE });
                      setCardBusy(true);
                      setCardError(null);
                      void startCardUpdate().then((result) => {
                        if (result.url) {
                          window.location.assign(result.url);
                          return;
                        }
                        setCardBusy(false);
                        setCardError(result.error ?? null);
                      });
                    }}
                    className={`${button} bg-red-600 text-white hover:bg-red-700`}
                  >
                    {cardBusy ? t("common.loading") : t("billingRescue.changeCard")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    trackFeatureEvent(BILLING_RESCUE_EVENTS.rescuePix, { feature: RENEWAL_RESCUE_FEATURE });
                    setClosed(true);
                    openPro("renewal_rescue", premium?.plan ?? null);
                  }}
                  className={`${button} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900`}
                >
                  {t("billingRescue.otherWays")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  trackFeatureEvent(BILLING_RESCUE_EVENTS.pixClick, { feature: PIX_RECOVER_FEATURE });
                  setClosed(true);
                  openPro("pix_recover", pending?.planId ?? null);
                }}
                className={`${button} bg-teal-600 text-white hover:bg-teal-700`}
              >
                {t("billingRescue.pixAction")}
              </button>
            )}
          </div>
          {cardError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{cardError}</p>}
        </div>
      </div>
    </div>
  );
}

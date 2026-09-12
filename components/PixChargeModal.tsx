"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { MdCheckCircle, MdClose, MdContentCopy, MdRefresh } from "react-icons/md";
import { PixIcon } from "@/components/icons";
import type { PixCharge } from "@/lib/premiumApi";
import { useI18n } from "@/lib/useI18n";

// The Pix code, in a dialog of its own.
//
// It used to render inline, in the same column as the two pay buttons, and
// that was wrong for what it is: a Pix code is a *modal* step in the literal
// sense — the person leaves for their bank app and comes back to this exact
// screen, and nothing else on the page is of any use to them until they do.
// Inline, it pushed the buttons that created it off the bottom of a phone,
// and on a laptop it sat in a card beside a price and a feature list,
// competing for attention with the thing it had just replaced.
//
// It also fixes a state the inline version could not show at all: renewing.
// That markup lived inside the "not subscribed yet" branch, so an account
// still inside its paid days that pressed "renovar" created a charge and was
// shown nothing. This renders from the panel top level, and the branch it
// sits in no longer decides whether it can appear.

/** mm:ss, from milliseconds. Only ever shown under half an hour. */
function countdownLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

type PixChargeModalProps = {
  /** The charge waiting to be paid, or null for closed. */
  charge: PixCharge | null;
  /**
   * Whether the money for *this* charge has landed. Decided by the caller
   * rather than here, because "is this account premium" is not the same
   * question — a renewal is bought by somebody who already was.
   */
  paid: boolean;
  /** Formatted end of the paid period, for the confirmation copy. */
  paidUntilLabel?: string | null;
  /**
   * The whole confirmation sentence, when the default one would be wrong.
   *
   * The default speaks to the buyer about their own access, which is true of
   * every charge but one: a gift's days go to somebody else, and telling the
   * person who paid that *their* access is now open would be false (see
   * GiftPlanDialog).
   */
  paidMessage?: string | null;
  /**
   * Anything else the confirmation has to carry.
   *
   * There is one caller and one reason: a present bought as a link produces
   * the link at exactly this moment, and this is the screen the buyer is
   * looking at when the money lands. Handing it over anywhere else means
   * handing it over on a screen nobody is on.
   */
  paidExtra?: ReactNode;
  /** A new charge is being created right now. */
  busy?: boolean;
  /** Asks for a fresh code, after this one expires. */
  onRegenerate: () => void;
  /** Checks with the API now instead of waiting for the next poll. */
  onCheckNow: () => void;
  onClose: () => void;
};

/**
 * Open/closed only. Everything else lives in the content below, keyed by the
 * payment id — which is what makes "copied", "code revealed" and the clock
 * reset for a second charge without an effect to clear them: a new key is a
 * new component, and its state starts where its initialisers say.
 *
 * Two shells, one body, the same arrangement MemberActionsMenu has and for the
 * same reason: /pro opens this as a dialog of its own, while the present opens
 * it as a *step inside* a popup it is already in (see GiftPlanDialog). Only the
 * box differs, and a second copy of the code screen to hold the second box is
 * two screens to keep in step.
 */
export function PixChargeModal({ charge, ...rest }: PixChargeModalProps) {
  const { t, tc } = useI18n();
  // Escape closes it. A dialog that can only be dismissed by hitting one small
  // target is a dialog somebody feels trapped in, and this one opens from a
  // payment button — the worst possible moment to feel that.
  //
  // On the shell rather than in the body: the other shell is inside a popup
  // whose library already answers this key, and two handlers for one press
  // would close the step and the popup behind it at once.
  const { onClose } = rest;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!charge) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("pixChargeModal.paymentViaPix")}
        // Without this, a click anywhere inside the card bubbles to the
        // backdrop and closes the dialog — including a click on the copy
        // button, which is the one thing this screen exists for.
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-y-auto rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-950"
      >
        <PixChargeContent key={charge.paymentId} charge={charge} {...rest} />
      </div>
    </div>
  );
}

/**
 * The code screen itself: a header and one of three states.
 *
 * Brings its own padding and no box — the shell around it decides whether this
 * is a card floating over the page or a step inside a popup.
 */
export function PixChargeContent({
  charge,
  paid,
  paidUntilLabel,
  paidMessage,
  paidExtra,
  busy,
  onRegenerate,
  onCheckNow,
  onClose,
}: PixChargeModalProps & { charge: PixCharge }) {
  const { t, tc } = useI18n();
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const expiresAt = charge.expiresAt ? Date.parse(charge.expiresAt) : Number.NaN;
  const hasExpiry = Number.isFinite(expiresAt);
  const remaining = hasExpiry ? expiresAt - now : Number.POSITIVE_INFINITY;
  const expired = hasExpiry && remaining <= 0;

  // Only while there is a countdown still worth running: a ticking interval
  // behind a confirmation nobody is reading is a second of work per second
  // for nothing.
  useEffect(() => {
    if (paid || !hasExpiry) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [paid, hasExpiry]);

  const handleCopy = useCallback(async () => {
    if (!charge.qrCode) return;
    try {
      await navigator.clipboard.writeText(charge.qrCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied (an insecure origin, a permission prompt refused).
      // Revealing the code is the repair: it is then on screen, selectable,
      // and can be read or copied by hand.
      setShowCode(true);
    }
  }, [charge.qrCode]);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <PixIcon className="h-5 w-5 shrink-0 text-[#32BCAD]" />
        <h2 className="flex-1 text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {paid ? t("pixChargeModal.paymentConfirmed") : t("pixChargeModal.payWithPix")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="-mr-1 rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          <MdClose className="h-5 w-5" />
        </button>
      </div>

      {paid ? (
        <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
          <MdCheckCircle className="h-12 w-12 text-emerald-500" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {paidMessage ??
              (paidUntilLabel
                ? t("pixChargeModal.allSetYourProAccessIs", { paidUntilLabel })
                : t("pixChargeModal.allSetYourProAccessIs2"))}
          </p>
          {paidExtra}
          <button
            type="button"
            onClick={onClose}
            className="mt-1 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {t("common.close")}
          </button>
        </div>
      ) : expired ? (
        <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
          <MdRefresh className="h-10 w-10 text-zinc-400" />
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t("pixChargeModal.thisCodeHasExpired")}
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("pixChargeModal.nothingWasChargedGenerateANew")}
          </p>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={busy}
            className="mt-1 flex items-center gap-2 rounded-lg bg-[#32BCAD] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#2ba99b] disabled:opacity-60"
          >
            <PixIcon className="h-4 w-4 shrink-0" />
            {busy ? t("common.generating") : t("pixChargeModal.generateANewCode")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex items-baseline justify-center gap-1.5">
            <span className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              {charge.amountLabel}
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {tc("common.forDayCount", charge.days)}
            </span>
          </div>

          {charge.qrCodeBase64 && (
            <div className="flex flex-col items-center gap-2">
              {/* White behind the QR in both themes: a scanner needs the
                  contrast the code was drawn with, and inverting it is how a
                  code stops reading. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/png;base64,${charge.qrCodeBase64}`}
                alt={t("pixChargeModal.pixQrCode")}
                className="h-52 w-52 rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800"
              />
              <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                {t("pixChargeModal.scanItInYourBankS")}
              </p>
            </div>
          )}

          {charge.qrCode && (
            <div className="flex flex-col gap-2">
              {/* The primary action, not the QR: most people open this on
                  the same phone their bank app is on, where there is no
                  second camera to point at the screen. */}
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center justify-center gap-2 rounded-lg bg-[#32BCAD] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#2ba99b]"
              >
                {copied ? (
                  <MdCheckCircle className="h-4 w-4 shrink-0" />
                ) : (
                  <MdContentCopy className="h-4 w-4 shrink-0" />
                )}
                {copied ? t("pixChargeModal.codeCopied") : t("pixChargeModal.copyPixCode")}
              </button>
              <button
                type="button"
                onClick={() => setShowCode((shown) => !shown)}
                className="self-center text-xs font-medium text-zinc-500 underline-offset-2 transition hover:underline dark:text-zinc-400"
              >
                {showCode ? t("pixChargeModal.hideCode") : t("pixChargeModal.seeCode")}
              </button>
              {showCode && (
                // Selectable and wrapped rather than truncated: if the
                // clipboard is unavailable, reading it off the screen has to
                // still be possible.
                <code className="max-h-24 overflow-y-auto break-all rounded-md border border-zinc-200 bg-zinc-50 p-2 text-[11px] leading-snug text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                  {charge.qrCode}
                </code>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <div className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              {/* Alive rather than a static mark: something is genuinely
                  being waited on, and this is the only thing on screen that
                  can say so. */}
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#32BCAD] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#32BCAD]" />
              </span>
              {t("pixChargeModal.waitingForThePayment")}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("pixChargeModal.itUnlocksByItselfAsSoon")}
              {hasExpiry && t("pixChargeModal.theCodeExpiresInValue", { value: countdownLabel(remaining) })}
            </p>
            <button
              type="button"
              onClick={onCheckNow}
              className="self-start text-xs font-medium text-zinc-600 underline-offset-2 transition hover:underline dark:text-zinc-400"
            >
              {t("common.iAlreadyPaidCheck")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

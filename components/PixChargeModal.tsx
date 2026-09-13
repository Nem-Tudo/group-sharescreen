"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  MdCardGiftcard,
  MdCheck,
  MdCheckCircle,
  MdClose,
  MdContentCopy,
  MdRefresh,
} from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { PixIcon } from "@/components/icons";
import { PlanBand } from "@/components/PlanBand";
import { planIcon } from "@/components/planIcons";
import { PurchaseCelebration, type CelebrationFace } from "@/components/PurchaseCelebration";
import { UserAvatar } from "@/components/UserAvatar";
import { planTierOf, verifiedBadge } from "@/lib/entitlements";
import type { PixCharge } from "@/lib/premiumApi";
import { useI18n } from "@/lib/useI18n";
import { useShake } from "@/lib/useShake";

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

/**
 * What was bought, for the confirmation screen.
 *
 * Handed in by the caller because this component only knows the charge — an
 * amount and a number of days — and the moment the money lands is the one
 * moment worth saying *what* it bought and for whom.
 */
export type PurchaseConfirmation = {
  planId: string;
  planTitle: string;
  planIconId?: string | null;
  /**
   * The person in the confetti (see PurchaseCelebration): the buyer for
   * their own plan or a link, the recipient for a present given by name.
   */
  face: CelebrationFace | null;
  /** A present rather than the buyer's own plan. Changes the heading. */
  gift?: boolean;
  /** Set for a present given to somebody by name: drawn as the "para" card. */
  recipient?: {
    displayName: string;
    username: string;
    avatarUrl?: string | null;
    flags?: string[];
    bot?: boolean;
    nameColor?: string | null;
  } | null;
};

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
  /** What was bought, for the confirmation. See PurchaseConfirmation. */
  confirmation?: PurchaseConfirmation | null;
  /**
   * A new charge is being created right now. The dialog shakes and refuses
   * to close until the API answers — closing mid-request would leave a charge
   * created at Mercado Pago with no screen left to show its code on.
   */
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
  const { onClose, busy } = rest;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Not while a charge is being created — see `busy`.
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  const cardRef = useRef<HTMLDivElement>(null);
  useShake(() => cardRef.current, Boolean(charge && busy));

  if (!charge) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-busy={busy || undefined}
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
  confirmation,
  busy,
  onRegenerate,
  onCheckNow,
  onClose,
}: PixChargeModalProps & { charge: PixCharge }) {
  const { t } = useI18n();
  if (paid) {
    return (
      <PaidScreen
        charge={charge}
        confirmation={confirmation ?? null}
        message={
          paidMessage ??
          (paidUntilLabel
            ? t("pixChargeModal.allSetYourProAccessIs", { paidUntilLabel })
            : t("pixChargeModal.allSetYourProAccessIs2"))
        }
        extra={paidExtra}
        onClose={onClose}
      />
    );
  }
  return (
    <PendingScreen
      charge={charge}
      busy={busy}
      onRegenerate={onRegenerate}
      onCheckNow={onCheckNow}
      onClose={onClose}
    />
  );
}

/**
 * The money landed.
 *
 * Drawn in the same shape as a present being opened (GiftClaimDialog) — the
 * plan's band, its name and mark, how long it lasts — because it is the same
 * event from the other side: a plan has just changed hands. And it arrives
 * with the confetti and the sound, once, on the way in.
 */
function PaidScreen({
  charge,
  confirmation,
  message,
  extra,
  onClose,
}: {
  charge: PixCharge;
  confirmation: PurchaseConfirmation | null;
  message: string;
  extra?: ReactNode;
  onClose: () => void;
}) {
  const { t, tc } = useI18n();
  const tone = confirmation && planTierOf(confirmation.planId) === "premium_max" ? "gold" : "blue";
  const mark = planIcon(confirmation?.planIconId);
  const recipient = confirmation?.recipient ?? null;
  const gift = Boolean(confirmation?.gift);

  return (
    <div className="relative">
      <PurchaseCelebration planIconId={confirmation?.planIconId} face={confirmation?.face ?? null} />

      {/* Over the band, so white on a scrim — the same button the present
          dialog puts in the same place. */}
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="absolute right-3 top-3 z-10 rounded-full bg-black/20 p-1.5 text-white/90 transition hover:bg-black/35 hover:text-white"
      >
        <MdClose className="h-4 w-4" />
      </button>

      <PlanBand tone={tone}>
        {gift ? (
          <MdCardGiftcard className="h-8 w-8 text-white drop-shadow-sm" />
        ) : (
          <MdCheck className="h-9 w-9 text-white drop-shadow-sm" />
        )}
      </PlanBand>

      <div className="px-6 pb-6 pt-5">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
          {gift ? t("pixChargeModal.giftPaid") : t("pixChargeModal.paymentConfirmed")}
        </p>

        {confirmation && (
          <h2 className="mt-1.5 flex items-center justify-center gap-1.5 text-center text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {confirmation.planTitle}
            <mark.Icon className={`h-5 w-5 shrink-0 ${mark.className}`} />
          </h2>
        )}

        <p className="mt-2 text-center">
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            {tc("common.dayCount", charge.days)}
          </span>
        </p>

        {/* Who it went to, drawn the way the present dialog draws who it is
            from — the mirror of the same card. */}
        {recipient && (
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
            <UserAvatar
              src={recipient.avatarUrl}
              name={recipient.displayName}
              size={38}
              className="shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                {t("pixChargeModal.toWord")}
              </span>
              <DisplayUserName
                name={recipient.displayName}
                verified={verifiedBadge(recipient.flags ?? [])}
                bot={recipient.bot}
                color={recipient.nameColor}
                className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"
              />
            </span>
          </div>
        )}

        <p className="mt-5 text-center text-sm text-zinc-600 dark:text-zinc-400">{message}</p>

        {extra && <div className="mt-4 w-full text-left">{extra}</div>}

        <button
          type="button"
          onClick={onClose}
          className={`mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition ${
            tone === "gold" ? "bg-amber-500 hover:bg-amber-600" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {gift ? t("common.close") : t("pixChargeModal.startUsingIt")}
        </button>
      </div>
    </div>
  );
}

/** Waiting for the money: the code, or the "expired" state when it ran out. */
function PendingScreen({
  charge,
  busy,
  onRegenerate,
  onCheckNow,
  onClose,
}: {
  charge: PixCharge;
  busy?: boolean;
  onRegenerate: () => void;
  onCheckNow: () => void;
  onClose: () => void;
}) {
  const { t, tc } = useI18n();
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const expiresAt = charge.expiresAt ? Date.parse(charge.expiresAt) : Number.NaN;
  const hasExpiry = Number.isFinite(expiresAt);
  const remaining = hasExpiry ? expiresAt - now : Number.POSITIVE_INFINITY;
  const expired = hasExpiry && remaining <= 0;

  // Only while there is a countdown still worth running. This screen is gone
  // the moment the charge is paid, which is what stops the clock then.
  useEffect(() => {
    if (!hasExpiry) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasExpiry]);

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
          {t("pixChargeModal.payWithPix")}
        </h2>
        {/* Disabled while a new code is being created — see `busy`. */}
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={t("common.close")}
          className="-mr-1 rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          <MdClose className="h-5 w-5" />
        </button>
      </div>

      {expired ? (
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

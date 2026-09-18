"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdArrowBack, MdClose } from "react-icons/md";
import {
  CANCEL_REASONS,
  CANCEL_USAGE,
  MIN_CANCEL_ANSWER,
  type CancelReason,
  type CancelSurvey,
  type CancelUsage,
} from "@/lib/premiumApi";
import { useI18n } from "@/lib/useI18n";
import { useShake } from "@/lib/useShake";

// The questions somebody answers on the way out.
//
// Four of them, one per screen, all required, and then a confirmation. That is
// deliberate friction and it is worth being honest about what kind: it is not
// a retention wall. Nothing here offers a discount, hides a button, or sends
// anybody to support. The cancellation goes through the moment the last
// question is answered, in one request (see the API's /premium/cancel).
//
// What the friction buys is the answer. Why somebody leaves is the most useful
// thing this service can learn and it is knowable at exactly one moment; a
// survey that can be skipped is answered only by the people who were not that
// annoyed, which is the half of the answer that matters least.
//
// One question per screen rather than a form, for the same reason a checkout
// is a page and not a field: four boxes at once reads as paperwork and gets
// the shortest answer that clears the validator. One at a time gets sentences.
//
// The "Manter assinatura" button is present on every step and is the primary
// one on the last. Somebody who opened this by accident should be one click
// from undoing that, at any point.

/** The steps, in order. The last one is the confirmation, not a question. */
const STEPS = ["reason", "improvement", "comeback", "usage", "confirm"] as const;
type Step = (typeof STEPS)[number];

type CancelSurveyDialogProps = {
  open: boolean;
  /** When access actually ends, already formatted. Shown on the last step. */
  accessUntilLabel: string;
  /** The plan being given up, for the confirmation. */
  planTitle: string;
  busy?: boolean;
  /** The API's refusal, when the answers somehow did not satisfy it. */
  error?: string | null;
  onCancelSubscription: (survey: CancelSurvey) => void;
  /** Close without cancelling anything. */
  onClose: () => void;
};

/**
 * Open/closed only. Everything else lives in the questions below, which are
 * mounted fresh each time this opens — the same arrangement PixChargeModal
 * uses, and for the same reason: reopening a dialog somebody abandoned halfway
 * should start over, and a new component is a cleaner way to say that than an
 * effect that resets five fields and can be forgotten by the sixth.
 */
export function CancelSurveyDialog({ open, ...rest }: CancelSurveyDialogProps) {
  if (!open) return null;
  return <CancelSurveyContent {...rest} />;
}

function CancelSurveyContent({
  accessUntilLabel,
  planTitle,
  busy,
  error,
  onCancelSubscription,
  onClose,
}: Omit<CancelSurveyDialogProps, "open">) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("reason");
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [reasonOther, setReasonOther] = useState("");
  const [improvement, setImprovement] = useState("");
  const [comeback, setComeback] = useState("");
  const [usage, setUsage] = useState<CancelUsage | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  // Shakes when the answers are being sent, the same signal the Pix dialog
  // uses: the card is refusing to close, and a card that simply ignores a
  // click reads as broken.
  useShake(() => cardRef.current, Boolean(busy));

  // Escape closes it — which here means *keeping* the subscription, the safe
  // direction. Not while the request is in flight.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Exactly the API's rules, so the button is never enabled for an answer the
  // server will refuse — see validateCancelSurvey.
  const stepAnswered = useMemo(() => {
    switch (step) {
      case "reason":
        return Boolean(reason) && (reason !== "other" || reasonOther.trim().length >= 3);
      case "improvement":
        return improvement.trim().length >= MIN_CANCEL_ANSWER;
      case "comeback":
        return comeback.trim().length >= MIN_CANCEL_ANSWER;
      case "usage":
        return Boolean(usage);
      case "confirm":
        return true;
    }
  }, [step, reason, reasonOther, improvement, comeback, usage]);

  const index = STEPS.indexOf(step);

  const goNext = useCallback(() => {
    if (!stepAnswered) return;
    const next = STEPS[index + 1];
    if (next) setStep(next);
  }, [index, stepAnswered]);

  const submit = useCallback(() => {
    if (!reason || !usage) return;
    onCancelSubscription({
      reason,
      ...(reason === "other" ? { reasonOther: reasonOther.trim() } : {}),
      improvement: improvement.trim(),
      comeback: comeback.trim(),
      usage,
    });
  }, [reason, reasonOther, improvement, comeback, usage, onCancelSubscription]);

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
        aria-label={t("cancelSurvey.title")}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-950"
      >
        <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          {/* Only once there is something to go back to. */}
          {index > 0 && !busy && (
            <button
              type="button"
              onClick={() => setStep(STEPS[index - 1]!)}
              aria-label={t("common.back")}
              className="-ml-1 rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              <MdArrowBack className="h-5 w-5" />
            </button>
          )}
          <div className="flex-1">
            <h2 className="text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {t("cancelSurvey.title")}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("cancelSurvey.stepOf", { current: index + 1, total: STEPS.length })}
            </p>
          </div>
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

        {/* How far along, as a bar rather than only as "passo 2 de 5": four
            questions with no visible end is what makes a form feel endless. */}
        <div className="h-1 w-full bg-zinc-100 dark:bg-zinc-900">
          <div
            className="h-full bg-zinc-900 transition-all dark:bg-zinc-100"
            style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="flex flex-col gap-4 p-5">
          {step === "reason" && (
            <Question text={t("cancelSurvey.reasonQuestion")}>
              <Choices
                options={CANCEL_REASONS.map((id) => ({ id, label: t(`cancelSurvey.reason.${id}`) }))}
                value={reason}
                onChange={(value) => setReason(value as CancelReason)}
                name="cancel-reason"
              />
              {reason === "other" && (
                <input
                  type="text"
                  value={reasonOther}
                  onChange={(event) => setReasonOther(event.target.value)}
                  autoFocus
                  maxLength={200}
                  placeholder={t("cancelSurvey.reasonOtherPlaceholder")}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
              )}
            </Question>
          )}

          {step === "improvement" && (
            <Question text={t("cancelSurvey.improvementQuestion")}>
              <LongAnswer
                value={improvement}
                onChange={setImprovement}
                placeholder={t("cancelSurvey.improvementPlaceholder")}
                hint={t("cancelSurvey.minChars", { count: MIN_CANCEL_ANSWER })}
              />
            </Question>
          )}

          {step === "comeback" && (
            <Question text={t("cancelSurvey.comebackQuestion")}>
              <LongAnswer
                value={comeback}
                onChange={setComeback}
                placeholder={t("cancelSurvey.comebackPlaceholder")}
                hint={t("cancelSurvey.minChars", { count: MIN_CANCEL_ANSWER })}
              />
            </Question>
          )}

          {step === "usage" && (
            <Question text={t("cancelSurvey.usageQuestion")}>
              <Choices
                options={CANCEL_USAGE.map((id) => ({ id, label: t(`cancelSurvey.usage.${id}`) }))}
                value={usage}
                onChange={(value) => setUsage(value as CancelUsage)}
                name="cancel-usage"
              />
            </Question>
          )}

          {step === "confirm" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                {t("cancelSurvey.confirmTitle", { plan: planTitle })}
              </p>
              {/* The one fact somebody cancelling most often does not know, and
                  the reason this step exists at all: nothing is taken away
                  today. */}
              <p className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                {t("cancelSurvey.confirmAccessUntil", { value: accessUntilLabel })}
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t("cancelSurvey.confirmThanks")}
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-2">
            {step === "confirm" ? (
              <>
                {/* Keeping the plan is the primary button here, and cancelling
                    is the quiet one — the opposite of every other screen in
                    this app, and the right way round for a destructive step
                    somebody may have reached by momentum. */}
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  {t("cancelSurvey.keepSubscription")}
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-red-600 underline-offset-2 transition hover:underline disabled:opacity-60 dark:text-red-400"
                >
                  {busy ? t("cancelSurvey.cancelling") : t("cancelSurvey.confirmButton")}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!stepAnswered || busy}
                  className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  {t("common.continue")}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="w-full rounded-xl px-4 py-2 text-sm font-medium text-zinc-600 underline-offset-2 transition hover:underline disabled:opacity-60 dark:text-zinc-400"
                >
                  {t("cancelSurvey.keepSubscription")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Question({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">{text}</p>
      {children}
    </div>
  );
}

/**
 * A radio list drawn as cards.
 *
 * Real radio inputs underneath, hidden: the whole row is the target, which on
 * a phone is the difference between an answer and a mis-tap, and the keyboard
 * and screen reader behaviour comes free.
 */
function Choices({
  options,
  value,
  onChange,
  name,
}: {
  options: { id: string; label: string }[];
  value: string | null;
  onChange: (id: string) => void;
  name: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => (
        <label
          key={option.id}
          className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
            value === option.id
              ? "border-zinc-900 bg-zinc-50 text-zinc-950 dark:border-zinc-100 dark:bg-zinc-900 dark:text-zinc-50"
              : "border-zinc-200 text-zinc-700 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700"
          }`}
        >
          <input
            type="radio"
            name={name}
            checked={value === option.id}
            onChange={() => onChange(option.id)}
            className="h-4 w-4 shrink-0 accent-zinc-900 dark:accent-zinc-100"
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

function LongAnswer({
  value,
  onChange,
  placeholder,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint: string;
}) {
  const short = value.trim().length < MIN_CANCEL_ANSWER;
  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        autoFocus
        maxLength={2000}
        placeholder={placeholder}
        className="w-full resize-y rounded-xl border border-zinc-300 px-3 py-2.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />
      {/* Shown only while the answer is too short, so it reads as a hint and
          not as a scolding for having written something. */}
      {short && <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </div>
  );
}

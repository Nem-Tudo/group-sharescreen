"use client";

import { useCallback, useEffect, useState } from "react";
import { MdCheckCircle, MdClose, MdContentCopy, MdRefresh } from "react-icons/md";
import { PixIcon } from "@/components/icons";
import type { PixCharge } from "@/lib/premiumApi";

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
  /** A new charge is being created right now. */
  busy?: boolean;
  /** Asks for a fresh code, after this one expires. */
  onRegenerate: () => void;
  /** Checks with the API now instead of waiting for the next poll. */
  onCheckNow: () => void;
  onClose: () => void;
};

/**
 * Open/closed only. Everything else lives in the dialog below, keyed by the
 * payment id — which is what makes "copied", "code revealed" and the clock
 * reset for a second charge without an effect to clear them: a new key is a
 * new component, and its state starts where its initialisers say.
 */
export function PixChargeModal({ charge, ...rest }: PixChargeModalProps) {
  if (!charge) return null;
  return <PixChargeDialog key={charge.paymentId} charge={charge} {...rest} />;
}

function PixChargeDialog({
  charge,
  paid,
  paidUntilLabel,
  busy,
  onRegenerate,
  onCheckNow,
  onClose,
}: PixChargeModalProps & { charge: PixCharge }) {
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

  // Escape closes it. A dialog that can only be dismissed by hitting one small
  // target is a dialog somebody feels trapped in, and this one opens from a
  // payment button — the worst possible moment to feel that.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pagamento via Pix"
        // Without this, a click anywhere inside the card bubbles to the
        // backdrop and closes the dialog — including a click on the copy
        // button, which is the one thing this screen exists for.
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-y-auto rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-950"
      >
        <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <PixIcon className="h-5 w-5 shrink-0 text-[#32BCAD]" />
          <h2 className="flex-1 text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {paid ? "Pagamento confirmado" : "Pagar com Pix"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-1 rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        {paid ? (
          <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
            <MdCheckCircle className="h-12 w-12 text-emerald-500" />
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {paidUntilLabel
                ? `Tudo certo. Seu acesso Pro está liberado até ${paidUntilLabel}.`
                : "Tudo certo. Seu acesso Pro já está liberado."}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-1 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Fechar
            </button>
          </div>
        ) : expired ? (
          <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
            <MdRefresh className="h-10 w-10 text-zinc-400" />
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Este código expirou
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Nada foi cobrado. Gere um novo código para pagar.
            </p>
            <button
              type="button"
              onClick={onRegenerate}
              disabled={busy}
              className="mt-1 flex items-center gap-2 rounded-lg bg-[#32BCAD] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#2ba99b] disabled:opacity-60"
            >
              <PixIcon className="h-4 w-4 shrink-0" />
              {busy ? "Gerando…" : "Gerar novo código"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-5">
            <div className="flex items-baseline justify-center gap-1.5">
              <span className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
                {charge.amountLabel}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                por {charge.days} dias
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
                  alt="QR code do Pix"
                  className="h-52 w-52 rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800"
                />
                <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                  Escaneie no app do seu banco
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
                  {copied ? "Código copiado!" : "Copiar código Pix"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCode((shown) => !shown)}
                  className="self-center text-xs font-medium text-zinc-500 underline-offset-2 transition hover:underline dark:text-zinc-400"
                >
                  {showCode ? "Ocultar código" : "Ver código"}
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
                Aguardando o pagamento…
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Libera sozinho assim que o pagamento cair — pode deixar esta janela aberta.
                {hasExpiry && ` O código expira em ${countdownLabel(remaining)}.`}
              </p>
              <button
                type="button"
                onClick={onCheckNow}
                className="self-start text-xs font-medium text-zinc-600 underline-offset-2 transition hover:underline dark:text-zinc-400"
              >
                Já paguei, verificar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

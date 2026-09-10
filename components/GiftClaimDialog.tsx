"use client";

import { useCallback, useEffect, useState } from "react";
import { MdCardGiftcard, MdCheckCircle, MdClose } from "react-icons/md";
import { AccountModal, type AccountModalMode } from "@/components/AccountModal";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { planIcon } from "@/components/planIcons";
import { useAuth } from "@/lib/AuthContext";
import { accountTierOf, planTierOf, tierAbove, verifiedBadge } from "@/lib/entitlements";
import {
  fetchGiftByCode,
  redeemGiftCode,
  type GiftCodeInfo,
  type RedeemFailure,
} from "@/lib/premiumApi";

// "Você recebeu um presente."
//
// This is the first thing a lot of people will ever see of GoLive — a link
// somebody sent them — so it is written as a moment rather than as a form.
// Three things and no more: what it is, who it is from, and one button. The
// price is deliberately absent; a present with the price tag left on is a
// different gesture.
//
// The colour comes from the plan (see planIcons), not from this file, so the
// blue one and the gold one are the same two colours the badge beside a
// subscriber's name has always been.
//
// "Recusar" closes it and does nothing else, and that is the honest behaviour
// rather than a stub: refusing a present should not destroy it. The code stays
// good, the link is still in whatever message it arrived in, and somebody who
// pressed it by accident has lost nothing.
//
// An ntpopups popup, registered as "gift_claim" in NtPopups.tsx and opened by
// GiftClaimHost with the code off the URL. The library owns the backdrop, the
// escape key, the animation and the corners — which is why the card below
// declares a width and a background and nothing else. The rounding in
// particular is deliberately the library's 10px rather than the 24 this was
// drawn with: a present is not the place to invent a second kind of dialog,
// and what makes it feel like one is the band, not the radius.

/** dd de mês de aaaa, for the confirmation line. */
function periodEndLabel(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

/**
 * The band across the top of the card, in the plan's own colours.
 *
 * Wrapping paper, drawn rather than illustrated: two crossed ribbons and a
 * sweep of light. It is four divs because that is all it needs to be — an
 * image here would be a file to host, a thing to load, and one more decision
 * to keep in step with a plan whose mark is already chosen in the database.
 */
function GiftBand({ tone }: { tone: "gold" | "blue" }) {
  return (
    <div
      className={`relative h-32 overflow-hidden ${
        tone === "gold"
          ? "bg-gradient-to-br from-amber-300 via-amber-500 to-orange-600"
          : "bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600"
      }`}
    >
      {/* The ribbons. Off-centre on purpose: dead centre reads as a target,
          slightly off reads as something somebody tied. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-[38%] w-9 bg-white/15"
      />
      <span aria-hidden className="absolute inset-x-0 top-1/2 h-9 -translate-y-1/2 bg-white/15" />
      {/* A light passing over it, the same sweep the Pro page uses for its
          offer — and, like that one, it stops for anybody who asked their
          system for less motion (see globals.css). */}
      <span
        aria-hidden
        className="golive-shine pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent"
      />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/40 backdrop-blur-sm">
          <MdCardGiftcard className="h-8 w-8 text-white drop-shadow-sm" />
        </span>
      </span>
    </div>
  );
}

type ClaimState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; gift: GiftCodeInfo }
  | { kind: "done"; gift: GiftCodeInfo; until: number };

export type GiftClaimPopupData = {
  /** The share code off the link. See app/gift/[code]/page.tsx. */
  code: string;
};

export function GiftClaimDialog({
  closePopup,
  data,
}: {
  closePopup: (hasAction?: boolean) => void;
  data?: GiftClaimPopupData;
}) {
  const code = data?.code ?? "";
  const { account, loading: resolvingAccount, refresh } = useAuth();
  const [state, setState] = useState<ClaimState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<RedeemFailure | null>(null);
  const [accountModal, setAccountModal] = useState<AccountModalMode | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchGiftByCode(code, controller.signal).then((gift) => {
      if (controller.signal.aborted) return;
      setState(gift ? { kind: "ready", gift } : { kind: "missing" });
    });
    return () => controller.abort();
  }, [code]);

  const gift = state.kind === "ready" || state.kind === "done" ? state.gift : null;
  const mark = planIcon(gift?.planIconId);
  const tone = gift && planTierOf(gift.planId) === "premium_max" ? "gold" : "blue";
  // What this account already has, against what the present is worth. Worked
  // out here so the screen can say it *before* the button — a refusal that
  // only appears after pressing "resgatar" reads as a failure, and this one is
  // the opposite of bad news.
  const outranks = Boolean(
    gift && account && tierAbove(accountTierOf(account.flags), planTierOf(gift.planId))
  );
  const alreadyTaken = gift?.status === "delivered" && state.kind !== "done";

  const redeem = useCallback(async () => {
    if (!gift || busy) return;
    setBusy(true);
    setError(null);
    setFailure(null);
    const outcome = await redeemGiftCode(gift.code);
    if (outcome.ok) {
      setState({ kind: "done", gift, until: outcome.currentPeriodEnd });
      // The account is what actually changed. Until it is re-read, every
      // Pro-only control on screen is still locked behind a plan this person
      // now has.
      refresh();
    } else {
      setError(outcome.error);
      setFailure(outcome.reason);
    }
    setBusy(false);
  }, [gift, busy, refresh]);

  return (
    <>
      {/* Width and background only — the box, the shadow and the corners
          belong to the popup this is mounted in. */}
      <div className="relative flex w-96 max-w-[calc(100vw-1rem)] flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        {/* Two skins for one button, because what is behind it changes: over
            the band it is white on a gradient with a scrim, and over the
            plain card — while the present is loading, or when there is none
            — that same white would be a light grey circle on white. */}
        <button
          type="button"
          onClick={() => closePopup(false)}
          aria-label="Fechar"
          className={`absolute right-3 top-3 z-10 rounded-full p-1.5 transition ${
            gift
              ? "bg-black/20 text-white/90 hover:bg-black/35 hover:text-white"
              : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          }`}
        >
          <MdClose className="h-4 w-4" />
        </button>

        {state.kind === "missing" ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
              <MdCardGiftcard className="h-7 w-7 text-zinc-400" />
            </span>
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Esse presente não está mais aqui
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              O código não existe ou o pagamento ainda não foi confirmado. Se acabaram de te
              mandar, tente de novo em um minuto.
            </p>
            <button
              type="button"
              onClick={() => closePopup(false)}
              className="mt-1 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Fechar
            </button>
          </div>
        ) : state.kind === "loading" || !gift ? (
          // Deliberately quiet: this is on screen for a few hundred
          // milliseconds, and a skeleton of the real card would flash a
          // shape that is about to be replaced by a different one.
          <div className="flex h-64 items-center justify-center">
            <span
              aria-hidden
              className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent dark:border-zinc-700"
            />
          </div>
        ) : (
          <>
            <GiftBand tone={tone} />

            <div className="px-6 pb-6 pt-5">
              <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
                {state.kind === "done" ? "Presente resgatado" : "Você recebeu um presente"}
              </p>

              <h2 className="mt-1.5 flex items-center justify-center gap-1.5 text-center text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                {gift.planTitle}
                <mark.Icon className={`h-5 w-5 shrink-0 ${mark.className}`} />
              </h2>

              <p className="mt-2 text-center">
                <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {gift.days} dias de acesso
                </span>
              </p>

              {/* Who it is from. The face and the name exactly as they are
                  drawn everywhere else on the site — the colour they bought
                  included — because this is the one line that makes it a
                  present from a person instead of a coupon from a company. */}
              {gift.from && (
                <div className="mt-5 flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
                  <UserAvatar
                    src={gift.from.avatarUrl}
                    name={gift.from.displayName}
                    size={38}
                    className="shrink-0"
                    userId={gift.from.id}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                      de
                    </span>
                    <DisplayUserName
                      name={gift.from.displayName}
                      verified={verifiedBadge(gift.from.flags)}
                      color={gift.from.nameColor}
                      className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"
                    />
                  </span>
                </div>
              )}

              {state.kind === "done" ? (
                <div className="mt-5 flex flex-col items-center gap-2 text-center">
                  <MdCheckCircle className="h-9 w-9 text-emerald-500" />
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {state.until > 0
                      ? `Está tudo seu até ${periodEndLabel(state.until)}. Aproveite.`
                      : "Está tudo seu. Aproveite."}
                  </p>
                  <button
                    type="button"
                    onClick={() => closePopup(true)}
                    className="mt-1 w-full rounded-xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                  >
                    Começar a usar
                  </button>
                </div>
              ) : alreadyTaken ? (
                <div className="mt-5 flex flex-col gap-3 text-center">
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Esse presente já foi resgatado.
                  </p>
                  <button
                    type="button"
                    onClick={() => closePopup(false)}
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Fechar
                  </button>
                </div>
              ) : outranks ? (
                // Not a refusal, and written so it does not read as one: the
                // reason they cannot take it is that they already have
                // better. The one thing worth adding is that the present
                // survives — the code is untouched and somebody else can
                // still use it.
                <div className="mt-5 flex flex-col gap-3 text-center">
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Você já tem um plano maior que esse, então ele não te daria nada de novo.
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-500">
                    O presente continua valendo — o link ainda pode ser resgatado por outra
                    pessoa.
                  </p>
                  <button
                    type="button"
                    onClick={() => closePopup(false)}
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Fechar
                  </button>
                </div>
              ) : !resolvingAccount && !account ? (
                // A present has to land somewhere, and a guest identity does
                // not survive clearing a browser (see the /pro gate, which
                // says the same thing for the same reason). The sign-up is a
                // dialog on top of this one rather than a page, so the code
                // in the URL — and this card — are still here afterwards.
                <div className="mt-5 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setAccountModal("create")}
                    className={`w-full rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition ${
                      tone === "gold"
                        ? "bg-amber-500 hover:bg-amber-600"
                        : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    Criar conta e resgatar
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountModal("login")}
                    className="w-full rounded-xl px-4 py-2 text-sm font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    Já tenho conta
                  </button>
                </div>
              ) : (
                <div className="mt-5 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => void redeem()}
                    disabled={busy || resolvingAccount}
                    className={`w-full rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60 ${
                      tone === "gold"
                        ? "bg-amber-500 hover:bg-amber-600"
                        : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    {busy ? "Resgatando…" : "Resgatar presente"}
                  </button>
                  {/* Quiet, and it should be: it is the answer nobody is
                      hoping for, and giving it equal weight would turn a
                      present into a decision. */}
                  <button
                    type="button"
                    onClick={() => closePopup(false)}
                    className="w-full rounded-xl px-4 py-2 text-sm font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    Recusar
                  </button>
                </div>
              )}

              {error && (
                <p
                  role="alert"
                  className="mt-3 text-center text-sm text-red-600 dark:text-red-400"
                >
                  {error}
                  {failure === "card_subscription" && (
                    <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                      Cancele a assinatura no cartão e volte aqui — o presente continua valendo.
                    </span>
                  )}
                </p>
              )}

              {gift.planDescription && state.kind !== "done" && (
                <p className="mt-4 text-center text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                  {gift.planDescription}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <AccountModal mode={accountModal} onModeChange={setAccountModal} />
    </>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { MdCardGiftcard, MdClose, MdSearch } from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { PixIcon } from "@/components/icons";
import { planIcon } from "@/components/planIcons";
import { PixChargeModal } from "@/components/PixChargeModal";
import { useAuth } from "@/lib/AuthContext";
import { verifiedBadge } from "@/lib/entitlements";
import { searchPeople, type SocialUser } from "@/lib/socialApi";
import { useSocialGraph } from "@/lib/useSocialGraph";
import {
  fetchGiftStatus,
  fetchPremiumPlans,
  startGiftPix,
  type BillingCycle,
  type GiftCharge,
  type PremiumPlan,
} from "@/lib/premiumApi";

// "Presentear": buy a plan for somebody else.
//
// Three questions in one dialog — who, which plan, and pay — in that order,
// because the first is the only one the person came here already knowing the
// answer to. The plans are the same documents /pro sells (see the API's
// premiumPlan.ts), so nothing here quotes a price of its own.
//
// Pix and only Pix, and that is the product rather than a shortcut: the card
// path is a *preapproval*, a standing monthly mandate on whoever pays. As a
// present that would be somebody signing up to be charged every month, for
// ever, for a benefit held by another account — with the recipient holding the
// only reason to end it and no way to. One charge, a fixed stretch of days, is
// what a present actually is.
//
// The list of people starts as your friends rather than an empty search box.
// Somebody who opens this has a person in mind, and that person is nearly
// always one of the faces already on the home page; the box is for the rest.

const SEARCH_DEBOUNCE_MS = 300;
/** How often the buyer's screen asks whether the money landed. */
const POLL_MS = 4000;

function PersonRow({ user, onSelect }: { user: SocialUser; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-left transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
      >
        <UserAvatar
          src={user.avatarUrl}
          name={user.displayName}
          size={32}
          className="shrink-0"
          userId={user.id}
        />
        <span className="min-w-0 flex-1">
          <DisplayUserName
            name={user.displayName}
            verified={verifiedBadge(user.flags)}
            color={user.nameColor}
            className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
          />
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
            @{user.username}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Mounted only while open, like AddFriendDialog and for the same reason:
 * unmounting is what throws away the chosen person, the search and the code on
 * screen, so reopening is a fresh present rather than the last one's leftovers.
 */
export function GiftPlanDialog({
  onClose,
  initialPlanId,
}: {
  onClose: () => void;
  /** Which plan to open on. The caller usually knows — see SiteHeader. */
  initialPlanId?: string;
}) {
  const { account } = useAuth();
  const { graph } = useSocialGraph();
  const [query, setQuery] = useState("");
  // Tagged with the query that produced it, same as AddFriendDialog: the
  // previous answer stays on screen while the next is in flight, because a
  // list that blinks through empty on every keystroke is harder to read than
  // one that is briefly a letter behind.
  const [result, setResult] = useState<{ query: string; hits: SocialUser[] } | null>(null);
  const [recipient, setRecipient] = useState<SocialUser | null>(null);
  const [plans, setPlans] = useState<PremiumPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(initialPlanId ?? null);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only ever shown after the API asks for it — an account created through
  // Discord or Google already has an address on file. Same rule as /pro.
  const [needsEmail, setNeedsEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [charge, setCharge] = useState<GiftCharge | null>(null);
  const [delivered, setDelivered] = useState(false);

  // Derived rather than stored, so the picker cannot end up naming a plan the
  // list no longer has.
  const plan = plans.find((entry) => entry.id === selectedPlanId) ?? plans[0] ?? null;
  const pricing = plan?.cycles?.find((entry) => entry.cycle === cycle) ?? null;
  const mark = planIcon(plan?.iconId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPremiumPlans(controller.signal).then(setPlans);
    return () => controller.abort();
  }, []);

  const trimmed = query.trim().replace(/^@/, "");
  const searchable = trimmed.length >= 2;

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchPeople(trimmed, controller.signal).then((hits) => {
        if (controller.signal.aborted) return;
        setResult({ query: trimmed, hits });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchable, trimmed]);

  const check = useCallback(async () => {
    if (!charge) return;
    const status = await fetchGiftStatus(charge.giftId);
    if (status?.status === "delivered") setDelivered(true);
  }, [charge]);

  // The buyer's own account never changes when a gift is paid — the days go
  // somewhere else — so there is nothing on this screen that would notice the
  // money landing except asking. Stops the moment it is delivered.
  useEffect(() => {
    if (!charge || delivered) return;
    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [charge, delivered, check]);

  // Whoever is on screen to choose from: your friends until something is
  // typed, the server's answer after.
  const people: SocialUser[] = searchable ? result?.hits ?? [] : graph.friends;
  // Never yourself. The API refuses it anyway (a present for yourself is just
  // a subscription), but a row that can only be pressed to be told "no" is a
  // row that should not be there.
  const choices = people.filter((user) => user.id !== account?.id);

  async function pay() {
    if (!recipient || !plan || busy) return;
    setBusy(true);
    setError(null);
    const outcome = await startGiftPix({
      toUserId: recipient.id,
      planId: plan.id,
      cycle,
      email: needsEmail ? email.trim() : undefined,
    });
    if (outcome.ok) {
      setDelivered(false);
      setCharge(outcome.charge);
      setNeedsEmail(false);
    } else {
      setError(outcome.error);
      if (outcome.needsEmail) setNeedsEmail(true);
    }
    setBusy(false);
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[8vh]"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Presentear um plano"
          onClick={(e) => e.stopPropagation()}
          className="flex max-h-[84vh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-zinc-950"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-1.5 text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                <MdCardGiftcard className="h-5 w-5 shrink-0 text-emerald-500" />
                Presentear um plano
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Você paga uma vez e a pessoa recebe os dias na hora.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
            >
              <MdClose className="h-5 w-5" />
            </button>
          </div>

          {/* Who. The chosen person replaces the list rather than sitting above
              it: with somebody picked, a list of everybody else is an invitation
              to change an answer that has already been given, and it is one tap
              to change it anyway. */}
          {recipient ? (
            <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
              <UserAvatar
                src={recipient.avatarUrl}
                name={recipient.displayName}
                size={32}
                className="shrink-0"
                userId={recipient.id}
              />
              <span className="min-w-0 flex-1">
                <DisplayUserName
                  name={recipient.displayName}
                  verified={verifiedBadge(recipient.flags)}
                  color={recipient.nameColor}
                  className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
                />
                <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                  @{recipient.username}
                </span>
              </span>
              {/* Disabled once a code exists: the charge names this person on
                  the server, and letting the name on screen change would show a
                  present being paid for somebody who is not going to get it. */}
              <button
                type="button"
                disabled={Boolean(charge)}
                onClick={() => setRecipient(null)}
                className="shrink-0 text-xs font-medium text-zinc-500 underline-offset-2 transition hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400"
              >
                Trocar
              </button>
            </div>
          ) : (
            <>
              <div className="relative mt-4">
                <MdSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Procurar por nome de usuário"
                  className="w-full rounded-lg border border-zinc-300 py-2 pl-9 pr-3 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
              </div>
              {choices.length === 0 ? (
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  {searchable
                    ? "Ninguém encontrado com esse nome."
                    : "Procure pelo nome de usuário de quem vai receber."}
                </p>
              ) : (
                <ul className="mt-3 flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                  {choices.map((user) => (
                    <PersonRow key={user.id} user={user} onSelect={() => setRecipient(user)} />
                  ))}
                </ul>
              )}
            </>
          )}

          {/* Which plan. Only with something to choose between — a single plan
              needs no picker, exactly as on /pro. */}
          {recipient && plans.length > 0 && (
            <div className="mt-4 flex flex-col gap-3">
              {plans.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {plans.map((entry) => {
                    const entryMark = planIcon(entry.iconId);
                    const chosen = entry.id === plan?.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        disabled={Boolean(charge)}
                        onClick={() => setSelectedPlanId(entry.id)}
                        aria-pressed={chosen}
                        className={`flex flex-1 items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          chosen
                            ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                            : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
                        }`}
                      >
                        <entryMark.Icon
                          className={`h-4 w-4 shrink-0 ${chosen ? "" : entryMark.className}`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{entry.title}</span>
                          <span className="block text-xs opacity-80">
                            {entry.cycles?.find((c) => c.cycle === cycle)?.pixPriceLabel ??
                              entry.pixPriceLabel}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* How long. Labelled in days rather than "Mensal"/"Anual": a
                  present does not renew, so a word that names a billing period
                  would be promising a subscription this cannot hold. */}
              {plan?.cycles && plan.cycles.length > 1 && (
                <div className="inline-flex self-start rounded-xl border border-zinc-200 p-1 dark:border-zinc-800">
                  {plan.cycles.map((entry) => {
                    const chosen = entry.cycle === cycle;
                    return (
                      <button
                        key={entry.cycle}
                        type="button"
                        disabled={Boolean(charge)}
                        onClick={() => setCycle(entry.cycle)}
                        aria-pressed={chosen}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          chosen
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                            : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                        }`}
                      >
                        {entry.periodDays} dias
                      </button>
                    );
                  })}
                </div>
              )}

              {needsEmail && (
                <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  <span>E-mail para o pagamento</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="voce@exemplo.com"
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  />
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    Usado só para a cobrança no Mercado Pago. Não é salvo na sua conta.
                  </span>
                </label>
              )}

              {/* Hidden while a code is on screen rather than disabled: pressing
                  it again would mint a second charge for a present already
                  waiting to be paid, and the dialog above is where that one is. */}
              {!charge && (
                <button
                  type="button"
                  onClick={() => void pay()}
                  disabled={busy || !plan?.available || (needsEmail && !email.trim())}
                  className="flex items-center justify-center gap-2 self-start rounded-lg bg-[#32BCAD] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#2ba99b] disabled:opacity-60"
                >
                  <PixIcon className="h-4 w-4 shrink-0" />
                  {busy
                    ? "Gerando…"
                    : `Presentear por ${pricing?.pixPriceLabel ?? plan?.pixPriceLabel ?? ""}`}
                </button>
              )}
              {plan && !plan.available && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Esse plano está indisponível no momento.
                </p>
              )}
              {plan && (
                <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <mark.Icon className={`h-3.5 w-3.5 shrink-0 ${mark.className}`} />
                  {recipient.displayName} recebe {pricing?.periodDays ?? 30} dias de {plan.title}. Não
                  renova sozinho e nada é cobrado de novo.
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* The same code screen the subscription uses, with the one sentence
          that would be false here replaced: the days are not the buyer's. */}
      <PixChargeModal
        charge={charge}
        paid={delivered}
        paidMessage={
          recipient
            ? `Presente entregue! ${recipient.displayName} já está com o ${plan?.title ?? "plano"}.`
            : null
        }
        busy={busy}
        onRegenerate={() => void pay()}
        onCheckNow={() => void check()}
        onClose={() => {
          setCharge(null);
          // A delivered present is a finished errand: closing the code screen
          // closes the dialog behind it too, rather than dropping somebody
          // back onto a form for a purchase they have already made.
          if (delivered) onClose();
        }}
      />
    </>
  );
}

"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { MdCardGiftcard, MdCheckCircle, MdClose, MdContentCopy, MdSearch } from "react-icons/md";
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
  fetchMyGifts,
  fetchPremiumPlans,
  startGiftPix,
  type BillingCycle,
  type GiftCharge,
  type PremiumPlan,
  type PurchasedGift,
} from "@/lib/premiumApi";

// "Presentear": buy a plan for somebody else.
//
// Two shapes, and the toggle at the top is the whole difference:
//
//   uma pessoa — you name an account at the till, and the days land on it the
//     moment the money does. Nothing to send, nothing to lose.
//   um link — you buy it unaddressed and get golive.../gift/<código> back.
//     Whoever opens that and presses "resgatar" is who gets it.
//
// The link exists because most presents are for somebody who is not here yet.
// "Escolha a conta" has no answer for a friend who has never registered, and
// that is exactly the person a present is most likely to be for — it is how
// they arrive.
//
// Pix and only Pix, and that is the product rather than a shortcut: the card
// path is a *preapproval*, a standing monthly mandate on whoever pays. As a
// present that would be somebody signing up to be charged every month, for
// ever, for a benefit held by another account — with the recipient holding the
// only reason to end it and no way to. One charge, a fixed stretch of days, is
// what a present actually is.

const SEARCH_DEBOUNCE_MS = 300;
/** How often the buyer's screen asks whether the money landed. */
const POLL_MS = 4000;

/** There is nothing to subscribe to — see the portal note in the component. */
const subscribeNothing = () => () => {};

/** The address a code travels as. Matches app/gift/[code]/page.tsx. */
function giftLink(code: string): string {
  if (typeof window === "undefined") return `/gift/${code}`;
  return `${window.location.origin}/gift/${code}`;
}

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
 * One code, with the button that matters.
 *
 * Copying the whole link rather than the code alone: the code is not the thing
 * anybody wants to send, and a friend who receives eight characters with no
 * address has been given a puzzle.
 */
function CodeRow({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(giftLink(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (an insecure origin, a permission denied). Showing
      // the link is the repair: it is then on screen and selectable, the same
      // fallback the Pix code uses.
      setShown(true);
    }
  }, [code]);

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {shown ? giftLink(code) : `/gift/${code}`}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-2 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {copied ? (
            <MdCheckCircle className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <MdContentCopy className="h-3.5 w-3.5 shrink-0" />
          )}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
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
  // Which shape of present. The link is the default: it is the one that works
  // for anybody, including the people most presents are meant for — the ones
  // who do not have an account yet.
  const [mode, setMode] = useState<"link" | "person">("link");
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
  // The money landed. Not "delivered": a link is paid long before anybody
  // redeems it, and the buyer's screen is finished at the payment either way.
  const [settled, setSettled] = useState(false);
  // Codes bought earlier and never handed over. The reason this list is here
  // at all: a link is shown once, and without somewhere to read it again a
  // closed tab is money gone.
  const [myGifts, setMyGifts] = useState<PurchasedGift[]>([]);
  // Whether there is a document to portal into. False on the server, true from
  // the first client render — the same guard UserProfileDialog and ProModal
  // use, through the store rather than an effect so hydration has one answer
  // instead of two.
  const onClient = useSyncExternalStore(subscribeNothing, () => true, () => false);

  // Derived rather than stored, so the picker cannot end up naming a plan the
  // list no longer has.
  const plan = plans.find((entry) => entry.id === selectedPlanId) ?? plans[0] ?? null;
  const pricing = plan?.cycles?.find((entry) => entry.cycle === cycle) ?? null;
  const mark = planIcon(plan?.iconId);
  // Everything past the recipient waits on one answer: who is this for. A
  // link has no such question, so it is ready from the moment it is chosen.
  const addressed = mode === "person" ? recipient : null;
  const ready = mode === "link" || Boolean(addressed);
  const unclaimed = myGifts.filter((gift) => gift.code && gift.status === "paid");

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
    void fetchMyGifts(controller.signal).then(setMyGifts);
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
    if (!status || status.status === "pending") return;
    setSettled(true);
    // So the list at the bottom has this code in it the moment the dialog is
    // reopened, rather than one refresh later.
    void fetchMyGifts().then(setMyGifts);
  }, [charge]);

  // The buyer's own account never changes when a gift is paid — the days go
  // somewhere else, or nowhere yet — so there is nothing on this screen that
  // would notice the money landing except asking. Stops once it has.
  useEffect(() => {
    if (!charge || settled) return;
    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [charge, settled, check]);

  // Whoever is on screen to choose from: your friends until something is
  // typed, the server's answer after.
  const people: SocialUser[] = searchable ? result?.hits ?? [] : graph.friends;
  // Never yourself. The API refuses it anyway (a present for yourself is just
  // a subscription), but a row that can only be pressed to be told "no" is a
  // row that should not be there.
  const choices = people.filter((user) => user.id !== account?.id);

  async function pay() {
    if (!plan || busy || !ready) return;
    setBusy(true);
    setError(null);
    const outcome = await startGiftPix({
      ...(addressed ? { toUserId: addressed.id } : {}),
      planId: plan.id,
      cycle,
      email: needsEmail ? email.trim() : undefined,
    });
    if (outcome.ok) {
      setSettled(false);
      setCharge(outcome.charge);
      setNeedsEmail(false);
    } else {
      setError(outcome.error);
      if (outcome.needsEmail) setNeedsEmail(true);
    }
    setBusy(false);
  }

  if (!onClient) return null;

  // Rendered into the body rather than where it was opened from, and this is
  // load-bearing rather than tidiness.
  //
  // Both callers sit inside an element with a `backdrop-filter` on it: the
  // site header is translucent and blurs what scrolls under it, and /pro can
  // itself be a dialog over a blurred page (see SiteHeader and ProModal). A
  // backdrop-filter makes its element a *containing block for fixed
  // descendants* — so `fixed inset-0` below stopped meaning "the viewport" and
  // started meaning "the header", and the dark backdrop covered a 56-pixel
  // strip at the top of the screen while the page behind stayed lit. The same
  // rule applies to the z-index: `z-30` on the header is a stacking context,
  // and nothing inside it can rise above anything outside.
  //
  // The portal is the fix for both at once, because it takes this subtree out
  // of that element entirely — the Pix code screen below included, which is
  // fixed for the same reasons and was being clipped by the same rule.
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[8vh] backdrop-blur-sm"
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

          {/* Which shape. Locked once a code exists: the charge already names
              a shape on the server, and letting this change afterwards would
              show a purchase that is not the one being paid for. */}
          <div className="mt-4 inline-flex rounded-xl border border-zinc-200 p-1 dark:border-zinc-800">
            {(["link", "person"] as const).map((option) => {
              const chosen = mode === option;
              return (
                <button
                  key={option}
                  type="button"
                  disabled={Boolean(charge)}
                  onClick={() => setMode(option)}
                  aria-pressed={chosen}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    chosen
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }`}
                >
                  {option === "link" ? "Gerar um link" : "Escolher alguém"}
                </button>
              );
            })}
          </div>

          {mode === "link" ? (
            <p className="mt-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              Você recebe um link para mandar por onde quiser. Quem abrir resgata na hora.
            </p>
          ) : recipient ? (
            <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
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
                  the server, and letting the name on screen change would show
                  a present being paid for somebody who is not going to get
                  it. */}
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
              <div className="relative mt-3">
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
          {ready && plans.length > 0 && (
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
                          <span className="block truncate text-sm font-semibold">
                            {entry.title}
                          </span>
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

              {/* Hidden while a code is on screen rather than disabled:
                  pressing it again would mint a second charge for a present
                  already waiting to be paid, and the dialog above is where
                  that one is. */}
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
                  {addressed ? addressed.displayName : "Quem resgatar"} recebe{" "}
                  {pricing?.periodDays ?? 30} dias de {plan.title}. Não renova sozinho e nada é
                  cobrado de novo.
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          {/* Codes bought and not yet handed over. Only the ones still going
              spare: a present somebody already redeemed is a link that does
              nothing, and a list of those is a list of dead ends. */}
          {unclaimed.length > 0 && !charge && (
            <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Presentes que ainda não foram resgatados
              </p>
              <div className="mt-2 flex flex-col gap-3">
                {unclaimed.map((gift) => (
                  <CodeRow
                    key={gift.id}
                    code={gift.code as string}
                    label={`${gift.planTitle} · ${gift.days} dias`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The same code screen the subscription uses, with the one sentence
          that would be false here replaced: the days are not the buyer's. */}
      <PixChargeModal
        charge={charge}
        paid={settled}
        paidMessage={
          addressed
            ? `Presente entregue! ${addressed.displayName} já está com o ${plan?.title ?? "plano"}.`
            : "Pagamento confirmado. Agora é só mandar o link para quem vai ganhar."
        }
        paidExtra={
          // The link, at the one moment the buyer is certainly looking. It is
          // also in the list behind this dialog, which is what makes closing
          // this window survivable.
          !addressed && charge?.code ? (
            <div className="w-full text-left">
              <CodeRow code={charge.code} />
            </div>
          ) : null
        }
        busy={busy}
        onRegenerate={() => void pay()}
        onCheckNow={() => void check()}
        onClose={() => {
          setCharge(null);
          // A delivered present is a finished errand: closing the code screen
          // closes the dialog behind it too — unless there is a link to hand
          // over, in which case the dialog behind is where it can be read
          // again, and shutting it would be taking it away.
          if (settled && addressed) onClose();
        }}
      />
    </>,
    document.body
  );
}

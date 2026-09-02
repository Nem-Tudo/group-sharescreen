"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MdCheck, MdLock } from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import { AccountModal, type AccountModalMode } from "@/components/AccountModal";
import { getDesktopBridge } from "@/lib/desktop";
import { type Feature } from "@/lib/entitlements";
import {
  cancelPremium,
  fetchPremiumPlan,
  fetchPremiumStatus,
  isPremiumActive,
  startPremiumCheckout,
  type PremiumPlan,
} from "@/lib/premiumApi";

// The Pro subscription page: what it costs, what it unlocks, and the one
// button that starts or stops it.
//
// The product is called "Pro" on screen and "premium" in storage — the plan
// id, the account field, the feature tiers and the API routes all still say
// premium. That split is deliberate: a name shown to people is a marketing
// decision that can change again, while those others are a document in a
// database, a column other rows point at, and a URL Mercado Pago has on file
// for every existing subscription. Renaming them would be a migration, not a
// rename.
//
// Everything shown here is read from the API. In particular the price is not
// written anywhere in this file — it comes from the plan document in the
// database (see the API's premiumPlan.ts), which is the whole point of that
// document: changing what premium costs is an edit to one row, and every
// surface that quotes a price follows.

// What each entitlement is called in front of a person. Keys come from
// lib/entitlements.ts; a feature with no entry here still counts and is
// simply not listed, which is the right behaviour for a client that predates
// a perk the server already grants.
const FEATURE_LABELS: Partial<Record<Feature, string>> = {
  quality_2160p: "Transmita em 4K (2160p)",
  quality_1440p: "Transmita em 2K (1440p)",
  fps_120: "Até 120 quadros por segundo",
  bitrate_maximo: "Bitrate máximo (~16 Mbps)",
};

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

export function ProPanel() {
  const { account, loading: resolvingAccount, refresh } = useAuth();
  const [plan, setPlan] = useState<PremiumPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only ever shown after the API asks for it — an account created through
  // Discord or Google already has an address on file, which is most of them,
  // and putting a form in front of everybody to serve the minority would be a
  // step added to the common path for nothing.
  const [needsEmail, setNeedsEmail] = useState(false);
  const [email, setEmail] = useState("");
  // The checkout that is open somewhere else right now, or null. Holding the
  // URL rather than a boolean is what lets the indicator offer to reopen it:
  // the window is easy to lose behind this one, and starting over would mint
  // a second preapproval for a subscription already waiting to be paid.
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  // The tab handle, when there is one — a browser gives us one, a shell
  // handing the URL to an external browser does not. Its only use is noticing
  // that the window was closed; see the poll below.
  const checkoutTabRef = useRef<Window | null>(null);
  // The sign-in dialog, opened from the gate below. A dialog rather than a
  // link home: somebody who got here, read the price and decided to buy has
  // already chosen — sending them to another page to find a form is asking
  // them to choose again, on a screen that no longer mentions premium.
  const [accountModal, setAccountModal] = useState<AccountModalMode | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPremiumPlan(controller.signal).then((loaded) => {
      setPlan(loaded);
      setLoadingPlan(false);
    });
    return () => controller.abort();
  }, []);

  // Re-reads the subscription from Mercado Pago (through the API) and pulls
  // the account down again, so `features` and the copy below reflect it.
  //
  // Throttled, because the caller below is a focus handler: /premium/status
  // is not a cheap read — it makes the API ask Mercado Pago — and somebody
  // alt-tabbing between this page and the checkout would otherwise send a
  // request per switch. Five seconds is far shorter than any payment takes
  // and long enough that a burst of focus events costs one call.
  const lastSyncRef = useRef(0);
  const syncStatus = useCallback(
    // `force` is for the button somebody presses *because* they believe
    // something changed. Making them wait out a throttle they cannot see
    // would make the button look broken, which is the opposite of what a
    // "verificar agora" is for.
    async (force = false) => {
      if (!force && Date.now() - lastSyncRef.current < 5_000) return;
      lastSyncRef.current = Date.now();
      const status = await fetchPremiumStatus();
      if (status) await refresh();
    },
    [refresh]
  );

  // Two moments need this, and the second one is what makes the checkout
  // opening in its own tab work at all.
  //
  //   - on mount, because the browser may return to /premium before Mercado
  //     Pago's webhook has landed; the page then corrects itself in a second
  //     instead of insisting the person is not subscribed.
  //   - when this tab is looked at again. The payment now happens somewhere
  //     else — another tab, or the system browser for the desktop and Android
  //     shells — and nothing here would otherwise ever hear that it worked.
  //     Coming back to this tab is the person asking "did it go through?",
  //     and it is the only signal available: there is no message from a tab on
  //     another origin, and none at all from an external browser.
  useEffect(() => {
    if (resolvingAccount || !account) return;
    void syncStatus();
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Both, because they are not the same event and each misses a case this
    // needs: switching back to a background tab fires visibilitychange and
    // not always focus, while returning from another *application* (the
    // system browser the shells use) fires focus with the tab already
    // visible.
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvingAccount, account?.id, syncStatus]);

  const handleSubscribe = useCallback(async () => {
    setBusy(true);
    setError(null);

    // The checkout leaves this page standing, and getting there is different
    // in each of the three places this app runs:
    //
    //   - in a shell (desktop or Android), `openExternal` hands the URL to the
    //     system browser or an in-app tab. It is what the OAuth login already
    //     does, and it is not optional: Electron *denies* window.open and
    //     redirects it (see electron/main.ts's setWindowOpenHandler), so the
    //     browser path below would open nothing at all there.
    //   - in a browser, a new tab.
    //
    // The tab is opened *now*, empty, while the click is still the reason
    // anything is happening. Opening it after the await instead would put it
    // outside the user gesture, which is exactly what a popup blocker exists
    // to stop — the request takes a round trip to Mercado Pago, so that window
    // is wide.
    const bridge = getDesktopBridge();
    const tab = bridge ? null : window.open("", "_blank");

    const result = await startPremiumCheckout(email.trim() || undefined);
    if (!result.ok) {
      // The placeholder has no reason to exist any more, and leaving a blank
      // tab behind after a failure reads as a second thing having gone wrong.
      if (tab && !tab.closed) tab.close();
      setError(result.error);
      // Latched rather than toggled: once the API has said it needs an
      // address, the field stays on screen through a failed retry — hiding it
      // again would take away the very thing being corrected.
      if (result.needsEmail) setNeedsEmail(true);
      setBusy(false);
      return;
    }

    if (bridge?.openExternal) {
      void bridge.openExternal(result.checkoutUrl);
      setCheckoutUrl(result.checkoutUrl);
    } else if (tab && !tab.closed) {
      tab.location.href = result.checkoutUrl;
      checkoutTabRef.current = tab;
      setCheckoutUrl(result.checkoutUrl);
    } else {
      // Blocked, or closed while the request was in flight. Navigating in
      // place is worse than a tab but far better than a button that did
      // nothing — and it is what this did before there was a tab at all.
      // No indicator here on purpose: this page is being replaced, so there
      // is nothing left to indicate anything to.
      window.location.href = result.checkoutUrl;
      return;
    }

    // Not left spinning: this page is staying, and the button has to be
    // usable again — the checkout can be abandoned, and the "assinar" they
    // press next must not find a disabled control.
    setBusy(false);
  }, [email]);

  // A closed checkout window is the clearest "they are done with it" signal
  // available — either they paid or they gave up, and both mean this page
  // should stop claiming a window is open. Polled because a cross-origin
  // window fires no event we can hear; `closed` is the one property still
  // readable across origins.
  //
  // Only ever runs in a browser: a shell handed the URL to an external
  // browser and has no handle, so there its indicator stays until the
  // subscription activates or the person dismisses it.
  useEffect(() => {
    if (!checkoutUrl) return;
    const tab = checkoutTabRef.current;
    if (!tab) return;
    const timer = setInterval(() => {
      if (!tab.closed) return;
      clearInterval(timer);
      checkoutTabRef.current = null;
      setCheckoutUrl(null);
      // They may well have paid in the seconds before closing it, and this is
      // the moment that is worth spending a check on.
      void syncStatus(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [checkoutUrl, syncStatus]);

  const handleReopenCheckout = useCallback(() => {
    if (!checkoutUrl) return;
    const bridge = getDesktopBridge();
    if (bridge?.openExternal) {
      void bridge.openExternal(checkoutUrl);
      return;
    }
    // Straight from the click with the URL already in hand, so there is no
    // await between the gesture and the open and nothing for a popup blocker
    // to object to.
    const tab = window.open(checkoutUrl, "_blank");
    if (tab) checkoutTabRef.current = tab;
  }, [checkoutUrl]);

  const handleCancel = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await cancelPremium();
    if (!result.ok) setError(result.error ?? "Não foi possível cancelar agora.");
    await refresh();
    setBusy(false);
  }, [refresh]);

  const premium = account?.premium ?? null;
  const active = isPremiumActive(premium);
  const cancelled = premium?.status === "cancelled";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        GoLive Pro
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {plan?.description ?? "Mais qualidade na sua transmissão."}
      </p>

      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        {loadingPlan ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando o plano…</p>
        ) : !plan ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Não foi possível carregar o plano agora. Tente recarregar a página.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
                {plan.priceLabel}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">/ mês</span>
            </div>

            <ul className="mt-4 flex flex-col gap-2">
              {plan.features.map((feature) => {
                const label = FEATURE_LABELS[feature as Feature];
                if (!label) return null;
                return (
                  <li
                    key={feature}
                    className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                  >
                    <MdCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
                    {label}
                  </li>
                );
              })}
            </ul>

            <div className="mt-6">
              {resolvingAccount ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando…</p>
              ) : !account ? (
                <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                  <MdLock className="h-4 w-4 shrink-0" />
                  {/* A subscription has to attach to something that survives
                      clearing the browser, and a guest identity deliberately
                      does not. */}
                  <span>
                    É preciso ter uma conta para assinar.{" "}
                    <button
                      type="button"
                      onClick={() => setAccountModal("create")}
                      className="font-medium underline underline-offset-2"
                    >
                      Criar conta
                    </button>
                  </span>
                </div>
              ) : active ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {cancelled
                      ? `Assinatura cancelada — seu acesso continua até ${periodEndLabel(premium!.currentPeriodEnd)}.`
                      : `Assinatura ativa — renova em ${periodEndLabel(premium!.currentPeriodEnd)}.`}
                  </p>
                  {!cancelled && (
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={busy}
                      className="self-start rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      {busy ? "Cancelando…" : "Cancelar assinatura"}
                    </button>
                  )}
                </div>
              ) : !plan.available ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  As assinaturas estão indisponíveis no momento.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {checkoutUrl && (
                    <div
                      role="status"
                      className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
                    >
                      <div className="flex items-center gap-2 font-medium">
                        {/* A spinner rather than an icon: something *is* in
                            progress somewhere else, and a static mark would
                            read as a finished state. */}
                        <span
                          aria-hidden
                          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                        />
                        Pagamento aberto em outra janela
                      </div>
                      <p className="text-amber-800 dark:text-amber-300/90">
                        Conclua o pagamento por lá. Esta página se atualiza sozinha assim que a
                        assinatura for confirmada.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleReopenCheckout}
                          className="rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-medium transition hover:bg-amber-100 dark:border-amber-500/50 dark:hover:bg-amber-500/15"
                        >
                          Reabrir janela
                        </button>
                        <button
                          type="button"
                          onClick={() => void syncStatus(true)}
                          className="rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-medium transition hover:bg-amber-100 dark:border-amber-500/50 dark:hover:bg-amber-500/15"
                        >
                          Já paguei, verificar
                        </button>
                        {/* An escape hatch, because this state can otherwise
                            only be left by paying: a person who changed their
                            mind in a window this page cannot see would be
                            stuck looking at a spinner about a payment that is
                            never coming. */}
                        <button
                          type="button"
                          onClick={() => {
                            checkoutTabRef.current = null;
                            setCheckoutUrl(null);
                          }}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium underline-offset-2 transition hover:underline"
                        >
                          Cancelar
                        </button>
                      </div>
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
                        className="w-full max-w-sm rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                      />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {/* Said plainly because an email box on a payment page
                            invites the question, and the answer is short. */}
                        Usado só para a cobrança no Mercado Pago. Não é salvo na sua conta.
                      </span>
                    </label>
                  )}
                  {/* Hidden while a checkout is open rather than disabled:
                      pressing it again would create a *second* preapproval at
                      Mercado Pago for a subscription already waiting to be
                      paid, and "reabrir janela" above is what somebody who
                      lost the window actually wants. */}
                  {!checkoutUrl && (
                    <button
                      type="button"
                      onClick={handleSubscribe}
                      disabled={busy || (needsEmail && !email.trim())}
                      className="self-start rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                    >
                      {busy ? "Abrindo o pagamento…" : `Assinar por ${plan.priceLabel}/mês`}
                    </button>
                  )}
                </div>
              )}
            </div>

            {error && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>

      {/* Rendered here rather than beside the button: it is fixed to the
          viewport, so where it sits in the tree only decides who owns its
          state — and that is this panel, which is what reacts to the account
          appearing. */}
      <AccountModal mode={accountModal} onModeChange={setAccountModal} />

      <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
        O pagamento é processado pelo Mercado Pago. A cobrança é mensal e pode ser cancelada a
        qualquer momento.
      </p>
    </div>
  );
}

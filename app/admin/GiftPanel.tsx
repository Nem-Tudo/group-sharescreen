"use client";

import { useEffect, useState } from "react";
import {
  createAdminGift,
  fetchAdminPlans,
  type AdminGift,
  type AdminPlanOption,
} from "@/lib/adminApi";

// Minting a gift link nobody paid for.
//
// Deliberately next to "Conceder plano" and deliberately not merged with it,
// because they answer different questions. That one is "give Fulano thirty
// days" — one step, nothing to send, and it needs an account to aim at. This
// one is "produce something I can hand out": a prize, a giveaway, an apology,
// where who ends up with it is decided afterwards and may not be on the site
// at all yet.
//
// The link that comes back is an ordinary present. It goes through the same
// claim screen, the same redemption and the same ladder check as one somebody
// bought — the only difference is that no money moved, and nothing downstream
// knows or cares.
//
// Codes made here are listed for the rest of the visit and nowhere else. That
// is a real limit and worth stating: leave the page and the link is gone. It
// is also not much of one — nothing was spent, and making another takes a
// second — and the alternative is a permanent ledger of comped codes that
// somebody would have to go and prune.

const DEFAULT_DAYS = 30;
/** The same handful "Conceder plano" offers, so the two read as one idea. */
const DAY_PRESETS = [7, 15, 30, 90, 365];

function giftLink(code: string): string {
  if (typeof window === "undefined") return `/gift/${code}`;
  return `${window.location.origin}/gift/${code}`;
}

/** One minted code, with the button that matters. */
function GiftRow({ gift }: { gift: AdminGift }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(giftLink(gift.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused. The link is on screen and selectable either way —
      // which is why it is rendered whole rather than truncated to the code.
    }
  }

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {gift.planTitle} · {gift.days} dias
      </span>
      <div className="flex items-center gap-2">
        {/* Selectable and wrapped rather than truncated: if the clipboard is
            unavailable, reading it off the screen has to still be possible —
            and at this length that means it has to be all there. */}
        <code className="min-w-0 flex-1 break-all rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] leading-snug text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {giftLink(gift.code)}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="shrink-0 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </li>
  );
}

export function GiftPanel() {
  const [plans, setPlans] = useState<AdminPlanOption[]>([]);
  const [planId, setPlanId] = useState("");
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Newest first: the one just made is the one being copied.
  const [minted, setMinted] = useState<AdminGift[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchAdminPlans()
      .then((loaded) => {
        if (cancelled) return;
        setPlans(loaded);
        setPlanId((current) => current || loaded[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar os planos.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGenerate() {
    if (!planId || busy || days < 1) return;
    setBusy(true);
    setError(null);
    try {
      const gift = await createAdminGift(planId, days);
      setMinted((current) => [gift, ...current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Gerar presente</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Cria um link de presente sem cobrança. Quem abrir escolhe resgatar, e os dias entram na
        conta dele — some ao que já tiver, e é recusado se a pessoa já tem um plano maior. Vale
        uma vez só. Para dar direto a alguém que você já sabe quem é, use “Conceder plano” acima.
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        <div className="min-w-40 flex-1">
          <label
            htmlFor="gift-plan"
            className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Plano
          </label>
          <select
            id="gift-plan"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            className={inputClass}
          >
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.title} ({plan.priceLabel}){plan.active ? "" : " — fora de venda"}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-40 flex-1">
          <label
            htmlFor="gift-days"
            className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Duração
          </label>
          {/* The preset and the number are one control in two halves, exactly
              as in "Conceder plano": the list is what is picked nine times out
              of ten, and the box beside it is the tenth without a mode to
              switch into. */}
          <div className="flex gap-2">
            <select
              id="gift-days"
              value={DAY_PRESETS.includes(days) ? String(days) : "custom"}
              onChange={(e) => {
                if (e.target.value === "custom") return;
                setDays(Number(e.target.value));
              }}
              className={inputClass}
            >
              {DAY_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset} dias
                </option>
              ))}
              <option value="custom">Outro…</option>
            </select>
            <input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              aria-label="Dias"
              className={`${inputClass} w-24`}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!planId || busy || days < 1}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Gerando..." : "Gerar link"}
        </button>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>

      {minted.length > 0 && (
        <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Gerados agora — copie antes de sair da página
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {minted.map((gift) => (
              <GiftRow key={gift.giftId} gift={gift} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

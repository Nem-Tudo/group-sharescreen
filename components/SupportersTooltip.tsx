"use client";

import { useEffect, useRef, useState } from "react";
import { getSignalingHttpBase } from "@/lib/roomsApi";
import { useSignaling } from "@/lib/useSignaling";
import type { Supporter } from "@/lib/supporter";
import { VerifiedBadgeIcon } from "./icons";

async function fetchSupporters(signal?: AbortSignal): Promise<Supporter[]> {
  const res = await fetch(`${getSignalingHttpBase()}/supporters`, { signal });
  if (!res.ok) throw new Error(`Falha ao carregar apoiadores (status ${res.status})`);
  const data = (await res.json()) as { supporters: Supporter[] };
  return data.supporters;
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// What a supporter gets, said at the top of the card rather than left to be
// discovered — it is the reason to click the button, so it goes above the
// list of people who already did. The threshold is the one the badge is
// actually granted on; it lives here as text because granting it is a manual
// admin action (see the admin panel's account flags), not something this
// client can check.
const VERIFIED_THRESHOLD_BRL = 5;

function SupportPerk() {
  return (
    <div className="mb-2 flex items-start gap-1.5 rounded-md bg-blue-500/10 px-2 py-1.5 text-[0.7rem] leading-snug text-zinc-200">
      <VerifiedBadgeIcon className="mt-px h-3.5 w-3.5 shrink-0 text-blue-400" />
      <span>
        Doações acima de {currencyFormatter.format(VERIFIED_THRESHOLD_BRL)} ganham um{" "}
        <span className="font-semibold">verificado</span> no site como agradecimento. (Coloque seu username na mensagem)
      </span>
    </div>
  );
}

// Hover content for the "Apoiar projeto" button (WatchRoom.tsx). Falls back
// to the original plain-text hint whenever there's nothing configured yet,
// so an empty admin list looks exactly like it did before this feature
// existed rather than showing an empty card. The list itself arrives
// pre-sorted descending by amount (server/signaling.ts's sortSupporters),
// so there's no client-side re-sort here.
export function SupportersTooltipContent() {
  const signalingState = useSignaling();
  const [supporters, setSupporters] = useState<Supporter[]>([]);
  const lastHandledSeq = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchSupporters(controller.signal)
      .then(setSupporters)
      .catch(() => {
        // Keeps whatever was already shown (or the empty-list fallback) —
        // a failed fetch shouldn't break the button's own hint.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (signalingState.supportersSeq === 0 || signalingState.supportersSeq === lastHandledSeq.current) {
      return;
    }
    lastHandledSeq.current = signalingState.supportersSeq;
    setSupporters(signalingState.supporters);
  }, [signalingState.supportersSeq, signalingState.supporters]);

  // The perk is the point of the button, so it shows either way — including
  // before anyone has supported, which is exactly when it most needs saying.
  // (This branch used to be a bare string; it is a card now, so both shapes
  // agree on width and padding.)
  if (supporters.length === 0) {
    return (
      <div className="w-56">
        <SupportPerk />
        <p className="px-0.5">Apoiar o projeto no LivePix</p>
      </div>
    );
  }

  return (
    <div className="max-h-60 w-56 overflow-y-auto">
      <SupportPerk />
      <p className="mb-1.5 px-0.5 text-[0.65rem] font-semibold tracking-wide text-zinc-400 uppercase">
        Rank dos apoiadores (R$20+)
      </p>
      <ul className="flex flex-col gap-1">
        {supporters.map((s, i) => (
          <li key={`${s.name}-${i}`}>
            <span className="font-semibold">{s.name}</span> doou {currencyFormatter.format(s.amount)}
          </li>
        ))}
      </ul>
    </div>
  );
}

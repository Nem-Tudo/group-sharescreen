"use client";

import { useEffect, useState } from "react";
import { BsCoin, BsShop } from "react-icons/bs";
import { useAuth } from "@/lib/AuthContext";
import { useSignaling } from "@/lib/useSignaling";
import { getAccountToken } from "@/lib/accountApi";
import { signalingClient } from "@/lib/signalingClient";
import {
  fetchCosmeticsCatalog,
  purchaseCosmetic,
  equipCosmetic as equipCosmeticRequest,
  type CosmeticProduct,
} from "@/lib/cosmetics";
import { trackEvent } from "@/lib/analytics";

export type CosmeticsStorePopupData = Record<string, never>;

// The cosmetics store — an ntpopups popup, registered as "cosmetics_store" in
// NtPopups.tsx, opened from RoomAccountCard's shop button. Fetches its own
// catalog+inventory (see lib/cosmetics.ts) rather than taking it as popup
// data: unlike a video-source or member-actions popup, there's nothing about
// a specific room/person a caller needs to hand it.
//
// Only ever meaningful for a signed-in account — a guest has no account
// document for a purchase to live on (see the server's purchaseCosmetic),
// so it renders the catalog read-only with a nudge to create an account
// instead of buy/equip buttons.
export function CosmeticsStoreDialog({ closePopup }: { closePopup: (hasAction?: boolean) => void }) {
  const { account, points, refresh } = useAuth();
  const state = useSignaling();
  const [catalog, setCatalog] = useState<CosmeticProduct[] | null>(null);
  const [owned, setOwned] = useState<string[]>([]);
  const [equipped, setEquipped] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCosmeticsCatalog()
      .then((data) => {
        if (cancelled) return;
        setCatalog(data.catalog);
        setOwned(data.ownedCosmetics);
        setEquipped(data.equippedNameColor);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Falha ao carregar a loja.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pushes the freshly bought/equipped color to whoever is already sharing a
  // room with us: re-registering on the same open socket is what the server
  // treats as "something about this peer changed" (see the "register" case
  // in server/signaling.ts) without a reconnect or a room switch.
  function announceToRoom() {
    if (state.name) signalingClient.register(state.name, getAccountToken());
  }

  async function handleBuy(product: CosmeticProduct) {
    if (pendingId) return;
    setPendingId(product.id);
    setActionError(null);
    try {
      const result = await purchaseCosmetic(product.id);
      setOwned(result.ownedCosmetics);
      setEquipped(result.equippedNameColor);
      trackEvent("cosmetic_purchased", { productId: product.id });
      await refresh();
      announceToRoom();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Falha ao comprar o item.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleEquip(productId: string | null) {
    if (pendingId) return;
    setPendingId(productId ?? "none");
    setActionError(null);
    try {
      const result = await equipCosmeticRequest(productId);
      setEquipped(result.equippedNameColor);
      await refresh();
      announceToRoom();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Falha ao equipar o item.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-4 bg-white p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <BsShop className="h-4 w-4 shrink-0" /> Loja de cosméticos
        </p>
        <button
          type="button"
          onClick={() => closePopup(false)}
          aria-label="Fechar"
          className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
        >
          ×
        </button>
      </div>

      {account && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
          <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <BsCoin className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            Seus pontos
          </span>
          <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {points.toLocaleString("pt-BR")}
          </span>
        </div>
      )}

      {!account && (
        <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Crie uma conta para comprar e usar cores no seu nome.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Cores de nome</p>

        {loadError && <p className="text-xs text-red-500">{loadError}</p>}

        {!catalog && !loadError && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Carregando...</p>
        )}

        {catalog && (
          <div className="flex flex-col gap-2">
            {account && (
              <button
                type="button"
                disabled={pendingId !== null || equipped === null}
                onClick={() => handleEquip(null)}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition disabled:cursor-not-allowed ${
                  equipped === null
                    ? "border-zinc-400 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900"
                    : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-zinc-400 dark:border-zinc-600" />
                  Nenhuma (padrão)
                </span>
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {equipped === null ? "Equipada" : "Equipar"}
                </span>
              </button>
            )}

            {catalog.map((product) => {
              const isOwned = owned.includes(product.id);
              const isEquipped = equipped === product.value;
              const canAfford = points >= product.price;
              const busy = pendingId === product.id;
              return (
                <div
                  key={product.id}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                    isEquipped
                      ? "border-zinc-400 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900"
                      : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-4 w-4 shrink-0 rounded-full"
                      style={{ backgroundColor: product.value }}
                    />
                    {product.label}
                  </span>
                  {!account ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      <BsCoin className="h-3 w-3 shrink-0 text-amber-500" />
                      {product.price}
                    </span>
                  ) : isOwned ? (
                    <button
                      type="button"
                      disabled={busy || isEquipped}
                      onClick={() => handleEquip(product.id)}
                      className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      {isEquipped ? "Equipada" : "Equipar"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || !canAfford}
                      onClick={() => handleBuy(product)}
                      className="flex shrink-0 items-center gap-1 rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                    >
                      <BsCoin className="h-3 w-3 shrink-0 text-amber-400 dark:text-amber-500" />
                      {product.price}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {actionError && <p className="text-xs text-red-500">{actionError}</p>}
      </div>
    </div>
  );
}

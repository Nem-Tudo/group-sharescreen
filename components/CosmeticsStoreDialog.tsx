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
  type CosmeticProductType,
} from "@/lib/cosmetics";
import { trackEvent } from "@/lib/analytics";
import { useT } from "@/lib/useI18n";
import { formatLocale } from "@/lib/i18n";

export type CosmeticsStorePopupData = Record<string, never>;

// The cosmetics store — an ntpopups popup, registered as "cosmetics_store" in
// NtPopups.tsx, opened from RoomAccountCard's shop button or user profile.
export function CosmeticsStoreDialog({ closePopup }: { closePopup: (hasAction?: boolean) => void }) {
  const t = useT();
  const { account, points, refresh } = useAuth();
  const state = useSignaling();
  const [activeTab, setActiveTab] = useState<CosmeticProductType>("name_color");
  const [catalog, setCatalog] = useState<CosmeticProduct[] | null>(null);
  const [owned, setOwned] = useState<string[]>([]);
  const [equippedNameColor, setEquippedNameColor] = useState<string | null>(null);
  const [equippedProfileColor, setEquippedProfileColor] = useState<string | null>(null);
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
        setEquippedNameColor(data.equippedNameColor);
        setEquippedProfileColor(data.equippedProfileColor ?? null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t("cosmeticsStoreDialog.couldNotLoadTheShop"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

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
      if (result.equippedNameColor !== undefined) setEquippedNameColor(result.equippedNameColor);
      if (result.equippedProfileColor !== undefined) setEquippedProfileColor(result.equippedProfileColor);
      trackEvent("cosmetic_purchased", { productId: product.id });
      await refresh();
      announceToRoom();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("common.couldNotBuyTheItem"));
    } finally {
      setPendingId(null);
    }
  }

  async function handleEquip(productId: string | null) {
    if (pendingId) return;
    setPendingId(productId ?? "none");
    setActionError(null);
    try {
      const result = await equipCosmeticRequest(productId, activeTab);
      if (activeTab === "name_color") {
        setEquippedNameColor(result.equippedNameColor);
      } else {
        setEquippedProfileColor(result.equippedProfileColor ?? null);
      }
      await refresh();
      announceToRoom();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("common.couldNotEquipTheItem"));
    } finally {
      setPendingId(null);
    }
  }

  const currentProducts = catalog?.filter((p) => p.type === activeTab) ?? [];
  const currentEquipped = activeTab === "name_color" ? equippedNameColor : equippedProfileColor;

  return (
    <div className="flex w-84 sm:w-96 max-w-[calc(100vw-1rem)] flex-col gap-4 bg-white p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <BsShop className="h-4 w-4 shrink-0" /> {t("common.cosmeticsShop")}
        </p>
        <button
          type="button"
          onClick={() => closePopup(false)}
          aria-label={t("common.close")}
          className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
        >
          ×
        </button>
      </div>

      {account && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
          <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <BsCoin className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            {t("cosmeticsStoreDialog.yourPoints")}
          </span>
          <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {points.toLocaleString(formatLocale())}
          </span>
        </div>
      )}

      {!account && (
        <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {t("cosmeticsStoreDialog.createAnAccountToBuyAnd")}
        </p>
      )}

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
        <button
          type="button"
          onClick={() => {
            setActiveTab("name_color");
            setActionError(null);
          }}
          className={`rounded-md py-1.5 text-xs font-semibold transition ${
            activeTab === "name_color"
              ? "bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          {t("cosmeticsStoreDialog.nameColours")}
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("profile_color");
            setActionError(null);
          }}
          className={`rounded-md py-1.5 text-xs font-semibold transition ${
            activeTab === "profile_color"
              ? "bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          {t("cosmeticsStoreDialog.bannerColour")}
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {activeTab === "name_color" ? t("cosmeticsStoreDialog.coloursForYourUsername") : t("cosmeticsStoreDialog.backgroundColoursForYourProfile")}
        </p>

        {loadError && <p className="text-xs text-red-500">{loadError}</p>}

        {!catalog && !loadError && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("common.loading2")}</p>
        )}

        {catalog && (
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
            {account && (
              <button
                type="button"
                disabled={pendingId !== null || currentEquipped === null}
                onClick={() => handleEquip(null)}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition disabled:cursor-not-allowed ${
                  currentEquipped === null
                    ? "border-zinc-400 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900"
                    : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-zinc-400 dark:border-zinc-600" />
                  {activeTab === "name_color" ? t("cosmeticsStoreDialog.noneDefault") : t("cosmeticsStoreDialog.defaultGolive")}
                </span>
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {currentEquipped === null ? t("cosmeticsStoreDialog.equipped") : t("cosmeticsStoreDialog.equip")}
                </span>
              </button>
            )}

            {currentProducts.map((product) => {
              const isOwned = owned.includes(product.id);
              const isEquipped = currentEquipped === product.value;
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
                  <span className="flex items-center gap-2.5">
                    {product.type === "profile_color" ? (
                      <span
                        className="h-5 w-7 shrink-0 rounded-md border border-black/20 shadow-2xs"
                        style={{ background: product.value }}
                      />
                    ) : (
                      <span
                        className="h-4 w-4 shrink-0 rounded-full"
                        style={{ backgroundColor: product.value }}
                      />
                    )}
                    <span className="text-xs font-medium sm:text-sm">{product.label}</span>
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
                      {isEquipped ? t("cosmeticsStoreDialog.equipped") : t("cosmeticsStoreDialog.equip")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || !canAfford}
                      onClick={() => handleBuy(product)}
                      className="flex shrink-0 items-center gap-1 rounded-md bg-zinc-950 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
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

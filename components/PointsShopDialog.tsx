"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BsCoin, BsShop } from "react-icons/bs";
import { MdCheck, MdPalette, MdTextFields } from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import { useSignalingSelector, shallow } from "@/lib/useSignalingSelector";
import { selectNameSlice } from "@/lib/signalingSelectors";
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
import { trackFeatureEvent } from "@/lib/features";
import { verifiedBadge } from "@/lib/entitlements";
import { nameStyleOf } from "@/lib/nameStyle";
import {
  POINTS_SHOP_EVENTS,
  POINTS_SHOP_FEATURE,
  RARITY_STYLES,
  rarityOf,
  shelfBadgeId,
  shelvesOf,
  type Rarity,
} from "@/lib/pointsShop";
import { useT } from "@/lib/useI18n";
import { formatLocale } from "@/lib/i18n";
import { DisplayUserName } from "@/components/DisplayUserName";
import { NewBadge, markFeatureUsed } from "@/components/NewBadge";
import { UserAvatar } from "@/components/UserAvatar";

// The redesigned points shop — what "cosmetics_store" opens for whoever is in
// the points-shop-v2 experiment (see CosmeticsStoreDialog, which decides).
//
// What the old list lacked, and this is built around:
//   - seeing it on yourself before paying. Picking any item puts it on the
//     preview at the top — your own avatar, name and banner — and the one
//     button there does whatever makes sense for it (buy, put on, take off);
//   - shelves. Plain colors, gradients, animated names, patterned banners,
//     each under its own heading instead of one long list of dots;
//   - knowing how far away something is. An item you cannot afford says how
//     many points are missing, and how close you are.
//   - a second press to spend points, so a misclick costs nothing.

type Filter = "all" | "owned";

const DEFAULT_BANNER = "linear-gradient(135deg, #27272a 0%, #10b981 100%)";

export function PointsShopDialog({ closePopup }: { closePopup: (hasAction?: boolean) => void }) {
  const t = useT();
  const { account, points, refresh } = useAuth();
  const state = useSignalingSelector(selectNameSlice, shallow);
  const [tab, setTab] = useState<CosmeticProductType>("name_color");
  const [filter, setFilter] = useState<Filter>("all");
  const [catalog, setCatalog] = useState<CosmeticProduct[] | null>(null);
  const [owned, setOwned] = useState<string[]>([]);
  const [equippedNameColor, setEquippedNameColor] = useState<string | null>(null);
  const [equippedProfileColor, setEquippedProfileColor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The item on the preview, and the one whose "Comprar" is waiting for its
  // second press.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
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

  // Pushes the freshly bought/equipped look to whoever is already sharing a
  // room with us — see CosmeticsStoreDialog's function of the same name.
  function announceToRoom() {
    if (state.name) signalingClient.register(state.name, getAccountToken());
  }

  function switchTab(next: CosmeticProductType) {
    setTab(next);
    setSelectedId(null);
    setConfirmId(null);
    setActionError(null);
  }

  function select(product: CosmeticProduct) {
    if (confirmId && confirmId !== product.id) trackFeatureEvent(POINTS_SHOP_EVENTS.buyCancelled, { feature: POINTS_SHOP_FEATURE });
    setConfirmId(null);
    setActionError(null);
    if (selectedId === product.id) return;
    setSelectedId(product.id);
    trackFeatureEvent(POINTS_SHOP_EVENTS.preview, { feature: POINTS_SHOP_FEATURE });
  }

  async function buy(product: CosmeticProduct) {
    if (pending) return;
    setPending(true);
    setActionError(null);
    try {
      const result = await purchaseCosmetic(product.id);
      setOwned(result.ownedCosmetics);
      if (result.equippedNameColor !== undefined) setEquippedNameColor(result.equippedNameColor);
      if (result.equippedProfileColor !== undefined) setEquippedProfileColor(result.equippedProfileColor);
      trackEvent("cosmetic_purchased", { productId: product.id });
      trackFeatureEvent(POINTS_SHOP_EVENTS.purchase, { feature: POINTS_SHOP_FEATURE, value: product.price });
      const badge = shelfBadgeId(product.collection ?? "");
      if (badge) markFeatureUsed(badge);
      setConfirmId(null);
      await refresh();
      announceToRoom();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("common.couldNotBuyTheItem"));
    } finally {
      setPending(false);
    }
  }

  async function equip(productId: string | null) {
    if (pending) return;
    setPending(true);
    setActionError(null);
    try {
      const result = await equipCosmeticRequest(productId, tab);
      if (tab === "name_color") setEquippedNameColor(result.equippedNameColor);
      else setEquippedProfileColor(result.equippedProfileColor ?? null);
      trackFeatureEvent(POINTS_SHOP_EVENTS.equip, { feature: POINTS_SHOP_FEATURE });
      await refresh();
      announceToRoom();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("common.couldNotEquipTheItem"));
    } finally {
      setPending(false);
    }
  }

  const selected = catalog?.find((p) => p.id === selectedId && p.type === tab) ?? null;
  const equippedValue = tab === "name_color" ? equippedNameColor : equippedProfileColor;
  const shelves = catalog
    ? shelvesOf(
        filter === "owned" ? catalog.filter((p) => owned.includes(p.id)) : catalog,
        tab
      )
    : [];

  // The preview wears the picked item on its own tab and whatever is equipped
  // on the other, so a name can be tried against the banner it will sit on.
  const previewName = tab === "name_color" && selected ? selected.value : equippedNameColor;
  const previewBanner = (tab === "profile_color" && selected ? selected.value : equippedProfileColor) ?? DEFAULT_BANNER;
  const displayName = account?.displayName ?? state.name ?? "GoLive";

  return (
    <div className="flex max-h-[90dvh] w-[min(44rem,calc(100vw-1rem))] flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      {/* Header: what this is, what you have, how to get more. */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-4 pt-4 pb-3 dark:border-zinc-800">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-base font-semibold">
            <BsShop className="h-4 w-4 shrink-0" /> {t("pointsShop.title")}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t("pointsShop.howToEarn")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {account && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold tabular-nums text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
              <BsCoin className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              {points.toLocaleString(formatLocale())}
            </span>
          )}
          <button
            type="button"
            onClick={() => closePopup(false)}
            aria-label={t("common.close")}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-lg leading-none opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* The preview: you, wearing it. */}
        <section className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <div className="h-20 w-full transition-[background] duration-300 sm:h-24" style={{ background: previewBanner }} />
          <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="-mt-8 flex min-w-0 items-end gap-3">
              <UserAvatar
                src={account?.avatarUrl}
                name={displayName}
                size={64}
                className="shrink-0 rounded-full ring-4 ring-white dark:ring-zinc-950"
              />
              <div className="min-w-0 pb-0.5">
                <DisplayUserName
                  name={displayName}
                  color={previewName}
                  verified={account ? verifiedBadge(account.flags) : null}
                  className="min-w-0 truncate text-lg font-semibold"
                />
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {selected ? selected.label : t("pointsShop.pickToPreview")}
                </p>
              </div>
            </div>
            <PreviewAction
              product={selected}
              signedIn={Boolean(account)}
              points={points}
              owned={selected ? owned.includes(selected.id) : false}
              equipped={selected ? equippedValue === selected.value : false}
              confirming={selected !== null && confirmId === selected.id}
              pending={pending}
              onBuy={() => {
                if (!selected) return;
                if (confirmId === selected.id) void buy(selected);
                else setConfirmId(selected.id);
              }}
              onCancel={() => {
                setConfirmId(null);
                trackFeatureEvent(POINTS_SHOP_EVENTS.buyCancelled, { feature: POINTS_SHOP_FEATURE });
              }}
              onEquip={() => selected && void equip(selected.id)}
              onUnequip={() => void equip(null)}
            />
          </div>
          {actionError && <p className="px-4 pb-3 text-xs text-red-500">{actionError}</p>}
        </section>

        {!account && (
          <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {t("cosmeticsStoreDialog.createAnAccountToBuyAnd")}
          </p>
        )}

        {/* Tabs, and the "just mine" filter beside them. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
            <TabButton active={tab === "name_color"} onClick={() => switchTab("name_color")} icon={<MdTextFields className="h-4 w-4" />}>
              {t("pointsShop.tabName")}
            </TabButton>
            <TabButton active={tab === "profile_color"} onClick={() => switchTab("profile_color")} icon={<MdPalette className="h-4 w-4" />}>
              {t("pointsShop.tabBanner")}
            </TabButton>
          </div>
          {account && (
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-xs dark:bg-zinc-900">
              {(["all", "owned"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setFilter(f);
                    if (f === "owned") trackFeatureEvent(POINTS_SHOP_EVENTS.ownedFilter, { feature: POINTS_SHOP_FEATURE });
                  }}
                  className={`cursor-pointer rounded-md px-2.5 py-1 font-semibold transition ${
                    filter === f
                      ? "bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }`}
                >
                  {f === "all" ? t("pointsShop.filterAll") : t("pointsShop.filterOwned")}
                </button>
              ))}
            </div>
          )}
        </div>

        {loadError && <p className="text-xs text-red-500">{loadError}</p>}

        {!catalog && !loadError && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="h-28 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
            ))}
          </div>
        )}

        {/* Taking an item off: a tile of its own, first, whenever something is on. */}
        {catalog && account && equippedValue !== null && filter === "all" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void equip(null)}
            className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-dashed border-zinc-300 px-3 py-2 text-left text-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <span>{tab === "name_color" ? t("cosmeticsStoreDialog.noneDefault") : t("cosmeticsStoreDialog.defaultGolive")}</span>
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t("pointsShop.backToDefault")}</span>
          </button>
        )}

        {catalog && shelves.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            {filter === "owned" ? t("pointsShop.nothingOwnedYet") : t("pointsShop.nothingHere")}
          </p>
        )}

        {shelves.map((shelf) => {
          const badge = shelfBadgeId(shelf.collection);
          return (
            <section key={shelf.collection} className="flex flex-col gap-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {shelfTitle(t, tab, shelf.collection)}
                {badge && <NewBadge id={badge} />}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {shelf.products.map((product) => (
                  <ItemTile
                    key={product.id}
                    product={product}
                    sample={displayName}
                    selected={selectedId === product.id}
                    owned={owned.includes(product.id)}
                    equipped={equippedValue === product.value}
                    signedIn={Boolean(account)}
                    points={points}
                    onSelect={() => select(product)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function shelfTitle(t: ReturnType<typeof useT>, tab: CosmeticProductType, collection: string): string {
  if (collection === "") return tab === "name_color" ? t("pointsShop.shelfNameColors") : t("pointsShop.shelfBannerColors");
  if (collection === "gradient") return t("pointsShop.shelfGradients");
  if (collection === "effect") return t("pointsShop.shelfEffects");
  if (collection === "pattern") return t("pointsShop.shelfPatterns");
  return t("pointsShop.shelfMore");
}

function rarityLabel(t: ReturnType<typeof useT>, rarity: Rarity): string {
  if (rarity === "legendary") return t("pointsShop.rarityLegendary");
  if (rarity === "epic") return t("pointsShop.rarityEpic");
  if (rarity === "rare") return t("pointsShop.rarityRare");
  return t("pointsShop.rarityCommon");
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50"
          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/** One item on a shelf: how it looks, what it is, and where you stand with it. */
function ItemTile({
  product,
  sample,
  selected,
  owned,
  equipped,
  signedIn,
  points,
  onSelect,
}: {
  product: CosmeticProduct;
  /** The name drawn on a name item's swatch — your own. */
  sample: string;
  selected: boolean;
  owned: boolean;
  equipped: boolean;
  signedIn: boolean;
  points: number;
  onSelect: () => void;
}) {
  const t = useT();
  const rarity = rarityOf(product.price);
  const style = RARITY_STYLES[rarity];
  const nameStyle = product.type === "name_color" ? nameStyleOf(product.value) : null;
  const short = signedIn && !owned && points < product.price;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex cursor-pointer flex-col gap-2 rounded-xl border p-2 text-left transition ${style.ring} ${
        selected
          ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
          : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/60"
      }`}
    >
      {nameStyle ? (
        <span className="flex h-14 items-center justify-center overflow-hidden rounded-lg bg-zinc-100 px-2 dark:bg-zinc-900">
          <span className={`truncate text-base font-bold ${nameStyle.className ?? ""}`} style={nameStyle.style}>
            {sample}
          </span>
        </span>
      ) : (
        <span className="h-14 rounded-lg border border-black/10" style={{ background: product.value }} />
      )}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden />
        <span className="truncate text-xs font-semibold">{product.label}</span>
      </span>
      {equipped ? (
        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <MdCheck className="h-3.5 w-3.5" /> {t("cosmeticsStoreDialog.equipped")}
        </span>
      ) : owned ? (
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t("pointsShop.owned")}</span>
      ) : (
        <span className="flex flex-col gap-1">
          <span className={`flex items-center gap-1 text-xs font-semibold tabular-nums ${short ? "text-zinc-400 dark:text-zinc-500" : ""}`}>
            <BsCoin className="h-3 w-3 shrink-0 text-amber-500" />
            {product.price.toLocaleString(formatLocale())}
          </span>
          {short && (
            <span className="h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden>
              <span className="block h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, (points / product.price) * 100)}%` }} />
            </span>
          )}
        </span>
      )}
    </button>
  );
}

/** The one button under the preview — what can be done with the picked item right now. */
function PreviewAction({
  product,
  signedIn,
  points,
  owned,
  equipped,
  confirming,
  pending,
  onBuy,
  onCancel,
  onEquip,
  onUnequip,
}: {
  product: CosmeticProduct | null;
  signedIn: boolean;
  points: number;
  owned: boolean;
  equipped: boolean;
  confirming: boolean;
  pending: boolean;
  onBuy: () => void;
  onCancel: () => void;
  onEquip: () => void;
  onUnequip: () => void;
}) {
  const t = useT();
  if (!product) return null;
  const rarity = rarityOf(product.price);
  const pill = (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${RARITY_STYLES[rarity].pill}`}>
      {rarityLabel(t, rarity)}
    </span>
  );
  const primary =
    "flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

  let action: ReactNode;
  if (!signedIn) {
    action = null;
  } else if (equipped) {
    action = (
      <button type="button" disabled={pending} onClick={onUnequip} className={`${primary} border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900`}>
        {t("pointsShop.takeOff")}
      </button>
    );
  } else if (owned) {
    action = (
      <button type="button" disabled={pending} onClick={onEquip} className={`${primary} bg-emerald-600 text-white hover:bg-emerald-700`}>
        {t("cosmeticsStoreDialog.equip")}
      </button>
    );
  } else if (points < product.price) {
    action = (
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {t("pointsShop.missingPoints", { missing: (product.price - points).toLocaleString(formatLocale()) })}
      </span>
    );
  } else if (confirming) {
    action = (
      <span className="flex items-center gap-2">
        <button type="button" disabled={pending} onClick={onCancel} className={`${primary} text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900`}>
          {t("common.cancel")}
        </button>
        <button type="button" disabled={pending} onClick={onBuy} className={`${primary} bg-amber-500 text-amber-950 hover:bg-amber-400`}>
          {t("pointsShop.confirmBuy", { left: (points - product.price).toLocaleString(formatLocale()) })}
        </button>
      </span>
    );
  } else {
    action = (
      <button type="button" disabled={pending} onClick={onBuy} className={`${primary} bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200`}>
        <BsCoin className="h-3.5 w-3.5 text-amber-400 dark:text-amber-500" />
        {t("pointsShop.buyFor", { price: product.price.toLocaleString(formatLocale()) })}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      {pill}
      {action}
    </div>
  );
}

import type { CosmeticProduct, CosmeticProductType } from "@/lib/cosmetics";

// The redesigned points shop (components/PointsShopDialog), in one place.
//
// A new look for an existing store, so it goes out behind a feature flag
// created in the admin panel (see CLAUDE.md); whoever is outside it keeps the
// old list (CosmeticsStoreDialog). Purchases are counted on both sides under
// the same event names, so the admin panel can compare the two.

/** The feature's key in the admin panel. Target: user. */
export const POINTS_SHOP_FEATURE = "points-shop-v2";

/**
 * Every event the shop reports. Each has to be registered as a "site event"
 * on the feature in the admin panel or it will not be counted.
 */
export const POINTS_SHOP_EVENTS = {
  /** Something was bought — both stores. Value: the price. */
  purchase: "shop_purchase",
  /** An owned item was put on (or the default put back) — both stores. */
  equip: "shop_equip",
  /** An item was picked to see it on the preview (new store only). */
  preview: "shop_item_preview",
  /** "Comprar" was pressed and then not confirmed (new store only). */
  buyCancelled: "shop_buy_cancel",
  /** The "Meus itens" filter was turned on (new store only). */
  ownedFilter: "shop_owned_filter",
} as const;

export type Rarity = "common" | "rare" | "epic" | "legendary";

/**
 * How rare an item reads, from its price alone — the catalog is edited by hand
 * in the database, and a price is the one thing every product already has.
 */
export function rarityOf(price: number): Rarity {
  if (price >= 1000) return "legendary";
  if (price >= 600) return "epic";
  if (price >= 300) return "rare";
  return "common";
}

export const RARITY_STYLES: Record<Rarity, { dot: string; pill: string; ring: string }> = {
  common: {
    dot: "bg-zinc-400",
    pill: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    ring: "",
  },
  rare: {
    dot: "bg-sky-500",
    pill: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    ring: "",
  },
  epic: {
    dot: "bg-violet-500",
    pill: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    ring: "shadow-[0_0_0_1px_rgba(139,92,246,0.25)]",
  },
  legendary: {
    dot: "bg-amber-500",
    pill: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    ring: "shadow-[0_0_0_1px_rgba(245,158,11,0.35),0_0_14px_-4px_rgba(245,158,11,0.5)]",
  },
};

/** The shelves of each tab, in the order they are shown. "" is the plain colors. */
const SHELF_ORDER: Record<CosmeticProductType, string[]> = {
  name_color: ["", "gradient", "effect"],
  profile_color: ["", "pattern"],
};

export type Shelf = { collection: string; products: CosmeticProduct[] };

/**
 * One tab's products, grouped by shelf and cheapest first. A shelf the store
 * has never heard of (a collection added straight in the database) still
 * shows, at the end, rather than hiding what somebody put on sale.
 */
export function shelvesOf(products: CosmeticProduct[], type: CosmeticProductType): Shelf[] {
  const groups = new Map<string, CosmeticProduct[]>();
  for (const product of products) {
    if (product.type !== type) continue;
    const key = product.collection ?? "";
    groups.set(key, [...(groups.get(key) ?? []), product]);
  }
  const known = SHELF_ORDER[type];
  const keys = [...known.filter((k) => groups.has(k)), ...[...groups.keys()].filter((k) => !known.includes(k))];
  return keys.map((collection) => ({
    collection,
    products: [...groups.get(collection)!].sort((a, b) => a.price - b.price || a.label.localeCompare(b.label)),
  }));
}

/** The id each shelf's blue "NOVO" is tracked by (the plain colors have none). */
export function shelfBadgeId(collection: string): string | null {
  return collection ? `points-shop-${collection}` : null;
}

"use client";

import { trackFeatureEvent, useFeature } from "./features";
import { formatLocale } from "./i18n";

// Affiliate products in the partner slot: things sold elsewhere, shown in
// rotation with the paid ads and linked through an affiliate link (the API's
// affiliateProductStore.ts has the model, the admin panel's "Anúncios" tab the
// list and the ads-vs-products slider).
//
// Behind an experiment (user target): only someone on it asks the API for
// products at all, so control keeps seeing exactly the ads it saw before. The
// slot's own events are comparable across the two sides: partner_impression /
// partner_click stay real ads only, and product_* below are the products', so
// "clicks in the slot" on the treatment side is the sum of the two.

export const AFFILIATE_PRODUCTS_FEATURE = "affiliate-products";

export const AFFILIATE_PRODUCT_EVENTS = {
  /** A product served and on screen in a visible tab (once per serve). */
  impression: "product_impression",
  /** The affiliate link opened, from any spot. */
  click: "product_click",
  /** The product's watch-to-earn video opened. */
  videoOpen: "product_video_open",
  /** ...and watched to the end. */
  videoComplete: "product_video_complete",
  /** Its points collected. value: the points. */
  reward: "product_reward_claim",
} as const;

/** `track` only where a slot is on screen (usePartnerAd). */
export function useAffiliateProductsFeature(options: { track?: boolean } = {}) {
  return useFeature(AFFILIATE_PRODUCTS_FEATURE, { track: options.track ?? false });
}

export function trackProductImpression() {
  trackFeatureEvent(AFFILIATE_PRODUCT_EVENTS.impression);
}

export function trackProductClick() {
  trackFeatureEvent(AFFILIATE_PRODUCT_EVENTS.click);
}

export function trackProductVideoOpen() {
  trackFeatureEvent(AFFILIATE_PRODUCT_EVENTS.videoOpen);
}

export function trackProductVideoComplete() {
  trackFeatureEvent(AFFILIATE_PRODUCT_EVENTS.videoComplete);
}

export function trackProductReward(points: number) {
  trackFeatureEvent(AFFILIATE_PRODUCT_EVENTS.reward, { value: Math.max(1, Math.round(points)) });
}

export function formatProductPrice(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(formatLocale(), { style: "currency", currency: currency || "BRL" }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

/** A known store's brand colours for its chip; null draws it in neutral. The name is free text in the admin. */
export function productStoreColors(store: string): { backgroundColor: string; color: string } | null {
  if (/mercado\s*(livre|libre)/i.test(store)) return { backgroundColor: "#FFE600", color: "#2D3277" };
  if (/amazon/i.test(store)) return { backgroundColor: "#FF9900", color: "#131A22" };
  if (/shopee/i.test(store)) return { backgroundColor: "#EE4D2D", color: "#FFFFFF" };
  return null;
}

/** Whole percent off, or null when the two prices do not make a discount. */
export function productDiscountPercent(price: number | null, originalPrice: number | null): number | null {
  if (price === null || originalPrice === null || originalPrice <= price || originalPrice <= 0) return null;
  const percent = Math.round((1 - price / originalPrice) * 100);
  return percent > 0 ? percent : null;
}

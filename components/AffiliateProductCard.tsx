"use client";

import type { ReactNode } from "react";
import { useT } from "@/lib/useI18n";
import { formatProductPrice, productDiscountPercent } from "@/lib/affiliateProducts";
import type { PartnerProductInfo } from "@/lib/partner";

/**
 * A product in the partner slot — not an advertiser's creative but a shop
 * shelf: the photo, the price and the way to it. Drawn in the site's own
 * colours rather than an ad's, with the photo always on white, because that
 * is what product photos are shot on.
 *
 * Also the admin form's preview (see AffiliateProductsPanel), so the two
 * cannot drift apart: `href` absent draws the button without a link.
 */
export function AffiliateProductCard({
  title,
  description,
  imageUrl,
  buttonLabel,
  href,
  product,
  layout = "sidebar",
  onClick,
  headerExtra,
  footer,
}: {
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  buttonLabel?: string | null;
  href?: string;
  product: PartnerProductInfo;
  layout?: "sidebar" | "stage";
  onClick?: () => void;
  /** Beside the chip: the slot's own "fold this away" button, when it has one. */
  headerExtra?: ReactNode;
  /** Under the button: the watch-to-earn button, when the product has a video. */
  footer?: ReactNode;
}) {
  const t = useT();
  const isStage = layout === "stage";
  const percent = productDiscountPercent(product.price, product.originalPrice);
  const badge = product.badge || (percent ? t("affiliateProduct.percentOff", { percent }) : "");
  const buttonClass =
    "mt-3 flex w-full items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-center text-sm font-semibold text-white transition hover:bg-emerald-500";
  const label = <span className="truncate">{buttonLabel || t("affiliateProduct.seeOffer")}</span>;

  return (
    <div
      className={`w-full overflow-hidden rounded-xl border border-zinc-200 bg-white p-3 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 ${
        // Below lg the sidebar's slot is a band capped at a third of the screen:
        // the photo goes beside the text, or the button ends up below the fold.
        !imageUrl ? "" : isStage ? "sm:flex sm:items-center sm:gap-5 sm:p-4" : "flex items-start gap-3 lg:block"
      }`}
    >
      {imageUrl && (
        <div
          className={`relative flex items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-black/5 dark:ring-white/10 ${
            isStage ? "mb-2 h-40 w-full sm:mb-0 sm:h-48 sm:w-48 sm:shrink-0" : "h-24 w-24 shrink-0 lg:mb-2 lg:h-32 lg:w-full"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="h-full w-full object-contain p-1" />
          {badge && (
            <span className="absolute left-1.5 top-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
              {badge}
            </span>
          )}
        </div>
      )}

      <div className={isStage && imageUrl ? "min-w-0 sm:flex-1" : "min-w-0 flex-1"}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            {product.store}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70 dark:bg-white/10">
              {t("affiliateProduct.affiliateLink")}
            </span>
            {headerExtra}
          </span>
        </div>

        <p className={`line-clamp-2 font-semibold ${isStage ? "text-sm sm:text-base" : "text-sm"}`}>{title}</p>

        {product.price !== null && (
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
            {product.originalPrice !== null && (
              <span className="text-xs text-zinc-500 line-through dark:text-zinc-400">
                {formatProductPrice(product.originalPrice, product.currency)}
              </span>
            )}
            <span className="text-lg font-bold tabular-nums">
              {formatProductPrice(product.price, product.currency)}
            </span>
          </div>
        )}
        {!imageUrl && badge && (
          <p className="mt-0.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">{badge}</p>
        )}
        {product.note && <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{product.note}</p>}
        {product.shipping && (
          <p className="mt-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">{product.shipping}</p>
        )}
        {description && <p className="mt-1 line-clamp-2 text-xs opacity-80">{description}</p>}

        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer sponsored" onClick={onClick} className={buttonClass}>
            {label}
          </a>
        ) : (
          <div className={buttonClass}>{label}</div>
        )}
        {footer}
      </div>
    </div>
  );
}

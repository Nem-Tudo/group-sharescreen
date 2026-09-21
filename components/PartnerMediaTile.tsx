"use client";

import { useCallback, useState, type MouseEvent } from "react";
import { BsCoin, BsPlayFill, BsCheckCircleFill } from "react-icons/bs";
import useNtPopups from "ntpopups";
import { Tooltip } from "@/components/Tooltip";
import {
  claimPartnerClickReward,
  clickRewardAppliesTo,
  hasClaimedPartnerReward,
  markPartnerRewardClaimed,
  usePartnerRewardStatus,
  type PartnerCardData,
} from "@/lib/partner";
import { partnerRewardPopupSize } from "@/components/PartnerRewardModal";
import { signalingClient } from "@/lib/signalingClient";
import { trackEvent } from "@/lib/analytics";
import { useT } from "@/lib/useI18n";
import {
  trackPartnerClick,
  trackPartnerClickReward,
  trackPartnerVideoOpen,
  usePartnerExperiment,
} from "@/lib/partnerExperiment";
import { PartnerClickRewardPill } from "@/components/PartnerClickReward";

export function PartnerMediaTile({
  partner,
  fill = false,
  compact = false,
}: {
  partner: PartnerCardData;
  fill?: boolean;
  compact?: boolean;
}) {
  const t = useT();
  const { openPopup } = useNtPopups();
  const [, bumpRewardState] = useState(0);

  const hasRewardVideo = Boolean(
    partner.id && partner.rewardVideoUrl && partner.rewardPoints
  );

  // The server's answer for whoever is here (see lib/partner's
  // usePartnerRewardStatus), this browser's flag until it comes.
  usePartnerRewardStatus(partner.id);
  const rewardClaimedLocally = Boolean(
    partner.id && hasClaimedPartnerReward(partner.id, "video")
  );

  const handleClick = useCallback(
    (e: MouseEvent) => {
      // Don't open sponsor link if clicked on an action button (e.g. play video)
      if ((e.target as HTMLElement).closest("button[data-tile-action]")) {
        return;
      }

      if (partner.buttonUrl) {
        window.open(partner.buttonUrl, "_blank", "noopener,noreferrer");

        if (partner.id) {
          signalingClient.reportPartnerClick(partner.id, "card");
          trackPartnerClick("tile");
          // Not asked again once collected — the server would only refuse it.
          if (clickRewardAppliesTo(partner, "card") && !hasClaimedPartnerReward(partner.id, "click")) {
            const id = partner.id;
            void claimPartnerClickReward(id)
              .then(() => {
                markPartnerRewardClaimed(id, "click");
                trackPartnerClickReward(partner.clickRewardPoints);
                bumpRewardState((n) => n + 1);
              })
              .catch(() => {
                // ignore duplicate or non-authenticated claims
              });
          }
        }

        trackEvent("partner_card_clicked", {
          source: "media_tile",
          fallback: !partner.id,
          partnerId: partner.id,
        });
      }
    },
    [partner]
  );

  const handlePlayVideo = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (!partner.id || !partner.rewardVideoUrl || !partner.rewardPoints) return;

      trackEvent("partner_reward_video_opened", {
        partnerId: partner.id,
        source: "media_tile",
      });
      trackPartnerVideoOpen();

      openPopup("partner_reward", {
        ...partnerRewardPopupSize(partner.hasExtendedDescription),
        closeOnEscape: false,
        closeOnClickOutside: false,
        requireAction: true,
        onClose: () => queueMicrotask(() => bumpRewardState((n) => n + 1)),
        data: {
          partnerId: partner.id,
          videoUrl: partner.rewardVideoUrl,
          points: partner.rewardPoints,
          title: partner.title,
          description: partner.description ?? "",
          hasExtendedDescription: partner.hasExtendedDescription,
          imageUrl: partner.imageUrl,
          buttonLabel: partner.buttonLabel,
          buttonUrl: partner.buttonUrl,
          buttonBackgroundColor: partner.buttonBackgroundColor,
          buttonTextColor: partner.buttonTextColor,
          clickRewardPoints: clickRewardAppliesTo(partner, "video")
            ? partner.clickRewardPoints
            : null,
          onClaimed: () => queueMicrotask(() => bumpRewardState((n) => n + 1)),
        },
      });
    },
    [partner, openPopup]
  );

  const cardClickRewardActive = Boolean(
    partner.clickRewardPoints && clickRewardAppliesTo(partner, "card")
  );
  // The partner-ctr treatment's "earn" look (see PartnerClickReward) — only
  // while the points are still there to collect.
  const inExperiment = usePartnerExperiment();
  const earnLook = Boolean(
    inExperiment &&
      cardClickRewardActive &&
      partner.id &&
      !hasClaimedPartnerReward(partner.id, "click")
  );

  const bgColor = partner.backgroundColor ?? "#111827";
  const textColor = partner.textColor ?? "#f4f4f5";
  const btnBg = partner.buttonBackgroundColor ?? "#10b981";
  const btnText = partner.buttonTextColor ?? "#ffffff";

  // The banner fills the tile when there is one; an ad with only a square mark
  // shows that mark above its copy instead, at a size it was drawn to be read
  // at, rather than a tile with nothing in it. See lib/partner's
  // partnerWideImage for the rule.
  const hasImage = Boolean(partner.imageUrl);
  const iconOnly = !hasImage && Boolean(partner.iconUrl);

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick(e as unknown as MouseEvent);
        }
      }}
      aria-label={t("partnerMediaTile.sponsoredAdTitle", { title: partner.title })}
      className={`group relative flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-zinc-200 shadow-xs transition select-none hover:ring-2 hover:ring-emerald-500/50 dark:border-zinc-800 ${
        compact
          ? "h-full aspect-video"
          : fill
            ? "h-full max-h-[70vh] max-w-2xl mx-auto aspect-video"
            : "aspect-video"
      }`}
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      {/* Media content: if image is present, it fills the media tile without stretching or cropping (object-contain), background color fills borders */}
      {hasImage ? (
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={partner.imageUrl!}
            alt={partner.title}
            className="pointer-events-none h-full w-full select-none object-contain transition duration-200 group-hover:scale-[1.01]"
          />
        </div>
      ) : (
        /* Text/Button layout when ad has no banner image */
        <div className="flex h-full w-full min-h-0 flex-col items-center justify-center p-3 text-center sm:p-5">
          {/* A compact tile draws no copy at all, so with no banner it used to
              be an empty coloured rectangle. The mark alone is still the ad. */}
          {compact && iconOnly && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={partner.iconUrl!}
              alt=""
              className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-black/20"
            />
          )}
          {!compact && (
            <>
              {iconOnly && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={partner.iconUrl!}
                  alt=""
                  className="mb-2 h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-black/20 sm:h-16 sm:w-16"
                />
              )}
              <p className="max-w-lg line-clamp-2 text-sm font-bold sm:text-base">
                {partner.title}
              </p>
              {partner.description && (
                <p className="mt-1 max-w-md line-clamp-2 whitespace-pre-line text-xs opacity-85 sm:text-xs">
                  {partner.description}
                </p>
              )}
              <div
                className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold shadow-sm transition hover:opacity-90 sm:text-sm"
                style={{ backgroundColor: btnBg, color: btnText }}
              >
                {cardClickRewardActive && !earnLook && (
                  <>
                    <BsCoin className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                    <span className="shrink-0 tabular-nums">
                      {partner.clickRewardPoints}
                    </span>
                  </>
                )}
                <span className="truncate">{partner.buttonLabel}</span>
                {earnLook && <PartnerClickRewardPill points={partner.clickRewardPoints!} />}
              </div>
            </>
          )}
        </div>
      )}

      {/* The advertiser's square mark, over the banner's own corner. The
          banner is contained rather than cropped here, so there is background
          to sit on at almost every tile shape, and on a banner that is all
          artwork this is the only thing that says whose it is. Only over a
          banner: with no banner the mark is the tile's own picture above,
          and a second copy in the corner would be the same logo twice. */}
      {partner.iconUrl && hasImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={partner.iconUrl}
          alt=""
          className={`pointer-events-none absolute left-2 top-2 z-10 select-none rounded-lg object-cover ring-1 ring-black/20 ${
            compact ? "h-6 w-6" : "h-8 w-8 sm:h-10 sm:w-10"
          }`}
        />
      )}

      {/* Unified Play + Coins button overlay (bottom-right in compact mode, center in normal mode) */}
      {hasRewardVideo && (
        <div
          className={`pointer-events-none absolute z-20 flex items-center ${
            compact
              ? "bottom-1.5 right-1.5 justify-end"
              : "inset-0 justify-center"
          }`}
        >
          <Tooltip
            content={
              rewardClaimedLocally
                ? t("partnerMediaTile.watchTheVideoAgain")
                : t("partnerMediaTile.watchTheVideoToEarnRewardpoints", { rewardPoints: partner.rewardPoints })
            }
          >
            <button
              type="button"
              data-tile-action="true"
              onClick={handlePlayVideo}
              aria-label={
                rewardClaimedLocally
                  ? t("partnerMediaTile.watchTheVideoAgain")
                  : t("partnerMediaTile.watchTheVideoAndEarnRewardpoints", { rewardPoints: partner.rewardPoints })
              }
              className={`pointer-events-auto group/play flex items-center rounded-full border border-white/20 bg-black/35 shadow-lg backdrop-blur-[2px] transition duration-200 hover:scale-105 hover:bg-black/65 hover:border-white/40 active:scale-95 ${
                compact
                  ? "gap-1 px-2 py-0.5 text-[10px]"
                  : "gap-2.5 px-3.5 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm"
              } ${
                rewardClaimedLocally
                  ? ""
                  : "ring-1 ring-emerald-400/40 hover:ring-emerald-400/70"
              }`}
            >
              {/* Play icon */}
              <div
                className={`flex shrink-0 items-center justify-center rounded-full bg-emerald-500/85 text-white shadow-xs transition duration-200 group-hover/play:bg-emerald-400 group-hover/play:scale-105 ${
                  compact ? "h-4 w-4" : "h-6 w-6 sm:h-7 sm:w-7"
                }`}
              >
                <BsPlayFill
                  className={`translate-x-0.5 ${
                    compact ? "h-3 w-3" : "h-4 w-4 sm:h-5 sm:w-5"
                  }`}
                />
              </div>

              {/* Reward points / Claimed badge */}
              {!rewardClaimedLocally ? (
                <span className="flex items-center gap-0.5 font-bold text-emerald-300 drop-shadow-xs">
                  <BsCoin
                    className={
                      compact
                        ? "h-2.5 w-2.5 text-emerald-400"
                        : "h-3.5 w-3.5 text-emerald-400 sm:h-4 sm:w-4"
                    }
                  />
                  <span>+{partner.rewardPoints}</span>
                </span>
              ) : (
                <span className="flex items-center gap-0.5 text-[10px] font-medium text-emerald-300 sm:text-xs">
                  <BsCheckCircleFill className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5" />
                  <span>{t("partnerMediaTile.redeemed")}</span>
                </span>
              )}
            </button>
          </Tooltip>
        </div>
      )}

      {/* Bottom bar overlay: Title on left, "Patrocinado" badge on right */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-t from-black/85 via-black/50 to-transparent ${
          compact ? "px-2 py-1" : "px-3 py-2"
        }`}
      >
        <span
          className={`truncate font-medium text-white drop-shadow-sm ${
            compact ? "text-[11px] max-w-[55%]" : "text-xs sm:text-sm"
          }`}
        >
          {partner.title}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {/* With a banner the tile has no button of its own to carry the
              points, so they ride here — the whole tile is the click. */}
          {earnLook && hasImage && (
            <PartnerClickRewardPill points={partner.clickRewardPoints!} size={compact ? "sm" : "md"} />
          )}
          {!compact && (
            <span className="shrink-0 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[11px] font-semibold text-white shadow-xs drop-shadow-sm sm:text-xs">
              {t("common.sponsored")}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

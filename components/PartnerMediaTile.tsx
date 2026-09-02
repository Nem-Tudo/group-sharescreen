"use client";

import { useCallback, useState, type MouseEvent } from "react";
import { BsCoin, BsPlayFill, BsCheckCircleFill } from "react-icons/bs";
import useNtPopups from "ntpopups";
import { Tooltip } from "@/components/Tooltip";
import {
  claimPartnerClickReward,
  clickRewardAppliesTo,
  hasClaimedPartnerRewardLocally,
  type PartnerCardData,
} from "@/lib/partner";
import { signalingClient } from "@/lib/signalingClient";
import { trackEvent } from "@/lib/analytics";

export function PartnerMediaTile({
  partner,
  fill = false,
  compact = false,
}: {
  partner: PartnerCardData;
  fill?: boolean;
  compact?: boolean;
}) {
  const { openPopup } = useNtPopups();
  const [, bumpRewardState] = useState(0);

  const hasRewardVideo = Boolean(
    partner.id && partner.rewardVideoUrl && partner.rewardPoints
  );

  const rewardClaimedLocally = Boolean(
    partner.id && hasClaimedPartnerRewardLocally(partner.id)
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
          if (clickRewardAppliesTo(partner, "card")) {
            void claimPartnerClickReward(partner.id).catch(() => {
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

      openPopup("partner_reward", {
        width: "min(1100px, calc(100vw - 30px))",
        maxWidth: "1100px",
        maxHeight: "94dvh",
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

  const bgColor = partner.backgroundColor ?? "#111827";
  const textColor = partner.textColor ?? "#f4f4f5";
  const btnBg = partner.buttonBackgroundColor ?? "#10b981";
  const btnText = partner.buttonTextColor ?? "#ffffff";

  const hasImage = Boolean(partner.imageUrl);

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
      aria-label={`Anúncio patrocinado: ${partner.title}`}
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
          {!compact && (
            <>
              <p className="max-w-lg line-clamp-2 text-sm font-bold sm:text-base">
                {partner.title}
              </p>
              {partner.description && (
                <p className="mt-1 max-w-md line-clamp-2 text-xs opacity-85 sm:text-xs">
                  {partner.description}
                </p>
              )}
              <div
                className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold shadow-sm transition hover:opacity-90 sm:text-sm"
                style={{ backgroundColor: btnBg, color: btnText }}
              >
                {cardClickRewardActive && (
                  <>
                    <BsCoin className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                    <span className="shrink-0 tabular-nums">
                      {partner.clickRewardPoints}
                    </span>
                  </>
                )}
                <span className="truncate">{partner.buttonLabel}</span>
              </div>
            </>
          )}
        </div>
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
                ? "Assistir vídeo de novo"
                : `Assistir vídeo para ganhar ${partner.rewardPoints} pontos`
            }
          >
            <button
              type="button"
              data-tile-action="true"
              onClick={handlePlayVideo}
              aria-label={
                rewardClaimedLocally
                  ? "Assistir vídeo de novo"
                  : `Assistir vídeo e ganhar ${partner.rewardPoints} pontos`
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
                  <span>Resgatado</span>
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
        {!compact && (
          <span className="shrink-0 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[11px] font-semibold text-white shadow-xs drop-shadow-sm sm:text-xs">
            Patrocinado
          </span>
        )}
      </div>
    </div>
  );
}

"use client";

import type { ComponentType } from "react";
import useNtPopups from "ntpopups";
import { MdCardGiftcard } from "react-icons/md";
import { GoldVerifiedBadgeIcon, VerifiedBadgeIcon } from "@/components/icons";
import { Tooltip } from "@/components/Tooltip";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/AuthContext";
import { openProModal } from "@/lib/proModal";
import { useT } from "@/lib/useI18n";

export interface RoomProOffer {
  label: string;
  tooltip: string;
  ariaLabel: string;
  Icon: ComponentType<{ className?: string }>;
  iconClassName: string;
  className: string;
  onPress: () => void;
}

/**
 * The room's premium button, which is three different offers wearing one slot
 * — the room's header, and the group bar's (see GroupHeaderMenu).
 *
 * The same climb the site header makes (see components/ProOffer), for the same
 * reason: a button that keeps selling "Pro" to somebody who already pays for it
 * is advertising the one thing they cannot buy.
 *
 *   no plan  → "Pro", the blue badge.
 *   Pro      → "Pro Max", in that plan's own gold mark.
 *   Pro Max  → "Presentear". Nothing left to sell them; the one thing they can
 *              still buy is a plan for somebody else.
 *
 * What differs from the site header's is the door: nothing here navigates.
 * These are drawn next to a call, and openProModal (see lib/proModal) and the
 * gift popup open over the page instead of leaving it.
 *
 * A plain function rather than a hook, so the room can call it wherever its
 * render has got to (see WatchRoom, which is past an early return by then).
 */
export function getRoomProOffer(
  flags: readonly string[],
  t: (key: string) => string,
  openGiftPopup: () => void
): RoomProOffer {
  if (flags.includes("PRO_MAX")) {
    return {
      label: t("common.sendAsAGift"),
      tooltip: t("watch.watchRoom.giftSomeoneGolivePro"),
      ariaLabel: t("common.giftPro"),
      Icon: MdCardGiftcard,
      // Carries its own colour, like the badges below: green is what the gift
      // control is everywhere else on the site.
      iconClassName: "text-emerald-500",
      className:
        "border-emerald-300 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40",
      onPress: openGiftPopup,
    };
  }
  if (flags.includes("PRO")) {
    return {
      label: t("common.proMax"),
      tooltip: t("watch.watchRoom.goliveProMaxThemesGiftsAnd"),
      ariaLabel: t("common.goliveProMax"),
      // The plan's own mark, which carries its colour in its gradients and
      // therefore takes no colour class of its own.
      Icon: GoldVerifiedBadgeIcon,
      iconClassName: "",
      className:
        "border-amber-300 text-amber-600 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/40",
      // Opened straight onto the card it is about: somebody who already has Pro
      // should not have to find the picker to see what is above it.
      onPress: () => openProModal("premium_max"),
    };
  }
  return {
    label: t("common.pro"),
    tooltip: t("watch.watchRoom.goliveProGetVerifiedBroadcastIn"),
    ariaLabel: t("common.golivePro"),
    // Blue rather than inheriting the label's colour: this is the same badge
    // that appears next to a verified name (see DisplayUserName), and it only
    // reads as that badge if it keeps its own.
    Icon: VerifiedBadgeIcon,
    iconClassName: "text-blue-500",
    className:
      "border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/40",
    onPress: () => openProModal(),
  };
}

/** The offer for whoever is signed in, for places that are not the room. */
export function useRoomProOffer(): RoomProOffer {
  const t = useT();
  const { account } = useAuth();
  const { openPopup } = useNtPopups();
  return getRoomProOffer(account?.flags ?? [], t, () => void openPopup("gift_plan", { data: {} }));
}

/** The offer as a header button, drawn the way the room's own is. */
export function RoomProOfferButton() {
  const offer = useRoomProOffer();
  return (
    <Tooltip content={offer.tooltip} placement="bottom">
      <button
        type="button"
        onClick={() => {
          trackEvent("pro_button_clicked", { offer: offer.label });
          offer.onPress();
        }}
        aria-label={offer.ariaLabel}
        className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-2 text-sm font-medium transition 2xl:px-3 ${offer.className}`}
      >
        <offer.Icon className={`h-5 w-5 shrink-0 ${offer.iconClassName}`} />
        <span data-header-label className="hidden 2xl:inline">
          {offer.label}
        </span>
      </button>
    </Tooltip>
  );
}

"use client";

import type { ComponentType } from "react";
import useNtPopups from "ntpopups";
import { MdCardGiftcard } from "react-icons/md";
import { GoldVerifiedBadgeIcon, RubyVerifiedBadgeIcon, VerifiedBadgeIcon } from "@/components/icons";
import { useAuth } from "@/lib/AuthContext";
import { usePlanOnSale } from "@/lib/usePlanOnSale";
import { useT } from "@/lib/useI18n";

/**
 * The premium entry, which is three different offers wearing one slot — the
 * site header's, and the Você screen's (app/me) on a phone.
 *
 * It sells whatever the reader has not got, and climbs with them:
 *
 *   no plan   → "Pro", the blue badge. What the site sells.
 *   Pro       → "Pro Max", in that plan's own gold mark (see planIcons), and
 *               pointing at /pro already opened on it.
 *   Pro Max   → "Pro Ultra", in its ruby mark, opened on its card — but only
 *               while Pro Ultra is on sale. Until then it is the gift, as it
 *               was: a link to a plan the page cannot show would land them on
 *               Pro, which they already have (see usePlanOnSale).
 *   Pro Ultra → "Presentear Pro". There is nothing left to sell them, and the
 *               one thing they can still buy is a plan for somebody else.
 *
 * Read from `flags` rather than from `features`: the question is which *plan*
 * somebody holds, not what they may do. Tested from the top down, because
 * each rung carries the flags of the ones below it (PRO_ULTRA comes with
 * PRO_MAX and PRO).
 */
export interface ProOffer {
  /** Stable across the three states, so React keeps the same element. */
  key: string;
  href?: string;
  onClick?: () => void;
  label: string;
  short: string;
  Icon: ComponentType<{ className?: string }>;
  iconClassName?: string;
}

export function useProOffer(): ProOffer {
  const t = useT();
  const { account } = useAuth();
  const { openPopup } = useNtPopups();
  const flags = account?.flags ?? [];
  const ultraOnSale = usePlanOnSale(
    "pro_ultra",
    flags.includes("PRO_MAX") && !flags.includes("PRO_ULTRA")
  );
  if (flags.includes("PRO_ULTRA") || (flags.includes("PRO_MAX") && !ultraOnSale)) {
    return {
      key: "pro",
      // By name rather than as markup: the header is translucent, and a dialog
      // rendered inside a `backdrop-filter` is a dialog whose backdrop covers
      // the bar instead of the page (see GiftPlanDialog).
      onClick: () => void openPopup("gift_plan", { data: {} }),
      label: t("common.giftPro"),
      // The only one whose two labels differ in *words*: "Presentear Pro"
      // beside an account menu is most of a phone's bar.
      short: t("common.sendAsAGift"),
      Icon: MdCardGiftcard,
      iconClassName: "text-emerald-500",
    };
  }
  if (flags.includes("PRO_MAX")) {
    return {
      key: "pro",
      href: "/pro?plan=pro_ultra",
      label: t("common.proUltra"),
      short: t("common.proUltra"),
      // Ruby, like gold, carries its colour in its own gradients.
      Icon: RubyVerifiedBadgeIcon,
    };
  }
  if (flags.includes("PRO")) {
    return {
      key: "pro",
      href: "/pro?plan=premium_max",
      label: t("common.proMax"),
      short: t("common.proMax"),
      // The plan's own mark carries its colour in its gradients.
      Icon: GoldVerifiedBadgeIcon,
    };
  }
  return {
    key: "pro",
    href: "/pro",
    label: t("common.pro"),
    short: t("common.pro"),
    // The same blue badge that marks a verified name (see DisplayUserName).
    Icon: VerifiedBadgeIcon,
    iconClassName: "text-blue-500",
  };
}

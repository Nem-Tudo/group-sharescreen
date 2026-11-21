"use client";

import { MdChatBubbleOutline, MdExpandMore, MdVolumeUp } from "react-icons/md";
import { useTileExperimentTip } from "@/lib/clipsMode";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { canManage } from "@/lib/groupPermissions";
import type { GroupDetail } from "@/lib/groupsApi";
import { useT } from "@/lib/useI18n";

// The blue "novo" tip about group banners (experiment group-banner-tip), for
// whoever may set one, on a group that has none yet. It hangs from the
// group's name — the menu its settings open from — and its button goes
// straight to the overview, where the banner is set.
//
// At its top a little motion: the group's own rooms column, and a banner
// dropping in over it with the name turning white on it — what the feature
// does, shown rather than described. A loop of CSS keyframes (see globals.css,
// .gb-tip-*), still on its last frame for somebody who asked for less motion.

export const GROUP_BANNER_TIP_FEATURE = "group-banner-tip";
export const GROUP_BANNER_TIP_EVENTS = {
  /** A banner saved, from the settings — both sides of the experiment. */
  set: "group_banner_set",
} as const;

/** Whether this person is shown the tip for this group, and the controls for it. */
export function useGroupBannerTip(detail: GroupDetail) {
  // Somebody who could act on it, on a group with nothing there yet: the
  // experiment's comparison is between people like that.
  const eligible = canManage(detail, "manageGroup") && !detail.group.bannerUrl;
  const { enabled } = useFeature(GROUP_BANNER_TIP_FEATURE, { track: eligible });
  return useTileExperimentTip("groupBanner", eligible && enabled);
}

export function trackGroupBannerSet(): void {
  trackFeatureEvent(GROUP_BANNER_TIP_EVENTS.set, { feature: GROUP_BANNER_TIP_FEATURE });
}

export function GroupBannerTip({
  groupName,
  onOpen,
  onDismiss,
  className = "",
}: {
  groupName: string;
  /** "Adicionar banner": the caller counts the click (tip.clicked) and opens the settings. */
  onOpen: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      role="status"
      className={`absolute z-50 w-64 rounded-xl bg-blue-600 p-2.5 text-left text-xs font-medium text-white shadow-xl ${className}`}
    >
      <span className="absolute -top-1 left-5 h-2 w-2 rotate-45 bg-blue-600" />
      <BannerMotion groupName={groupName} />
      <div className="mt-2.5 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug">{t("groups.banner.tipTitle")}</p>
          <p className="mt-0.5 leading-snug text-white/90">{t("groups.banner.tipText")}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("watch.watchRoom.clipsModeTipDismiss")}
          className="-m-1 cursor-pointer rounded p-1 leading-none text-white/80 hover:text-white"
        >
          ✕
        </button>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-2 w-full cursor-pointer rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
      >
        {t("groups.banner.tipCta")}
      </button>
    </div>
  );
}

/** A rooms column in miniature, its banner dropping in and out on a loop. */
function BannerMotion({ groupName }: { groupName: string }) {
  return (
    <div aria-hidden className="gb-tip relative overflow-hidden rounded-lg bg-white text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
      {/* The banner: never shorter than the header it sits under (as on the
          real column), and a picture's worth of colour and shapes coming in
          on it, panning slowly. */}
      <div className="gb-tip-banner relative overflow-hidden">
        <span className="gb-tip-picture absolute inset-0">
          <span className="absolute left-[18%] top-[34%] h-5 w-5 rounded-full bg-white/75 blur-[1px]" />
          <span className="absolute bottom-0 left-[42%] h-6 w-16 rounded-t-full bg-indigo-950/45" />
          <span className="absolute bottom-0 left-[60%] h-9 w-24 rounded-t-full bg-indigo-950/60" />
          <span className="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-black/50 to-transparent" />
        </span>
      </div>
      {/* The header, on the banner once it is there. */}
      <div className="gb-tip-name absolute inset-x-0 top-0 flex items-center gap-0.5 px-2 py-1.5 text-[11px] font-semibold">
        <span className="truncate">{groupName}</span>
        <MdExpandMore className="h-3 w-3 shrink-0" />
      </div>
      {/* The rooms, pushed down by it. */}
      <div className="flex flex-col gap-1 px-2 pb-2 pt-1">
        {[MdVolumeUp, MdChatBubbleOutline, MdChatBubbleOutline].map((Icon, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <Icon className="h-3 w-3 shrink-0 text-zinc-400" />
            <span className={`h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 ${i === 0 ? "w-14" : i === 1 ? "w-20" : "w-10"}`} />
          </span>
        ))}
      </div>
    </div>
  );
}

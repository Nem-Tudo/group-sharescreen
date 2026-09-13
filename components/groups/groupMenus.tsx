"use client";

import { useCallback, type MouseEvent } from "react";
import useNtPopups from "ntpopups";
import { MdContentCopy, MdDoneAll, MdGroups, MdLink, MdLogout, MdOpenInNew } from "react-icons/md";
import { copyText } from "@/lib/clipboard";
import { openContextMenu } from "@/lib/contextMenu";
import { groupPath } from "@/lib/groupLinks";
import { getGroupVoiceSession, setGroupVoiceSession } from "@/lib/groupVoiceSession";
import { leaveGroup, type GroupSummary } from "@/lib/groupsApi";
import { forgetGroup, markGroupRead } from "@/lib/useGroups";
import { useT } from "@/lib/useI18n";

// The right button on a group, wherever a group is listed outside the rail —
// the groups page, the home page's panel, the switcher on a phone. (The rail
// has its own, with moving the group up and down, see GroupRail's GroupMenu.)

/**
 * Returns the handler: `open` is how this list goes to the group (a shallow
 * push inside the groups pages, the router outside them), and `afterLeave`
 * what to do once somebody has left one (leave its pages, if they were on them).
 */
export function useGroupContextMenu(open: (path: string) => void, afterLeave?: (group: GroupSummary) => void) {
  const t = useT();
  const { openPopup } = useNtPopups();

  const confirmLeave = useCallback(
    (group: GroupSummary) => {
      void openPopup("confirm", {
        data: {
          title: t("groups.groupSidebar.leaveName", { name: group.name }),
          message: t("groups.groupSidebar.toComeBackYouWillNeed"),
          cancelLabel: t("common.cancel"),
          confirmLabel: t("common.leaveTheGroup"),
          confirmStyle: t("common.danger"),
          onChoose: async (confirmed: boolean) => {
            if (!confirmed) return;
            const result = await leaveGroup(group.id);
            if (!result.ok) {
              void openPopup("generic", { data: { title: t("common.didnTWork"), message: result.error } });
              return;
            }
            if (getGroupVoiceSession()?.groupId === group.id) setGroupVoiceSession(null);
            forgetGroup(group.id);
            afterLeave?.(group);
          },
        },
      });
    },
    [openPopup, t, afterLeave]
  );

  return useCallback(
    (event: MouseEvent, group: GroupSummary) => {
      const path = groupPath(group.id);
      const hasNews = !group.suspended && (group.unread || group.mentions > 0);
      openContextMenu(event, {
        title: group.name,
        entries: [
          { label: t("groups.contextMenu.openGroup"), icon: <MdGroups className="h-4 w-4" />, onSelect: () => open(path) },
          {
            label: t("groups.contextMenu.openInNewTab"),
            icon: <MdOpenInNew className="h-4 w-4" />,
            onSelect: () => void window.open(path, "_blank", "noopener"),
          },
          {
            label: t("groups.groupRail.markAsRead"),
            icon: <MdDoneAll className="h-4 w-4" />,
            disabled: !hasNews,
            onSelect: () => void markGroupRead(group.id),
          },
          { type: "divider" },
          {
            label: t("groups.groupRail.copyLink"),
            icon: <MdLink className="h-4 w-4" />,
            onSelect: () => void copyText(`${window.location.origin}${path}`),
          },
          { label: t("groups.memberMenu.copyId"), icon: <MdContentCopy className="h-4 w-4" />, onSelect: () => void copyText(group.id) },
          group.role !== "owner" && { type: "divider" },
          group.role !== "owner" && {
            label: t("common.leaveTheGroup"),
            icon: <MdLogout className="h-4 w-4" />,
            danger: true,
            onSelect: () => confirmLeave(group),
          },
        ],
      });
    },
    [t, open, confirmLeave]
  );
}

"use client";

import { useState } from "react";
import useNtPopups from "ntpopups";
import { MdAdd, MdCheck, MdGroups, MdLink, MdUnfoldMore } from "react-icons/md";
import { Popover } from "@/components/Tooltip";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupLink } from "@/components/groups/GroupLink";
import { GroupName } from "@/components/groups/GroupName";
import { useAuth } from "@/lib/AuthContext";
import { groupPath } from "@/lib/groupLinks";
import { prefetchGroup, useMyGroups } from "@/lib/useGroups";
import { useT } from "@/lib/useI18n";

// Which group is open, and the way to every other one — a switcher in the top
// bar, the same place the room shows its own name. From lg up the groups are
// also down the left edge (see GroupRail), so the switcher's own "news
// elsewhere" dot is left to the narrower screens that have no rail.

const itemClass =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-900";

export function GroupSwitcher({
  activeGroupId,
  fallbackName,
  fallbackIconUrl,
  fallbackFlags,
}: {
  activeGroupId: string | null;
  /** The open group's name from its detail, for the moment before the list has loaded. */
  fallbackName?: string | null;
  fallbackIconUrl?: string | null;
  fallbackFlags?: string[] | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { groups } = useMyGroups();
  const { account } = useAuth();
  const { openPopup } = useNtPopups();

  const active = groups?.find((g) => g.id === activeGroupId) ?? null;
  const name = active?.name ?? fallbackName ?? null;
  const iconUrl = active?.iconUrl ?? fallbackIconUrl ?? null;
  const flags = active?.flags ?? fallbackFlags ?? null;
  const elsewhereUnread = Boolean(
    groups?.some((g) => g.id !== activeGroupId && (g.unread || g.mentions > 0))
  );
  const close = () => setOpen(false);

  return (
    <Popover
      open={open}
      onClose={close}
      placement="bottom-start"
      content={
        <div className="flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <p className="px-2 pb-1 pt-0.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{t("common.yourGroups")}</p>
          {groups === null && <p className="px-2 py-1.5 text-sm text-zinc-500">{t("common.loading")}</p>}
          {groups?.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-zinc-500 dark:text-zinc-400">{t("common.youAreNotInAnyGroup")}</p>
          )}
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {groups?.map((group) => (
              <GroupLink
                key={group.id}
                href={groupPath(group.id)}
                onClick={close}
                onMouseEnter={() => prefetchGroup(group.id)}
                onFocus={() => prefetchGroup(group.id)}
                className={`${itemClass} ${group.suspended ? "opacity-60" : ""}`}
              >
                <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={26} className="rounded-md" />
                <GroupName
                  name={group.name}
                  flags={group.flags}
                  className={`flex-1 ${group.unread ? "font-semibold text-zinc-950 dark:text-zinc-50" : ""}`}
                />
                {group.suspended ? (
                  <span className="shrink-0 text-[11px] font-medium text-amber-600 dark:text-amber-400">suspenso</span>
                ) : group.id === activeGroupId ? (
                  <MdCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-label={t("groups.groupSwitcher.open")} />
                ) : group.mentions > 0 ? (
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
                    {group.mentions}
                  </span>
                ) : group.unread ? (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-950 dark:bg-zinc-50" aria-label={t("common.newMessages")} />
                ) : null}
              </GroupLink>
            ))}
          </div>
          <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
          <GroupLink href="/groups" onClick={close} className={itemClass}>
            <MdGroups className="h-4 w-4 shrink-0 opacity-70" />
            {t("groups.groupSwitcher.allGroups")}
          </GroupLink>
          <button
            type="button"
            disabled={!account}
            title={account ? undefined : t("common.createAnAccountToCreateGroups")}
            onClick={() => {
              close();
              void openPopup("create_group", { data: {} });
            }}
            className={itemClass}
          >
            <MdAdd className="h-4 w-4 shrink-0 text-emerald-600" />
            {t("common.newGroup")}
          </button>
          <button
            type="button"
            onClick={() => {
              close();
              void openPopup("join_group", { data: {} });
            }}
            className={itemClass}
          >
            <MdLink className="h-4 w-4 shrink-0 opacity-70" />
            {t("common.joinWithAnInvite")}
          </button>
        </div>
      }
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("groups.groupSwitcher.switchGroup")}
        className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        {name ? (
          <GroupIcon name={name} iconUrl={iconUrl} seed={activeGroupId ?? name} size={28} className="rounded-lg" />
        ) : (
          <MdGroups className="h-6 w-6 shrink-0 text-zinc-600 dark:text-zinc-400" />
        )}
        <GroupName
          name={name ?? t("common.groups")}
          flags={name ? flags : null}
          className="text-base font-semibold text-zinc-950 sm:text-lg dark:text-zinc-50"
          badgeClassName="h-5 w-5"
        />
        {elsewhereUnread && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-red-500 lg:hidden" aria-label={t("groups.groupSwitcher.newsInOtherGroups")} />
        )}
        <MdUnfoldMore className="h-4 w-4 shrink-0 text-zinc-500" />
      </button>
    </Popover>
  );
}

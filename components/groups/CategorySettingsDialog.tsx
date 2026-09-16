"use client";

import { useState, type FormEvent } from "react";
import useNtPopups from "ntpopups";
import { MdFolderOpen } from "react-icons/md";
import {
  DialogFrame,
  DialogTabs,
  WIDE_POPUP_SIZE,
  inputClass,
  primaryButton,
  type PopupProps,
} from "@/components/groups/dialogKit";
import { renameCategory, setCategoryPermissions, type GroupDetail } from "@/lib/groupsApi";
import { canManage } from "@/lib/groupPermissions";
import {
  PermissionOverridesPanel,
  categorySections,
  type OverridesTarget,
} from "@/components/groups/PermissionOverrides";
import { refreshGroup, useGroupDetail } from "@/lib/useGroups";
import { useT } from "@/lib/useI18n";

// A category's own settings — its name, and the permissions every room under
// it inherits.
//
// Built next to ChannelSettingsDialog and sharing its permission editor (see
// PermissionOverrides), because for somebody using it the two screens are the
// same screen. The difference worth knowing is what a save here does: a room's
// settings change that room, a category's change every room in it that is
// synced with it, all at once — those rooms read the category rather than
// keeping a copy, so there is no partial application to worry about and a room
// made a second later is already in step.
//
// It shows both kinds' switches, unlike a room's, because one heading can hold
// text rooms and voice rooms — a switch that does not apply to a given room is
// simply never consulted for it.

type CategoryTab = "general" | "permissions";

/** Opens a category's settings. */
export function useOpenCategorySettings() {
  const { openPopup } = useNtPopups();
  return (groupId: string, categoryId: string, tab?: CategoryTab) =>
    void openPopup("group_category", { ...WIDE_POPUP_SIZE, data: { groupId, categoryId, tab } });
}

export function CategorySettingsDialog({
  closePopup,
  data,
}: PopupProps<{ groupId: string; categoryId: string; tab?: CategoryTab }>) {
  const t = useT();
  const groupId = data?.groupId ?? "";
  const { detail } = useGroupDetail(groupId || null);
  const category = detail?.categories?.find((c) => c.id === data?.categoryId) ?? null;
  const isManager = detail ? canManage(detail, "manageChannels") : false;
  const [tab, setTab] = useState<CategoryTab>(data?.tab ?? "general");

  if (!detail || !category) {
    return (
      <DialogFrame title={t("common.category")} onClose={() => closePopup(false)} wide>
        <p className="text-sm text-zinc-500">
          {detail ? t("groups.categorySettings.gone") : t("common.loading")}
        </p>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame
      title={
        <span className="flex min-w-0 items-center gap-2">
          <MdFolderOpen className="h-5 w-5 shrink-0 opacity-60" />
          <span className="truncate">{category.name}</span>
        </span>
      }
      onClose={() => closePopup(false)}
      wide
      tabs={
        isManager && (
          <DialogTabs
            tabs={[
              { id: "general" as const, label: t("common.general") },
              { id: "permissions" as const, label: t("groups.channelSettingsDialog.permissions") },
            ]}
            current={tab}
            onChange={setTab}
          />
        )
      }
    >
      {!isManager ? (
        <p className="text-sm text-zinc-500">{t("groups.channelSettingsDialog.youDoNotHavePermissionTo")}</p>
      ) : tab === "general" ? (
        <CategoryGeneralTab detail={detail} categoryId={category.id} name={category.name} />
      ) : (
        <CategoryPermissionsTab detail={detail} categoryId={category.id} name={category.name} />
      )}
    </DialogFrame>
  );
}

function CategoryGeneralTab({
  detail,
  categoryId,
  name: saved,
}: {
  detail: GroupDetail;
  categoryId: string;
  name: string;
}) {
  const t = useT();
  const groupId = detail.group.id;
  const [name, setName] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === saved) return;
    setBusy(true);
    const result = await renameCategory(groupId, categoryId, name.trim());
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: t("common.saved2") } : { ok: false, text: result.error });
    if (result.ok) {
      setName(result.category.name);
      void refreshGroup(groupId);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {t("groups.categorySettings.nameLabel")}
      </span>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} className={inputClass} />
        <button
          type="submit"
          disabled={busy || !name.trim() || name.trim() === saved}
          className={`${primaryButton} shrink-0`}
        >
          {t("common.save")}
        </button>
      </div>
      {/* Deleting is deliberately not here: it lives in the list's own menu,
          beside the thing being deleted, where it already had its
          confirmation. */}
      {message && <p className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</p>}
    </form>
  );
}

function CategoryPermissionsTab({
  detail,
  categoryId,
  name,
}: {
  detail: GroupDetail;
  categoryId: string;
  name: string;
}) {
  const t = useT();
  const groupId = detail.group.id;
  const category = detail.categories?.find((c) => c.id === categoryId);
  const sections = categorySections(t);
  const synced = detail.channels.filter(
    (channel) => channel.categoryId === categoryId && channel.syncedWithCategory === true
  ).length;

  const target: OverridesTarget = {
    key: categoryId,
    overridesFor: (roleId) =>
      roleId ? category?.roleOverrides?.[roleId] ?? {} : category?.permissions ?? {},
    save: (overrides, roleId) => setCategoryPermissions(groupId, categoryId, overrides, roleId),
    sections,
    keys: sections.flatMap((section) => section.keys),
  };

  return (
    <PermissionOverridesPanel
      detail={detail}
      target={target}
      intro={
        <>
          {t("groups.categorySettings.intro", { name })}{" "}
          {/* The count is the useful part: it says how much a save here moves,
              which is the one thing about this screen that a room's does not
              have. */}
          <b>
            {synced === 1
              ? t("groups.categorySettings.oneSyncedRoom")
              : t("groups.categorySettings.syncedRooms", { count: synced })}
          </b>
        </>
      }
    />
  );
}

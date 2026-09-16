"use client";

import { useState, type FormEvent } from "react";
import useNtPopups from "ntpopups";
import { MdSync, MdTag, MdVolumeUp } from "react-icons/md";
import {
  DialogFrame,
  DialogTabs,
  WIDE_POPUP_SIZE,
  dangerButton,
  inputClass,
  primaryButton,
  secondaryButton,
  type PopupProps,
} from "@/components/groups/dialogKit";
import {
  deleteChannel,
  renameChannel,
  setChannelPermissions,
  setChannelSync,
  setChannelTopic,
  MAX_CHANNEL_TOPIC,
  type GroupChannel,
  type GroupDetail,
} from "@/lib/groupsApi";
import {
  PermissionOverridesPanel,
  type OverridesTarget,
} from "@/components/groups/PermissionOverrides";
import {
  GENERAL_PERMISSION_KEYS,
  TEXT_PERMISSION_KEYS,
  VOICE_PERMISSION_KEYS,
  canManage,
  permissionKeysFor,
} from "@/lib/groupPermissions";
import { groupPath } from "@/lib/groupLinks";
import { ChannelWebhooksTab } from "@/components/groups/ChannelWebhooksTab";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { refreshGroup, useGroupDetail } from "@/lib/useGroups";
import { useT } from "@/lib/useI18n";

// One room's own settings — the gear beside a room in the group's list opens
// this (see GroupSidebar), as does the "Salas" tab of the group's settings.
//
//   Geral       — its name, and deleting it.
//   Permissões  — what @everyone, or one role, may do in this room: each
//                 switch on, off, or neutral (for @everyone, the group's
//                 setting from the "Cargos" tab of the group's settings; for a
//                 role, whatever everything else says).
//
// The owner and administrators may always do everything; none of this applies
// to them. Whoever manages the rooms opens it.

//   Webhooks    — URLs that post into this room (see ChannelWebhooksTab).
//                 The one tab that takes "manage webhooks" rather than
//                 managing the rooms, so somebody with only that sees only it.

type ChannelTab = "general" | "permissions" | "webhooks";

/** Opens a room's settings. */
export function useOpenChannelSettings() {
  const { openPopup } = useNtPopups();
  return (groupId: string, channelId: string, tab?: ChannelTab) =>
    void openPopup("group_channel", { ...WIDE_POPUP_SIZE, data: { groupId, channelId, tab } });
}

export function ChannelSettingsDialog({
  closePopup,
  data,
}: PopupProps<{ groupId: string; channelId: string; tab?: ChannelTab }>) {
  const t = useT();
  const groupId = data?.groupId ?? "";
  const { detail } = useGroupDetail(groupId || null);
  const channel = detail?.channels.find((c) => c.id === data?.channelId) ?? null;
  const isManager = detail ? canManage(detail, "manageChannels") : false;
  const managesWebhooks = detail ? canManage(detail, "manageWebhooks") : false;
  const [picked, setTab] = useState<ChannelTab>(data?.tab ?? "general");
  // Somebody who may only manage webhooks has no other tab to be on.
  const tab: ChannelTab = !isManager && managesWebhooks ? "webhooks" : picked;

  if (!detail || !channel) {
    return (
      <DialogFrame title={t("common.room")} onClose={() => closePopup(false)} wide>
        <p className="text-sm text-zinc-500">{detail ? t("groups.channelSettingsDialog.thisRoomNoLongerExists") : t("common.loading")}</p>
      </DialogFrame>
    );
  }

  const Icon = channel.kind === "text" ? MdTag : MdVolumeUp;
  return (
    <DialogFrame
      title={
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="h-5 w-5 shrink-0 opacity-60" />
          <span className="truncate">{channel.name}</span>
        </span>
      }
      onClose={() => closePopup(false)}
      wide
      tabs={
        (isManager || managesWebhooks) && (
          <DialogTabs
            tabs={[
              ...(isManager
                ? [
                    { id: "general" as const, label: t("common.general") },
                    { id: "permissions" as const, label: t("groups.channelSettingsDialog.permissions") },
                  ]
                : []),
              ...(managesWebhooks ? [{ id: "webhooks" as const, label: t("webhook.tabTitle") }] : []),
            ]}
            current={tab}
            onChange={setTab}
          />
        )
      }
    >
      {!isManager && !managesWebhooks ? (
        <p className="text-sm text-zinc-500">{t("groups.channelSettingsDialog.youDoNotHavePermissionTo")}</p>
      ) : (
        <>
          {tab === "general" && isManager && (
            <GeneralTab detail={detail} channel={channel} onDeleted={() => closePopup(true)} />
          )}
          {tab === "permissions" && isManager && <ChannelPermissionsTab detail={detail} channel={channel} />}
          {tab === "webhooks" && managesWebhooks && <ChannelWebhooksTab detail={detail} channel={channel} />}
        </>
      )}
    </DialogFrame>
  );
}

// ─── Geral ────────────────────────────────────────────────────────────────

function GeneralTab({ detail, channel, onDeleted }: { detail: GroupDetail; channel: GroupChannel; onDeleted: () => void }) {
  const t = useT();
  const navigation = useGroupNavigation();
  const groupId = detail.group.id;
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const lastTextRoom = channel.kind === "text" && detail.channels.filter((c) => c.kind === "text").length <= 1;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === channel.name) return;
    setBusy(true);
    const result = await renameChannel(groupId, channel.id, name.trim());
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: t("common.saved2") } : { ok: false, text: result.error });
    if (result.ok) {
      setName(result.channel.name);
      void refreshGroup(groupId);
    }
  }

  // Its own form, and its own save: sending the name alongside would mean a
  // rejected name blocking a perfectly good description, and the API takes
  // either field on its own for exactly that reason.
  async function saveTopic(e: FormEvent) {
    e.preventDefault();
    const next = topic.trim();
    if (next === (channel.topic ?? "")) return;
    setBusy(true);
    const result = await setChannelTopic(groupId, channel.id, next);
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: t("common.saved2") } : { ok: false, text: result.error });
    if (result.ok) {
      setTopic(result.channel.topic ?? "");
      void refreshGroup(groupId);
    }
  }

  async function remove() {
    setBusy(true);
    const result = await deleteChannel(groupId, channel.id);
    setBusy(false);
    if (!result.ok) {
      setConfirmDelete(false);
      setMessage({ ok: false, text: result.error });
      return;
    }
    await refreshGroup(groupId);
    onDeleted();
    // Standing in it? The group's page picks the next room.
    if (typeof window !== "undefined" && window.location.pathname.endsWith(`/${channel.id}`)) {
      navigation.replace(groupPath(groupId));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={save} className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("common.roomName")}</span>
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} className={inputClass} />
          <button type="submit" disabled={busy || !name.trim() || name.trim() === channel.name} className={`${primaryButton} shrink-0`}>
            {t("common.save")}
          </button>
        </div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {channel.kind === "text" ? t("common.textRoom") : t("common.voiceRoom")}
        </span>
      </form>

      {/* Text rooms only: a voice room's header is the call in it, with
          nowhere to put a sentence — the API refuses one there for the same
          reason. */}
      {channel.kind === "text" && (
        <form onSubmit={saveTopic} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t("groups.channelTopic.label")}
          </span>
          <div className="flex gap-2">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={MAX_CHANNEL_TOPIC}
              placeholder={t("groups.channelTopic.placeholder")}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={busy || topic.trim() === (channel.topic ?? "")}
              className={`${primaryButton} shrink-0`}
            >
              {t("common.save")}
            </button>
          </div>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("groups.channelTopic.hint")}</span>
        </form>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-red-200 p-3 dark:border-red-900/60">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">{t("groups.channelSettingsDialog.deleteRoom")}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {lastTextRoom
            ? t("groups.channelSettingsDialog.thisIsTheGroupSOnly")
            : channel.kind === "text"
              ? t("groups.channelSettingsDialog.deletesTheRoomAndAllIts")
              : t("groups.channelSettingsDialog.deletesTheRoomForEveryoneWhoever")}
        </p>
        {confirmDelete ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void remove()} className={dangerButton}>
              {t("common.yesDelete")} {channel.kind === "text" ? `#${channel.name}` : channel.name}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className={secondaryButton}>
              {t("common.cancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={lastTextRoom}
            onClick={() => setConfirmDelete(true)}
            className={`${secondaryButton} self-start !border-red-300 !text-red-600 dark:!border-red-900 dark:!text-red-400`}
          >
            {t("groups.channelSettingsDialog.deleteRoom")}
          </button>
        )}
      </div>

      {message && <p className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</p>}
    </div>
  );
}

// ─── Permissões (da sala) ─────────────────────────────────────────────────

/**
 * What this room allows — its own, or its category's while the two are synced.
 *
 * The switches themselves are the shared panel (see PermissionOverrides); what
 * lives here is the syncing, which is the one thing a category has and a room
 * does not: a room in a category can either follow it or answer for itself,
 * and this is where that is chosen.
 */
function ChannelPermissionsTab({ detail, channel }: { detail: GroupDetail; channel: GroupChannel }) {
  const t = useT();
  const groupId = detail.group.id;
  const category = channel.categoryId
    ? detail.categories?.find((c) => c.id === channel.categoryId) ?? null
    : null;
  const synced = channel.syncedWithCategory === true && Boolean(category);
  const [busy, setBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function toggleSync(next: boolean) {
    setBusy(true);
    setSyncError(null);
    const result = await setChannelSync(groupId, channel.id, next);
    setBusy(false);
    if (!result.ok) {
      setSyncError(result.error);
      return;
    }
    void refreshGroup(groupId);
  }

  const keys = permissionKeysFor(channel.kind);
  const target: OverridesTarget = {
    // Includes the sync state, so turning it off remounts the editor onto the
    // room's freshly-copied values instead of leaving the category's on screen.
    key: `${channel.id}:${synced ? "synced" : "own"}`,
    overridesFor: (roleId) =>
      roleId ? channel.roleOverrides?.[roleId] ?? {} : channel.permissions ?? {},
    save: (overrides, roleId) => setChannelPermissions(groupId, channel.id, overrides, roleId),
    sections: [
      { title: t("common.general2"), keys: GENERAL_PERMISSION_KEYS },
      {
        title: channel.kind === "text" ? t("common.textRoom") : t("common.voiceRoom"),
        keys: channel.kind === "text" ? TEXT_PERMISSION_KEYS : VOICE_PERMISSION_KEYS,
      },
    ],
    keys,
  };

  return (
    <div className="flex flex-col gap-3">
      {category && (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              <MdSync className="h-4 w-4 shrink-0 opacity-70" />
              {t("groups.channelPermissions.syncTitle", { name: category.name })}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void toggleSync(!synced)}
              className={synced ? secondaryButton : primaryButton}
            >
              {synced ? t("groups.channelPermissions.stopSyncing") : t("groups.channelPermissions.startSyncing")}
            </button>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {synced
              ? t("groups.channelPermissions.syncedHint", { name: category.name })
              : t("groups.channelPermissions.unsyncedHint", { name: category.name })}
          </p>
          {syncError && <p className="text-sm text-red-500">{syncError}</p>}
        </div>
      )}
      <PermissionOverridesPanel
        detail={detail}
        target={target}
        intro={
          <>
            {t("groups.channelSettingsDialog.whatEachOneCanDoIn")} <b>@everyone</b>{" "}
            {t("groups.channelSettingsDialog.everyoneOrARole")}{" "}
            <b>{t("groups.channelSettingsDialog.neutral")}</b>{" "}
            {t("groups.channelSettingsDialog.changesNothing")} <b>{t("common.enabledFem")}</b>{" "}
            {t("common.or")} <b>{t("common.disabledFem")}</b>{" "}
            {t("groups.channelSettingsDialog.appliesOnlyHereIfOneRole")}
          </>
        }
        banner={
          synced && category ? (
            // Said here rather than by disabling the switches: touching one is
            // exactly how somebody takes this room out of the sync, and a
            // locked row gives them nowhere to do it from.
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              <MdSync className="mt-0.5 h-4 w-4 shrink-0" />
              {t("groups.channelPermissions.editUnsyncsWarning", { name: category.name })}
            </p>
          ) : null
        }
      />
    </div>
  );
}

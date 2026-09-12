"use client";

import { useState, type FormEvent } from "react";
import useNtPopups from "ntpopups";
import { MdCheck, MdClose, MdLockOutline, MdRemove, MdTag, MdVolumeUp } from "react-icons/md";
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
  type GroupChannel,
  type GroupDetail,
} from "@/lib/groupsApi";
import {
  GENERAL_PERMISSION_KEYS,
  PERMISSION_LABELS,
  TEXT_PERMISSION_KEYS,
  VOICE_PERMISSION_KEYS,
  canManage,
  groupAllows,
  myRank,
  permissionIn,
  permissionKeysFor,
  rolesInOrder,
  type ChannelPermissionOverrides,
  type GroupPermissionKey,
} from "@/lib/groupPermissions";
import { groupPath } from "@/lib/groupLinks";
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

type ChannelTab = "general" | "permissions";

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
  const [tab, setTab] = useState<ChannelTab>(data?.tab ?? "general");
  const isManager = detail ? canManage(detail, "manageChannels") : false;

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
    >
      {!isManager ? (
        <p className="text-sm text-zinc-500">{t("groups.channelSettingsDialog.youDoNotHavePermissionTo")}</p>
      ) : (
        <>
          <DialogTabs
            tabs={[
              { id: "general" as const, label: t("common.general") },
              { id: "permissions" as const, label: t("groups.channelSettingsDialog.permissions") },
            ]}
            current={tab}
            onChange={setTab}
          />
          {tab === "general" && <GeneralTab detail={detail} channel={channel} onDeleted={() => closePopup(true)} />}
          {tab === "permissions" && <ChannelPermissionsTab detail={detail} channel={channel} />}
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

type TriState = "off" | "neutral" | "on";

function triOf(value: boolean | undefined): TriState {
  return value === true ? "on" : value === false ? "off" : "neutral";
}

/** Off / neutral / on, side by side — the three a room's switch can be. */
function TriStateControl({
  value,
  onChange,
  disabled,
}: {
  value: TriState;
  onChange: (next: TriState) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const options: { id: TriState; label: string; icon: typeof MdCheck; active: string }[] = [
    { id: "off", label: t("groups.channelSettingsDialog.disabled"), icon: MdClose, active: "bg-red-600 text-white" },
    { id: "neutral", label: t("groups.channelSettingsDialog.neutral"), icon: MdRemove, active: "bg-zinc-500 text-white dark:bg-zinc-600" },
    { id: "on", label: t("groups.channelSettingsDialog.enabled"), icon: MdCheck, active: "bg-emerald-600 text-white" },
  ];
  return (
    <div role="radiogroup" className="inline-flex shrink-0 overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
      {options.map(({ id, label, icon: Icon, active }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          aria-label={label}
          title={label}
          disabled={disabled}
          onClick={() => onChange(id)}
          className={`flex h-8 w-9 cursor-pointer items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-60 ${
            value === id
              ? active
              : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          } ${id !== "off" ? "border-l border-zinc-300 dark:border-zinc-700" : ""}`}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

const EVERYONE = "@everyone";

function ChannelPermissionsTab({ detail, channel }: { detail: GroupDetail; channel: GroupChannel }) {
  const t = useT();
  const roles = rolesInOrder(detail);
  // Whose overrides are being edited: @everyone, or one role.
  const [target, setTarget] = useState<string>(EVERYONE);
  const role = roles.find((r) => r.id === target) ?? null;
  const rank = myRank(detail);
  const overridesOf = (roleId: string | null) =>
    roleId ? channel.roleOverrides?.[roleId] ?? {} : channel.permissions ?? {};
  const hasOverrides = (roleId: string | null) => Object.keys(overridesOf(roleId)).length > 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {t("groups.channelSettingsDialog.whatEachOneCanDoIn")} <b>@everyone</b> {t("groups.channelSettingsDialog.everyoneOrARole")} <b>{t("groups.channelSettingsDialog.neutral")}</b> {t("groups.channelSettingsDialog.changesNothing")} <b>{t("common.enabledFem")}</b> {t("common.or")} <b>{t("common.disabledFem")}</b> {t("groups.channelSettingsDialog.appliesOnlyHereIfOneRole")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {[{ id: EVERYONE, name: "@everyone", color: null as string | null }, ...roles].map((option) => {
          const active = option.id === (role?.id ?? EVERYONE);
          const overridden = hasOverrides(option.id === EVERYONE ? null : option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setTarget(option.id)}
              className={`flex max-w-48 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                active
                  ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              {option.id !== EVERYONE && (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: option.color ?? "#99aab5" }} />
              )}
              <span className="truncate">{option.name}</span>
              {overridden && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" title={t("groups.channelSettingsDialog.hasSettingsInThisRoom")} />}
            </button>
          );
        })}
      </div>
      <OverridesEditor
        key={`${channel.id}:${role?.id ?? EVERYONE}`}
        detail={detail}
        channel={channel}
        roleId={role?.id ?? null}
        roleName={role?.name ?? null}
        initial={overridesOf(role?.id ?? null)}
        // A role at or above one's own is the API's to refuse — drawn, but locked.
        locked={Boolean(role && role.position >= rank)}
      />
    </div>
  );
}

function OverridesEditor({
  detail,
  channel,
  roleId,
  roleName,
  initial,
  locked,
}: {
  detail: GroupDetail;
  channel: GroupChannel;
  roleId: string | null;
  roleName: string | null;
  initial: ChannelPermissionOverrides;
  locked: boolean;
}) {
  const t = useT();
  const openGroupSettings = useOpenGroupSettings();
  const groupId = detail.group.id;
  // What was last sent, shown at once rather than after the round trip.
  const [local, setLocal] = useState<ChannelPermissionOverrides>(initial);
  const [error, setError] = useState<string | null>(null);
  const role = roleId ? rolesInOrder(detail).find((r) => r.id === roleId) ?? null : null;

  async function send(overrides: ChannelPermissionOverrides) {
    const previous = local;
    setLocal(overrides);
    setError(null);
    const result = await setChannelPermissions(groupId, channel.id, overrides, roleId);
    if (!result.ok) {
      setLocal(previous);
      setError(result.error);
      return;
    }
    void refreshGroup(groupId);
  }

  function change(key: GroupPermissionKey, next: TriState) {
    const overrides: ChannelPermissionOverrides = { ...local };
    if (next === "neutral") delete overrides[key];
    else overrides[key] = next === "on";
    void send(overrides);
  }

  const keys = permissionKeysFor(channel.kind);
  const overridden = keys.some((key) => typeof local[key] === "boolean");
  // The same sections as the group's own: the general switches, then this
  // room's kind.
  const sections: { title: string; keys: readonly GroupPermissionKey[] }[] = [
    { title: t("common.general2"), keys: GENERAL_PERMISSION_KEYS },
    {
      title: channel.kind === "text" ? t("common.textRoom") : t("common.voiceRoom"),
      keys: channel.kind === "text" ? TEXT_PERMISSION_KEYS : VOICE_PERMISSION_KEYS,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {locked && (
        <p className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <MdLockOutline className="h-4 w-4 shrink-0" />
          {t("common.thisRoleIsAtTheSame")}
        </p>
      )}
      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{section.title}</p>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {section.keys.map((key) => {
              const value = triOf(local[key]);
              const { label, hint } = PERMISSION_LABELS[key];
              // What neutral means: for @everyone, the group's setting; for a
              // role, whatever it (or @everyone) already gives.
              const inherited = role
                ? permissionIn(role.permissions, key) || groupAllows(detail.group.permissions, key)
                : groupAllows(detail.group.permissions, key);
              const effective = value === "neutral" ? inherited : value === "on";
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {value === "neutral" ? (
                        role ? (
                          <>{t("groups.channelSettingsDialog.changesNothingFor")} {roleName}</>
                        ) : (
                          <>
                            {t("groups.channelSettingsDialog.followsTheGroup")}{" "}
                            <span className={inherited ? "text-emerald-600 dark:text-emerald-500" : "text-red-500"}>
                              {inherited ? t("common.enabledFem") : t("common.disabledFem")}
                            </span>
                          </>
                        )
                      ) : (
                        <span className={effective ? "text-emerald-600 dark:text-emerald-500" : "text-red-500"}>
                          {effective
                            ? role
                              ? t("groups.channelSettingsDialog.enabledForRolenameInThisRoom", { roleName })
                              : t("groups.channelSettingsDialog.enabledInThisRoom")
                            : role
                              ? t("groups.channelSettingsDialog.disabledForRolenameInThisRoom", { roleName })
                              : t("groups.channelSettingsDialog.disabledInThisRoom")}
                        </span>
                      )}
                      {hint && <> · {hint}</>}
                    </p>
                  </div>
                  <TriStateControl value={value} disabled={locked} onChange={(next) => change(key, next)} />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => openGroupSettings(groupId, "roles")}
          className="cursor-pointer text-sm font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          {t("groups.channelSettingsDialog.groupRolesAndPermissions")}
        </button>
        {overridden && !locked && (
          <button type="button" onClick={() => void send({})} className={secondaryButton}>
            {t("groups.channelSettingsDialog.setEverythingToNeutral")}
          </button>
        )}
      </div>
    </div>
  );
}

function useOpenGroupSettings() {
  const { openPopup } = useNtPopups();
  return (groupId: string, tab?: string) =>
    void openPopup("group_settings", { ...WIDE_POPUP_SIZE, data: { groupId, tab } });
}

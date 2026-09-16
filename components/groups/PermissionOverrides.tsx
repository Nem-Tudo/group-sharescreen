"use client";

import { useState } from "react";
import useNtPopups from "ntpopups";
import { MdCheck, MdClose, MdLockOutline, MdRemove } from "react-icons/md";
import { secondaryButton, WIDE_POPUP_SIZE } from "@/components/groups/dialogKit";
import type { GroupDetail } from "@/lib/groupsApi";
import {
  GENERAL_PERMISSION_KEYS,
  PERMISSION_LABELS,
  TEXT_PERMISSION_KEYS,
  VOICE_PERMISSION_KEYS,
  groupAllows,
  myRank,
  permissionIn,
  rolesInOrder,
  type ChannelPermissionOverrides,
  type GroupPermissionKey,
} from "@/lib/groupPermissions";
import { refreshGroup } from "@/lib/useGroups";
import { useT } from "@/lib/useI18n";

// The three-state permission editor, shared by a room's settings and a
// category's (see ChannelSettingsDialog and CategorySettingsDialog).
//
// It was a room's alone until categories learned to carry permissions. The two
// screens are the same screen — the same chips to pick @everyone or a role,
// the same rows, the same "everything to neutral" — differing only in which
// switches exist and where a save goes, so they are one component with those
// two things passed in rather than a copy that drifts.

export type TriState = "off" | "neutral" | "on";

export function triOf(value: boolean | undefined): TriState {
  return value === true ? "on" : value === false ? "off" : "neutral";
}

/** Off / neutral / on, side by side — the three a switch here can be. */
export function TriStateControl({
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

export const EVERYONE = "@everyone";

/**
 * What the panel is editing, and how to save it.
 *
 * `sections` is what makes a room's screen differ from a category's: a room
 * shows the general switches and its own kind's, a category shows the general
 * ones and *both* kinds — one heading can hold text rooms and voice rooms, so
 * its settings have to be able to say something about either.
 */
export type OverridesTarget = {
  /** Distinguishes one target from another, for resetting the editor's state. */
  key: string;
  overridesFor: (roleId: string | null) => ChannelPermissionOverrides;
  save: (
    overrides: ChannelPermissionOverrides,
    roleId: string | null
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  sections: { title: string; keys: readonly GroupPermissionKey[] }[];
  /** Every key any section shows — what "is anything overridden" counts. */
  keys: readonly GroupPermissionKey[];
};

/** Both halves of the screen: who is being edited, and their switches. */
export function PermissionOverridesPanel({
  detail,
  target,
  intro,
  /** Drawn between the chips and the rows — the room's "synced" notice. */
  banner,
}: {
  detail: GroupDetail;
  target: OverridesTarget;
  intro: React.ReactNode;
  banner?: React.ReactNode;
}) {
  const t = useT();
  const roles = rolesInOrder(detail);
  // Whose overrides are being edited: @everyone, or one role.
  const [picked, setPicked] = useState<string>(EVERYONE);
  const role = roles.find((r) => r.id === picked) ?? null;
  const rank = myRank(detail);
  const hasOverrides = (roleId: string | null) => Object.keys(target.overridesFor(roleId)).length > 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{intro}</p>
      <div className="flex flex-wrap gap-1.5">
        {[{ id: EVERYONE, name: "@everyone", color: null as string | null }, ...roles].map((option) => {
          const active = option.id === (role?.id ?? EVERYONE);
          const overridden = hasOverrides(option.id === EVERYONE ? null : option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setPicked(option.id)}
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
      {banner}
      <OverridesEditor
        // Remounts when the target or the chip changes, so the local copy
        // below always starts from what is actually saved.
        key={`${target.key}:${role?.id ?? EVERYONE}`}
        detail={detail}
        target={target}
        roleId={role?.id ?? null}
        roleName={role?.name ?? null}
        initial={target.overridesFor(role?.id ?? null)}
        // A role at or above one's own is the API's to refuse — drawn, but locked.
        locked={Boolean(role && role.position >= rank)}
      />
    </div>
  );
}

function OverridesEditor({
  detail,
  target,
  roleId,
  roleName,
  initial,
  locked,
}: {
  detail: GroupDetail;
  target: OverridesTarget;
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
    const result = await target.save(overrides, roleId);
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

  const overridden = target.keys.some((key) => typeof local[key] === "boolean");

  return (
    <div className="flex flex-col gap-3">
      {locked && (
        <p className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <MdLockOutline className="h-4 w-4 shrink-0" />
          {t("common.thisRoleIsAtTheSame")}
        </p>
      )}
      {target.sections.map((section) => (
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

/** The general switches plus both kinds' — what a category may set. */
export function categorySections(t: ReturnType<typeof useT>) {
  return [
    { title: t("common.general2"), keys: GENERAL_PERMISSION_KEYS },
    { title: t("common.textRoom"), keys: TEXT_PERMISSION_KEYS },
    { title: t("common.voiceRoom"), keys: VOICE_PERMISSION_KEYS },
  ];
}

export function useOpenGroupSettings() {
  const { openPopup } = useNtPopups();
  return (groupId: string, tab?: string) =>
    void openPopup("group_settings", { ...WIDE_POPUP_SIZE, data: { groupId, tab } });
}

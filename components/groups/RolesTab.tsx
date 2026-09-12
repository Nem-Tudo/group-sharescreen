"use client";

import { useState, type FormEvent } from "react";
import {
  MdAdd,
  MdArrowDownward,
  MdArrowUpward,
  MdClose,
  MdLockOutline,
  MdOutlineFormatColorReset,
  MdShield,
} from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { TogglePill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/groups/dialogKit";
import { verifiedBadge } from "@/lib/entitlements";
import { useGroupMembers } from "@/lib/groupCache";
import {
  createRole,
  deleteRole,
  reorderRoles,
  setGroupPermissions,
  setMemberRoles,
  updateRole,
  type GroupDetail,
  type GroupRoleInfo,
  type RoleInput,
} from "@/lib/groupsApi";
import {
  GENERAL_PERMISSION_KEYS,
  MANAGE_PERMISSION_KEYS,
  PERMISSION_LABELS,
  TEXT_PERMISSION_KEYS,
  VOICE_PERMISSION_KEYS,
  canManage,
  groupAllows,
  membersRevalidateKey,
  myRank,
  permissionIn,
  roleColorOf,
  rolesInOrder,
  sectionOf,
  type AnyPermissionKey,
} from "@/lib/groupPermissions";
import { refreshGroup, useGroupDetail } from "@/lib/useGroups";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";

// The group settings' "Cargos" tab — Discord's roles. The list on the left,
// highest first, with @everyone at the bottom; the one picked is edited on
// the right: its name, colour, whether it is listed apart and may be
// @-mentioned, its switches, and who holds it.
//
// What somebody may touch follows the API (see its groupRoutes' roles
// section): only roles below their own highest, and only switches they have
// themselves — everything else is drawn, but locked.

const EVERYONE = "@everyone";

/** The swatches a role's colour is picked from — Discord's, more or less. */
const ROLE_COLORS = [
  "#1abc9c",
  "#2ecc71",
  "#3498db",
  "#9b59b6",
  "#e91e63",
  "#f1c40f",
  "#e67e22",
  "#e74c3c",
  "#95a5a6",
  "#607d8b",
  "#11806a",
  "#1f8b4c",
  "#206694",
  "#71368a",
  "#ad1457",
  "#c27c0e",
  "#a84300",
  "#992d22",
];

const SECTIONS: { title: string; keys: readonly AnyPermissionKey[] }[] = [
  { get title() { return translate("common.administration"); }, keys: MANAGE_PERMISSION_KEYS },
  { get title() { return translate("common.general2"); }, keys: GENERAL_PERMISSION_KEYS },
  { get title() { return translate("groups.rolesTab.textRooms"); }, keys: TEXT_PERMISSION_KEYS },
  { get title() { return translate("groups.rolesTab.voiceRooms"); }, keys: VOICE_PERMISSION_KEYS },
];

/** A patch for one switch, in the shape the API merges. */
function patchFor(key: AnyPermissionKey, value: boolean) {
  return { [sectionOf(key)]: { [key]: value } } as RoleInput["permissions"];
}

/** Whether the person looking may flip this switch on somebody else: an administrator any, anybody else only their own. */
function mayGrant(detail: GroupDetail, key: AnyPermissionKey): boolean {
  return canManage(detail, "administrator") || permissionIn(detail.me.permissions, key);
}

export function RolesTab({ groupId }: { groupId: string }) {
  const t = useT();
  const { detail } = useGroupDetail(groupId);
  const [selected, setSelected] = useState<string>(EVERYONE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!detail) return null;

  const roles = rolesInOrder(detail);
  const rank = myRank(detail);
  const canEdit = canManage(detail, "manageRoles");
  const holders = new Map<string, number>();
  for (const ids of Object.values(detail.memberRoles ?? {})) {
    for (const id of ids) holders.set(id, (holders.get(id) ?? 0) + 1);
  }
  const current = roles.find((r) => r.id === selected) ?? null;

  async function create() {
    setBusy(true);
    setError(null);
    const result = await createRole(groupId, { name: "novo cargo" });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refreshGroup(groupId);
    setSelected(result.role.id);
  }

  // One step up or down, among the roles below one's own.
  async function move(index: number, delta: -1 | 1) {
    const other = roles[index + delta];
    if (!other || other.position >= rank) return;
    const ids = roles.map((r) => r.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    setError(null);
    const result = await reorderRoles(groupId, ids);
    if (!result.ok) setError(result.error);
    void refreshGroup(groupId);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {t("groups.rolesTab.rolesGiveExtraPermissionsToWhoever")}
      </p>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          {canEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void create()}
              className={`${secondaryButton} flex items-center justify-center gap-1.5`}
            >
              <MdAdd className="h-4 w-4" />
              {t("groups.rolesTab.createRole")}
            </button>
          )}
          <ul className="flex flex-col gap-0.5">
            {roles.map((role, index) => {
              const locked = !canEdit || role.position >= rank;
              const active = selected === role.id;
              return (
                <li key={role.id} className="group/role flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelected(role.id)}
                    className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                      active
                        ? "bg-zinc-200 font-medium text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border border-black/10 dark:border-white/10"
                      style={{ backgroundColor: role.color ?? "#99aab5" }}
                    />
                    <span className="min-w-0 flex-1 truncate">{role.name}</span>
                    {role.permissions.manage?.administrator && (
                      <MdShield className="h-3.5 w-3.5 shrink-0 opacity-50" title={t("common.administrator")} />
                    )}
                    {locked && canEdit && <MdLockOutline className="h-3.5 w-3.5 shrink-0 opacity-50" />}
                    <span className="shrink-0 text-xs tabular-nums text-zinc-400">{holders.get(role.id) ?? 0}</span>
                  </button>
                  {!locked && (
                    <span className="flex shrink-0 flex-col">
                      <button
                        type="button"
                        aria-label={t("common.moveUp")}
                        title={t("common.moveUp")}
                        disabled={index === 0 || roles[index - 1].position >= rank}
                        onClick={() => void move(index, -1)}
                        className="cursor-pointer rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-default disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      >
                        <MdArrowUpward className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("common.moveDown")}
                        title={t("common.moveDown")}
                        disabled={index === roles.length - 1}
                        onClick={() => void move(index, 1)}
                        className="cursor-pointer rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-default disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      >
                        <MdArrowDownward className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={() => setSelected(EVERYONE)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                  !current
                    ? "bg-zinc-200 font-medium text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                }`}
              >
                <span className="h-3 w-3 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                <span className="min-w-0 flex-1 truncate">@everyone</span>
                <span className="shrink-0 text-xs tabular-nums text-zinc-400">{detail.group.memberCount}</span>
              </button>
            </li>
          </ul>
        </div>

        <div className="min-w-0">
          {current ? (
            <RoleEditor
              key={current.id}
              detail={detail}
              role={current}
              editable={canEdit && current.position < rank}
              onDeleted={() => setSelected(EVERYONE)}
            />
          ) : (
            <EveryoneEditor detail={detail} editable={canEdit} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── The switches ─────────────────────────────────────────────────────────

function PermissionSections({
  value,
  onToggle,
  canToggle,
  note,
}: {
  value: (key: AnyPermissionKey) => boolean;
  onToggle: (key: AnyPermissionKey) => void;
  canToggle: (key: AnyPermissionKey) => boolean;
  /** An extra line under a switch — how many rooms say otherwise, for @everyone. */
  note?: (key: AnyPermissionKey) => string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {SECTIONS.map((section) => (
        <div key={section.title} className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{section.title}</p>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {section.keys.map((key) => {
              const on = value(key);
              const allowed = canToggle(key);
              const { label, hint } = PERMISSION_LABELS[key];
              const extra = note?.(key) ?? null;
              return (
                <li key={key}>
                  <button
                    type="button"
                    disabled={!allowed}
                    onClick={() => onToggle(key)}
                    aria-pressed={on}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent dark:hover:bg-zinc-900"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
                      {(hint || extra) && (
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {hint}
                          {hint && extra && " · "}
                          {extra}
                        </span>
                      )}
                    </span>
                    <TogglePill on={on} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Flips switches ahead of the round trip, and lets go of each once the group is re-read. */
function usePendingSwitches() {
  const [pending, setPending] = useState<Partial<Record<AnyPermissionKey, boolean>>>({});
  const hold = (key: AnyPermissionKey, value: boolean) => setPending((p) => ({ ...p, [key]: value }));
  const release = (key: AnyPermissionKey) =>
    setPending((p) => {
      const rest = { ...p };
      delete rest[key];
      return rest;
    });
  return { pending, hold, release };
}

// ─── @everyone ────────────────────────────────────────────────────────────

function EveryoneEditor({ detail, editable }: { detail: GroupDetail; editable: boolean }) {
  const t = useT();
  const groupId = detail.group.id;
  const { pending, hold, release } = usePendingSwitches();
  const [error, setError] = useState<string | null>(null);
  const value = (key: AnyPermissionKey) => pending[key] ?? groupAllows(detail.group.permissions, key);

  async function toggle(key: AnyPermissionKey) {
    const next = !value(key);
    hold(key, next);
    setError(null);
    const result = await setGroupPermissions(groupId, patchFor(key, next) ?? {});
    if (!result.ok) setError(result.error);
    await refreshGroup(groupId);
    release(key);
  }

  // How many rooms say otherwise — worth knowing before flipping a switch
  // that some rooms will not follow. The management ones are never overridden.
  const note = (key: AnyPermissionKey) => {
    const section = sectionOf(key);
    if (section === "manage") return null;
    const n = detail.channels.filter(
      (c) =>
        (section === "general" || c.kind === section) &&
        typeof c.permissions?.[key as keyof typeof c.permissions] === "boolean"
    ).length;
    return n > 0 ? `${n} ${n === 1 ? "sala define" : "salas definem"} diferente` : null;
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-base font-semibold">@everyone</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("groups.rolesTab.whatEveryoneInTheGroupCan")}
        </p>
      </div>
      <PermissionSections
        value={value}
        onToggle={(key) => void toggle(key)}
        canToggle={(key) => editable && mayGrant(detail, key)}
        note={note}
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

// ─── One role ─────────────────────────────────────────────────────────────

function RoleEditor({
  detail,
  role,
  editable,
  onDeleted,
}: {
  detail: GroupDetail;
  role: GroupRoleInfo;
  editable: boolean;
  onDeleted: () => void;
}) {
  const t = useT();
  const groupId = detail.group.id;
  const [name, setName] = useState(role.name);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flags, setFlags] = useState<{ hoist?: boolean; mentionable?: boolean; color?: string | null }>({});
  const { pending, hold, release } = usePendingSwitches();

  async function save(input: RoleInput): Promise<boolean> {
    setMessage(null);
    const result = await updateRole(groupId, role.id, input);
    if (!result.ok) setMessage({ ok: false, text: result.error });
    await refreshGroup(groupId);
    return result.ok;
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === role.name) return;
    setBusy(true);
    if (await save({ name: name.trim() })) setMessage({ ok: true, text: t("common.saved2") });
    setBusy(false);
  }

  async function setFlag(input: { hoist?: boolean; mentionable?: boolean; color?: string | null }) {
    setFlags((f) => ({ ...f, ...input }));
    await save(input);
    setFlags({});
  }

  async function toggle(key: AnyPermissionKey) {
    const next = !(pending[key] ?? permissionIn(role.permissions, key));
    hold(key, next);
    await save({ permissions: patchFor(key, next) });
    release(key);
  }

  async function remove() {
    setBusy(true);
    const result = await deleteRole(groupId, role.id);
    setBusy(false);
    if (!result.ok) {
      setConfirmDelete(false);
      setMessage({ ok: false, text: result.error });
      return;
    }
    await refreshGroup(groupId);
    onDeleted();
  }

  const color = flags.color !== undefined ? flags.color : role.color;
  const hoist = flags.hoist ?? role.hoist;
  const mentionable = flags.mentionable ?? role.mentionable;

  return (
    <div className="flex flex-col gap-4">
      {!editable && (
        <p className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <MdLockOutline className="h-4 w-4 shrink-0" />
          {canManage(detail, "manageRoles")
            ? t("common.thisRoleIsAtTheSame")
            : t("groups.rolesTab.youDoNotHavePermissionTo")}
        </p>
      )}

      <form onSubmit={rename} className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("groups.rolesTab.roleName")}</span>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            disabled={!editable}
            className={inputClass}
          />
          {editable && (
            <button type="submit" disabled={busy || !name.trim() || name.trim() === role.name} className={`${primaryButton} shrink-0`}>
              {t("common.save")}
            </button>
          )}
        </div>
      </form>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("common.color")}</span>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("groups.rolesTab.theNameOfWhoeverHasThe")}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={!editable}
            onClick={() => void setFlag({ color: null })}
            aria-label={t("groups.rolesTab.noColour")}
            title={t("groups.rolesTab.noColour")}
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border text-zinc-500 disabled:cursor-not-allowed ${
              color === null ? "border-zinc-950 ring-2 ring-zinc-950/20 dark:border-zinc-50" : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            <MdOutlineFormatColorReset className="h-4 w-4" />
          </button>
          {ROLE_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              disabled={!editable}
              onClick={() => void setFlag({ color: swatch })}
              aria-label={swatch}
              title={swatch}
              className={`h-7 w-7 cursor-pointer rounded-md transition disabled:cursor-not-allowed ${
                color === swatch ? "ring-2 ring-zinc-950 ring-offset-2 dark:ring-zinc-50 dark:ring-offset-zinc-950" : ""
              }`}
              style={{ backgroundColor: swatch }}
            />
          ))}
          <label
            title={t("groups.rolesTab.anotherColour")}
            className={`relative h-7 w-7 overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700 ${
              editable ? "cursor-pointer" : "cursor-not-allowed opacity-60"
            } ${color && !ROLE_COLORS.includes(color) ? "ring-2 ring-zinc-950 ring-offset-2 dark:ring-zinc-50 dark:ring-offset-zinc-950" : ""}`}
            style={{
              background:
                color && !ROLE_COLORS.includes(color)
                  ? color
                  : "conic-gradient(#e74c3c, #f1c40f, #2ecc71, #3498db, #9b59b6, #e74c3c)",
            }}
          >
            <input
              type="color"
              disabled={!editable}
              value={color ?? "#99aab5"}
              onChange={(e) => setFlags((f) => ({ ...f, color: e.target.value }))}
              onBlur={(e) => {
                if (e.target.value !== role.color) void setFlag({ color: e.target.value });
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        <li>
          <button
            type="button"
            disabled={!editable}
            onClick={() => void setFlag({ hoist: !hoist })}
            aria-pressed={hoist}
            className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent dark:hover:bg-zinc-900"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t("groups.rolesTab.displaySeparately")}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                {t("groups.rolesTab.whoeverHasTheRoleAppearsIn")}
              </span>
            </span>
            <TogglePill on={hoist} />
          </button>
        </li>
        <li>
          <button
            type="button"
            disabled={!editable}
            onClick={() => void setFlag({ mentionable: !mentionable })}
            aria-pressed={mentionable}
            className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent dark:hover:bg-zinc-900"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t("groups.rolesTab.allowAnyoneToMentionThisRole")}
              </span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                {t("groups.rolesTab.aMentionNotifiesEveryoneWhoHas")}
              </span>
            </span>
            <TogglePill on={mentionable} />
          </button>
        </li>
      </ul>

      <PermissionSections
        value={(key) => pending[key] ?? permissionIn(role.permissions, key)}
        onToggle={(key) => void toggle(key)}
        canToggle={(key) => editable && mayGrant(detail, key)}
      />

      <RoleHolders detail={detail} role={role} editable={editable} />

      {message && <p className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</p>}

      {editable && (
        <div className="flex flex-col gap-2 rounded-lg border border-red-200 p-3 dark:border-red-900/60">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">{t("groups.rolesTab.deleteRole")}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("groups.rolesTab.removesTheRoleFromEveryoneWho")}
          </p>
          {confirmDelete ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void remove()} className={dangerButton}>
                {t("common.yesDelete")} {role.name}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className={secondaryButton}>
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className={`${secondaryButton} self-start !border-red-300 !text-red-600 dark:!border-red-900 dark:!text-red-400`}
            >
              {t("groups.rolesTab.deleteRole")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Who holds a role — with a way to take it off them, and to hand it to somebody else. */
function RoleHolders({ detail, role, editable }: { detail: GroupDetail; role: GroupRoleInfo; editable: boolean }) {
  const t = useT();
  const groupId = detail.group.id;
  const members = useGroupMembers(groupId, membersRevalidateKey(detail));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roleIdsOf = (userId: string) => detail.memberRoles?.[userId] ?? [];
  const holding = (members ?? []).filter((m) => roleIdsOf(m.id).includes(role.id));
  const others = (members ?? []).filter((m) => !roleIdsOf(m.id).includes(role.id));

  async function change(userId: string, give: boolean) {
    setBusy(true);
    setError(null);
    const current = roleIdsOf(userId);
    const next = give ? [...current, role.id] : current.filter((id) => id !== role.id);
    const result = await setMemberRoles(groupId, userId, next);
    setBusy(false);
    if (!result.ok) setError(result.error);
    void refreshGroup(groupId);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {t("groups.rolesTab.membersWithThisRole")} {members ? holding.length : "…"}
      </p>
      {editable && others.length > 0 && (
        <select
          value=""
          disabled={busy}
          onChange={(e) => {
            if (e.target.value) void change(e.target.value, true);
          }}
          className={inputClass}
        >
          <option value="">{t("groups.rolesTab.addSomeone")}</option>
          {others.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.username ? ` (@${m.username})` : ""}
            </option>
          ))}
        </select>
      )}
      {members && holding.length === 0 && <p className="text-sm text-zinc-500">{t("groups.rolesTab.nobodyHasThisRoleYet")}</p>}
      <ul className="flex flex-col gap-0.5">
        {holding.map((m) => (
          <li key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-900">
            <UserAvatar src={m.avatarUrl} name={m.name} size={24} />
            <DisplayUserName
              name={m.name}
              isGuest={m.guest}
              verified={verifiedBadge(m.flags)}
              bot={m.bot}
              color={roleColorOf(detail, { id: m.id }) ?? m.nameColor}
              className="min-w-0 flex-1 truncate text-sm"
            />
            {editable && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void change(m.id, false)}
                aria-label={t("groups.rolesTab.removeNameSRole", { name: m.name })}
                title={t("common.removeTheRole")}
                className="cursor-pointer rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
              >
                <MdClose className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import Tippy from "@tippyjs/react";
import { FaCrown } from "react-icons/fa";
import {
  MdAdd,
  MdAlternateEmail,
  MdBlock,
  MdCheck,
  MdChatBubbleOutline,
  MdChevronRight,
  MdContentCopy,
  MdMic,
  MdMicOff,
  MdPersonOutline,
  MdPersonRemove,
  MdShield,
  MdSwapHoriz,
} from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { Popover } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import { UserProfileDialog } from "@/components/UserProfileDialog";
import { WebhookProfileDialog } from "@/components/WebhookProfileDialog";
import { VolumeSlider } from "@/components/VolumeSlider";
import { RoleChip } from "@/components/groups/RoleChip";
import {
  closeGroupMemberMenu,
  closeGroupProfile,
  openGroupProfile,
  useGroupMemberMenu,
  useGroupProfileTarget,
  type GroupProfileTarget,
} from "@/components/groups/groupProfile";
import { MAX_GAIN } from "@/lib/audioGain";
import { useAuth } from "@/lib/AuthContext";
import { copyText } from "@/lib/clipboard";
import { openDirectMessages } from "@/lib/dmWindow";
import { mentionInComposer, useCanMention } from "@/lib/groupMentionBridge";
import {
  canManage,
  myRank,
  rankOf,
  roleColorOf,
  roleIdsOf,
  rolesInOrder,
  rolesWithIds,
} from "@/lib/groupPermissions";
import { useGroupVoiceControls, useGroupVoiceLive } from "@/lib/groupVoiceSession";
import { banMember, kickMember, setMemberRoles, transferGroup, type GroupDetail } from "@/lib/groupsApi";
import { refreshGroup } from "@/lib/useGroups";
import { useT } from "@/lib/useI18n";

// What can be done about one person in a group, in the two places it is
// offered: their member profile (a click on them anywhere), and the menu the
// right button opens on them (Discord's).
//
// Both read the same rules the settings' members tab reads (see MembersTab in
// GroupDialogs), so neither ever offers what the API would refuse: roles are
// handed out and taken back only below the looker's own highest role, and
// nobody is removed who is the owner or stands at or above the looker.

/** What the person looking may do to `target` — the members tab's rules. */
function permissionsOver(detail: GroupDetail, targetId: string, targetGuest: boolean) {
  const selfId = detail.me.id;
  const self = targetId === selfId;
  const rank = myRank(detail);
  const canRoles = canManage(detail, "manageRoles");
  const roleIds = roleIdsOf(detail, targetId);
  const isOwner = targetId === detail.group.ownerId;
  const above = !isOwner && rank > rankOf(detail, { id: targetId, roleIds });
  return {
    self,
    isOwner,
    roleIds,
    roles: rolesWithIds(detail, roleIds),
    canRoles,
    rank,
    // A bot's own role is never handed to anybody (see GroupRoleInfo.managedBy).
    assignable: canRoles ? rolesInOrder(detail).filter((r) => r.position < rank && !r.managedBy) : [],
    canKick: !self && above && canManage(detail, "kickMembers"),
    canBan: !self && above && canManage(detail, "banMembers"),
    canTransfer: !self && !targetGuest && detail.me.role === "owner",
  };
}

/** Sets somebody's roles and re-reads the group, resolving the API's error or null. */
async function saveRoles(groupId: string, userId: string, roleIds: string[]): Promise<string | null> {
  const result = await setMemberRoles(groupId, userId, roleIds);
  if (!result.ok) return result.error;
  await refreshGroup(groupId);
  return null;
}

// ─── The member profile ───────────────────────────────────────────────────

/**
 * The profile dialog for the group's pages: the person's own profile, and
 * under it what they are in this group — their roles, which whoever may hand
 * roles out can change right there.
 */
export function GroupProfileHost({ detail }: { detail: GroupDetail | null }) {
  const target = useGroupProfileTarget();
  if (!target) return null;
  // A webhook has no profile to fetch and no place in the group — see
  // WebhookProfileDialog.
  if (target.webhook) {
    return <WebhookProfileDialog name={target.name} avatarUrl={target.avatarUrl} onClose={closeGroupProfile} />;
  }
  return (
    <UserProfileDialog
      key={target.id}
      userId={target.id}
      guest={target.guest ? { name: target.name, avatarUrl: target.avatarUrl } : undefined}
      onClose={closeGroupProfile}
      extra={detail ? <GroupMemberPanel detail={detail} target={target} /> : null}
    />
  );
}

function GroupMemberPanel({ detail, target }: { detail: GroupDetail; target: GroupProfileTarget }) {
  const t = useT();
  const groupId = detail.group.id;
  const rules = permissionsOver(detail, target.id, target.guest);
  // What was just asked for, shown until the group's re-read carries it — so
  // a chip goes (or comes) on the click rather than a round trip later.
  const [pending, setPending] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const heldIds = pending ?? rules.roleIds;
  const held = rolesWithIds(detail, heldIds);
  const missing = rules.assignable.filter((r) => !heldIds.includes(r.id));

  async function change(next: string[]) {
    setAdding(false);
    setError(null);
    setPending(next);
    const failure = await saveRoles(groupId, target.id, next);
    setPending(null);
    if (failure) setError(failure);
  }

  return (
    <section className="mt-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {t("groups.memberPanel.memberOf", { group: detail.group.name })}
      </p>
      <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
        {t("groups.memberPanel.roles")}
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {rules.isOwner && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
            <FaCrown className="h-3 w-3" />
            {t("common.owner")}
          </span>
        )}
        {held.map((role) => (
          <RoleChip
            key={role.id}
            size="md"
            name={role.name}
            color={role.color}
            onRemove={
              rules.canRoles && role.position < rules.rank && !role.managedBy
                ? () => void change(heldIds.filter((id) => id !== role.id))
                : undefined
            }
          />
        ))}
        {held.length === 0 && !rules.isOwner && missing.length === 0 && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("groups.memberPanel.noRoles")}</span>
        )}
        {missing.length > 0 && (
          <Popover
            open={adding}
            onClose={() => setAdding(false)}
            placement="bottom-start"
            tooltip={t("groups.groupDialogs.giveARole")}
            content={
              <RoleList
                roles={missing}
                onPick={(roleId) => void change([...heldIds, roleId])}
              />
            }
          >
            <button
              type="button"
              onClick={() => setAdding((open) => !open)}
              aria-label={t("groups.groupDialogs.giveARole")}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-dashed border-zinc-300 text-zinc-500 transition hover:border-zinc-500 hover:text-zinc-800 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
            >
              <MdAdd className="h-4 w-4" />
            </button>
          </Popover>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

/** The roles that can still be given, to pick one from. */
function RoleList({
  roles,
  onPick,
}: {
  roles: { id: string; name: string; color: string | null }[];
  onPick: (roleId: string) => void;
}) {
  return (
    <div className="flex max-h-72 w-56 flex-col gap-0.5 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
      {roles.map((role) => (
        <button
          key={role.id}
          type="button"
          onClick={() => onPick(role.id)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: role.color ?? "#99aab5" }} />
          <span className="truncate">{role.name}</span>
        </button>
      ))}
    </div>
  );
}

// ─── The right-click menu ─────────────────────────────────────────────────

/** The one menu for the group's pages, opened by contextPerson. */
export function GroupMemberMenuHost({ detail }: { detail: GroupDetail | null }) {
  const state = useGroupMemberMenu();
  // A zero-size anchor for Tippy; the menu is placed at the pointer through
  // getReferenceClientRect.
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeGroupMemberMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  // Leaving the group's pages (or the group) takes the menu with it.
  useEffect(() => () => closeGroupMemberMenu(), []);

  return (
    <>
      <span ref={setAnchor} aria-hidden className="pointer-events-none fixed left-0 top-0 h-0 w-0" />
      {anchor && (
        <Tippy
          reference={anchor}
          visible={Boolean(state && detail)}
          getReferenceClientRect={() => new DOMRect(state?.x ?? 0, state?.y ?? 0, 0, 0)}
          onClickOutside={closeGroupMemberMenu}
          interactive
          placement="right-start"
          offset={[0, 4]}
          theme="golive-panel"
          animation="shift-away"
          duration={[120, 80]}
          maxWidth="none"
          appendTo={() => document.body}
          content={
            state && detail ? (
              <MemberMenu key={`${state.target.id}:${state.x}:${state.y}`} detail={detail} target={state.target} />
            ) : null
          }
        />
      )}
    </>
  );
}

const menuItem =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-900";
const dangerItem =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-red-600 transition hover:bg-red-500/10 dark:text-red-400";
const menuIcon = "h-4 w-4 shrink-0 opacity-70";

function MenuDivider() {
  return <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />;
}

function MemberMenu({ detail, target }: { detail: GroupDetail; target: GroupProfileTarget }) {
  const t = useT();
  const { account } = useAuth();
  const canMention = useCanMention();
  const controls = useGroupVoiceControls();
  const live = useGroupVoiceLive();
  const groupId = detail.group.id;
  const rules = permissionsOver(detail, target.id, target.guest);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [pendingRoles, setPendingRoles] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState<"kick" | "ban" | "transfer" | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // This listener's own dial for them — only while both are in the call this
  // tab is connected to (see GroupVoiceLivePerson.audio).
  const inCall = live?.people.find((p) => p.userId === target.id) ?? null;
  const audio = controls && inCall?.audio ? inCall.audio : null;
  const selfInCall = rules.self && controls && inCall;
  const color = roleColorOf(detail, { id: target.id, roleIds: rules.roleIds });
  const heldIds = pendingRoles ?? rules.roleIds;

  function act(fn: () => void) {
    fn();
    closeGroupMemberMenu();
  }

  async function toggleRole(roleId: string) {
    const next = heldIds.includes(roleId) ? heldIds.filter((id) => id !== roleId) : [...heldIds, roleId];
    setError(null);
    setPendingRoles(next);
    const failure = await saveRoles(groupId, target.id, next);
    setPendingRoles(null);
    if (failure) setError(failure);
  }

  async function runConfirmed() {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    const result =
      confirm === "kick"
        ? await kickMember(groupId, target.id)
        : confirm === "ban"
          ? await banMember(groupId, target.id)
          : await transferGroup(groupId, target.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    void refreshGroup(groupId);
    closeGroupMemberMenu();
  }

  let body: ReactNode;
  if (confirm) {
    const question =
      confirm === "kick"
        ? t("groups.memberMenu.confirmKick", { name: target.name })
        : confirm === "ban"
          ? t("groups.memberMenu.confirmBan", { name: target.name })
          : t("groups.memberMenu.confirmTransfer", { name: target.name });
    body = (
      <div className="flex flex-col gap-2 p-1.5">
        <p className="text-sm text-zinc-700 dark:text-zinc-200">{question}</p>
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setConfirm(null)}
            className="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runConfirmed()}
            className="cursor-pointer rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            {t("groups.groupDialogs.confirm")}
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <>
        <button type="button" onClick={() => act(() => openGroupProfile(target))} className={menuItem}>
          <MdPersonOutline className={menuIcon} />
          {t("common.viewProfile")}
        </button>
        {canMention && (
          <button type="button" onClick={() => act(() => mentionInComposer(target))} className={menuItem}>
            <MdAlternateEmail className={menuIcon} />
            {t("groups.memberMenu.mention")}
          </button>
        )}
        {!rules.self && !target.guest && account && (
          <button type="button" onClick={() => act(() => openDirectMessages(target.id))} className={menuItem}>
            <MdChatBubbleOutline className={menuIcon} />
            {t("groups.memberMenu.sendMessage")}
          </button>
        )}

        {/* For this listener alone: how loud they are in the call. */}
        {audio && controls && (
          <>
            <MenuDivider />
            <p className="px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t("groups.memberMenu.userVolume")}
            </p>
            <div className="px-2 py-1">
              <VolumeSlider
                value={audio.volume}
                label={t("common.nameSAudioVolume", { name: target.name })}
                onChange={(volume) => controls.setPersonVolume(target.id, volume)}
                muted={audio.muted}
                onToggleMute={() => controls.togglePersonMute(target.id)}
                max={MAX_GAIN}
                className="w-full text-zinc-500 dark:text-zinc-400"
              />
            </div>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={audio.muted}
              onClick={() => controls.togglePersonMute(target.id)}
              className={menuItem}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  audio.muted ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 dark:border-zinc-600"
                }`}
              >
                {audio.muted && <MdCheck className="h-3 w-3" />}
              </span>
              {t("groups.memberMenu.muteForMe")}
            </button>
          </>
        )}
        {selfInCall && controls && (
          <>
            <MenuDivider />
            <button type="button" onClick={() => act(controls.toggleMic)} className={menuItem}>
              {controls.isMicOn ? <MdMicOff className={menuIcon} /> : <MdMic className={menuIcon} />}
              {controls.isMicOn ? t("groups.memberMenu.turnMicOff") : t("groups.memberMenu.turnMicOn")}
            </button>
          </>
        )}

        {/* For the group: roles, and taking somebody out of it. */}
        {rules.assignable.length > 0 && (
          <>
            <MenuDivider />
            <button
              type="button"
              aria-expanded={rolesOpen}
              onClick={() => setRolesOpen((open) => !open)}
              className={menuItem}
            >
              <MdShield className={menuIcon} />
              <span className="flex-1">{t("groups.memberPanel.roles")}</span>
              <MdChevronRight className={`h-4 w-4 shrink-0 opacity-60 transition ${rolesOpen ? "rotate-90" : ""}`} />
            </button>
            {rolesOpen && (
              <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto pl-2">
                {rules.assignable.map((role) => {
                  const on = heldIds.includes(role.id);
                  return (
                    <button
                      key={role.id}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      disabled={pendingRoles !== null}
                      onClick={() => void toggleRole(role.id)}
                      className={menuItem}
                    >
                      <span
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                        style={{
                          borderColor: role.color ?? "#99aab5",
                          backgroundColor: on ? role.color ?? "#99aab5" : "transparent",
                        }}
                      >
                        {on && <MdCheck className="h-3 w-3 text-white" />}
                      </span>
                      <span className="truncate">{role.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
        {(rules.canKick || rules.canBan || rules.canTransfer) && (
          <>
            <MenuDivider />
            {rules.canTransfer && (
              <button type="button" onClick={() => setConfirm("transfer")} className={menuItem}>
                <MdSwapHoriz className={menuIcon} />
                {t("groups.groupDialogs.handOverOwnership")}
              </button>
            )}
            {rules.canKick && (
              <button type="button" onClick={() => setConfirm("kick")} className={dangerItem}>
                <MdPersonRemove className="h-4 w-4 shrink-0" />
                {t("groups.memberMenu.kickName", { name: target.name })}
              </button>
            )}
            {rules.canBan && (
              <button type="button" onClick={() => setConfirm("ban")} className={dangerItem}>
                <MdBlock className="h-4 w-4 shrink-0" />
                {t("groups.memberMenu.banName", { name: target.name })}
              </button>
            )}
          </>
        )}

        <MenuDivider />
        <button
          type="button"
          onClick={() => {
            void copyText(target.id).then((ok) => {
              if (!ok) return;
              setCopied(true);
              setTimeout(closeGroupMemberMenu, 700);
            });
          }}
          className={menuItem}
        >
          <MdContentCopy className={menuIcon} />
          {copied ? t("groups.memberMenu.copied") : t("groups.memberMenu.copyId")}
        </button>
      </>
    );
  }

  return (
    <div
      role="menu"
      className="flex w-60 flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex min-w-0 items-center gap-2 px-2 pb-1.5 pt-1">
        <UserAvatar
          src={target.avatarUrl}
          name={target.name}
          size={28}
          userId={target.guest ? null : target.id}
          isGuest={target.guest}
        />
        <DisplayUserName
          name={target.name}
          isGuest={target.guest}
          color={color}
          className="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"
        />
        {rules.isOwner && <FaCrown className="h-3 w-3 shrink-0 text-amber-500" aria-label={t("common.owner")} />}
      </div>
      {body}
      {error && <p className="px-2 pb-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

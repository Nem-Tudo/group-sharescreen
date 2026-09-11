"use client";

import { useState, type FormEvent } from "react";
import useNtPopups from "ntpopups";
import {
  MdAdd,
  MdCallEnd,
  MdChatBubbleOutline,
  MdCheck,
  MdHeadsetOff,
  MdLock,
  MdLogout,
  MdMic,
  MdMicOff,
  MdMusicNote,
  MdPeopleOutline,
  MdPalette,
  MdPersonAdd,
  MdSettings,
  MdVideocam,
  MdVolumeUp,
} from "react-icons/md";
import { Popover, Tooltip } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import {
  createChannel,
  leaveGroup,
  setGroupNotify,
  type GroupChannelKind,
  type GroupDetail,
  type GroupNotifyLevel,
  type GroupVoiceParticipant,
} from "@/lib/groupsApi";
import { groupPath } from "@/lib/groupLinks";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { canInChannel } from "@/lib/groupPermissions";
import { prefetchChannel } from "@/lib/groupCache";
import { prefetchUserProfile } from "@/lib/userProfile";
import { forgetGroup, refreshGroup, useGroupsState } from "@/lib/useGroups";
import { GroupLink } from "@/components/groups/GroupLink";
import { GroupName } from "@/components/groups/GroupName";
import { openGroupProfile } from "@/components/groups/groupProfile";
import { useOpenChannelSettings } from "@/components/groups/ChannelSettingsDialog";
import {
  setGroupVoiceSession,
  useGroupVoiceControls,
  useGroupVoiceLive,
  useGroupVoiceSession,
  type GroupVoiceLivePerson,
} from "@/lib/groupVoiceSession";
import { useSpeaking } from "@/lib/useSpeaking";
import { playHangUpSound } from "@/lib/soundEffects";
import { useAuth } from "@/lib/AuthContext";
import { hasFeature } from "@/lib/entitlements";
import { openProModal } from "@/lib/proModal";

// The pieces of a group's screen around the conversation itself:
//
//   GroupRoomsPanel — the group's rooms, in a card like the room's participant
//                     list. Voice rooms first and as cards of their own, with
//                     who is in each — being in a call together is what GoLive
//                     is for — and the text rooms as a plain list under them.
//   GroupActions    — invite, settings, notifications, leave: the top bar's
//                     right-hand side.
//   VoiceControls   — the call, from anywhere in the group, drawn like the
//                     room's own mid-call controls.

const NOTIFY_LABELS: Record<GroupNotifyLevel, string> = {
  all: "Todas as mensagens",
  mentions: "Só menções e respostas",
  none: "Nada",
};

const menuItemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-900";

function useOpenSettings(groupId: string) {
  const { openPopup } = useNtPopups();
  return (tab?: string) =>
    void openPopup("group_settings", {
      maxWidth: "min(46rem, calc(100vw - 2rem))",
      width: "min(46rem, calc(100vw - 2rem))",
      maxHeight: "90dvh",
      data: { groupId, tab },
    });
}

// ─── Rooms ───────────────────────────────────────────────────────────────

/**
 * A person in a room you are not in, as the server described them — in the
 * same shape as the call's own (GroupVoiceLivePerson), so one row draws both.
 * Fields an older API does not send read as off; "screen" falls back to
 * "sharing", which is what the row showed before cameras had their own icon.
 */
function fromServerPresence(person: GroupVoiceParticipant): GroupVoiceLivePerson {
  return {
    userId: person.userId,
    name: person.name,
    avatarUrl: person.avatarUrl,
    mic: person.mic,
    deafened: person.deafened ?? false,
    camera: person.camera ?? false,
    screen: person.screen ?? person.sharing,
    micStream: null,
  };
}

/**
 * One person under a voice room: a green ring round their face and their name
 * in green while they are speaking, like the call's own participant list
 * (only ever in the room you are in — nobody else's audio reaches
 * this tab), and what they have on, the way the call's participant list says
 * it. A closed mic and deafened are two icons, side by side when both are true
 * — which is the usual case, since deafening closes the mic.
 */
function VoicePersonRow({ person }: { person: GroupVoiceLivePerson }) {
  const speaking = useSpeaking(person.micStream);
  return (
    <li>
      <button
        type="button"
        onClick={() =>
          openGroupProfile({
            id: person.userId,
            name: person.name,
            avatarUrl: person.avatarUrl,
            guest: person.userId.startsWith("guest:"),
          })
        }
        onMouseEnter={() => prefetchUserProfile(person.userId)}
        title="Ver perfil"
        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
      >
        <span
          className={`flex shrink-0 rounded-full transition-shadow duration-150 ${
            speaking ? "ring-2 ring-emerald-500" : "ring-0 ring-transparent"
          }`}
        >
          <UserAvatar src={person.avatarUrl} name={person.name} size={18} />
        </span>
        <span
          className={`min-w-0 flex-1 truncate transition-colors duration-150 ${
            speaking ? "font-medium text-emerald-600 dark:text-emerald-500" : ""
          }`}
        >
          {person.name}
        </span>
        {person.screen && (
          <span className="shrink-0 rounded bg-red-600 px-1 py-px text-[9px] font-bold uppercase text-white">
            Ao vivo
          </span>
        )}
        {person.camera && (
          <MdVideocam className="h-3.5 w-3.5 shrink-0 opacity-70" title="Câmera ligada" aria-label="Câmera ligada" />
        )}
        {!person.mic && (
          <MdMicOff
            className="h-3.5 w-3.5 shrink-0 opacity-60"
            title="Microfone desligado"
            aria-label="Microfone desligado"
          />
        )}
        {person.deafened && (
          <MdHeadsetOff className="h-3.5 w-3.5 shrink-0 opacity-60" title="Ensurdecido" aria-label="Ensurdecido" />
        )}
      </button>
    </li>
  );
}

export function GroupRoomsPanel({
  detail,
  activeChannelId,
  onNavigate,
  bare = false,
}: {
  detail: GroupDetail;
  activeChannelId: string | null;
  onNavigate?: () => void;
  /** Without the card around it — for the phone's sheet, which is already one. */
  bare?: boolean;
}) {
  const navigation = useGroupNavigation();
  const session = useGroupVoiceSession();
  const live = useGroupVoiceLive();
  const openChannelSettings = useOpenChannelSettings();
  const [addOpen, setAddOpen] = useState(false);
  const [creating, setCreating] = useState<GroupChannelKind | null>(null);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { group, channels, voice, voiceRooms: voiceRoomStates, me } = detail;
  const isManager = me.role === "owner" || me.role === "admin";
  const textRooms = channels.filter((c) => c.kind === "text");
  const voiceRooms = channels.filter((c) => c.kind === "voice");

  function startCreating(kind: GroupChannelKind) {
    setAddOpen(false);
    setCreating(kind);
    setNewName("");
    setCreateError(null);
  }

  async function submitNewRoom(e: FormEvent) {
    e.preventDefault();
    if (!creating || !newName.trim() || busy) return;
    setBusy(true);
    const result = await createChannel(group.id, creating, newName.trim());
    setBusy(false);
    if (!result.ok) {
      setCreateError(result.error);
      return;
    }
    setCreating(null);
    setNewName("");
    setCreateError(null);
    await refreshGroup(group.id);
    // A new text room opens. A new voice room only appears in the list:
    // opening a voice room is joining its call, and making one is not a
    // request to be in it.
    if (result.channel.kind !== "text") return;
    onNavigate?.();
    navigation.push(groupPath(group.id, result.channel.id));
  }

  // The room's own settings — name, permissions, deleting it (see
  // ChannelSettingsDialog). Inside the room's link, so it stops the click
  // from also opening (or joining) the room.
  const editButton = (channelId: string) => (
    <span
      role="button"
      tabIndex={0}
      aria-label="Configurações da sala"
      title="Configurações da sala"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onNavigate?.();
        openChannelSettings(group.id, channelId);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        openChannelSettings(group.id, channelId);
      }}
      className="shrink-0 rounded p-0.5 text-zinc-400 opacity-0 transition hover:text-zinc-800 focus-visible:opacity-100 group-hover/room:opacity-100 dark:hover:text-zinc-200"
    >
      <MdSettings className="h-3.5 w-3.5" />
    </span>
  );

  const content = (
    <div className="flex flex-col gap-4">
      {creating && (
        <form
          onSubmit={submitNewRoom}
          className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {creating === "voice" ? "Nova sala de voz" : "Nova sala de texto"}
          </p>
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setCreating(null);
              }}
              maxLength={32}
              placeholder={creating === "voice" ? "Ex: Jogatina" : "Ex: memes"}
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
            />
            <button
              type="submit"
              disabled={!newName.trim() || busy}
              className="shrink-0 cursor-pointer rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
            >
              Criar
            </button>
          </div>
          {createError && <p className="text-xs text-red-500">{createError}</p>}
          <button
            type="button"
            onClick={() => setCreating(null)}
            className="self-start text-xs text-zinc-500 underline-offset-2 hover:underline"
          >
            Cancelar
          </button>
        </form>
      )}

      <section>
        <p className="mb-1.5 px-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Voz</p>
        <ul className="flex flex-col gap-1.5">
          {voiceRooms.map((channel) => {
            const active = channel.id === activeChannelId;
            const connected = session?.groupId === group.id && session.channelId === channel.id;
            // The room you are in is drawn from the call itself (see
            // lib/groupVoiceSession's GroupVoiceLive) — every change shows
            // the moment it happens, and it is the only room whose speakers
            // can be seen. Every other room, from the server's update.
            const liveRoom = connected && live && live.handle === session?.handle ? live : null;
            const people = liveRoom ? liveRoom.people : (voice[channel.id] ?? []).map(fromServerPresence);
            const music = liveRoom ? liveRoom.music : voiceRoomStates?.[channel.id]?.music ?? null;
            // Without "Conectar" the room is still listed, with who is in it,
            // but its header is not a way in (see lib/groupPermissions). The
            // server refuses the join regardless; this only doesn't offer it.
            // Somebody already in the call keeps their way back to it.
            const locked = !connected && !canInChannel(detail, channel, "connect");
            const headerContent = (
              <>
                {locked ? (
                  <MdLock className="h-4 w-4 shrink-0 text-zinc-400" aria-label="Trancada" />
                ) : (
                  <MdVolumeUp className={`h-4 w-4 shrink-0 ${connected ? "text-emerald-600" : "text-zinc-400"}`} />
                )}
                <span
                  className={`flex min-w-0 flex-1 items-center gap-1 text-sm font-medium ${
                    locked ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  <span className="truncate">{channel.name}</span>
                  {music && (
                    <MdMusicNote
                      className={`h-3.5 w-3.5 shrink-0 ${music.playing ? "text-emerald-600" : "text-zinc-400"}`}
                      title={music.playing ? "Música tocando" : "Música pausada"}
                      aria-label={music.playing ? "Música tocando" : "Música pausada"}
                    />
                  )}
                </span>
                {connected ? (
                  <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white">
                    Você está aqui
                  </span>
                ) : people.length === 0 ? (
                  <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">vazia</span>
                ) : null}
                {isManager && editButton(channel.id)}
              </>
            );
            return (
              <li key={channel.id}>
                <div
                  className={`rounded-lg border transition ${
                    active ? "border-zinc-950 dark:border-zinc-50" : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  {/* Only the room's own header joins it. The people under it
                      are their own targets — a click on somebody is a question
                      about them, not a request to walk into their call. */}
                  {locked ? (
                    <div
                      title="Você não tem permissão para entrar nesta sala"
                      className="group/room flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2"
                    >
                      {headerContent}
                    </div>
                  ) : (
                    <GroupLink
                      href={groupPath(group.id, channel.id)}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={connected ? "Voltar para a chamada" : "Entrar na sala"}
                      className="group/room flex items-center gap-2 rounded-lg px-3 py-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    >
                      {headerContent}
                    </GroupLink>
                  )}
                  {people.length > 0 && (
                    <ul className="flex flex-col gap-0.5 border-t border-zinc-100 px-1.5 py-1.5 dark:border-zinc-800/70">
                      {people.map((person) => (
                        <VoicePersonRow key={person.userId} person={person} />
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
          {voiceRooms.length === 0 && (
            <li className="px-1 text-xs text-zinc-400 dark:text-zinc-500">Nenhuma sala de voz.</li>
          )}
        </ul>
      </section>

      <section>
        <p className="mb-1 px-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Texto</p>
        <ul className="flex flex-col gap-0.5">
          {textRooms.map((channel) => {
            const active = channel.id === activeChannelId;
            return (
              <li key={channel.id}>
                <GroupLink
                  href={groupPath(group.id, channel.id)}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  // Warms the room's messages on the way to the click, so it
                  // usually opens already filled in (see lib/groupCache).
                  onMouseEnter={() => prefetchChannel(group.id, channel.id)}
                  onFocus={() => prefetchChannel(group.id, channel.id)}
                  className={`group/room flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${
                    active
                      ? "bg-zinc-100 font-medium text-zinc-950 dark:bg-zinc-900 dark:text-zinc-50"
                      : channel.unread
                        ? "font-semibold text-zinc-950 hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-900"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                  }`}
                >
                  <MdChatBubbleOutline className="h-4 w-4 shrink-0 opacity-60" />
                  <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                  {!active && channel.mentions > 0 ? (
                    <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                      {channel.mentions}
                    </span>
                  ) : !active && channel.unread ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-950 dark:bg-zinc-50" aria-label="Mensagens novas" />
                  ) : null}
                  {isManager && editButton(channel.id)}
                </GroupLink>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );

  if (bare) return content;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Salas</h2>
        {isManager && (
          <Popover
            open={addOpen}
            onClose={() => setAddOpen(false)}
            placement="bottom-end"
            tooltip="Criar sala"
            content={
              <div className="flex w-48 flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
                <button type="button" onClick={() => startCreating("voice")} className={menuItemClass}>
                  <MdVolumeUp className="h-4 w-4 opacity-70" />
                  Sala de voz
                </button>
                <button type="button" onClick={() => startCreating("text")} className={menuItemClass}>
                  <MdChatBubbleOutline className="h-4 w-4 opacity-70" />
                  Sala de texto
                </button>
              </div>
            }
          >
            <button
              type="button"
              onClick={() => setAddOpen((o) => !o)}
              aria-label="Criar sala"
              className="cursor-pointer rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <MdAdd className="h-4 w-4" />
            </button>
          </Popover>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{content}</div>
    </div>
  );
}

// ─── Group actions (top bar) ─────────────────────────────────────────────

export function GroupActions({ detail }: { detail: GroupDetail }) {
  const navigation = useGroupNavigation();
  const { openPopup } = useNtPopups();
  const session = useGroupVoiceSession();
  const openSettings = useOpenSettings(detail.group.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const { group, me } = detail;
  const { account } = useAuth();
  // The same plan gate as a room's theme — see WatchRoom's hasThemePlan.
  const hasThemePlan = hasFeature("room_theme_set", account?.features ?? []);
  const isManager = me.role === "owner" || me.role === "admin";

  function openInvite() {
    setMenuOpen(false);
    void openPopup("group_invite", { data: { groupId: group.id, groupName: group.name } });
  }

  async function changeNotify(level: GroupNotifyLevel) {
    setMenuOpen(false);
    const result = await setGroupNotify(group.id, level);
    if (result.ok) void refreshGroup(group.id);
  }

  function confirmLeave() {
    setMenuOpen(false);
    void openPopup("confirm", {
      data: {
        title: `Sair de ${group.name}?`,
        message: "Para voltar, você vai precisar de um novo convite.",
        cancelLabel: "Cancelar",
        confirmLabel: "Sair do grupo",
        confirmStyle: "Danger",
        onChoose: async (confirmed: boolean) => {
          if (!confirmed) return;
          const result = await leaveGroup(group.id);
          if (!result.ok) {
            void openPopup("generic", { data: { title: "Não deu", message: result.error } });
            return;
          }
          if (session?.groupId === group.id) setGroupVoiceSession(null);
          forgetGroup(group.id);
          navigation.push("/groups");
        },
      },
    });
  }

  return (
    <>
      {isManager && (
        <button
          type="button"
          onClick={openInvite}
          className="hidden shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 sm:flex dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <MdPersonAdd className="h-4 w-4" />
          <span className="hidden lg:inline">Convidar</span>
        </button>
      )}
      <Popover
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        placement="bottom-end"
        tooltip="Opções do grupo"
        content={
          <div className="flex w-60 flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            {isManager && (
              <button type="button" onClick={openInvite} className={`${menuItemClass} sm:hidden`}>
                <MdPersonAdd className="h-4 w-4 opacity-70" />
                Convidar pessoas
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                openSettings(isManager ? undefined : "members");
              }}
              className={menuItemClass}
            >
              {isManager ? <MdSettings className="h-4 w-4 opacity-70" /> : <MdPeopleOutline className="h-4 w-4 opacity-70" />}
              {isManager ? "Configurações do grupo" : "Membros"}
            </button>
            {isManager && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  // Without the plan it is a way *to* the plan, as in a room.
                  if (!hasThemePlan) {
                    openProModal("premium_max");
                    return;
                  }
                  void openPopup("room_theme", {
                    data: { currentThemeId: group.theme, groupId: group.id },
                  });
                }}
                className={menuItemClass}
              >
                <MdPalette className="h-4 w-4 opacity-70" />
                <span className="flex-1">Tema do grupo</span>
                {!hasThemePlan && (
                  <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">PRO MAX</span>
                )}
              </button>
            )}
            <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
            <p className="px-2 pb-0.5 pt-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Notificações</p>
            {(Object.keys(NOTIFY_LABELS) as GroupNotifyLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => void changeNotify(level)}
                disabled={me.guest}
                className={menuItemClass}
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  {me.notify === level && <MdCheck className="h-4 w-4 text-emerald-600" />}
                </span>
                {NOTIFY_LABELS[level]}
              </button>
            ))}
            {me.guest && (
              <p className="px-2 pb-1 text-xs text-zinc-500 dark:text-zinc-400">
                Notificações no celular precisam de uma conta.
              </p>
            )}
            {me.role !== "owner" && (
              <>
                <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
                <button type="button" onClick={confirmLeave} className={`${menuItemClass} text-red-600 dark:text-red-500`}>
                  <MdLogout className="h-4 w-4" />
                  Sair do grupo
                </button>
              </>
            )}
          </div>
        }
      >
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Opções do grupo"
          className="flex shrink-0 cursor-pointer items-center justify-center rounded-lg p-2 text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          <MdSettings className="h-5 w-5" />
        </button>
      </Popover>
    </>
  );
}

// ─── The call (top bar) ──────────────────────────────────────────────────

/**
 * The call, from anywhere in the group: which room it is in (click to go back
 * to it), the microphone, and hanging up. The same grey tray and red button as
 * the room's own mid-call controls. Renders nothing while not connected.
 */
export function VoiceControls({ className = "" }: { className?: string }) {
  const navigation = useGroupNavigation();
  const session = useGroupVoiceSession();
  const controls = useGroupVoiceControls();
  // The group's flags, for its badge — the session carries only the name.
  const groupsState = useGroupsState();
  if (!session) return null;
  const sessionFlags = groupsState.details[session.groupId]?.group.flags;
  return (
    <div
      className={`flex items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <GroupLink
        href={groupPath(session.groupId, session.channelId)}
        title="Voltar para a chamada"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition hover:bg-white dark:hover:bg-zinc-800"
      >
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{session.channelName}</span>
        <span className="hidden min-w-0 items-center gap-1 text-zinc-500 xl:inline-flex dark:text-zinc-400">
          <span className="shrink-0">·</span>
          <GroupName name={session.groupName} flags={sessionFlags} badgeClassName="h-3.5 w-3.5" />
        </span>
      </GroupLink>
      {controls && (
        <Tooltip content={controls.isMicOn ? "Desligar microfone" : "Ligar microfone"}>
          <button
            type="button"
            onClick={controls.toggleMic}
            aria-label={controls.isMicOn ? "Desligar microfone" : "Ligar microfone"}
            className={`flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition ${
              controls.isMicOn
                ? "bg-white text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                : "bg-red-600/10 text-red-600 hover:bg-red-600/20 dark:text-red-500"
            }`}
          >
            {controls.isMicOn ? <MdMic className="h-5 w-5" /> : <MdMicOff className="h-5 w-5" />}
          </button>
        </Tooltip>
      )}
      <Tooltip content="Sair da chamada">
        <button
          type="button"
          onClick={() => {
            playHangUpSound();
            const wasOnCall =
              typeof window !== "undefined" &&
              window.location.pathname === groupPath(session.groupId, session.channelId);
            setGroupVoiceSession(null);
            if (wasOnCall) navigation.push(groupPath(session.groupId));
          }}
          aria-label="Sair da chamada"
          className="flex h-8 shrink-0 cursor-pointer items-center rounded-lg bg-red-600 px-2.5 text-white transition hover:bg-red-700"
        >
          <MdCallEnd className="h-5 w-5" />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Which room the call is in, as the way back to it — beside the call's own
 * controls in the top bar while something else in the group is on screen (the
 * controls themselves are the room's, portalled in; see WatchRoom's
 * inHeaderSlot). Renders nothing while not connected.
 */
export function VoiceCallLink() {
  const session = useGroupVoiceSession();
  if (!session) return null;
  return (
    <Tooltip content={`Voltar para a chamada · ${session.groupName}`} placement="bottom">
      <GroupLink
        href={groupPath(session.groupId, session.channelId)}
        aria-label={`Voltar para a chamada em ${session.channelName}`}
        className="flex max-w-[12rem] shrink-0 items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
        <MdVolumeUp className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{session.channelName}</span>
      </GroupLink>
    </Tooltip>
  );
}

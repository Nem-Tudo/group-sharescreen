"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import useNtPopups from "ntpopups";
import {
  MdAdd,
  MdCallEnd,
  MdCheck,
  MdExpandMore,
  MdLogout,
  MdMic,
  MdMicOff,
  MdNotifications,
  MdPersonAdd,
  MdSettings,
  MdTag,
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
} from "@/lib/groupsApi";
import { groupPath } from "@/lib/groupLinks";
import { forgetGroup, refreshGroup } from "@/lib/useGroups";
import {
  setGroupVoiceSession,
  useGroupVoiceControls,
  useGroupVoiceSession,
} from "@/lib/groupVoiceSession";
import { playHangUpSound } from "@/lib/soundEffects";

// The middle column: the open group's name and menu, its text rooms, its voice
// rooms with whoever is in each, and — while connected — the voice dock that
// keeps the call reachable from anywhere in the group.

const NOTIFY_LABELS: Record<GroupNotifyLevel, string> = {
  all: "Todas as mensagens",
  mentions: "Só menções e respostas",
  none: "Nada",
};

export function GroupSidebar({
  detail,
  activeChannelId,
  onNavigate,
}: {
  detail: GroupDetail;
  activeChannelId: string | null;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { openPopup } = useNtPopups();
  const session = useGroupVoiceSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState<GroupChannelKind | null>(null);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { group, channels, voice, me } = detail;
  const isManager = me.role === "owner" || me.role === "admin";
  const textRooms = channels.filter((c) => c.kind === "text");
  const voiceRooms = channels.filter((c) => c.kind === "voice");

  function openSettings(tab?: string) {
    setMenuOpen(false);
    onNavigate?.();
    void openPopup("group_settings", {
      maxWidth: "min(46rem, calc(100vw - 2rem))",
      width: "min(46rem, calc(100vw - 2rem))",
      maxHeight: "90dvh",
      data: { groupId: group.id, tab },
    });
  }

  function openInvite() {
    setMenuOpen(false);
    onNavigate?.();
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
        icon: "🚪",
        onChoose: async (confirmed: boolean) => {
          if (!confirmed) return;
          const result = await leaveGroup(group.id);
          if (!result.ok) {
            void openPopup("generic", { data: { title: "Não deu", message: result.error, icon: "⚠️" } });
            return;
          }
          if (session?.groupId === group.id) setGroupVoiceSession(null);
          forgetGroup(group.id);
          router.push("/groups");
        },
      },
    });
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
    onNavigate?.();
    router.push(groupPath(group.id, result.channel.id));
  }

  function sectionHeader(label: string, kind: GroupChannelKind) {
    return (
      <div className="mt-4 flex items-center justify-between px-2 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
        {isManager && (
          <Tooltip content={kind === "text" ? "Criar sala de texto" : "Criar sala de voz"}>
            <button
              type="button"
              onClick={() => {
                setCreating(creating === kind ? null : kind);
                setNewName("");
                setCreateError(null);
              }}
              aria-label={kind === "text" ? "Criar sala de texto" : "Criar sala de voz"}
              className="cursor-pointer rounded p-0.5 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <MdAdd className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>
    );
  }

  function newRoomForm(kind: GroupChannelKind) {
    if (creating !== kind) return null;
    return (
      <form onSubmit={submitNewRoom} className="mb-1 flex flex-col gap-1 px-1">
        <div className="flex gap-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setCreating(null);
            }}
            maxLength={32}
            placeholder={kind === "text" ? "nova-sala" : "Nova sala de voz"}
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={!newName.trim() || busy}
            aria-label="Criar"
            className="cursor-pointer rounded-md bg-emerald-600 px-2 text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MdCheck className="h-4 w-4" />
          </button>
        </div>
        {createError && <p className="px-1 text-xs text-red-500">{createError}</p>}
      </form>
    );
  }

  const rowBase =
    "group/row flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[15px] transition";

  return (
    <div className="flex h-full w-full flex-col bg-zinc-50 dark:bg-zinc-900">
      {/* The group's name, and everything about the group as a whole. */}
      <Popover
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        placement="bottom-start"
        offset={[8, 4]}
        content={
          <div className="flex w-60 flex-col gap-0.5 p-1.5 text-sm">
            {isManager && (
              <button type="button" onClick={openInvite} className={menuItemClass}>
                <MdPersonAdd className="h-4 w-4 text-indigo-500" />
                Convidar pessoas
              </button>
            )}
            <button type="button" onClick={() => openSettings()} className={menuItemClass}>
              <MdSettings className="h-4 w-4 opacity-70" />
              {isManager ? "Configurações do grupo" : "Membros do grupo"}
            </button>
            <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
            <p className="flex items-center gap-2 px-2 pb-0.5 pt-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              <MdNotifications className="h-3.5 w-3.5" />
              Notificações
            </p>
            {(Object.keys(NOTIFY_LABELS) as GroupNotifyLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => void changeNotify(level)}
                disabled={me.guest}
                className={`${menuItemClass} disabled:cursor-not-allowed disabled:opacity-50`}
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
                <button
                  type="button"
                  onClick={confirmLeave}
                  className={`${menuItemClass} text-red-600 dark:text-red-500`}
                >
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
          onClick={() => setMenuOpen((open) => !open)}
          className="flex h-12 w-full shrink-0 cursor-pointer items-center justify-between gap-2 border-b border-black/5 px-3 text-left transition hover:bg-zinc-200/60 dark:border-white/5 dark:hover:bg-zinc-900"
        >
          <span className="truncate font-semibold text-zinc-950 dark:text-zinc-50">{group.name}</span>
          <MdExpandMore
            className={`h-5 w-5 shrink-0 text-zinc-500 transition-transform ${menuOpen ? "rotate-180" : ""}`}
          />
        </button>
      </Popover>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isManager && (
          <button
            type="button"
            onClick={openInvite}
            className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            <MdPersonAdd className="h-4 w-4" />
            Convidar pessoas
          </button>
        )}

        {sectionHeader("Salas de texto", "text")}
        {newRoomForm("text")}
        {textRooms.map((channel) => {
          const active = channel.id === activeChannelId;
          return (
            <Link
              key={channel.id}
              href={groupPath(group.id, channel.id)}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`${rowBase} ${
                active
                  ? "bg-zinc-200 font-medium text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50"
                  : channel.unread
                    ? "font-semibold text-zinc-950 hover:bg-zinc-200/70 dark:text-zinc-50 dark:hover:bg-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              <MdTag className="h-5 w-5 shrink-0 opacity-60" />
              <span className="min-w-0 flex-1 truncate">{channel.name}</span>
              {channel.mentions > 0 && !active && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                  {channel.mentions}
                </span>
              )}
              {isManager && (
                <Tooltip content="Editar sala">
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Editar sala"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openSettings("channels");
                    }}
                    className="hidden rounded p-0.5 text-zinc-500 hover:text-zinc-900 group-hover/row:block dark:hover:text-zinc-100"
                  >
                    <MdSettings className="h-3.5 w-3.5" />
                  </span>
                </Tooltip>
              )}
            </Link>
          );
        })}

        {sectionHeader("Salas de voz", "voice")}
        {newRoomForm("voice")}
        {voiceRooms.map((channel) => {
          const active = channel.id === activeChannelId;
          const connected = session?.groupId === group.id && session.channelId === channel.id;
          const people = voice[channel.id] ?? [];
          return (
            <div key={channel.id}>
              <Link
                href={groupPath(group.id, channel.id)}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`${rowBase} ${
                  active
                    ? "bg-zinc-200 font-medium text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                <MdVolumeUp className={`h-5 w-5 shrink-0 ${connected ? "text-emerald-600" : "opacity-60"}`} />
                <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                {people.length > 0 && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{people.length}</span>
                )}
                {isManager && (
                  <Tooltip content="Editar sala">
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Editar sala"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openSettings("channels");
                      }}
                      className="hidden rounded p-0.5 text-zinc-500 hover:text-zinc-900 group-hover/row:block dark:hover:text-zinc-100"
                    >
                      <MdSettings className="h-3.5 w-3.5" />
                    </span>
                  </Tooltip>
                )}
              </Link>
              {people.length > 0 && (
                <ul className="mb-1 ml-7 flex flex-col gap-0.5">
                  {people.map((person) => (
                    <li
                      key={person.userId}
                      className="flex items-center gap-2 rounded px-1.5 py-0.5 text-sm text-zinc-600 dark:text-zinc-400"
                    >
                      <UserAvatar
                        src={person.avatarUrl}
                        name={person.name}
                        size={20}
                        className={person.mic ? "ring-2 ring-emerald-500/60" : ""}
                      />
                      <span className="min-w-0 flex-1 truncate">{person.name}</span>
                      {person.sharing && (
                        <span className="rounded bg-red-600 px-1 text-[10px] font-bold uppercase text-white">
                          Ao vivo
                        </span>
                      )}
                      {!person.mic && <MdMicOff className="h-3.5 w-3.5 shrink-0 opacity-60" aria-label="Microfone desligado" />}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <VoiceDock onNavigate={onNavigate} />
    </div>
  );
}

const menuItemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800";

/**
 * The call, from anywhere in the group: which room it is in, the microphone,
 * and hanging up. Clicking the room name goes back to the call's own screen.
 * Renders nothing while not connected.
 */
export function VoiceDock({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const session = useGroupVoiceSession();
  const controls = useGroupVoiceControls();
  if (!session) return null;
  return (
    <div className="shrink-0 border-t border-black/5 bg-zinc-100 px-2 py-2 dark:border-white/5 dark:bg-zinc-950">
      <div className="flex items-center gap-2">
        <Link
          href={groupPath(session.groupId, session.channelId)}
          onClick={onNavigate}
          className="min-w-0 flex-1 rounded-md px-1.5 py-1 transition hover:bg-zinc-200 dark:hover:bg-zinc-900"
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            Voz conectada
          </p>
          <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">
            {session.channelName} · {session.groupName}
          </p>
        </Link>
        {controls && (
          <Tooltip content={controls.isMicOn ? "Desligar microfone" : "Ligar microfone"}>
            <button
              type="button"
              onClick={controls.toggleMic}
              aria-label={controls.isMicOn ? "Desligar microfone" : "Ligar microfone"}
              className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition ${
                controls.isMicOn
                  ? "text-zinc-700 hover:bg-zinc-200 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  : "bg-red-600/10 text-red-600 hover:bg-red-600/20 dark:text-red-500"
              }`}
            >
              {controls.isMicOn ? <MdMic className="h-5 w-5" /> : <MdMicOff className="h-5 w-5" />}
            </button>
          </Tooltip>
        )}
        <Tooltip content="Desconectar">
          <button
            type="button"
            onClick={() => {
              playHangUpSound();
              const wasOnCall =
                typeof window !== "undefined" &&
                window.location.pathname === groupPath(session.groupId, session.channelId);
              setGroupVoiceSession(null);
              if (wasOnCall) router.push(groupPath(session.groupId));
            }}
            aria-label="Desconectar"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-red-600 transition hover:bg-red-600/10 dark:text-red-500"
          >
            <MdCallEnd className="h-5 w-5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

"use client";

import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import useNtPopups from "ntpopups";
import {
  MdAdd,
  MdCallEnd,
  MdChatBubbleOutline,
  MdCheck,
  MdCreateNewFolder,
  MdDeleteOutline,
  MdEdit,
  MdExpandMore,
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
  createCategory,
  createChannel,
  deleteCategory,
  leaveGroup,
  renameCategory,
  setGroupLayout,
  setGroupNotify,
  type GroupCategory,
  type GroupChannel,
  type GroupChannelKind,
  type GroupDetail,
  type GroupNotifyLevel,
  type GroupVoiceParticipant,
} from "@/lib/groupsApi";
import { groupPath } from "@/lib/groupLinks";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { canInChannel, canManage, managesAnything, roleColorOf } from "@/lib/groupPermissions";
import { prefetchChannel } from "@/lib/groupCache";
import { prefetchUserProfile } from "@/lib/userProfile";
import { forgetGroup, patchGroupDetail, refreshGroup, useGroupsState } from "@/lib/useGroups";
import { useCollapsedCategories } from "@/lib/groupCollapse";
import {
  applySections,
  buildSections,
  dropOnChannel,
  moveCategory,
  moveChannel,
  toPayload,
  type LayoutSection,
} from "@/lib/groupLayout";
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
import { VolumeSlider } from "@/components/VolumeSlider";
import { MAX_GAIN } from "@/lib/audioGain";
import { callNameFor, callPathFor, endCall, useCallSession } from "@/lib/callSession";
import { playHangUpSound } from "@/lib/soundEffects";
import { useAuth } from "@/lib/AuthContext";
import { hasFeature } from "@/lib/entitlements";
import { openProModal } from "@/lib/proModal";

// The pieces of a group's screen around the conversation itself:
//
//   GroupRoomsPanel — the group's rooms, in a card like the room's participant
//                     list: the rooms without a category, then each category
//                     (folded away or open, remembered per browser). In each,
//                     voice rooms first and as cards of their own, with who
//                     is in each — being in a call together is what GoLive is
//                     for — and the text rooms as a plain list under them.
//                     The owner and admins drag rooms and categories around.
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
const VoicePersonRow = memo(function VoicePersonRow({
  person,
  color = null,
}: {
  person: GroupVoiceLivePerson;
  color?: string | null;
}) {
  const speaking = useSpeaking(person.micStream);
  // Only for somebody else in the room you are in (see
  // GroupVoiceLivePerson.audio) — and only once the call has published how to
  // change it.
  const controls = useGroupVoiceControls();
  const audio = controls ? person.audio : undefined;
  return (
    // The profile link and the volume sit side by side rather than one inside
    // the other: the slider has buttons of its own, and a button inside a
    // button is not something a browser will build.
    <li className="flex items-center gap-0.5">
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
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
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
          // Their highest coloured role's colour — green wins while they speak.
          style={!speaking && color ? { color } : undefined}
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
      {/* This listener's own dial for them — the same control, and the same
          saved value, as the participant list's (see ParticipantRow). */}
      {audio && controls && (
        <VolumeSlider
          value={audio.volume}
          label={`Volume do áudio de ${person.name}`}
          onChange={(volume) => controls.setPersonVolume(person.userId, volume)}
          muted={audio.muted}
          onToggleMute={() => controls.togglePersonMute(person.userId)}
          collapseOnIdle
          max={MAX_GAIN}
          className="shrink-0 text-zinc-400 dark:text-zinc-500"
        />
      )}
    </li>
  );
});

/** What is being dragged in the rooms list, and where it would land. */
type RoomDrag = { type: "channel"; id: string } | { type: "category"; id: string };
type DropHint =
  | { type: "before" | "after"; channelId: string }
  | { type: "into"; categoryId: string | null }
  | { type: "category-before" | "category-after"; categoryId: string }
  | { type: "categories-top" };

// The line a drop would land on — drawn at the top or bottom edge of a row.
const dropLine = "pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-emerald-500";

// How many rooms the card always has room for, however much the ad under it
// would like — see onMinHeight.
const MIN_VISIBLE_ROOMS = 5;

export function GroupRoomsPanel({
  detail,
  activeChannelId,
  onNavigate,
  onMinHeight,
  bare = false,
}: {
  detail: GroupDetail;
  activeChannelId: string | null;
  onNavigate?: () => void;
  /**
   * How tall the card has to be to show its first MIN_VISIBLE_ROOMS rooms (all
   * of them, when there are fewer), told again whenever that changes — for the
   * shell, which keeps the ad under the card from taking that space.
   */
  onMinHeight?: (px: number) => void;
  /** Without the card around it — for the phone's sheet, which is already one. */
  bare?: boolean;
}) {
  const navigation = useGroupNavigation();
  const { openPopup } = useNtPopups();
  const session = useGroupVoiceSession();
  const live = useGroupVoiceLive();
  const openChannelSettings = useOpenChannelSettings();
  const [addOpen, setAddOpen] = useState(false);
  // What the inline form is making, and where: a room of a kind in a
  // category (null for none), or a category.
  const [creating, setCreating] = useState<{ kind: GroupChannelKind | "category"; categoryId: string | null } | null>(
    null
  );
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A category's "+" menu, its options menu, and the one being renamed.
  const [categoryAddOpen, setCategoryAddOpen] = useState<string | null>(null);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [drag, setDrag] = useState<RoomDrag | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);

  const { group, channels, voice, voiceRooms: voiceRoomStates } = detail;
  // Creating, renaming, moving and configuring rooms — "Gerenciar salas".
  const isManager = canManage(detail, "manageChannels");
  const { collapsed, toggle: toggleCollapsed } = useCollapsedCategories(group.id);
  const sections = useMemo(() => buildSections(channels, detail.categories ?? []), [channels, detail.categories]);
  const hasCategories = sections.length > 1;

  // What onMinHeight reports: down to the bottom of the fifth room's own row —
  // its name, not the people under it, though the people in the rooms above
  // it do count — plus the card's header, padding and border. Read in the
  // list's own coordinates (the scroll added back), so neither scrolling nor
  // the height the card ends up with moves it. Rooms folded away in a
  // category are not drawn, and so are not counted.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    const card = scroller?.parentElement;
    const list = scroller?.firstElementChild;
    if (!onMinHeight || !scroller || !card || !list) return;
    const measure = () => {
      const rows = list.querySelectorAll("[data-room-head]");
      const last = rows[Math.min(rows.length, MIN_VISIBLE_ROOMS) - 1];
      if (!last) {
        onMinHeight(0);
        return;
      }
      const rowBottom = last.getBoundingClientRect().bottom - card.getBoundingClientRect().top + scroller.scrollTop;
      // The card's top border standing in for its bottom one: the same line.
      const below = parseFloat(getComputedStyle(scroller).paddingBottom) + card.clientTop;
      onMinHeight(Math.ceil(rowBottom + below));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      observer.disconnect();
      onMinHeight(0);
    };
  }, [onMinHeight]);

  function startCreating(kind: GroupChannelKind | "category", categoryId: string | null = null) {
    setAddOpen(false);
    setCategoryAddOpen(null);
    setCreating({ kind, categoryId });
    setNewName("");
    setCreateError(null);
    // Making a room in a folded category unfolds it, so the room is seen landing.
    if (categoryId && collapsed.includes(categoryId)) toggleCollapsed(categoryId);
  }

  async function submitNew(e: FormEvent) {
    e.preventDefault();
    if (!creating || !newName.trim() || busy) return;
    setBusy(true);
    if (creating.kind === "category") {
      const result = await createCategory(group.id, newName.trim());
      setBusy(false);
      if (!result.ok) {
        setCreateError(result.error);
        return;
      }
      setCreating(null);
      setNewName("");
      await refreshGroup(group.id);
      return;
    }
    const result = await createChannel(group.id, creating.kind, newName.trim(), creating.categoryId);
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

  async function submitRename(e: FormEvent) {
    e.preventDefault();
    if (!renaming || !renaming.draft.trim()) return;
    const { id, draft } = renaming;
    setRenaming(null);
    const result = await renameCategory(group.id, id, draft.trim());
    if (!result.ok) setLayoutError(result.error);
    await refreshGroup(group.id);
  }

  function confirmDeleteCategory(category: GroupCategory) {
    setCategoryMenuOpen(null);
    void openPopup("confirm", {
      data: {
        title: `Apagar a categoria ${category.name}?`,
        message: "As salas dela não são apagadas: elas vão para o topo da lista, sem categoria.",
        cancelLabel: "Cancelar",
        confirmLabel: "Apagar categoria",
        confirmStyle: "Danger",
        onChoose: async (confirmed: boolean) => {
          if (!confirmed) return;
          const result = await deleteCategory(group.id, category.id);
          if (!result.ok) setLayoutError(result.error);
          await refreshGroup(group.id);
        },
      },
    });
  }

  // ── Dragging (owner and admins) ────────────────────────────────────────
  //
  // The browser's own drag and drop: a room or a category is picked up, the
  // list shows where it would land, and letting go rearranges the list here at
  // once and tells the server the whole new arrangement (see lib/groupLayout).

  function showHint(next: DropHint) {
    setHint((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }

  function endDrag() {
    setDrag(null);
    setHint(null);
  }

  function commitLayout(next: LayoutSection[]) {
    endDrag();
    const applied = applySections(next);
    patchGroupDetail(group.id, applied);
    setLayoutError(null);
    void setGroupLayout(group.id, toPayload(next)).then((result) => {
      if (result.ok) return;
      setLayoutError(result.error);
      void refreshGroup(group.id);
    });
  }

  function dropChannel(targetCategoryId: string | null, beforeId: string | null) {
    if (drag?.type !== "channel") return;
    commitLayout(moveChannel(sections, drag.id, targetCategoryId, beforeId));
  }

  function dropCategory(beforeId: string | null) {
    if (drag?.type !== "category") return;
    commitLayout(moveCategory(sections, drag.id, beforeId));
  }

  /** What makes a room a thing to pick up and to drop another room on. */
  function channelDragProps(channel: GroupChannel) {
    if (!isManager) return {};
    return {
      draggable: true,
      onDragStart: (e: DragEvent<HTMLLIElement>) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        // Firefox starts no drag without some data on it.
        e.dataTransfer.setData("text/plain", channel.id);
        setDrag({ type: "channel", id: channel.id });
      },
      onDragEnd: endDrag,
      onDragOver: (e: DragEvent<HTMLLIElement>) => {
        // A category being dragged is the section's business, not the row's.
        if (drag?.type !== "channel") return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        const rect = e.currentTarget.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        showHint({ type: after ? "after" : "before", channelId: channel.id });
      },
      onDrop: (e: DragEvent<HTMLLIElement>) => {
        if (drag?.type !== "channel") return;
        e.preventDefault();
        e.stopPropagation();
        const dragged = channels.find((c) => c.id === drag.id);
        if (!dragged || dragged.id === channel.id) {
          endDrag();
          return;
        }
        const rect = e.currentTarget.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        const target = dropOnChannel(sections, dragged, channel, after);
        dropChannel(target.categoryId, target.beforeId);
      },
    };
  }

  /** What makes a section a place to drop a room into, or a category beside. */
  function sectionDropProps(category: GroupCategory | null) {
    if (!isManager) return {};
    const categoryId = category?.id ?? null;
    const categoryPlace = (e: DragEvent<HTMLElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      return e.clientY > rect.top + rect.height / 2 ? "after" : "before";
    };
    return {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!drag) return;
        if (drag.type === "category" && category?.id === drag.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (drag.type === "channel") showHint({ type: "into", categoryId });
        else if (!category) showHint({ type: "categories-top" });
        else showHint({ type: categoryPlace(e) === "after" ? "category-after" : "category-before", categoryId: category.id });
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        if (!drag) return;
        e.preventDefault();
        if (drag.type === "channel") {
          dropChannel(categoryId, null);
          return;
        }
        if (!category) {
          // Dropped on the uncategorised rooms: the top of the categories.
          dropCategory(sections[1]?.category?.id ?? null);
          return;
        }
        if (category.id === drag.id) return endDrag();
        const index = sections.findIndex((s) => s.category?.id === category.id);
        const beforeId =
          categoryPlace(e) === "after" ? sections[index + 1]?.category?.id ?? null : category.id;
        dropCategory(beforeId);
      },
    };
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

  const edgeLine = (channelId: string) =>
    hint && (hint.type === "before" || hint.type === "after") && hint.channelId === channelId ? (
      <span className={`${dropLine} ${hint.type === "before" ? "-top-1" : "-bottom-1"}`} />
    ) : null;

  function renderVoiceRoom(channel: GroupChannel) {
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
      <li
        key={channel.id}
        className={`relative ${drag?.type === "channel" && drag.id === channel.id ? "opacity-40" : ""}`}
        {...channelDragProps(channel)}
      >
        {edgeLine(channel.id)}
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
              data-room-head
              className="group/room flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2"
            >
              {headerContent}
            </div>
          ) : (
            <GroupLink
              href={groupPath(group.id, channel.id)}
              onClick={onNavigate}
              // The row is what is dragged, not the link inside it.
              draggable={isManager ? false : undefined}
              aria-current={active ? "page" : undefined}
              title={connected ? "Voltar para a chamada" : "Entrar na sala"}
              data-room-head
              className="group/room flex items-center gap-2 rounded-lg px-3 py-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              {headerContent}
            </GroupLink>
          )}
          {people.length > 0 && (
            <ul className="flex flex-col gap-0.5 border-t border-zinc-100 px-1.5 py-1.5 dark:border-zinc-800/70">
              {people.map((person) => (
                <VoicePersonRow key={person.userId} person={person} color={roleColorOf(detail, { id: person.userId })} />
              ))}
            </ul>
          )}
        </div>
      </li>
    );
  }

  function renderTextRoom(channel: GroupChannel) {
    const active = channel.id === activeChannelId;
    return (
      <li
        key={channel.id}
        className={`relative ${drag?.type === "channel" && drag.id === channel.id ? "opacity-40" : ""}`}
        {...channelDragProps(channel)}
      >
        {edgeLine(channel.id)}
        <GroupLink
          href={groupPath(group.id, channel.id)}
          onClick={onNavigate}
          draggable={isManager ? false : undefined}
          aria-current={active ? "page" : undefined}
          // Warms the room's messages on the way to the click, so it
          // usually opens already filled in (see lib/groupCache).
          onMouseEnter={() => prefetchChannel(group.id, channel.id)}
          onFocus={() => prefetchChannel(group.id, channel.id)}
          data-room-head
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
  }

  const creationForm = creating && (
    <form
      onSubmit={submitNew}
      className="mb-1.5 flex flex-col gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {creating.kind === "category"
          ? "Nova categoria"
          : creating.kind === "voice"
            ? "Nova sala de voz"
            : "Nova sala de texto"}
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
          placeholder={creating.kind === "category" ? "Ex: Jogos" : creating.kind === "voice" ? "Ex: Jogatina" : "Ex: memes"}
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
  );

  /** The heading of a category: fold it, and — for managers — add a room to it or change it. */
  function categoryHeader(category: GroupCategory, isCollapsed: boolean) {
    const intoHere = hint?.type === "into" && hint.categoryId === category.id;
    return (
      <div
        className={`group/cat flex items-center gap-1 rounded-md px-1 py-1 transition ${
          intoHere ? "bg-emerald-50 ring-1 ring-emerald-500/60 dark:bg-emerald-950/40" : ""
        }`}
        draggable={isManager && renaming?.id !== category.id}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", category.id);
          setDrag({ type: "category", id: category.id });
        }}
        onDragEnd={endDrag}
      >
        {renaming?.id === category.id ? (
          <form onSubmit={submitRename} className="flex min-w-0 flex-1 gap-1">
            <input
              autoFocus
              value={renaming.draft}
              onChange={(e) => setRenaming({ id: category.id, draft: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape") setRenaming(null);
              }}
              onBlur={() => setRenaming(null)}
              maxLength={32}
              className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => toggleCollapsed(category.id)}
            aria-expanded={!isCollapsed}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-0.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <MdExpandMore className={`h-3.5 w-3.5 shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
            <span className="truncate">{category.name}</span>
          </button>
        )}
        {isManager && renaming?.id !== category.id && (
          <>
            <Popover
              open={categoryMenuOpen === category.id}
              onClose={() => setCategoryMenuOpen(null)}
              placement="bottom-end"
              tooltip="Editar categoria"
              content={
                <div className="flex w-48 flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryMenuOpen(null);
                      setRenaming({ id: category.id, draft: category.name });
                    }}
                    className={menuItemClass}
                  >
                    <MdEdit className="h-4 w-4 opacity-70" />
                    Renomear
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmDeleteCategory(category)}
                    className={`${menuItemClass} text-red-600 dark:text-red-400`}
                  >
                    <MdDeleteOutline className="h-4 w-4" />
                    Apagar categoria
                  </button>
                </div>
              }
            >
              <button
                type="button"
                onClick={() => setCategoryMenuOpen((open) => (open === category.id ? null : category.id))}
                aria-label="Editar categoria"
                className="shrink-0 cursor-pointer rounded p-0.5 text-zinc-400 opacity-0 transition hover:text-zinc-800 focus-visible:opacity-100 group-hover/cat:opacity-100 dark:hover:text-zinc-200"
              >
                <MdSettings className="h-3.5 w-3.5" />
              </button>
            </Popover>
            <Popover
              open={categoryAddOpen === category.id}
              onClose={() => setCategoryAddOpen(null)}
              placement="bottom-end"
              tooltip="Criar sala nesta categoria"
              content={
                <div className="flex w-48 flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
                  <button type="button" onClick={() => startCreating("voice", category.id)} className={menuItemClass}>
                    <MdVolumeUp className="h-4 w-4 opacity-70" />
                    Sala de voz
                  </button>
                  <button type="button" onClick={() => startCreating("text", category.id)} className={menuItemClass}>
                    <MdChatBubbleOutline className="h-4 w-4 opacity-70" />
                    Sala de texto
                  </button>
                </div>
              }
            >
              <button
                type="button"
                onClick={() => setCategoryAddOpen((open) => (open === category.id ? null : category.id))}
                aria-label={`Criar sala em ${category.name}`}
                className="shrink-0 cursor-pointer rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <MdAdd className="h-4 w-4" />
              </button>
            </Popover>
          </>
        )}
      </div>
    );
  }

  function renderSection(section: LayoutSection) {
    const category = section.category;
    const isCollapsed = Boolean(category && collapsed.includes(category.id));
    // A folded category still shows the room on screen and the call you are
    // in, the way Discord keeps them — folding tidies the list, it does not
    // hide where you are.
    const isConnected = (c: GroupChannel) => session?.groupId === group.id && session.channelId === c.id;
    const voiceShown = isCollapsed
      ? section.voice.filter((c) => c.id === activeChannelId || isConnected(c))
      : section.voice;
    const textShown = isCollapsed ? section.text.filter((c) => c.id === activeChannelId) : section.text;
    const empty = section.voice.length === 0 && section.text.length === 0;
    const creatingHere = creating && creating.kind !== "category" && creating.categoryId === (category?.id ?? null);
    // Nothing to draw for the uncategorised rooms when there are none — except
    // somewhere to drop a room while one is being dragged out of a category.
    if (!category && empty && !creatingHere && drag?.type !== "channel") return null;
    const categoryEdge =
      hint &&
      (hint.type === "category-before" || hint.type === "category-after") &&
      category &&
      hint.categoryId === category.id
        ? hint.type
        : null;
    const intoRoot = !category && hint?.type === "into" && hint.categoryId === null;
    return (
      <section
        key={category?.id ?? "root"}
        className={`relative ${drag?.type === "category" && drag.id === category?.id ? "opacity-40" : ""}`}
        {...sectionDropProps(category)}
      >
        {categoryEdge && <span className={`${dropLine} ${categoryEdge === "category-before" ? "-top-1" : "-bottom-1"}`} />}
        {!category && hint?.type === "categories-top" && <span className={`${dropLine} -bottom-2`} />}
        {category && categoryHeader(category, isCollapsed)}
        {creatingHere && creationForm}
        {voiceShown.length > 0 && <ul className="flex flex-col gap-1.5">{voiceShown.map(renderVoiceRoom)}</ul>}
        {textShown.length > 0 && (
          <ul className={`flex flex-col gap-0.5 ${voiceShown.length > 0 ? "mt-1.5" : ""}`}>
            {textShown.map(renderTextRoom)}
          </ul>
        )}
        {/* Somewhere to drop a room when there is nothing to drop it beside:
            an empty category, or the top of the list while every room is
            in a category. Only while dragging, or for an empty category
            that could use a hint. */}
        {isManager && empty && !isCollapsed && (category || drag?.type === "channel") && (
          <p
            className={`rounded-md border border-dashed px-2 py-1.5 text-center text-[11px] ${
              (category && hint?.type === "into" && hint.categoryId === category.id) || intoRoot
                ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                : "border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500"
            }`}
          >
            {category ? "Arraste salas pra cá" : "Solte aqui pra tirar da categoria"}
          </p>
        )}
      </section>
    );
  }

  const content = (
    <div className="flex flex-col gap-3">
      {creating?.kind === "category" && creationForm}
      {layoutError && (
        <p className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {layoutError}
        </p>
      )}
      {sections.map(renderSection)}
      {!hasCategories && channels.length === 0 && (
        <p className="px-1 text-xs text-zinc-400 dark:text-zinc-500">Nenhuma sala.</p>
      )}
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
            tooltip="Criar sala ou categoria"
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
                <div className="my-0.5 border-t border-zinc-200 dark:border-zinc-800" />
                <button type="button" onClick={() => startCreating("category")} className={menuItemClass}>
                  <MdCreateNewFolder className="h-4 w-4 opacity-70" />
                  Categoria
                </button>
              </div>
            }
          >
            <button
              type="button"
              onClick={() => setAddOpen((o) => !o)}
              aria-label="Criar sala ou categoria"
              className="cursor-pointer rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <MdAdd className="h-4 w-4" />
            </button>
          </Popover>
        )}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {content}
      </div>
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
  // The settings open on whatever part of the group this person runs; the
  // theme is "Gerenciar grupo"'s, inviting "Criar convites"'.
  const isManager = managesAnything(detail);
  const canTheme = canManage(detail, "manageGroup");
  const canInvite = canManage(detail, "createInvites");

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
      {canInvite && (
        <button
          type="button"
          onClick={openInvite}
          className="hidden shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 sm:flex dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <MdPersonAdd className="h-4 w-4" />
          <span data-header-label className="hidden lg:inline">Convidar</span>
        </button>
      )}
      <Popover
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        placement="bottom-end"
        tooltip="Opções do grupo"
        content={
          <div className="flex w-60 flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            {canInvite && (
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
            {canTheme && (
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
 *
 * Any call, not only a group's: one carried into /groups from an ordinary room
 * is shown the same way (see lib/callSession), just without a group to name.
 */
export function VoiceControls({ className = "" }: { className?: string }) {
  const navigation = useGroupNavigation();
  const call = useCallSession();
  const controls = useGroupVoiceControls();
  // The group's flags, for its badge — the session carries only the name.
  const groupsState = useGroupsState();
  if (!call) return null;
  const callGroup = call.group;
  const sessionFlags = callGroup ? groupsState.details[callGroup.groupId]?.group.flags : undefined;
  return (
    <div
      className={`flex items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <GroupLink
        href={callPathFor(call)}
        title="Voltar para a chamada"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition hover:bg-white dark:hover:bg-zinc-800"
      >
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{callNameFor(call)}</span>
        {callGroup && (
          <span className="hidden min-w-0 items-center gap-1 text-zinc-500 xl:inline-flex dark:text-zinc-400">
            <span className="shrink-0">·</span>
            <GroupName name={callGroup.groupName} flags={sessionFlags} badgeClassName="h-3.5 w-3.5" />
          </span>
        )}
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
              typeof window !== "undefined" && window.location.pathname === callPathFor(call);
            endCall();
            if (wasOnCall) navigation.push(callGroup ? groupPath(callGroup.groupId) : "/");
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
  // Any call — see VoiceControls.
  const call = useCallSession();
  if (!call) return null;
  const name = callNameFor(call);
  return (
    <Tooltip
      content={call.group ? `Voltar para a chamada · ${call.group.groupName}` : "Voltar para a chamada"}
      placement="bottom"
    >
      <GroupLink
        href={callPathFor(call)}
        aria-label={`Voltar para a chamada em ${name}`}
        className="flex max-w-[12rem] shrink-0 items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
        <MdVolumeUp className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{name}</span>
      </GroupLink>
    </Tooltip>
  );
}

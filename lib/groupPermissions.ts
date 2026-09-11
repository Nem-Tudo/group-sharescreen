import type { GroupChannel, GroupChannelKind, GroupDetail, GroupRole } from "./groupsApi";

// What an ordinary member may do in a group's rooms — the client's copy of the
// API's groupPermissions.ts. Two layers: the group sets every switch on or off;
// each room may override the ones of its own kind, or leave them neutral to
// inherit the group's. The owner and admins may always do everything.
//
// The server is the one that enforces all of this; the client only uses it to
// not offer what would be refused.
//
// Three sections, as the settings show them: the general switches apply to
// every room, text and voice alike; the other two only to rooms of their kind.

export const GENERAL_PERMISSION_KEYS = ["viewChannel"] as const;
export type GeneralPermissionKey = (typeof GENERAL_PERMISSION_KEYS)[number];

export const TEXT_PERMISSION_KEYS = [
  "sendMessages",
  "sendGifs",
  "sendImages",
  "mentionMembers",
  "mentionEveryone",
  "addReactions",
  "react",
] as const;
export type TextPermissionKey = (typeof TEXT_PERMISSION_KEYS)[number];

// "connect" is whether a member may walk in at all — without it the room is
// still listed, with who is in it, behind a lock. The rest are named as a
// room's own switches are (see the signaling client's roomPermissions) — they
// pass straight into the voice room.
export const VOICE_PERMISSION_KEYS = [
  "connect",
  "mic",
  "screen",
  "camera",
  "videoSource",
  "chat",
  "gif",
  "image",
] as const;
export type VoicePermissionKey = (typeof VOICE_PERMISSION_KEYS)[number];

export type GroupPermissionKey = GeneralPermissionKey | TextPermissionKey | VoicePermissionKey;

export interface GroupPermissions {
  general: Record<GeneralPermissionKey, boolean>;
  text: Record<TextPermissionKey, boolean>;
  voice: Record<VoicePermissionKey, boolean>;
}

/** Which section of the settings a switch lives in. */
export type PermissionSection = "general" | GroupChannelKind;

export type ChannelPermissionOverrides = Partial<Record<GroupPermissionKey, boolean>>;

/** What an @everyone leaves in a message's `mentions`. */
export const EVERYONE_MENTION = "@everyone";

export const DEFAULT_GROUP_PERMISSIONS: GroupPermissions = {
  general: { viewChannel: true },
  text: {
    sendMessages: true,
    sendGifs: true,
    sendImages: true,
    mentionMembers: true,
    mentionEveryone: false,
    addReactions: true,
    react: true,
  },
  voice: { connect: true, mic: true, screen: true, camera: true, videoSource: true, chat: true, gif: true, image: true },
};

/** Each switch in words, phrased as what it lets a member do, with a line on what it covers. */
export const PERMISSION_LABELS: Record<GroupPermissionKey, { label: string; hint: string }> = {
  viewChannel: { label: "Ver a sala", hint: "Sem isso, a sala nem aparece na lista — de texto ou de voz." },
  sendMessages: { label: "Enviar mensagens", hint: "A base de todas as outras: sem ela, não dá pra escrever nada." },
  sendGifs: { label: "Enviar GIFs", hint: "Pelo seletor de GIFs." },
  sendImages: { label: "Enviar imagens", hint: "Anexadas ou coladas com Ctrl+V." },
  mentionMembers: { label: "Mencionar pessoas", hint: "Um @nome avisa a pessoa." },
  mentionEveryone: { label: "Mencionar @everyone", hint: "Avisa todo mundo que vê a sala de uma vez." },
  addReactions: { label: "Adicionar reações", hint: "Colocar um emoji novo numa mensagem." },
  react: { label: "Reagir", hint: "Entrar numa reação que já está na mensagem. Tirar a própria sempre pode." },
  connect: { label: "Conectar", hint: "Sem isso, a sala aparece com um cadeado e não dá pra entrar." },
  mic: { label: "Ligar o microfone", hint: "" },
  screen: { label: "Compartilhar a tela", hint: "" },
  camera: { label: "Ligar a câmera", hint: "" },
  videoSource: { label: "Adicionar fontes de vídeo", hint: "" },
  chat: { label: "Escrever no chat da chamada", hint: "" },
  gif: { label: "Enviar GIFs no chat da chamada", hint: "" },
  image: { label: "Enviar imagens no chat da chamada", hint: "" },
};

/** The switches a room of this kind has — the general ones first, then its own. */
export function permissionKeysFor(kind: GroupChannelKind): readonly GroupPermissionKey[] {
  return [...GENERAL_PERMISSION_KEYS, ...(kind === "text" ? TEXT_PERMISSION_KEYS : VOICE_PERMISSION_KEYS)];
}

export function sectionOf(key: GroupPermissionKey): PermissionSection {
  if ((GENERAL_PERMISSION_KEYS as readonly string[]).includes(key)) return "general";
  return (TEXT_PERMISSION_KEYS as readonly string[]).includes(key) ? "text" : "voice";
}

/** The group's setting for a switch — what a room left neutral inherits. */
export function groupAllows(permissions: GroupPermissions | undefined, key: GroupPermissionKey): boolean {
  const source = permissions ?? DEFAULT_GROUP_PERMISSIONS;
  const section = sectionOf(key);
  if (section === "general") {
    const k = key as GeneralPermissionKey;
    // An API from before the general section still sends this as a text switch.
    const legacy = (source.text as Record<string, boolean | undefined> | undefined)?.[k];
    return source.general?.[k] ?? legacy ?? DEFAULT_GROUP_PERMISSIONS.general[k];
  }
  if (section === "text") {
    const k = key as TextPermissionKey;
    return source.text?.[k] ?? DEFAULT_GROUP_PERMISSIONS.text[k];
  }
  const k = key as VoicePermissionKey;
  return source.voice?.[k] ?? DEFAULT_GROUP_PERMISSIONS.voice[k];
}

/** Whether this room lets an ordinary member do `key`: its own setting, or the group's. */
export function channelAllows(detail: GroupDetail, channel: GroupChannel, key: GroupPermissionKey): boolean {
  const own = channel.permissions?.[key];
  if (typeof own === "boolean") return own;
  return groupAllows(detail.group.permissions, key);
}

/**
 * Whether a member with this role may do `key` in this room — the answer the
 * API's memberCan gives for them. Roles are the only thing that varies between
 * members: the owner and admins may always, everybody else gets the room's.
 */
export function memberCanInChannel(
  detail: GroupDetail,
  channel: GroupChannel,
  role: GroupRole,
  key: GroupPermissionKey
): boolean {
  if (role === "owner" || role === "admin") return true;
  return channelAllows(detail, channel, key);
}

/** Whether the person looking may do `key` in this room. */
export function canInChannel(detail: GroupDetail, channel: GroupChannel, key: GroupPermissionKey): boolean {
  return memberCanInChannel(detail, channel, detail.me.role, key);
}

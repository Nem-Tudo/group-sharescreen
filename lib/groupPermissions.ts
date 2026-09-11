import type { GroupChannel, GroupChannelKind, GroupDetail } from "./groupsApi";

// What an ordinary member may do in a group's rooms — the client's copy of the
// API's groupPermissions.ts. Two layers: the group sets every switch on or off;
// each room may override the ones of its own kind, or leave them neutral to
// inherit the group's. The owner and admins may always do everything.
//
// The server is the one that enforces all of this; the client only uses it to
// not offer what would be refused.

export const TEXT_PERMISSION_KEYS = [
  "viewChannel",
  "sendMessages",
  "sendGifs",
  "sendImages",
  "mentionMembers",
  "mentionEveryone",
] as const;
export type TextPermissionKey = (typeof TEXT_PERMISSION_KEYS)[number];

// Named as a room's own switches are (see the signaling client's
// roomPermissions) — they pass straight into the voice room.
export const VOICE_PERMISSION_KEYS = ["mic", "screen", "camera", "videoSource", "chat", "gif", "image"] as const;
export type VoicePermissionKey = (typeof VOICE_PERMISSION_KEYS)[number];

export type GroupPermissionKey = TextPermissionKey | VoicePermissionKey;

export interface GroupPermissions {
  text: Record<TextPermissionKey, boolean>;
  voice: Record<VoicePermissionKey, boolean>;
}

export type ChannelPermissionOverrides = Partial<Record<GroupPermissionKey, boolean>>;

/** What an @everyone leaves in a message's `mentions`. */
export const EVERYONE_MENTION = "@everyone";

export const DEFAULT_GROUP_PERMISSIONS: GroupPermissions = {
  text: {
    viewChannel: true,
    sendMessages: true,
    sendGifs: true,
    sendImages: true,
    mentionMembers: true,
    mentionEveryone: false,
  },
  voice: { mic: true, screen: true, camera: true, videoSource: true, chat: true, gif: true, image: true },
};

/** Each switch in words, phrased as what it lets a member do, with a line on what it covers. */
export const PERMISSION_LABELS: Record<GroupPermissionKey, { label: string; hint: string }> = {
  viewChannel: { label: "Ver a sala", hint: "Sem isso, a sala nem aparece na lista." },
  sendMessages: { label: "Enviar mensagens", hint: "A base de todas as outras: sem ela, não dá pra escrever nada." },
  sendGifs: { label: "Enviar GIFs", hint: "Pelo seletor de GIFs." },
  sendImages: { label: "Enviar imagens", hint: "Anexadas ou coladas com Ctrl+V." },
  mentionMembers: { label: "Mencionar pessoas", hint: "Um @nome avisa a pessoa." },
  mentionEveryone: { label: "Mencionar @everyone", hint: "Avisa todo mundo que vê a sala de uma vez." },
  mic: { label: "Ligar o microfone", hint: "" },
  screen: { label: "Compartilhar a tela", hint: "" },
  camera: { label: "Ligar a câmera", hint: "" },
  videoSource: { label: "Adicionar fontes de vídeo", hint: "" },
  chat: { label: "Escrever no chat da chamada", hint: "" },
  gif: { label: "Enviar GIFs no chat da chamada", hint: "" },
  image: { label: "Enviar imagens no chat da chamada", hint: "" },
};

export function permissionKeysFor(kind: GroupChannelKind): readonly GroupPermissionKey[] {
  return kind === "text" ? TEXT_PERMISSION_KEYS : VOICE_PERMISSION_KEYS;
}

/** The group's setting for a switch — what a room left neutral inherits. */
export function groupAllows(permissions: GroupPermissions | undefined, kind: GroupChannelKind, key: GroupPermissionKey): boolean {
  const source = permissions ?? DEFAULT_GROUP_PERMISSIONS;
  return kind === "text"
    ? source.text[key as TextPermissionKey] ?? DEFAULT_GROUP_PERMISSIONS.text[key as TextPermissionKey] ?? true
    : source.voice[key as VoicePermissionKey] ?? DEFAULT_GROUP_PERMISSIONS.voice[key as VoicePermissionKey] ?? true;
}

/** Whether this room lets an ordinary member do `key`: its own setting, or the group's. */
export function channelAllows(detail: GroupDetail, channel: GroupChannel, key: GroupPermissionKey): boolean {
  const own = channel.permissions?.[key];
  if (typeof own === "boolean") return own;
  return groupAllows(detail.group.permissions, channel.kind, key);
}

/** Whether the person looking may do `key` in this room. */
export function canInChannel(detail: GroupDetail, channel: GroupChannel, key: GroupPermissionKey): boolean {
  if (detail.me.role === "owner" || detail.me.role === "admin") return true;
  return channelAllows(detail, channel, key);
}

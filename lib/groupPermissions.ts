import type { GroupChannel, GroupChannelKind, GroupDetail, GroupRoleInfo } from "./groupsApi";

// What somebody may do in a group — the client's copy of the API's
// groupPermissions.ts. Discord's model: @everyone's switches (the group's own),
// which each role can only add to; then each room's overrides, for @everyone
// and per role — on, off, or neutral to inherit. The owner, and anybody with a
// role that has "Administrador", may always do everything.
//
// The server is the one that enforces all of this; the client only uses it to
// not offer what would be refused.
//
// Four sections, as the settings show them: the management switches are the
// group's alone (no room overrides them); the general ones apply to every
// room, text and voice alike; the other two only to rooms of their kind.

export const MANAGE_PERMISSION_KEYS = [
  "administrator",
  "manageGroup",
  "manageChannels",
  "manageRoles",
  "kickMembers",
  "banMembers",
  "manageMessages",
  "createInvites",
] as const;
export type ManagePermissionKey = (typeof MANAGE_PERMISSION_KEYS)[number];

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

/** The switches a room can override. */
export type GroupPermissionKey = GeneralPermissionKey | TextPermissionKey | VoicePermissionKey;
/** Any switch at all. */
export type AnyPermissionKey = ManagePermissionKey | GroupPermissionKey;

export interface GroupPermissions {
  /** Absent from an older API — read as all off. */
  manage?: Record<ManagePermissionKey, boolean>;
  general: Record<GeneralPermissionKey, boolean>;
  text: Record<TextPermissionKey, boolean>;
  voice: Record<VoicePermissionKey, boolean>;
}

/** Which section of the settings a switch lives in. */
export type PermissionSection = "manage" | "general" | GroupChannelKind;

export type ChannelPermissionOverrides = Partial<Record<GroupPermissionKey, boolean>>;

/** What an @everyone leaves in a message's `mentions`. */
export const EVERYONE_MENTION = "@everyone";
/** A role's @-mention in a message's `mentions`: this, then the role's id. */
export const ROLE_MENTION_PREFIX = "@role:";

const MANAGE_OFF: Record<ManagePermissionKey, boolean> = {
  administrator: false,
  manageGroup: false,
  manageChannels: false,
  manageRoles: false,
  kickMembers: false,
  banMembers: false,
  manageMessages: false,
  createInvites: false,
};

export const DEFAULT_GROUP_PERMISSIONS: GroupPermissions = {
  manage: MANAGE_OFF,
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
export const PERMISSION_LABELS: Record<AnyPermissionKey, { label: string; hint: string }> = {
  administrator: {
    label: "Administrador",
    hint: "Pode tudo, em todas as salas, ignorando as permissões delas. Dê com cuidado.",
  },
  manageGroup: {
    label: "Gerenciar grupo",
    hint: "Nome, ícone, descrição, tema, mapa, link personalizado e todos os convites.",
  },
  manageChannels: {
    label: "Gerenciar salas",
    hint: "Criar, renomear, apagar e organizar salas e categorias, e as permissões de cada sala.",
  },
  manageRoles: {
    label: "Gerenciar cargos",
    hint: "Criar e editar cargos abaixo do seu, dar e tirar esses cargos das pessoas e mudar o @everyone.",
  },
  kickMembers: { label: "Expulsar membros", hint: "Tirar do grupo quem tem um cargo abaixo do seu." },
  banMembers: { label: "Banir membros", hint: "Tirar do grupo sem poder voltar — e desbanir." },
  manageMessages: { label: "Gerenciar mensagens", hint: "Apagar mensagens de outras pessoas." },
  createInvites: { label: "Criar convites", hint: "Criar links de convite para o grupo." },
  viewChannel: { label: "Ver a sala", hint: "Sem isso, a sala nem aparece na lista — de texto ou de voz." },
  sendMessages: { label: "Enviar mensagens", hint: "A base de todas as outras: sem ela, não dá pra escrever nada." },
  sendGifs: { label: "Enviar GIFs", hint: "Pelo seletor de GIFs." },
  sendImages: { label: "Enviar imagens", hint: "Anexadas ou coladas com Ctrl+V." },
  mentionMembers: { label: "Mencionar pessoas", hint: "Um @nome avisa a pessoa." },
  mentionEveryone: {
    label: "Mencionar @everyone e todos os cargos",
    hint: "Avisa todo mundo que vê a sala de uma vez — e permite mencionar até os cargos que não deixam.",
  },
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

export function sectionOf(key: AnyPermissionKey): PermissionSection {
  if ((MANAGE_PERMISSION_KEYS as readonly string[]).includes(key)) return "manage";
  if ((GENERAL_PERMISSION_KEYS as readonly string[]).includes(key)) return "general";
  return (TEXT_PERMISSION_KEYS as readonly string[]).includes(key) ? "text" : "voice";
}

/** One switch of a role's set — a role's missing switch is off. */
export function permissionIn(permissions: GroupPermissions | undefined, key: AnyPermissionKey): boolean {
  if (!permissions) return false;
  const section = sectionOf(key);
  const values = permissions[section] as Record<string, boolean | undefined> | undefined;
  return values?.[key] === true;
}

/** @everyone's setting for a switch — what a room left neutral inherits, before any role. */
export function groupAllows(permissions: GroupPermissions | undefined, key: AnyPermissionKey): boolean {
  const source = permissions ?? DEFAULT_GROUP_PERMISSIONS;
  const section = sectionOf(key);
  if (section === "manage") return source.manage?.[key as ManagePermissionKey] ?? false;
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

/** Whether this room lets @everyone do `key`: its own setting, or the group's. */
export function channelAllows(detail: GroupDetail, channel: GroupChannel, key: GroupPermissionKey): boolean {
  const own = channel.permissions?.[key];
  if (typeof own === "boolean") return own;
  return groupAllows(detail.group.permissions, key);
}

// ─── Roles ────────────────────────────────────────────────────────────────

// Keyed on the group object rather than its id, so there is nothing to
// invalidate: a group update replaces the object wholesale, which makes the
// old entry unreachable and collectable. An id key would need a version
// counter and would go stale the one time somebody forgot to bump it.
const orderedRoles = new WeakMap<GroupDetail["group"], GroupRoleInfo[]>();

/**
 * The group's roles, highest first.
 *
 * Memoized because the member list asks for this order four times per
 * rendered member (hoistedRoleOf, roleColorOf, and twice inside
 * memberCanInChannel) — 600 members and 20 roles was 2,400 copies and sorts
 * of the same array in a single render.
 *
 * The result is shared, so callers must not mutate it. rolesWithIds only
 * filters, which is what everything else goes through.
 */
export function rolesInOrder(detail: GroupDetail): GroupRoleInfo[] {
  const held = orderedRoles.get(detail.group);
  if (held) return held;
  const out = [...(detail.group.roles ?? [])].sort((a, b) => b.position - a.position);
  orderedRoles.set(detail.group, out);
  return out;
}

/** The ids of the roles somebody holds — from the detail's map, or my own list for me. */
export function roleIdsOf(detail: GroupDetail, userId: string): string[] {
  if (userId === detail.me.id && detail.me.roleIds) return detail.me.roleIds;
  return detail.memberRoles?.[userId] ?? [];
}

/** The roles with these ids, highest first. */
export function rolesWithIds(detail: GroupDetail, roleIds: readonly string[]): GroupRoleInfo[] {
  if (roleIds.length === 0) return [];
  return rolesInOrder(detail).filter((r) => roleIds.includes(r.id));
}

/** Somebody the resolution is asked about: their id, and their roles when already known. */
export interface PermissionSubject {
  id: string;
  roleIds?: readonly string[];
}

function subjectRoles(detail: GroupDetail, subject: PermissionSubject): GroupRoleInfo[] {
  return rolesWithIds(detail, subject.roleIds ?? roleIdsOf(detail, subject.id));
}

/** The owner, or holding "Administrador" through @everyone or any role. */
export function isAdministrator(detail: GroupDetail, subject: PermissionSubject): boolean {
  if (subject.id === detail.group.ownerId) return true;
  // An API from before roles: its admins were everything an administrator is.
  if (!detail.group.roles && subject.id === detail.me.id) return detail.me.role === "admin";
  if (groupAllows(detail.group.permissions, "administrator")) return true;
  return subjectRoles(detail, subject).some((r) => permissionIn(r.permissions, "administrator"));
}

/**
 * Whether somebody may do `key` in this room — the answer the API's memberCan
 * gives for them: @everyone's and their roles' switches, then the room's
 * @everyone override, then its overrides for their roles (any role allowing
 * wins over any denying). Owner and administrators always may.
 */
export function memberCanInChannel(
  detail: GroupDetail,
  channel: GroupChannel,
  subject: PermissionSubject,
  key: GroupPermissionKey
): boolean {
  if (isAdministrator(detail, subject)) return true;
  const roles = subjectRoles(detail, subject);
  let allowed = groupAllows(detail.group.permissions, key) || roles.some((r) => permissionIn(r.permissions, key));
  const everyone = channel.permissions?.[key];
  if (typeof everyone === "boolean") allowed = everyone;
  let roleAllow = false;
  let roleDeny = false;
  for (const role of roles) {
    const own = channel.roleOverrides?.[role.id]?.[key];
    if (own === true) roleAllow = true;
    else if (own === false) roleDeny = true;
  }
  if (roleDeny) allowed = false;
  if (roleAllow) allowed = true;
  return allowed;
}

/** Whether the person looking may do `key` in this room. */
export function canInChannel(detail: GroupDetail, channel: GroupChannel, key: GroupPermissionKey): boolean {
  return memberCanInChannel(detail, channel, { id: detail.me.id, roleIds: detail.me.roleIds }, key);
}

/**
 * One of the group's own switches, for the person looking — as the API
 * resolved it (me.permissions). An older API only said owner or admin.
 */
export function canManage(detail: GroupDetail, key: ManagePermissionKey): boolean {
  const manage = detail.me.permissions?.manage;
  if (manage) return manage.administrator || manage[key];
  return detail.me.role === "owner" || detail.me.role === "admin";
}

/** The management switches that open the group's settings for somebody. */
const SETTINGS_KEYS: readonly ManagePermissionKey[] = [
  "manageGroup",
  "manageChannels",
  "manageRoles",
  "kickMembers",
  "banMembers",
  "createInvites",
];

/** Whether the person looking runs any part of the group — what the settings entry is shown for. */
export function managesAnything(detail: GroupDetail): boolean {
  return SETTINGS_KEYS.some((key) => canManage(detail, key));
}

/** Where the person looking stands in the order — Infinity for the owner, 0 with no role. */
export function myRank(detail: GroupDetail): number {
  if (detail.me.id === detail.group.ownerId) return Number.POSITIVE_INFINITY;
  if (typeof detail.me.rank === "number") return detail.me.rank < 0 ? Number.POSITIVE_INFINITY : detail.me.rank;
  return rolesWithIds(detail, detail.me.roleIds ?? [])[0]?.position ?? 0;
}

/** Where somebody stands, from their role ids — Infinity for the owner. */
export function rankOf(detail: GroupDetail, subject: PermissionSubject): number {
  if (subject.id === detail.group.ownerId) return Number.POSITIVE_INFINITY;
  return subjectRoles(detail, subject)[0]?.position ?? 0;
}

/** The colour somebody's name is drawn in: their highest role that has one. Null for none. */
export function roleColorOf(detail: GroupDetail | null | undefined, subject: PermissionSubject): string | null {
  if (!detail) return null;
  return subjectRoles(detail, subject).find((r) => r.color)?.color ?? null;
}

/**
 * What the member list is re-read on (see groupCache's useGroupMembers): who
 * is in the group, who owns it, and who holds which role — every change the
 * list itself shows.
 */
export function membersRevalidateKey(detail: GroupDetail): string {
  // Memoized on the detail object for the same reason as rolesInOrder, and
  // more urgently: this is called *during render* by four screens, and
  // memberRoles is a map with an entry per member — so at 600 members every
  // render of any of them allocated four copies of a several-hundred-KB
  // string, purely to compare it with the last one. A group update replaces
  // `detail`, so a changed membership still produces a new key.
  const held = revalidateKeys.get(detail);
  if (held !== undefined) return held;
  const key = `${detail.group.memberCount}:${detail.group.ownerId}:${JSON.stringify(detail.memberRoles ?? {})}`;
  revalidateKeys.set(detail, key);
  return key;
}
const revalidateKeys = new WeakMap<GroupDetail, string>();

/** The section of the member list somebody is listed in: their highest hoisted role. */
export function hoistedRoleOf(detail: GroupDetail, subject: PermissionSubject): GroupRoleInfo | null {
  return subjectRoles(detail, subject).find((r) => r.hoist) ?? null;
}

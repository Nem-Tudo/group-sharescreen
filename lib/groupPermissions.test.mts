// node --experimental-strip-types lib/groupPermissions.test.mts
//
// How a switch resolves: the room's own setting when it has one, the group's
// when it is neutral, and always yes for the owner and admins — and, with
// roles, Discord's order: @everyone plus roles, then the room's @everyone
// override, then its role overrides.
import assert from "node:assert/strict";
import {
  DEFAULT_GROUP_PERMISSIONS,
  canInChannel,
  canManage,
  channelAllows,
  groupAllows,
  hoistedRoleOf,
  isAdministrator,
  memberCanInChannel,
  myRank,
  permissionKeysFor,
  rankOf,
  roleColorOf,
  rolesInOrder,
  sectionOf,
  type GroupPermissions,
} from "./groupPermissions";
import type { GroupChannel, GroupDetail, GroupRoleInfo } from "./groupsApi";

function detailWith(
  role: "owner" | "admin" | "member",
  overrides: GroupChannel["permissions"],
  groupText = {},
  { kind = "text", general = {}, voice = {} }: { kind?: "text" | "voice"; general?: object; voice?: object } = {}
) {
  const channel: GroupChannel = {
    id: "c1",
    kind,
    name: "geral",
    position: 0,
    permissions: overrides,
    unread: false,
    mentions: 0,
  };
  const detail = {
    group: {
      ownerId: role === "owner" ? "u1" : "someone-else",
      permissions: {
        general: { ...DEFAULT_GROUP_PERMISSIONS.general, ...general },
        text: { ...DEFAULT_GROUP_PERMISSIONS.text, ...groupText },
        voice: { ...DEFAULT_GROUP_PERMISSIONS.voice, ...voice },
      },
    },
    me: { id: "u1", role, notify: "mentions", guest: false },
    channels: [channel],
  } as unknown as GroupDetail;
  return { detail, channel };
}

// Neutral follows the group — whichever way the group is set.
{
  const { detail, channel } = detailWith("member", {});
  assert.equal(channelAllows(detail, channel, "sendMessages"), true);
  assert.equal(channelAllows(detail, channel, "mentionEveryone"), false, "@everyone is off by default");
}
{
  const { detail, channel } = detailWith("member", {}, { sendGifs: false });
  assert.equal(channelAllows(detail, channel, "sendGifs"), false, "the group's off reaches a neutral room");
}

// The room's own setting wins, in both directions.
{
  const { detail, channel } = detailWith("member", { sendGifs: true, sendMessages: false }, { sendGifs: false });
  assert.equal(channelAllows(detail, channel, "sendGifs"), true, "room on beats group off");
  assert.equal(channelAllows(detail, channel, "sendMessages"), false, "room off beats group on");
}

// Owner and admins may always; members get what the room resolves to.
{
  const { detail, channel } = detailWith("admin", { sendMessages: false, viewChannel: false });
  assert.equal(canInChannel(detail, channel, "sendMessages"), true);
  assert.equal(canInChannel(detail, channel, "viewChannel"), true);
}
{
  const { detail, channel } = detailWith("owner", { mentionEveryone: false });
  assert.equal(canInChannel(detail, channel, "mentionEveryone"), true);
}
{
  const { detail, channel } = detailWith("member", { sendMessages: false });
  assert.equal(canInChannel(detail, channel, "sendMessages"), false);
}

// Each kind of room has the general switches, then its own, and only those.
assert.deepEqual([...permissionKeysFor("text")], [
  "viewChannel",
  "sendMessages",
  "sendGifs",
  "sendImages",
  "mentionMembers",
  "mentionEveryone",
  "addReactions",
  "react",
]);
// Both reaction switches start on.
assert.equal(groupAllows(undefined, "addReactions"), true);
assert.equal(groupAllows(undefined, "react"), true);
assert.deepEqual([...permissionKeysFor("voice")], [
  "viewChannel",
  "connect",
  "mic",
  "screen",
  "camera",
  "videoSource",
  "chat",
  "gif",
  "image",
]);
assert.ok(!permissionKeysFor("text").includes("connect" as never));
assert.ok(!permissionKeysFor("voice").includes("sendMessages" as never));

// Which section each switch is set in.
assert.equal(sectionOf("viewChannel"), "general");
assert.equal(sectionOf("sendGifs"), "text");
assert.equal(sectionOf("connect"), "voice");

// "Ver a sala" is one switch for both kinds: the group's off reaches a voice room too.
{
  const { detail, channel } = detailWith("member", {}, {}, { kind: "voice", general: { viewChannel: false } });
  assert.equal(channelAllows(detail, channel, "viewChannel"), false);
}
{
  const { detail, channel } = detailWith("member", { viewChannel: true }, {}, { kind: "voice", general: { viewChannel: false } });
  assert.equal(channelAllows(detail, channel, "viewChannel"), true, "a voice room can open itself back up");
}

// "Conectar": off leaves the room visible but locked; the room can say otherwise; managers always may.
{
  const { detail, channel } = detailWith("member", {}, {}, { kind: "voice", voice: { connect: false } });
  assert.equal(canInChannel(detail, channel, "viewChannel"), true);
  assert.equal(canInChannel(detail, channel, "connect"), false);
}
{
  const { detail, channel } = detailWith("member", { connect: true }, {}, { kind: "voice", voice: { connect: false } });
  assert.equal(canInChannel(detail, channel, "connect"), true);
}
{
  const { detail, channel } = detailWith("admin", { connect: false }, {}, { kind: "voice" });
  assert.equal(canInChannel(detail, channel, "connect"), true);
}

// ─── Roles ────────────────────────────────────────────────────────────────

function perms(patch: { manage?: object; general?: object; text?: object; voice?: object } = {}): GroupPermissions {
  const off = (o: object) => Object.fromEntries(Object.keys(o).map((k) => [k, false]));
  return {
    manage: { ...off(DEFAULT_GROUP_PERMISSIONS.manage!), ...patch.manage },
    general: { ...off(DEFAULT_GROUP_PERMISSIONS.general), ...patch.general },
    text: { ...off(DEFAULT_GROUP_PERMISSIONS.text), ...patch.text },
    voice: { ...off(DEFAULT_GROUP_PERMISSIONS.voice), ...patch.voice },
  } as GroupPermissions;
}

function role(id: string, position: number, patch: Partial<GroupRoleInfo> = {}): GroupRoleInfo {
  return { id, name: id, color: null, position, hoist: false, mentionable: false, permissions: perms(), ...patch };
}

/** A group with roles: "admin" (top, administrator), "mod" (colour, hoisted, may kick), "vip" (may @everyone). */
function withRoles({
  everyone = {},
  channelOverrides = {},
  roleOverrides = {},
  memberRoles = {},
  me = "m",
}: {
  everyone?: { general?: object; text?: object; voice?: object };
  channelOverrides?: GroupChannel["permissions"];
  roleOverrides?: GroupChannel["roleOverrides"];
  memberRoles?: Record<string, string[]>;
  me?: string;
} = {}) {
  const roles = [
    role("vip", 1, { color: "#00ff00", permissions: perms({ text: { mentionEveryone: true } }) }),
    role("mod", 2, { color: "#ff0000", hoist: true, permissions: perms({ manage: { kickMembers: true } }) }),
    role("admin", 3, { hoist: true, permissions: perms({ manage: { administrator: true } }) }),
  ];
  const channel: GroupChannel = {
    id: "c1",
    kind: "text",
    name: "geral",
    position: 0,
    permissions: channelOverrides,
    roleOverrides,
    unread: false,
    mentions: 0,
  };
  const detail = {
    group: {
      ownerId: "o",
      roles,
      permissions: {
        manage: { ...DEFAULT_GROUP_PERMISSIONS.manage },
        general: { ...DEFAULT_GROUP_PERMISSIONS.general, ...everyone.general },
        text: { ...DEFAULT_GROUP_PERMISSIONS.text, ...everyone.text },
        voice: { ...DEFAULT_GROUP_PERMISSIONS.voice, ...everyone.voice },
      },
    },
    memberRoles,
    me: { id: me, role: "member", roleIds: memberRoles[me] ?? [], notify: "mentions", guest: false },
    channels: [channel],
  } as unknown as GroupDetail;
  return { detail, channel };
}

// Roles in order, highest first.
assert.deepEqual(rolesInOrder(withRoles().detail).map((r) => r.id), ["admin", "mod", "vip"]);

// A role only adds: @everyone off + role on = on; @everyone on + role off = still on.
{
  const { detail, channel } = withRoles({ memberRoles: { v: ["vip"] } });
  assert.equal(memberCanInChannel(detail, channel, { id: "v" }, "mentionEveryone"), true, "the role turns it on");
  assert.equal(memberCanInChannel(detail, channel, { id: "x" }, "mentionEveryone"), false, "nobody else has it");
  assert.equal(memberCanInChannel(detail, channel, { id: "v" }, "sendMessages"), true, "a role's off takes nothing away");
}

// Administrator (a role, or the owner) may everything — room overrides included.
{
  const { detail, channel } = withRoles({
    memberRoles: { a: ["admin"] },
    channelOverrides: { viewChannel: false, sendMessages: false },
  });
  assert.equal(isAdministrator(detail, { id: "a" }), true);
  assert.equal(memberCanInChannel(detail, channel, { id: "a" }, "viewChannel"), true);
  assert.equal(memberCanInChannel(detail, channel, { id: "o" }, "sendMessages"), true, "the owner");
  assert.equal(memberCanInChannel(detail, channel, { id: "x" }, "viewChannel"), false, "anybody else: the room's off");
}

// The room's @everyone override beats a role's group-wide grant (Discord's order)...
{
  const { detail, channel } = withRoles({
    memberRoles: { v: ["vip"] },
    channelOverrides: { mentionEveryone: false },
  });
  assert.equal(memberCanInChannel(detail, channel, { id: "v" }, "mentionEveryone"), false);
}
// ...and a role's room override beats the room's @everyone one.
{
  const { detail, channel } = withRoles({
    memberRoles: { m1: ["mod"] },
    channelOverrides: { viewChannel: false },
    roleOverrides: { mod: { viewChannel: true } },
  });
  assert.equal(memberCanInChannel(detail, channel, { id: "m1" }, "viewChannel"), true, "the mod sees the hidden room");
  assert.equal(memberCanInChannel(detail, channel, { id: "x" }, "viewChannel"), false, "nobody else does");
}
// Between roles, allow wins over deny.
{
  const { detail, channel } = withRoles({
    memberRoles: { both: ["mod", "vip"], onlyVip: ["vip"] },
    roleOverrides: { mod: { sendGifs: true }, vip: { sendGifs: false } },
    everyone: { text: { sendGifs: true } },
  });
  assert.equal(memberCanInChannel(detail, channel, { id: "both" }, "sendGifs"), true);
  assert.equal(memberCanInChannel(detail, channel, { id: "onlyVip" }, "sendGifs"), false, "the vip override takes it away");
}
// Role ids given directly win over the detail's map (the member list sends them).
{
  const { detail, channel } = withRoles({ channelOverrides: { viewChannel: false }, roleOverrides: { mod: { viewChannel: true } } });
  assert.equal(memberCanInChannel(detail, channel, { id: "n", roleIds: ["mod"] }, "viewChannel"), true);
}

// Rank, colour and the member list's section.
{
  const { detail } = withRoles({ memberRoles: { m: ["vip", "mod"] } });
  assert.equal(rankOf(detail, { id: "m" }), 2);
  assert.equal(rankOf(detail, { id: "o" }), Number.POSITIVE_INFINITY);
  assert.equal(rankOf(detail, { id: "nobody" }), 0);
  assert.equal(myRank(detail), 2);
  assert.equal(roleColorOf(detail, { id: "m" }), "#ff0000", "the highest role with a colour");
  assert.equal(roleColorOf(detail, { id: "nobody" }), null);
  assert.equal(hoistedRoleOf(detail, { id: "m" })?.id, "mod");
  assert.equal(hoistedRoleOf(detail, { id: "v", roleIds: ["vip"] }), null, "vip is not shown apart");
}
{
  // The admin role has no colour — the next one down that has one is used.
  const { detail } = withRoles({ memberRoles: { a: ["admin", "vip"] } });
  assert.equal(roleColorOf(detail, { id: "a" }), "#00ff00");
}

// The management switches come from what the API resolved for me.
{
  const { detail } = withRoles();
  const me = detail.me as GroupDetail["me"];
  me.permissions = perms({ manage: { kickMembers: true } });
  assert.equal(canManage(detail, "kickMembers"), true);
  assert.equal(canManage(detail, "banMembers"), false);
  me.permissions = perms({ manage: { administrator: true } });
  assert.equal(canManage(detail, "banMembers"), true, "an administrator has them all");
  // An older API: owner and admins only.
  me.permissions = undefined;
  assert.equal(canManage(detail, "manageChannels"), false);
  me.role = "admin";
  assert.equal(canManage(detail, "manageChannels"), true);
}

// Who a text room's member list shows: those who can see it — by their roles.
{
  const { detail, channel } = withRoles({
    channelOverrides: { viewChannel: false },
    roleOverrides: { vip: { viewChannel: true } },
    memberRoles: { a: ["admin"], v: ["vip"] },
  });
  const members = [{ id: "o" }, { id: "a" }, { id: "v" }, { id: "m" }];
  const visible = members.filter((m) => memberCanInChannel(detail, channel, m, "viewChannel")).map((m) => m.id);
  assert.deepEqual(visible, ["o", "a", "v"], "the owner, the administrator and the role the room let in");
}
{
  const { detail, channel } = detailWith("member", {}, {}, { general: { viewChannel: false } });
  assert.equal(memberCanInChannel(detail, channel, { id: "x" }, "viewChannel"), false, "the group's off reaches the list");
  const opened = detailWith("member", { viewChannel: true }, {}, { general: { viewChannel: false } });
  assert.equal(memberCanInChannel(opened.detail, opened.channel, { id: "x" }, "viewChannel"), true, "a room opened back up lists members");
}

// The management section.
assert.equal(sectionOf("administrator"), "manage");
assert.equal(groupAllows(undefined, "manageRoles"), false, "nobody runs the group by default");

// A group read from an older API falls back to the defaults...
assert.equal(groupAllows(undefined, "sendImages"), true);
assert.equal(groupAllows(undefined, "mentionEveryone"), false);
assert.equal(groupAllows(undefined, "screen"), true);
assert.equal(groupAllows(undefined, "connect"), true);
// ...and one from before the general section still says "Ver a sala" as a text switch.
assert.equal(
  groupAllows({ text: { viewChannel: false }, voice: {} } as never, "viewChannel"),
  false,
  "text.viewChannel from an old API is read as the general switch"
);

console.log("groupPermissions ok");

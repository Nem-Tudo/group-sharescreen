// node --experimental-strip-types lib/groupPermissions.test.mts
//
// How a switch resolves: the room's own setting when it has one, the group's
// when it is neutral, and always yes for the owner and admins.
import assert from "node:assert/strict";
import {
  DEFAULT_GROUP_PERMISSIONS,
  canInChannel,
  channelAllows,
  groupAllows,
  memberCanInChannel,
  permissionKeysFor,
  sectionOf,
} from "./groupPermissions";
import type { GroupChannel, GroupDetail } from "./groupsApi";

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

// Who a text room's member list shows: everybody when members can see it, only
// the owner and admins when they cannot — by role, whoever is looking.
{
  const { detail, channel } = detailWith("member", { viewChannel: false });
  const members = [
    { id: "o", role: "owner" as const },
    { id: "a", role: "admin" as const },
    { id: "m", role: "member" as const },
  ];
  const visible = members.filter((m) => memberCanInChannel(detail, channel, m.role, "viewChannel")).map((m) => m.id);
  assert.deepEqual(visible, ["o", "a"], "a hidden room lists only who runs the group");
}
{
  const { detail, channel } = detailWith("member", {}, {}, { general: { viewChannel: false } });
  assert.equal(memberCanInChannel(detail, channel, "member", "viewChannel"), false, "the group's off reaches the list");
  const opened = detailWith("member", { viewChannel: true }, {}, { general: { viewChannel: false } });
  assert.equal(memberCanInChannel(opened.detail, opened.channel, "member", "viewChannel"), true, "a room opened back up lists members");
}

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

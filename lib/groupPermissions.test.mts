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
  permissionKeysFor,
} from "./groupPermissions";
import type { GroupChannel, GroupDetail } from "./groupsApi";

function detailWith(role: "owner" | "admin" | "member", overrides: GroupChannel["permissions"], groupText = {}) {
  const channel: GroupChannel = {
    id: "c1",
    kind: "text",
    name: "geral",
    position: 0,
    permissions: overrides,
    unread: false,
    mentions: 0,
  };
  const detail = {
    group: {
      permissions: {
        text: { ...DEFAULT_GROUP_PERMISSIONS.text, ...groupText },
        voice: { ...DEFAULT_GROUP_PERMISSIONS.voice },
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

// Each kind of room has its own switches, and only those.
assert.deepEqual([...permissionKeysFor("text")], [
  "viewChannel",
  "sendMessages",
  "sendGifs",
  "sendImages",
  "mentionMembers",
  "mentionEveryone",
]);
assert.ok(!permissionKeysFor("voice").includes("viewChannel" as never));
assert.ok(permissionKeysFor("voice").includes("mic"));

// A group read from an older API (no permissions at all) falls back to the defaults.
assert.equal(groupAllows(undefined, "text", "sendImages"), true);
assert.equal(groupAllows(undefined, "text", "mentionEveryone"), false);
assert.equal(groupAllows(undefined, "voice", "screen"), true);

console.log("groupPermissions ok");

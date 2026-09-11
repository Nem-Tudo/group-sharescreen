// node --experimental-strip-types lib/groupLinks.test.mts
//
// The link helpers groups are reached through. The invite parser is the one
// people actually feed arbitrary text into (a pasted link, a bare code, a
// link with junk around it), so it is the one tested hardest.
import assert from "node:assert/strict";
import {
  describeInviteExpiry,
  groupInitials,
  groupPath,
  groupVoiceHandle,
  inviteCodeFromInput,
  invitePath,
  isGroupId,
  isInviteCode,
} from "./groupLinks";

// Voice handles have to fit the room system's HANDLE_RE (1–32 of [A-Za-z0-9_-]).
const handle = groupVoiceHandle("abcdefghij12");
assert.equal(handle, "grp-abcdefghij12");
assert.ok(/^[a-zA-Z0-9_-]{1,32}$/.test(handle));

assert.equal(groupPath("g1a2b3c4d5"), "/groups/g1a2b3c4d5");
assert.equal(groupPath("g1a2b3c4d5", "c1"), "/groups/g1a2b3c4d5/c1");
assert.equal(invitePath("AbC12345"), "/invite/AbC12345");

assert.ok(isGroupId("abc123def0"));
assert.ok(!isGroupId("ABC123DEF0"));
assert.ok(!isGroupId("../etc"));
assert.ok(isInviteCode("AbC12345"));
assert.ok(!isInviteCode("ab-c"));

// Bare codes come back as they are.
assert.equal(inviteCodeFromInput("AbC12345"), "AbC12345");
assert.equal(inviteCodeFromInput("  AbC12345  "), "AbC12345");

// Full links, with and without a scheme, on either host.
assert.equal(inviteCodeFromInput("https://golive.nemtudo.me/invite/AbC12345"), "AbC12345");
assert.equal(inviteCodeFromInput("golive.nemtudo.me/invite/AbC12345"), "AbC12345");
assert.equal(inviteCodeFromInput("https://www.golive.nemtudo.me/invite/AbC12345?x=1"), "AbC12345");
assert.equal(inviteCodeFromInput("http://localhost:3000/invite/AbC12345"), "AbC12345");

// Anything else is not an invite.
assert.equal(inviteCodeFromInput(""), null);
assert.equal(inviteCodeFromInput("https://evil.example/invite/AbC12345"), null);
assert.equal(inviteCodeFromInput("https://golive.nemtudo.me/watch/sala"), null);
assert.equal(inviteCodeFromInput("https://golive.nemtudo.me/invite/"), null);
assert.equal(inviteCodeFromInput("não é um link"), null);

// Expiry wording.
const now = 1_000_000_000_000;
assert.equal(describeInviteExpiry(null, now), "Nunca expira");
assert.equal(describeInviteExpiry(now - 1, now), "Expirado");
assert.equal(describeInviteExpiry(now + 30 * 60_000, now), "Expira em 30 min");
assert.equal(describeInviteExpiry(now + 6 * 3_600_000, now), "Expira em 6 h");
assert.equal(describeInviteExpiry(now + 7 * 86_400_000, now), "Expira em 7 dias");

// Initials for a group with no icon.
assert.equal(groupInitials("Meu Grupo"), "MG");
assert.equal(groupInitials("  solo  "), "S");
assert.equal(groupInitials("três palavras aqui"), "TP");
assert.equal(groupInitials(""), "?");

console.log("groupLinks ok");

// node --experimental-strip-types lib/groupMetadata.test.mts
//
// What a group's link previews as in a chat: its own name, description, size
// and icon — and nothing at all about a group there is no public card for.
import assert from "node:assert/strict";
import { groupLinkMetadata } from "./groupMetadata";

const group = {
  id: "j9hjobgc88",
  name: "Go Live Oficial",
  description: "Grupo oficial do Go Live",
  iconUrl: "https://cdn.nemtudo.me/f/golive/icon.webp",
  flags: ["VERIFIED"],
  memberCount: 10,
  onlineCount: 2,
};
const images = (m: ReturnType<typeof groupLinkMetadata>) =>
  (m.openGraph?.images as { url: string; width?: number }[] | undefined) ?? [];
const twitterCard = (m: ReturnType<typeof groupLinkMetadata>) => (m.twitter as { card?: string } | undefined)?.card;

// A group's address: its name, its description with the member count, its icon as a square.
{
  const m = groupLinkMetadata({ path: "/groups/j9hjobgc88", kind: "group", group });
  assert.equal(m.title, "Go Live Oficial");
  assert.equal(m.description, "Grupo oficial do Go Live · 10 membros");
  assert.equal(m.openGraph?.title, "Go Live Oficial");
  assert.deepEqual(images(m), [{ url: group.iconUrl, alt: "Go Live Oficial" }]);
  assert.equal(twitterCard(m), "summary", "an icon is a thumbnail, not a wide card");
  assert.deepEqual(m.robots, { index: false, follow: false });
}

// An invite to it says so in the title.
{
  const m = groupLinkMetadata({ path: "/invite/abc", kind: "invite", group, inviteState: "ok" });
  assert.equal(m.title, "Convite para Go Live Oficial");
  assert.equal(m.openGraph?.url, "https://golive.nemtudo.me/invite/abc");
}

// A dead invite does not invite anybody.
{
  const m = groupLinkMetadata({ path: "/invite/abc", kind: "invite", group, inviteState: "expired" });
  assert.equal(m.title, "Convite inválido");
  assert.match(String(m.description), /não vale mais/);
}

// No icon: the site's own card, with the group's name on it.
{
  const m = groupLinkMetadata({
    path: "/groups/x",
    kind: "group",
    group: { ...group, iconUrl: null, description: "  ", memberCount: 1 },
  });
  assert.equal(m.description, "Grupo no GoLive · 1 membro");
  const [image] = images(m);
  assert.match(image.url, /^\/api\/og\?/);
  assert.match(image.url, /title=Go\+Live\+Oficial/);
  assert.equal(image.width, 1200);
  assert.equal(twitterCard(m), "summary_large_image");
}

// No public card (a private group, a dead link): nothing about the group at all.
{
  const m = groupLinkMetadata({ path: "/groups/secret", kind: "group", group: null });
  assert.equal(m.title, "Grupo no GoLive");
  const inv = groupLinkMetadata({ path: "/invite/zzz", kind: "invite", group: null });
  assert.equal(inv.title, "Convite para um grupo");
}

console.log("groupMetadata ok");

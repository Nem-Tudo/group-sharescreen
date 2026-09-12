import type { Metadata } from "next";
import type { InvitePreview, InviteState } from "./groupLinks";
import { pageMetadata } from "./seo";
import { translate, translateCount } from "@/lib/i18n";

// What a link to a group looks like when it is pasted into a chat — an invite
// (/invite/<code>) or the group's own address (/groups/<id>). The group's
// name, its description, how many are in it, and its icon as the picture,
// the way a chat app previews a group invite.
//
// Only ever from what the group's public card already says (the invite
// preview, or a public group's preview): a private group's address previews
// as "a group on GoLive" and nothing more, since the link alone is no proof
// that whoever pasted it may see what is inside.

type PreviewGroup = InvitePreview["group"];

/** "Grupo oficial do Go Live · 10 membros". The count is what the description cannot say. */
function describeGroup(group: PreviewGroup): string {
  const members = translateCount("common.memberCount", group.memberCount);
  const text = group.description.trim().replace(/\s+/g, " ");
  return text ? `${text} · ${members}` : translate("groupMetadata.groupOnGoliveMembers", { members });
}

/** The group's icon as the picture, or the site's card with the group's name when it has none. */
function picture(group: PreviewGroup, subtitle: string) {
  return group.iconUrl
    ? { thumbnail: group.iconUrl }
    : { card: { title: group.name, subtitle, badge: translate("common.group") } };
}

export function groupLinkMetadata({
  path,
  kind,
  group,
  inviteState = "ok",
}: {
  /** Site-relative, with the leading slash. */
  path: string;
  kind: "invite" | "group";
  /** The group's public card, or null when there is none to show. */
  group: PreviewGroup | null;
  /** For an invite: whether it still lets anybody in. */
  inviteState?: InviteState;
}): Metadata {
  if (!group) {
    return kind === "invite"
      ? pageMetadata({
          path,
          title: translate("groupMetadata.inviteToAGroup"),
          description: translate("groupMetadata.youHaveBeenInvitedToA"),
          noindex: true,
          card: { title: translate("groupMetadata.inviteToAGroup"), subtitle: translate("groupMetadata.openTheLinkToSee"), badge: translate("common.groups") },
        })
      : pageMetadata({
          path,
          title: translate("groupMetadata.groupOnGolive"),
          description: translate("groupMetadata.permanentVoiceAndTextRoomsWith"),
          noindex: true,
          card: { title: translate("groupMetadata.groupOnGolive"), subtitle: translate("groupMetadata.voiceAndTextRoomsWithYour"), badge: translate("common.groups") },
        });
  }

  // An invite that no longer lets anybody in says so up front, rather than
  // inviting somebody into a group the link will then turn them away from.
  if (kind === "invite" && inviteState !== "ok") {
    const description = translate("groupMetadata.thisInviteToNameIsNo", { name: group.name });
    return pageMetadata({ path, title: translate("common.invalidInvite"), description, noindex: true, ...picture(group, description) });
  }

  const description = describeGroup(group);
  return pageMetadata({
    path,
    title: kind === "invite" ? translate("groupMetadata.inviteToName", { name: group.name }) : group.name,
    description,
    noindex: true,
    ...picture(group, description),
  });
}

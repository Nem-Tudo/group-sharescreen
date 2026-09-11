import type { Metadata } from "next";
import type { InvitePreview, InviteState } from "./groupLinks";
import { pageMetadata } from "./seo";

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
  const members = `${group.memberCount} ${group.memberCount === 1 ? "membro" : "membros"}`;
  const text = group.description.trim().replace(/\s+/g, " ");
  return text ? `${text} · ${members}` : `Grupo no GoLive · ${members}`;
}

/** The group's icon as the picture, or the site's card with the group's name when it has none. */
function picture(group: PreviewGroup, subtitle: string) {
  return group.iconUrl
    ? { thumbnail: group.iconUrl }
    : { card: { title: group.name, subtitle, badge: "Grupo" } };
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
          title: "Convite para um grupo",
          description: "Você foi convidado para um grupo no GoLive.",
          noindex: true,
          card: { title: "Convite para um grupo", subtitle: "Abra o link para ver", badge: "Grupos" },
        })
      : pageMetadata({
          path,
          title: "Grupo no GoLive",
          description: "Salas de voz e de texto permanentes com seus amigos, no GoLive.",
          noindex: true,
          card: { title: "Grupo no GoLive", subtitle: "Salas de voz e de texto com seus amigos", badge: "Grupos" },
        });
  }

  // An invite that no longer lets anybody in says so up front, rather than
  // inviting somebody into a group the link will then turn them away from.
  if (kind === "invite" && inviteState !== "ok") {
    const description = `Este convite para "${group.name}" não vale mais — peça um novo a alguém do grupo.`;
    return pageMetadata({ path, title: "Convite inválido", description, noindex: true, ...picture(group, description) });
  }

  const description = describeGroup(group);
  return pageMetadata({
    path,
    title: kind === "invite" ? `Convite para ${group.name}` : group.name,
    description,
    noindex: true,
    ...picture(group, description),
  });
}

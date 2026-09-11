import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { InviteClient } from "@/components/groups/InviteClient";
import { fetchInvitePreview } from "@/lib/groupLinks";
import { groupLinkMetadata } from "@/lib/groupMetadata";

// /invite/:code — what a group's invite link opens. The preview is read on the
// server so the card a chat app shows for the link is the group's — its name,
// description, size and icon (see lib/groupMetadata); whether the person
// opening it is already in, and accepting, happen in the browser.

export async function generateMetadata(props: PageProps<"/invite/[code]">): Promise<Metadata> {
  const { code } = await props.params;
  const preview = await fetchInvitePreview(code);
  return groupLinkMetadata({
    path: `/invite/${code}`,
    kind: "invite",
    group: preview?.group ?? null,
    inviteState: preview?.invite.state,
  });
}

export default async function InvitePage(props: PageProps<"/invite/[code]">) {
  const { code } = await props.params;
  const preview = await fetchInvitePreview(code);
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <InviteClient code={code} initialPreview={preview} />
    </div>
  );
}

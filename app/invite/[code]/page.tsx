import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { InviteClient } from "@/components/groups/InviteClient";
import { fetchInvitePreview } from "@/lib/groupLinks";

// /invite/:code — what a group's invite link opens. The preview is read on the
// server so the title a chat app shows for the link names the group; whether
// the person opening it is already in, and accepting, happen in the browser.

export async function generateMetadata(props: PageProps<"/invite/[code]">): Promise<Metadata> {
  const { code } = await props.params;
  const preview = await fetchInvitePreview(code);
  const name = preview?.group.name;
  return {
    title: name ? `Convite para ${name}` : "Convite para um grupo",
    description: name
      ? `Você foi convidado para o grupo "${name}" no GoLive. Abra o link para entrar.`
      : "Você foi convidado para um grupo no GoLive.",
    robots: { index: false, follow: false },
  };
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

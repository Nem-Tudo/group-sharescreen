import type { Metadata } from "next";
import { UserProfileClient } from "./UserProfileClient";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata(
  props: PageProps<"/user/[id]">
): Promise<Metadata> {
  const { id } = await props.params;
  return pageMetadata({
    path: `/user/${id}`,
    title: `Perfil de ${id}`,
    description: `Veja o perfil de ${id} no GoLive.`,
    noindex: true,
    card: {
      title: id,
      subtitle: "Perfil no GoLive",
      badge: "Perfil",
    },
  });
}

export default async function UserProfilePage(props: PageProps<"/user/[id]">) {
  const { id } = await props.params;
  return <UserProfileClient id={id} />;
}

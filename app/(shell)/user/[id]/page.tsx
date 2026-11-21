import type { Metadata } from "next";
import { UserProfileClient } from "./UserProfileClient";
import { pageMetadata } from "@/lib/seo";
import { translate } from "@/lib/i18n";

export async function generateMetadata(
  props: PageProps<"/user/[id]">
): Promise<Metadata> {
  const { id } = await props.params;
  return pageMetadata({
    path: `/user/${id}`,
    title: translate("user.idSProfile", { id }),
    description: translate("user.seeIdSProfileOnGolive", { id }),
    noindex: true,
    card: {
      title: id,
      subtitle: translate("user.profileOnGolive"),
      badge: translate("common.profile"),
    },
  });
}

export default async function UserProfilePage(props: PageProps<"/user/[id]">) {
  const { id } = await props.params;
  return <UserProfileClient id={id} />;
}

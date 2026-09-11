import { GroupIndex } from "@/components/groups/GroupPages";

// /groups/:id — lands on a room. Which one is decided in the browser (the room
// this group was last left on lives in localStorage), so this page is only the
// redirect and the "not found" for a group that is not yours.
export default async function GroupIndexPage(props: PageProps<"/groups/[groupId]">) {
  const { groupId } = await props.params;
  return <GroupIndex groupId={groupId} />;
}

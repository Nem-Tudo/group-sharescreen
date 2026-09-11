import { GroupRoom } from "@/components/groups/GroupPages";

// /groups/:id/:room — a text room, or a voice room. A voice room renders nothing
// here: the call is owned by the group shell (see GroupAppShell), so that it
// keeps running while this page changes under it.
export default async function GroupRoomPage(props: PageProps<"/groups/[groupId]/[roomId]">) {
  const { groupId, roomId } = await props.params;
  return <GroupRoom groupId={groupId} roomId={roomId} />;
}

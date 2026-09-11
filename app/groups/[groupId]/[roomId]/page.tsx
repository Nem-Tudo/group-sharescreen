// /groups/:id/:room — a text room, or a voice room. Drawn by the group shell
// from the address, like every page under /groups: moving between rooms is a
// pushState that never asks the server for this page (see
// components/groups/GroupAppShell and lib/groupNavigation). It exists so the
// address resolves on a reload or a shared link.
export default function GroupRoomPage() {
  return null;
}

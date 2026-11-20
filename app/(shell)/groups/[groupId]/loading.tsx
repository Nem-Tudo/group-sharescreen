// Nothing to show: the group shell draws the room from the address the moment
// it changes (see components/groups/GroupAppShell). What this file buys is
// prefetching. A dynamic route without a loading boundary is not prefetched at
// all, so arriving in a group from outside /groups — the home page's group
// list, say — waited on the server before anything moved. With one, the shared
// layout (the shell) is prefetched down to here and the navigation is
// immediate.
export default function GroupLoading() {
  return null;
}

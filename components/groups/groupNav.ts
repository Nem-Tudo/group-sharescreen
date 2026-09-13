"use client";

import { createContext, useContext } from "react";

// Lets anything inside the group shell open the rooms drawer on a phone — the
// text room's header, the call's header — without the shell passing a prop
// through every page in between. Provided by GroupAppShell.

export const GroupNavContext = createContext<{ openNav: () => void; openMembers: () => void }>({
  openNav: () => {},
  // The group's people as a sheet over the page, on a phone — where there is
  // no column for them (see GroupAppShell).
  openMembers: () => {},
});

export function useGroupNav() {
  return useContext(GroupNavContext);
}

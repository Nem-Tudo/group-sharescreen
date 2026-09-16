"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { rememberScreen, takeScreenToRestore } from "@/lib/lastScreen";

// Mounted once in the root layout. Inside the desktop or Android app, reopens
// the screen that was on show when the app was closed, and keeps that record
// current. See lib/lastScreen.ts for the rules (never a call).
export function LastScreenRestorer() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const target = takeScreenToRestore();
    if (target) router.replace(target);
  }, [router]);

  // On every route change, and again when the app is hidden: the group shell
  // moves between rooms with pushState, and reading the live address on the
  // way out catches whatever it last showed.
  useEffect(() => {
    rememberScreen(window.location.pathname + window.location.search);
  }, [pathname]);

  useEffect(() => {
    const save = () => rememberScreen(window.location.pathname + window.location.search);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", save);
    };
  }, []);

  return null;
}

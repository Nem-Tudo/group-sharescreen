"use client";

import { useEffect, useRef } from "react";
import { pushBackHandler } from "@/lib/nativeApp";

/**
 * While `active`, Android's back button calls `onBack` instead of leaving the
 * page — for a sheet, a panel or a drawer that back should close first. The
 * newest active one wins (see lib/nativeApp's back stack).
 *
 * Harmless in a browser: nothing there calls the stack, so this only
 * registers and unregisters.
 */
export function useBackHandler(active: boolean, onBack: () => void): void {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });
  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => latest.current());
  }, [active]);
}

"use client";

import { useEffect, useRef } from "react";
import { clearCallOutlet, setCallOutlet } from "@/lib/callSession";

// Somewhere for the call to be drawn.
//
// Renders an empty box and says where it is; the room itself is mounted once
// at the root and moved in here (see components/RoomCallHost). A page that
// wants the call on screen renders one of these where the room used to be —
// and a page that does not simply leaves the call docked, still connected.

export function CallOutlet({
  className = "flex min-h-0 flex-1 flex-col",
}: {
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    setCallOutlet(el);
    return () => clearCallOutlet(el);
  }, []);
  return <div ref={ref} className={className} />;
}

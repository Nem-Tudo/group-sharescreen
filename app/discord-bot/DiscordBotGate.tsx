"use client";

import { notFound } from "next/navigation";
import { useDiscordBotHidden } from "@/lib/discordBotHidden";

// The page is still in the server HTML (search engines read it), just invisible
// until the experiment is decided — so the treatment side never sees it flash
// before the 404.
export function DiscordBotGate({ children }: { children: React.ReactNode }) {
  const { hidden, show } = useDiscordBotHidden(true);
  if (hidden) notFound();
  return <div className="contents" style={show ? undefined : { visibility: "hidden" }}>{children}</div>;
}

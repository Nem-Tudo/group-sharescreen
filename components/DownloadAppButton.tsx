"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FaApple, FaLinux, FaWindows } from "react-icons/fa";
import { isDesktopApp } from "@/lib/desktop";
import { detectDownloadPlatform, type DownloadPlatform } from "@/lib/downloadTargets";
import { trackDownloadClick, type DownloadSource } from "@/lib/analytics";
import { Tooltip } from "./Tooltip";

// Offers the desktop build, labelled for the machine the visitor is on.
//
// Renders nothing in two cases, both on purpose:
//   - inside the app itself, where offering to download it is nonsense;
//   - on phones and anything unrecognised, since only Windows, macOS and
//     Linux are built (see electron-builder.yml) and a button that leads to
//     a file you cannot run is worse than no button.
//
// The platform detection is the same function the /download route uses, so
// the label and the file can never disagree about what "your system" means.

const LABEL: Record<DownloadPlatform, { text: string; Icon: typeof FaWindows }> = {
  win: { text: "Baixar para Windows", Icon: FaWindows },
  mac: { text: "Baixar para macOS", Icon: FaApple },
  linux: { text: "Baixar para Linux", Icon: FaLinux },
};

export function DownloadAppButton({
  source,
  className = "",
}: {
  // Required, not defaulted: every surface that offers the download has to
  // say which one it is, or the metric silently merges them.
  source: DownloadSource;
  className?: string;
}) {
  // navigator does not exist during the server render, so the platform is
  // resolved after mount. Deferred by a tick rather than set synchronously
  // in the effect body — the cascading-render pattern React 19 warns about,
  // same gate the home page and WatchRoom use.
  const [platform, setPlatform] = useState<DownloadPlatform | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      if (isDesktopApp()) return;
      setPlatform(detectDownloadPlatform(navigator.userAgent));
    }, 0);
    return () => clearTimeout(id);
  }, []);

  if (!platform) return null;
  const { text, Icon } = LABEL[platform];

  return (
    // Lands on /app, not on /download: the file itself is one click further
    // in, and this way someone who has never heard of the desktop build gets
    // told what it is before a 100 MB installer starts downloading. /app
    // keeps the same platform detection, so the button they find there is
    // the one this label promised.
    <Tooltip content="Remova o eco, obtenha melhor desempenho e mais.">
      <Link
        href="/app"
        onClick={() => trackDownloadClick(source, platform)}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 ${className}`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {text}
      </Link>
    </Tooltip>
  );
}

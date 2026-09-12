"use client";

import Link from "next/link";
import { UserProfileCard } from "@/components/UserProfileCard";
import { useProfileSongAutoplay } from "@/lib/profileSong";
import { AdsterraNative } from "@/components/AdsterraNative";
import { useT } from "@/lib/useI18n";

// The standalone profile page. Everything that is actually *the profile* now
// lives in components/UserProfileCard, which the room's dialog renders too —
// this file is only what is page-specific: the surrounding layout and the way
// back out. Before that split, opening a profile from a room meant a new tab
// showing this page, and the two would have drifted the moment either changed.
export function UserProfileClient({ id }: { id: string }) {
  const t = useT();
  // The listener's own setting (see lib/profileSong). Read through a store
  // rather than an effect so the first render already has the answer — a
  // song must not start while the page is still deciding whether it may.
  const autoplay = useProfileSongAutoplay();

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-10 dark:bg-black sm:py-16">
      <main className="w-full max-w-2xl">
        <Link
          href="/"
          className="text-sm font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {t("common.backToGolive")}
        </Link>
        <div className="mt-4">
          {/* Autoplay only here: this page is somebody opening a profile on
              purpose. The room's popup passes nothing and gets a play button. */}
          <UserProfileCard id={id} autoPlaySong={autoplay} />
        </div>
        <AdsterraNative className="mt-8" />
      </main>
    </div>
  );
}

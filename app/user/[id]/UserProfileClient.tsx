"use client";

import Link from "next/link";
import { UserProfileCard } from "@/components/UserProfileCard";

// The standalone profile page. Everything that is actually *the profile* now
// lives in components/UserProfileCard, which the room's dialog renders too —
// this file is only what is page-specific: the surrounding layout and the way
// back out. Before that split, opening a profile from a room meant a new tab
// showing this page, and the two would have drifted the moment either changed.
export function UserProfileClient({ id }: { id: string }) {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-10 dark:bg-black sm:py-16">
      <main className="w-full max-w-2xl">
        <Link
          href="/"
          className="text-sm font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Voltar para o GoLive
        </Link>
        <div className="mt-4">
          <UserProfileCard id={id} />
        </div>
      </main>
    </div>
  );
}

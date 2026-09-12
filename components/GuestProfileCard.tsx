"use client";

import { MdPersonOutline } from "react-icons/md";
import { SocialActions } from "@/components/SocialActions";
import { UserAvatar } from "@/components/UserAvatar";
import { useT } from "@/lib/useI18n";

// The profile of somebody who has no profile.
//
// A guest is a name and a face for as long as they are in the room and nothing
// after that: no account, no history, no stats, nothing to be friends with.
// Clicking their name used to do nothing at all, which is the honest amount of
// information but the wrong amount of explanation — a name that is a button
// everywhere else and inert here reads as broken, not as meaningful.
//
// So the card exists and says what it knows, which is little on purpose. Its
// job is to answer "who is this?" with "somebody without an account", and to
// explain why the three things you would want to do next are unavailable.
//
// Deliberately not fetched: there is nothing to fetch. Everything here comes
// from the participant list that was already on screen, which is also why it
// opens instantly while a real profile takes a request.

export function GuestProfileCard({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string | null;
}) {
  const t = useT();
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
      {/* A flat band where a real profile has its banner. Not an empty banner
          area: the space is what makes a profile look like a profile, and
          leaving it blank would read as an image that failed to load. */}
      <div className="h-20 bg-gradient-to-r from-zinc-200 to-zinc-100 dark:from-zinc-900 dark:to-zinc-800" />

      <div className="px-6 pb-6">
        <div className="-mt-10 flex items-end gap-4">
          <UserAvatar
            src={avatarUrl}
            name={name}
            size={80}
            className="ring-4 ring-white dark:ring-zinc-950"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h2 className="truncate text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            {name}
          </h2>
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            <MdPersonOutline className="h-3.5 w-3.5" />
            {t("common.guest")}
          </span>
        </div>

        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {t("guestProfileCard.theyAreInTheRoomWithout")}
        </p>

        {/* The same three buttons every other profile has, disabled and saying
            why. `userId` is the guest id — never an account — so nothing here
            could act on it even if it were pressed; the reason is what the
            component is actually being given. */}
        <SocialActions
          userId=""
          displayName={name}
          className="mt-5"
          unavailable={`${name} precisa criar uma conta para isso`}
        />
      </div>
    </div>
  );
}

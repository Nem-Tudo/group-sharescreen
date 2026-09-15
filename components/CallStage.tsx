"use client";

import type { ReactNode } from "react";
import { MdMicOff } from "react-icons/md";
import { UserAvatar } from "@/components/UserAvatar";
import { useSpeaking } from "@/lib/useSpeaking";

// What a direct call looks like while nobody is sharing anything: the people
// in it, as faces.
//
// A call is not a room with an empty stage — "ninguém está transmitindo" is
// the wrong thing to say to two people who are talking to each other. So the
// call shows who is on it, who is speaking, and whose microphone is off, the
// way every other call on every other app does; sharing a screen or a camera
// takes the space over (see WatchRoom's tile grid), and this comes back when
// it stops.

export type CallStagePerson = {
  /** Stable per participant, for React's list. */
  key: string;
  name: string;
  avatarUrl: string | null;
  /** Whose face it is, for the presence dot. Absent for a guest. */
  userId?: string | null;
  isGuest?: boolean;
  micOn: boolean;
  /** Their microphone, for the ring that says they are talking. */
  micStream: MediaStream | null;
};

export function CallStage({ people, footer }: { people: CallStagePerson[]; footer?: ReactNode }) {
  // Two faces are big; a call that grew a few more shrinks them rather than
  // scrolling, since the whole point is seeing everybody at once.
  const size = people.length <= 2 ? 96 : people.length <= 4 ? 72 : 56;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto rounded-xl bg-zinc-100 px-4 py-6 dark:bg-zinc-900/60">
      <ul className="flex flex-wrap items-start justify-center gap-x-8 gap-y-6">
        {people.map((person) => (
          <CallStageFace key={person.key} person={person} size={size} />
        ))}
      </ul>
      {footer}
    </div>
  );
}

function CallStageFace({ person, size }: { person: CallStagePerson; size: number }) {
  // Only a live microphone can be speaking: a muted one goes on producing
  // sound in the browser's eyes, and a ring around somebody nobody can hear
  // is a lie.
  const speaking = useSpeaking(person.micOn ? person.micStream : null);
  return (
    <li className="flex w-28 flex-col items-center gap-2 text-center">
      <span
        className={`relative flex items-center justify-center rounded-full transition-[box-shadow,transform] duration-150 ${
          speaking
            ? "shadow-[0_0_0_3px_var(--color-emerald-500)] scale-105"
            : "shadow-[0_0_0_3px_transparent]"
        }`}
      >
        <UserAvatar
          src={person.avatarUrl}
          name={person.name}
          size={size}
          userId={person.userId}
          isGuest={person.isGuest}
        />
        {!person.micOn && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-white ring-2 ring-zinc-100 dark:bg-zinc-950 dark:ring-zinc-900">
            <MdMicOff className="h-3.5 w-3.5" />
          </span>
        )}
      </span>
      <span className="w-full truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {person.name}
      </span>
    </li>
  );
}

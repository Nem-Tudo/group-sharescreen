"use client";

import type { ReactNode } from "react";
import { MdMicOff } from "react-icons/md";
import { UserAvatar } from "@/components/UserAvatar";
import { HeadphonesOffIcon, MicOffIcon } from "@/components/icons";
import { Tooltip } from "@/components/Tooltip";
import { useT } from "@/lib/useI18n";
import { useSpeaking } from "@/lib/useSpeaking";
import { avatarShapeClass } from "@/lib/avatarShape";

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
  /** A room manager turned their mic off — the badge goes red. */
  silenced?: boolean;
  /** They turned everybody else's sound off: talking to them reaches nobody. */
  deafened?: boolean;
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
        className={`relative flex items-center justify-center ${avatarShapeClass(person.avatarUrl)} transition-[box-shadow,transform] duration-150 ${
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
        {(!person.micOn || person.silenced) && (
          <span className={`absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full ${person.silenced ? "bg-red-600" : "bg-zinc-800 dark:bg-zinc-950"} text-white ring-2 ring-zinc-100 dark:ring-zinc-900`}>
            <MdMicOff className="h-3.5 w-3.5" />
          </span>
        )}
        {/* The other corner, since it is a different fact from the mic and
            both can be true at once (deafening closes the mic too). */}
        {person.deafened && (
          <span className="absolute -bottom-0.5 -left-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-white ring-2 ring-zinc-100 dark:bg-zinc-950 dark:ring-zinc-900">
            <HeadphonesOffIcon className="h-3.5 w-3.5" />
          </span>
        )}
      </span>
      <span className="w-full truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {person.name}
      </span>
    </li>
  );
}

// The same people while something *is* being shared, as one slim row under
// the video. The screen takes the stage over, and with it went the only place
// a call said whose mic was off or who had deafened — the participants column
// is not drawn in a call at all — so somebody watching a screen had no way to
// tell whether the other end could hear them. A row of small faces costs the
// video one short line and says it all again.
export function CallPeopleStrip({ people }: { people: CallStagePerson[] }) {
  return (
    <ul className="flex shrink-0 items-center justify-center gap-2 overflow-x-auto py-0.5">
      {people.map((person) => (
        <CallStripChip key={person.key} person={person} />
      ))}
    </ul>
  );
}

function CallStripChip({ person }: { person: CallStagePerson }) {
  const t = useT();
  const speaking = useSpeaking(person.micOn ? person.micStream : null);
  const micOff = !person.micOn || person.silenced;
  return (
    <li className="flex min-w-0 max-w-48 shrink-0 items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pr-3 pl-1 dark:border-zinc-800 dark:bg-zinc-950">
      <span
        className={`flex shrink-0 ${avatarShapeClass(person.avatarUrl)} transition-shadow duration-150 ${
          speaking ? "shadow-[0_0_0_2px_var(--color-emerald-500)]" : "shadow-[0_0_0_2px_transparent]"
        }`}
      >
        <UserAvatar
          src={person.avatarUrl}
          name={person.name}
          size={24}
          userId={person.userId}
          isGuest={person.isGuest}
        />
      </span>
      <span className="min-w-0 truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{person.name}</span>
      {micOff &&
        (person.silenced ? (
          <Tooltip content={t("participantRow.mutedByAdmin", { name: person.name })}>
            <span className="flex shrink-0 items-center">
              <MicOffIcon className="h-4 w-4 text-red-500" />
            </span>
          </Tooltip>
        ) : (
          <MicOffIcon className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
        ))}
      {person.deafened && (
        <Tooltip content={t("participantRow.nameHasMutedTheMicrophonesAnd", { name: person.name })}>
          <span className="flex shrink-0 items-center">
            <HeadphonesOffIcon className="h-4 w-4 text-zinc-500" />
          </span>
        </Tooltip>
      )}
    </li>
  );
}

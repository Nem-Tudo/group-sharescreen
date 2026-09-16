"use client";

import { useState, type FormEvent } from "react";
import { MdClose, MdGroupAdd, MdGroups, MdLock, MdShield, MdVolumeUp } from "react-icons/md";
import { Tooltip } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import { DialogFrame, inputClass, secondaryButton, type PopupProps } from "@/components/groups/dialogKit";
import { signalingClient } from "@/lib/signalingClient";
import { useT } from "@/lib/useI18n";
import { avatarShapeClass } from "@/lib/avatarShape";

// Turning an ordinary room into a group, the way somebody in it finds out it
// can be done: a button after the room's last participant (see WatchRoom), and
// the dialog it opens. The room's owner creates the group; everybody in the
// room is made a member and taken to its voice room on the spot (see the
// server's "room-convert-to-group"). Everybody else sees the same button,
// switched off, saying whose call it is — a thing nobody sees is a thing nobody
// asks their owner for.

/** Somebody in the room, as the card and the dialog draw them. */
export interface RoomToGroupPerson {
  key: string;
  name: string;
  avatarUrl?: string | null;
}

/** From how many people in the room — you included — the button is worth showing. */
export const ROOM_TO_GROUP_MIN_PEOPLE = 2;

const DISMISS_KEY_PREFIX = "sharescreen:roomToGroupDismissed:";

/** The API's MAX_GROUP_NAME_LENGTH — the same cap the create-group dialog has. */
const MAX_GROUP_NAME_LENGTH = 50;

/** Whether the button was closed in this room, on this browser. */
export function isRoomToGroupDismissed(handle: string): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY_PREFIX + handle) === "1";
  } catch {
    return false;
  }
}

export function dismissRoomToGroup(handle: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY_PREFIX + handle, "1");
  } catch {
    // Private mode, blocked storage: it just comes back next time.
  }
}

/** A row of overlapping faces, the rest as "+N". */
function Faces({ people, max, size }: { people: RoomToGroupPerson[]; max: number; size: number }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((person, i) => (
        <span
          key={person.key}
          className={`flex shrink-0 ${avatarShapeClass(person.avatarUrl)} ring-2 ring-white dark:ring-zinc-950 ${i > 0 ? "-ml-2" : ""}`}
          title={person.name}
        >
          <UserAvatar src={person.avatarUrl} name={person.name} size={size} />
        </span>
      ))}
      {rest > 0 && (
        <span
          className="-ml-2 flex shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white ring-2 ring-white dark:ring-zinc-950"
          style={{ width: size, height: size }}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}

/**
 * One slim row at the end of the participant list — drawn like the list's own
 * rows, so it reads as something the list offers rather than an ad inside it.
 */
export function RoomToGroupButton({
  canConvert,
  needsAccount,
  ownerName,
  onConvert,
  onCreateAccount,
  onDismiss,
}: {
  /** This person owns the room and has an account — the only one the button works for. */
  canConvert: boolean;
  /** Owns the room, but as a guest: the button is a way to an account first. */
  needsAccount: boolean;
  ownerName: string | null;
  onConvert: () => void;
  onCreateAccount: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const enabled = canConvert || needsAccount;
  const lockedHint = ownerName
    ? t("roomToGroup.onlyOwnerNamed", { name: ownerName })
    : t("roomToGroup.onlyOwner");

  return (
    <div className="flex items-center gap-0.5">
      {/* Off for everybody but the owner, with the reason on hover. */}
      <Tooltip content={enabled ? null : lockedHint} wrapperClassName="flex min-w-0 flex-1">
        <button
          type="button"
          disabled={!enabled}
          onClick={needsAccount ? onCreateAccount : onConvert}
          className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-emerald-600/40 px-2.5 text-left text-sm font-medium text-emerald-700 transition hover:border-emerald-600 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:text-zinc-400 disabled:hover:bg-transparent dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/40 dark:disabled:border-zinc-700 dark:disabled:text-zinc-500"
        >
          {enabled ? <MdGroupAdd className="h-4 w-4 shrink-0" /> : <MdLock className="h-4 w-4 shrink-0" />}
          <span className="truncate">
            {needsAccount ? t("roomToGroup.createAccountToConvert") : t("roomToGroup.button")}
          </span>
        </button>
      </Tooltip>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("roomToGroup.dismiss")}
        title={t("roomToGroup.dismiss")}
        className="flex h-8 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
      >
        <MdClose className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── The dialog ───────────────────────────────────────────────────────────

export function RoomToGroupDialog({
  closePopup,
  data,
}: PopupProps<{ defaultName: string; people: RoomToGroupPerson[] }>) {
  const t = useT();
  const people = data?.people ?? [];
  const [name, setName] = useState((data?.defaultName ?? "").slice(0, MAX_GROUP_NAME_LENGTH));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signalingClient.convertRoomToGroup(name.trim());
      // Where to go next is the room's business: everybody in it, us
      // included, is told and taken there (see WatchRoom's roomConverted).
      closePopup(true);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : t("roomToGroup.failed"));
    }
  }

  // Who comes along, by name — everybody but whoever is looking at this.
  const others = people.filter((p) => p.key !== "self");
  const [first, second] = others.map((p) => p.name);
  const rest = others.length - 2;
  const whoComes =
    rest > 0
      ? t("roomToGroup.whoComesMany", { a: first, b: second, count: rest })
      : second
        ? t("roomToGroup.whoComesTwo", { a: first, b: second })
        : t("roomToGroup.whoComesOne", { a: first ?? "" });

  return (
    <DialogFrame title={t("roomToGroup.dialogTitle")} onClose={() => closePopup(false)}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-50 px-3 py-4 text-center dark:bg-emerald-950/40">
          <Faces people={people} max={7} size={36} />
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{whoComes}</p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("groups.groupDialogs.groupName")}</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_GROUP_NAME_LENGTH}
            placeholder={t("groups.groupDialogs.exGamingCrew")}
            className={inputClass}
          />
        </label>

        <ul className="flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <li className="flex gap-2">
            <MdVolumeUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            {t("roomToGroup.pointMove")}
          </li>
          <li className="flex gap-2">
            <MdLock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            {t("roomToGroup.pointPrivate")}
          </li>
          <li className="flex gap-2">
            <MdShield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            {t("roomToGroup.pointOwner")}
          </li>
        </ul>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => closePopup(false)} className={secondaryButton}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MdGroups className="h-5 w-5 shrink-0" />
            {busy ? t("common.creating") : t("roomToGroup.confirm")}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

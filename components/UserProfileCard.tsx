"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchUserProfile, formatDuration, type UserProfile } from "@/lib/userProfile";
import { VerifiedBadgeIcon, MicIcon, ScreenIcon } from "@/components/icons";
import { BsCoin, BsClock } from "react-icons/bs";
import { hasVerifiedBadge } from "@/lib/entitlements";
import { SocialActions } from "@/components/SocialActions";

// A person's public profile, as a self-contained card.
//
// Lifted out of app/user/[id]/UserProfileClient so the page and the in-room
// dialog (components/UserProfileDialog) show the same thing rather than two
// drifting copies of it — the room used to send people to the page in a new
// tab, which is a lot of ceremony for "who is this?" while you are in a call
// with them. The page still exists and is still the thing a link points at;
// this is just the part that was never page-specific.

const cardClass =
  "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";

// One of the three lifetime totals shown below the bio — same card shape for
// call/mic/share time so the three read as one set, not three different
// widgets that happen to sit next to each other.
function StatCard({
  icon,
  label,
  seconds,
}: {
  icon: React.ReactNode;
  label: string;
  seconds: number;
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 text-lg font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
        {formatDuration(seconds)}
      </p>
    </div>
  );
}

/**
 * Fetches `id` and renders its profile, including the loading and
 * not-found states.
 *
 * `onNavigate` fires when something inside is about to take the person
 * somewhere else — today only the "they are in a room right now" link. The
 * page has nowhere to go and leaves it out; the dialog uses it to close
 * itself, so a click does not leave a modal hanging over the destination.
 */
export function UserProfileCard({
  id,
  onNavigate,
}: {
  id: string;
  onNavigate?: () => void;
}) {
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);

  // Keeps whatever's already on screen while a new id loads, rather than
  // flashing back to "Carregando..." — the aborted fetch below (on id
  // change/unmount) is what keeps a slow response for a since-abandoned id
  // from landing after the fact.
  useEffect(() => {
    const controller = new AbortController();
    fetchUserProfile(id, controller.signal)
      .then(setProfile)
      .catch((err) => {
        // A superseded request (id changed, or this profile unmounted)
        // aborts on purpose — that's not "not found," it's just stale, and
        // the effect that fired it no longer cares about the answer.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setProfile(null);
      });
    return () => controller.abort();
  }, [id]);

  if (profile === undefined) return <ProfileSkeleton />;
  if (profile === null) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Não foi possível encontrar esse perfil.
        </p>
      </div>
    );
  }
  return <ProfileContent profile={profile} onNavigate={onNavigate} />;
}

// The profile's own shape while it is still arriving.
//
// It replaced the line "Carregando perfil...", which was honest and told you
// nothing: the dialog opened at one size showing a sentence, then jumped to
// another size showing a card. Tracing the real layout means the only thing
// that changes when the fetch lands is that the grey blocks become content —
// the box never resizes, which matters far more here than on a page, because
// this one is centred over a room and every resize moves it.
//
// Mirrors ProfileContent below deliberately: same banner height, same rounded
// container, same three-column stat grid. Those values being duplicated is
// the cost, and the thing to check if that layout is ever reworked — a
// skeleton that no longer matches is a shape that jumps, which is worse than
// no skeleton at all.
const SKELETON_BLOCK = "animate-pulse rounded-md bg-zinc-200/80 dark:bg-zinc-800/80";

function ProfileSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      aria-busy="true"
      aria-label="Carregando perfil"
    >
      <div className={`h-32 w-full rounded-none sm:h-44 ${SKELETON_BLOCK}`} />
      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        <div className="flex flex-wrap items-end justify-between gap-3 pt-4">
          <div className="min-w-0 flex-1">
            {/* Display name, then @username — the two-line block the real
                header has, at the sizes it actually renders at. */}
            <div className={`h-7 w-44 ${SKELETON_BLOCK}`} />
            <div className={`mt-2 h-4 w-28 ${SKELETON_BLOCK}`} />
          </div>
          <div className={`h-9 w-28 shrink-0 rounded-full ${SKELETON_BLOCK}`} />
        </div>

        {/* The bio: two lines of unequal length, because a paragraph that
            loads as two identical bars reads as a table, not as prose. */}
        <div className={`mt-5 h-4 w-full ${SKELETON_BLOCK}`} />
        <div className={`mt-2 h-4 w-2/3 ${SKELETON_BLOCK}`} />

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className={`h-[74px] rounded-xl ${SKELETON_BLOCK}`} />
          <div className={`h-[74px] rounded-xl ${SKELETON_BLOCK}`} />
          <div className={`h-[74px] rounded-xl ${SKELETON_BLOCK}`} />
        </div>

        <div className={`mt-5 h-3 w-40 ${SKELETON_BLOCK}`} />
      </div>
    </div>
  );
}

function ProfileContent({
  profile,
  onNavigate,
}: {
  profile: UserProfile;
  onNavigate?: () => void;
}) {
  const { account, live } = profile;
  const verified = hasVerifiedBadge(account?.flags);
  const memberSince = new Date(account.createdAt).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {/* Purely decorative — a set banner image, or a fallback gradient so a
          profile with none still reads as "a profile page", not an empty bar. */}
      <div
        className="h-32 w-full sm:h-44"
        style={
          account.bannerUrl
            ? {
                backgroundImage: `url(${account.bannerUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : {
                background: "linear-gradient(135deg, #18181b 0%, #10b981 140%)",
              }
        }
      />

      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        <div className="flex flex-wrap items-end justify-between gap-3 pt-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-1.5 truncate text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              <span style={account.equippedNameColor ? { color: account.equippedNameColor } : undefined}>
                {account.displayName}
              </span>
              {verified && <VerifiedBadgeIcon className="h-6 w-6 shrink-0 text-blue-500" />}
            </h1>
            <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">@{account.username}</p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-semibold text-amber-700 dark:text-amber-400">
            <BsCoin className="h-4 w-4 shrink-0" />
            {account.points ?? 0} pontos
          </span>
        </div>

        {live && (
          <Link
            href={`/watch/${live.room}`}
            onClick={onNavigate}
            className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-400"
          >
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
            Está numa sala pública agora — {live.peopleCount}{" "}
            {live.peopleCount === 1 ? "pessoa" : "pessoas"}, entrar em &quot;{live.room}&quot;
          </Link>
        )}

        <p className="mt-4 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">
          {account.bio || "Sem descrição."}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            icon={<BsClock className="h-3.5 w-3.5" />}
            label="Tempo em call"
            seconds={account.callSeconds ?? 0}
          />
          <StatCard
            icon={<MicIcon className="h-3.5 w-3.5" />}
            label="Tempo com o mic aberto"
            seconds={account.micSeconds ?? 0}
          />
          <StatCard
            icon={<ScreenIcon className="h-3.5 w-3.5" />}
            label="Tempo compartilhando tela"
            seconds={account.shareSeconds ?? 0}
          />
        </div>

        {/* Adding and blocking live on the profile because that is where you
            land after clicking a name anywhere else — the room's participant
            list, a chat message, the header. See components/SocialActions. */}
        <SocialActions
          userId={account.id}
          displayName={account.displayName}
          className="mt-5"
        />

        <p className="mt-5 text-xs text-zinc-400 dark:text-zinc-600">No GoLive desde {memberSince}.</p>
      </div>
    </div>
  );
}

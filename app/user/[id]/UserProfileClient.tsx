"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchUserProfile, formatDuration, type UserProfile } from "@/lib/userProfile";
import { VerifiedBadgeIcon, MicIcon, ScreenIcon } from "@/components/icons";
import { BsCoin, BsClock } from "react-icons/bs";

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

export function UserProfileClient({ id }: { id: string }) {
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

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-10 dark:bg-black sm:py-16">
      <main className="w-full max-w-2xl">
        <Link
          href="/"
          className="text-sm font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Voltar para o GoLive
        </Link>

        {profile === undefined ? (
          <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">Carregando perfil...</p>
        ) : profile === null ? (
          <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Não foi possível encontrar esse perfil.
            </p>
          </div>
        ) : (
          <ProfileContent profile={profile} />
        )}
      </main>
    </div>
  );
}

function ProfileContent({ profile }: { profile: UserProfile }) {
  const { account, live } = profile;
  const verified = account.flags?.includes("VERIFIED") ?? false;
  const memberSince = new Date(account.createdAt).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
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

        <p className="mt-5 text-xs text-zinc-400 dark:text-zinc-600">No GoLive desde {memberSince}.</p>
      </div>
    </div>
  );
}

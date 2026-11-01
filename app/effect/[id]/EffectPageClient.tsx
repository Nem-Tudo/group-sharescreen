"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MdCheck, MdFavorite, MdFavoriteBorder, MdFlag, MdOutlineShowChart, MdPeople } from "react-icons/md";
import { EffectAuthor, ReportDialog, takeAndWear } from "@/components/CameraEffectBrowser";
import { CopyButton } from "@/components/CopyButton";
import { UserProfileDialog } from "@/components/UserProfileDialog";
import { useAuth } from "@/lib/AuthContext";
import { useCameraEffectSettings } from "@/lib/cameraEffects";
import { CAMERA_CUSTOM_FEATURE, useCustomCameraEffects } from "@/lib/cameraCustomEffects";
import {
  CAMERA_WORKSHOP_FEATURE,
  effectLink,
  fetchWorkshopEffectInfo,
  likeWorkshopEffect,
  workshopPreviewUrl,
  type WorkshopEffect,
} from "@/lib/cameraEffectWorkshop";
import { useFeature } from "@/lib/features";
import { useT } from "@/lib/useI18n";

// One effect's public page. Only for who is in the experiments, as the workshop
// is: anyone else could not use what it offers, and goes to the themes.
export function EffectPageClient({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const { account } = useAuth();
  const workshop = useFeature(CAMERA_WORKSHOP_FEATURE, { track: true });
  const custom = useFeature(CAMERA_CUSTOM_FEATURE, { track: false });
  const allowed = workshop.enabled && custom.enabled;
  const decided = workshop.ready && custom.ready;
  const local = useCustomCameraEffects();
  const settings = useCameraEffectSettings();
  const [effect, setEffect] = useState<WorkshopEffect | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [useFailed, setUseFailed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    if (decided && !allowed) router.replace("/workshop");
  }, [decided, allowed, router]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchWorkshopEffectInfo(id, controller.signal).then((info) => {
      if (controller.signal.aborted) return;
      setEffect(info);
      setMissing(info === null);
    });
    return () => controller.abort();
  }, [id, account?.id]);

  if (!allowed) return null;

  if (missing) {
    return (
      <main className="mx-auto w-full max-w-md grow px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{t("cameraWorkshop.notFound")}</h1>
        <Link
          href="/workshop/effects"
          className="mt-4 inline-block rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
        >
          {t("cameraWorkshop.discover")}
        </Link>
      </main>
    );
  }

  if (!effect) {
    return (
      <main className="mx-auto w-full max-w-3xl grow px-4 py-16">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>
      </main>
    );
  }

  const mine = account?.id === effect.authorId;
  const copy = local.find((item) => item.sourceId === effect.id || item.publishedId === effect.id);
  const inUse = copy !== undefined && settings.custom === copy.id;

  const take = async () => {
    setBusy(true);
    setUseFailed(false);
    const done = await takeAndWear(effect.id);
    setBusy(false);
    setUseFailed(!done);
  };

  const like = async () => {
    const answer = await likeWorkshopEffect(effect.id, !effect.liked);
    if (answer) setEffect({ ...effect, ...answer });
  };

  const secondary =
    "flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

  return (
    <main className="mx-auto flex w-full max-w-3xl grow flex-col gap-6 px-4 py-10 sm:flex-row">
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the API, with its own cache */}
      <img
        src={workshopPreviewUrl(effect)}
        alt=""
        className="aspect-square w-full max-w-xs shrink-0 self-center rounded-2xl bg-zinc-800 object-cover sm:self-start"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight break-words text-zinc-950 dark:text-zinc-50">{effect.name}</h1>
        <EffectAuthor effect={effect} onOpen={() => setProfileOpen(true)} />
        {effect.description && <p className="text-sm break-words text-zinc-600 dark:text-zinc-300">{effect.description}</p>}
        <div className="flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
          <button
            type="button"
            disabled={!account}
            aria-pressed={effect.liked}
            aria-label={t("cameraWorkshop.like")}
            title={account ? t("cameraWorkshop.like") : t("cameraWorkshop.likeNeedsAccount")}
            onClick={() => void like()}
            className="inline-flex items-center gap-1 disabled:cursor-default"
          >
            {effect.liked ? <MdFavorite className="h-4 w-4 text-rose-500" /> : <MdFavoriteBorder className="h-4 w-4" />}
            {effect.likes}
          </button>
          <span className="inline-flex items-center gap-1" title={t("cameraWorkshop.uses")}>
            <MdPeople className="h-4 w-4" />
            {effect.uses}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!mine && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void take()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {inUse && <MdCheck className="h-4 w-4" />}
              {busy ? t("cameraWorkshop.downloading") : inUse ? t("cameraWorkshop.inUse") : t("cameraWorkshop.use")}
            </button>
          )}
          <CopyButton value={effectLink(effect.id)} label={t("common.copyLink")} />
          {mine && (
            <Link href={`/effect/${encodeURIComponent(effect.id)}/panel`} className={secondary}>
              <MdOutlineShowChart className="h-4 w-4" />
              {t("cameraWorkshop.panel")}
            </Link>
          )}
          {account && !mine && (
            <button type="button" disabled={reported} onClick={() => setReporting(true)} className={secondary}>
              <MdFlag className="h-4 w-4" />
              {t(reported ? "cameraWorkshop.reported" : "cameraWorkshop.report")}
            </button>
          )}
        </div>
        {inUse && <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("cameraWorkshop.inUseHint")}</p>}
        {useFailed && <p className="text-xs text-red-600 dark:text-red-400">{t("cameraWorkshop.useError")}</p>}
      </div>
      {profileOpen && <UserProfileDialog userId={effect.authorId} onClose={() => setProfileOpen(false)} />}
      {reporting && (
        <ReportDialog
          effect={effect}
          onClose={() => setReporting(false)}
          onSent={() => {
            setReported(true);
            setReporting(false);
          }}
        />
      )}
    </main>
  );
}

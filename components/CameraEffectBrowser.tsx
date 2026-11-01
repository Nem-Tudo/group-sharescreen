"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { MdAutoAwesome, MdCheck, MdFavorite, MdFavoriteBorder, MdFlag, MdPeople } from "react-icons/md";
import { markFeatureUsed } from "@/components/NewBadge";
import { useAuth } from "@/lib/AuthContext";
import { setCameraEffect, useCameraEffectSettings } from "@/lib/cameraEffects";
import { CAMERA_CUSTOM_FEATURE, useCustomCameraEffects } from "@/lib/cameraCustomEffects";
import {
  CAMERA_WORKSHOP_EVENTS,
  CAMERA_WORKSHOP_FEATURE,
  EFFECT_REPORT_REASONS,
  fetchMyWorkshopEffects,
  fetchWorkshopEffects,
  likeWorkshopEffect,
  reportWorkshopEffect,
  takeWorkshopEffect,
  trackWorkshop,
  unpublishWorkshopEffect,
  workshopPreviewUrl,
  type EffectReportReason,
  type WorkshopEffect,
  type WorkshopEffectSort,
} from "@/lib/cameraEffectWorkshop";
import { setTileExperimentMode } from "@/lib/clipsMode";
import { useFeature } from "@/lib/features";
import { useT } from "@/lib/useI18n";

// The effects workshop's grid (see lib/cameraEffectWorkshop), the same in its page
// and in the room's popup, where the camera is right behind it to try one on.

const SORTS: { sort: WorkshopEffectSort; label: string }[] = [
  { sort: "trending", label: "cameraWorkshop.sortTrending" },
  { sort: "popular", label: "cameraWorkshop.sortPopular" },
  { sort: "recent", label: "cameraWorkshop.sortRecent" },
  { sort: "liked", label: "cameraWorkshop.sortLiked" },
];
const PAGE = 24;

const CHIP = "rounded-md px-2.5 py-1 text-xs font-medium transition";
const CHIP_ON = "bg-emerald-600 text-white";
const CHIP_OFF =
  "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700";

// Above the room's popup (z-60), and in a portal: a card is too small to hold it.
function ReportDialog({ effect, onClose, onSent }: { effect: WorkshopEffect; onClose: () => void; onSent: () => void }) {
  const t = useT();
  const [reason, setReason] = useState<EffectReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setFailed(false);
    const done = await reportWorkshopEffect(effect.id, reason, note);
    setBusy(false);
    if (done) onSent();
    else setFailed(true);
  };
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="flex w-full max-w-sm flex-col gap-3 rounded-2xl bg-white p-4 shadow-2xl dark:bg-zinc-950">
        <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{t("cameraWorkshop.reportTitle", { name: effect.name })}</h3>
        <div className="flex flex-wrap gap-1">
          {EFFECT_REPORT_REASONS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={reason === item}
              onClick={() => setReason(item)}
              className={`${CHIP} ${reason === item ? CHIP_ON : CHIP_OFF}`}
            >
              {t(`cameraWorkshop.reportReason.${item}`)}
            </button>
          ))}
        </div>
        <textarea
          value={note}
          maxLength={300}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("cameraWorkshop.reportNote")}
          aria-label={t("cameraWorkshop.reportNote")}
          className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {failed && <p className="text-xs text-red-600 dark:text-red-400">{t("cameraWorkshop.reportError")}</p>}
        <div className="flex justify-end gap-1">
          <button type="button" onClick={onClose} className={`${CHIP} ${CHIP_OFF}`}>
            {t("common.cancel")}
          </button>
          <button type="button" disabled={!reason || busy} onClick={() => void send()} className={`${CHIP} ${CHIP_ON} disabled:opacity-50`}>
            {t("cameraWorkshop.reportSend")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function CameraEffectBrowser() {
  const t = useT();
  const { account } = useAuth();
  const local = useCustomCameraEffects();
  const settings = useCameraEffectSettings();
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [sort, setSort] = useState<WorkshopEffectSort>("trending");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [effects, setEffects] = useState<WorkshopEffect[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [useFailed, setUseFailed] = useState(false);
  const [limit, setLimit] = useState<number | null | undefined>(undefined);
  const [reporting, setReporting] = useState<WorkshopEffect | null>(null);
  const [reported, setReported] = useState<string[]>([]);

  useEffect(() => {
    trackWorkshop(CAMERA_WORKSHOP_EVENTS.open);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      if (tab === "mine") {
        const mine = await fetchMyWorkshopEffects(controller.signal);
        if (controller.signal.aborted) return;
        setEffects(mine?.effects ?? []);
        setLimit(mine ? mine.limit : undefined);
        setHasMore(false);
        setFailed(!mine);
      } else {
        const page = await fetchWorkshopEffects({ sort, query, limit: PAGE }, controller.signal);
        if (controller.signal.aborted) return;
        setEffects(page.effects);
        setHasMore(page.hasMore);
        setFailed(!page.ok);
      }
      setLoading(false);
    };
    void load();
    return () => controller.abort();
  }, [tab, sort, query]);

  const loadMore = async () => {
    setLoading(true);
    const page = await fetchWorkshopEffects({ sort, query, limit: PAGE, offset: effects.length });
    setEffects((current) => [...current, ...page.effects.filter((item) => !current.some((seen) => seen.id === item.id))]);
    setHasMore(page.hasMore);
    setLoading(false);
  };

  const take = async (effect: WorkshopEffect) => {
    setBusy(effect.id);
    setUseFailed(false);
    const localId = await takeWorkshopEffect(effect.id);
    setBusy(null);
    if (!localId) {
      setUseFailed(true);
      return;
    }
    setCameraEffect("custom", localId);
    setTileExperimentMode("cameraEffects", true);
    markFeatureUsed(CAMERA_CUSTOM_FEATURE);
  };

  const like = async (effect: WorkshopEffect) => {
    const answer = await likeWorkshopEffect(effect.id, !effect.liked);
    if (!answer) return;
    setEffects((current) => current.map((item) => (item.id === effect.id ? { ...item, ...answer } : item)));
  };

  const unpublish = async (effect: WorkshopEffect) => {
    setBusy(effect.id);
    if (await unpublishWorkshopEffect(effect.id)) {
      setEffects((current) => current.filter((item) => item.id !== effect.id));
    }
    setBusy(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <button type="button" aria-pressed={tab === "all"} onClick={() => setTab("all")} className={`${CHIP} ${tab === "all" ? CHIP_ON : CHIP_OFF}`}>
            {t("cameraWorkshop.tabAll")}
          </button>
          {account && (
            <button type="button" aria-pressed={tab === "mine"} onClick={() => setTab("mine")} className={`${CHIP} ${tab === "mine" ? CHIP_ON : CHIP_OFF}`}>
              {t("cameraWorkshop.tabMine")}
            </button>
          )}
        </div>
        {tab === "all" ? (
          <>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("cameraWorkshop.search")}
              aria-label={t("cameraWorkshop.search")}
              className="min-w-0 flex-1 basis-40 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <div className="flex gap-1">
              {SORTS.map((item) => (
                <button
                  key={item.sort}
                  type="button"
                  aria-pressed={sort === item.sort}
                  onClick={() => {
                    if (item.sort !== sort) trackWorkshop(CAMERA_WORKSHOP_EVENTS.sort);
                    setSort(item.sort);
                  }}
                  className={`${CHIP} ${sort === item.sort ? CHIP_ON : CHIP_OFF}`}
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          </>
        ) : (
          limit !== undefined && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {limit === null
                ? t("cameraWorkshop.countNoLimit", { count: effects.length })
                : t("cameraWorkshop.count", { count: effects.length, limit })}
            </span>
          )
        )}
      </div>

      {useFailed && <p className="text-xs text-red-600 dark:text-red-400">{t("cameraWorkshop.useError")}</p>}
      {failed && <p className="text-sm text-red-600 dark:text-red-400">{t("cameraWorkshop.loadError")}</p>}
      {!loading && !failed && effects.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {tab === "mine" ? t("cameraWorkshop.emptyMine") : t("cameraWorkshop.empty")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {effects.map((effect) => {
          const copy = local.find((item) => item.sourceId === effect.id || item.publishedId === effect.id);
          const inUse = copy !== undefined && settings.custom === copy.id;
          return (
            <article key={effect.id} className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
              {/* eslint-disable-next-line @next/next/no-img-element -- served by the API, with its own cache */}
              <img src={workshopPreviewUrl(effect)} alt="" loading="lazy" className="aspect-square w-full rounded-lg bg-zinc-800 object-cover" />
              <h3 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{effect.name}</h3>
              {effect.authorUsername && (
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">@{effect.authorUsername}</p>
              )}
              {effect.description && (
                <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{effect.description}</p>
              )}
              <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <button
                  type="button"
                  disabled={!account}
                  aria-pressed={effect.liked}
                  aria-label={t("cameraWorkshop.like")}
                  title={account ? t("cameraWorkshop.like") : t("cameraWorkshop.likeNeedsAccount")}
                  onClick={() => void like(effect)}
                  className="inline-flex items-center gap-0.5 disabled:cursor-default"
                >
                  {effect.liked ? <MdFavorite className="h-3.5 w-3.5 text-rose-500" /> : <MdFavoriteBorder className="h-3.5 w-3.5" />}
                  {effect.likes}
                </button>
                <span className="inline-flex items-center gap-0.5" title={t("cameraWorkshop.uses")}>
                  <MdPeople className="h-3.5 w-3.5" />
                  {effect.uses}
                </span>
                {account && effect.authorId !== account.id && (
                  <button
                    type="button"
                    disabled={reported.includes(effect.id)}
                    aria-label={t(reported.includes(effect.id) ? "cameraWorkshop.reported" : "cameraWorkshop.report")}
                    title={t(reported.includes(effect.id) ? "cameraWorkshop.reported" : "cameraWorkshop.report")}
                    onClick={() => setReporting(effect)}
                    className="ml-auto inline-flex items-center hover:text-red-600 disabled:text-red-600 dark:hover:text-red-400 dark:disabled:text-red-400"
                  >
                    <MdFlag className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {tab === "mine" ? (
                <button type="button" disabled={busy === effect.id} onClick={() => void unpublish(effect)} className={`${CHIP} ${CHIP_OFF} text-red-600 disabled:opacity-50 dark:text-red-400`}>
                  {t("cameraWorkshop.unpublish")}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy === effect.id}
                  onClick={() => void take(effect)}
                  className={`${CHIP} ${inUse ? CHIP_ON : CHIP_OFF} inline-flex items-center justify-center gap-1 disabled:opacity-50`}
                >
                  {inUse && <MdCheck className="h-3.5 w-3.5" />}
                  {busy === effect.id
                    ? t("cameraWorkshop.downloading")
                    : inUse
                      ? t("cameraWorkshop.inUse")
                      : t("cameraWorkshop.use")}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {reporting && (
        <ReportDialog
          effect={reporting}
          onClose={() => setReporting(null)}
          onSent={() => {
            setReported((current) => [...current, reporting.id]);
            setReporting(null);
          }}
        />
      )}

      {tab === "all" && hasMore && (
        <button type="button" disabled={loading} onClick={() => void loadMore()} className={`${CHIP} ${CHIP_OFF} self-center disabled:opacity-50`}>
          {t("cameraWorkshop.loadMore")}
        </button>
      )}
    </div>
  );
}

// The popup, registered as "camera_effect_workshop" in NtPopups.tsx.
export function CameraEffectWorkshopPopup({
  closePopup,
  popupstyles,
}: {
  closePopup: (hasAction?: boolean) => void;
  popupstyles: Record<string, string>;
}) {
  const t = useT();
  return (
    <>
      <div className={popupstyles.header}>
        <span>{t("cameraWorkshop.title")}</span>
      </div>
      <div className={`${popupstyles.body} min-h-0 overflow-y-auto`}>
        <CameraEffectBrowser />
      </div>
      <div className={popupstyles.footer}>
        <button type="button" className={popupstyles.baseButton} base-button-style="0" onClick={() => closePopup(true)}>
          {t("common.close")}
        </button>
      </div>
    </>
  );
}

// The page, at /workshop/effects. Only for who is in the experiment: anyone else
// goes to the themes, which is the workshop they know.
export function CameraEffectWorkshopPage() {
  const t = useT();
  const router = useRouter();
  const workshop = useFeature(CAMERA_WORKSHOP_FEATURE, { track: true });
  const custom = useFeature(CAMERA_CUSTOM_FEATURE, { track: false });
  const allowed = workshop.enabled && custom.enabled;
  const decided = workshop.ready && custom.ready;
  useEffect(() => {
    if (decided && !allowed) router.replace("/workshop");
  }, [decided, allowed, router]);
  if (!allowed) return null;
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        <MdAutoAwesome className="h-6 w-6 shrink-0 text-emerald-500" />
        {t("cameraWorkshop.title")}
      </h1>
      <p className="mt-1 mb-6 text-sm text-zinc-500 dark:text-zinc-400">{t("cameraWorkshop.subtitle")}</p>
      <CameraEffectBrowser />
    </div>
  );
}

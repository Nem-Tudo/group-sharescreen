"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MdAdd,
  MdAutoAwesome,
  MdCheck,
  MdClose,
  MdFavorite,
  MdFavoriteBorder,
  MdFlag,
  MdOpenInNew,
  MdOutlineShowChart,
  MdPeople,
  MdSearch,
} from "react-icons/md";
import { CopyButton } from "@/components/CopyButton";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { UserProfileDialog } from "@/components/UserProfileDialog";
import { verifiedBadge } from "@/lib/entitlements";
import { markFeatureUsed } from "@/components/NewBadge";
import { useAuth } from "@/lib/AuthContext";
import { setCameraEffect, useCameraEffectSettings } from "@/lib/cameraEffects";
import {
  CAMERA_CUSTOM_FEATURE,
  createCustomCameraEffect,
  openCustomEffectEditor,
  useCustomCameraEffects,
  useCustomEffectPreview,
} from "@/lib/cameraCustomEffects";
import {
  CAMERA_WORKSHOP_EVENTS,
  CAMERA_WORKSHOP_FEATURE,
  EFFECT_REPORT_REASONS,
  effectLink,
  fetchMyWorkshopEffects,
  fetchWorkshopEffects,
  likeWorkshopEffect,
  reportWorkshopEffect,
  startEffectTrial,
  stopEffectTrial,
  useEffectTrial,
  takeWorkshopEffect,
  trackWorkshop,
  unpublishWorkshopEffect,
  workshopPreviewUrl,
  type EffectReportReason,
  type WorkshopEffect,
  type WorkshopEffectSort,
} from "@/lib/cameraEffectWorkshop";
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

/** Adds it to "Meus efeitos", to be picked there like any other. Says whether that worked. */
export async function addToLibrary(id: string): Promise<boolean> {
  const localId = await takeWorkshopEffect(id);
  if (!localId) return false;
  markFeatureUsed(CAMERA_CUSTOM_FEATURE);
  return true;
}

/** Who made it, drawn as they are everywhere else. Opens their profile in place. */
export function EffectAuthor({ effect, onOpen }: { effect: WorkshopEffect; onOpen: () => void }) {
  const t = useT();
  const { author } = effect;
  if (!author) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("common.seeDisplaynameSProfile", { displayName: author.displayName })}
      className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left text-xs text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      <UserAvatar src={author.avatarUrl} name={author.displayName} size={20} className="shrink-0" userId={author.id} />
      <DisplayUserName
        name={author.displayName}
        verified={verifiedBadge(author.flags)}
        bot={author.bot}
        color={author.nameColor}
        className="truncate"
      />
    </button>
  );
}

// Above the room's popup (z-60), and in a portal: a card is too small to hold it.
export function ReportDialog({ effect, onClose, onSent }: { effect: WorkshopEffect; onClose: () => void; onSent: () => void }) {
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

// The camera with the effect being tried on, since the dialog covers the room's tile.
function EffectTrialBar() {
  const t = useT();
  const trial = useEffectTrial();
  const { track, fallbackMirrored } = useCustomEffectPreview();
  const video = useRef<HTMLVideoElement>(null);
  const showing = Boolean(trial);
  useEffect(() => {
    if (video.current) video.current.srcObject = track ? new MediaStream([track]) : null;
  }, [track, showing]);
  if (!trial) return null;
  const facing = track?.getSettings().facingMode;
  const mirrored = facing ? facing === "user" : fallbackMirrored;
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2 sm:px-5 dark:border-zinc-800 dark:bg-zinc-900">
      <video ref={video} autoPlay muted playsInline className={`h-24 w-40 shrink-0 rounded-lg bg-black object-cover ${mirrored ? "-scale-x-100" : ""}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t("cameraWorkshop.trying", { name: trial.name })}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t(track ? "cameraWorkshop.tryingHint" : "cameraWorkshop.tryNoCamera")}</p>
      </div>
      <button
        type="button"
        onClick={stopEffectTrial}
        className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {t("cameraWorkshop.tryStop")}
      </button>
    </div>
  );
}

export function CameraEffectBrowser({ inPopup = false }: { inPopup?: boolean }) {
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
  const trial = useEffectTrial();
  const [reported, setReported] = useState<string[]>([]);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  // In the room's popup, a link must not take the person out of their call.
  const linkTarget = inPopup ? "_blank" : undefined;

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
    const done = await addToLibrary(effect.id);
    setBusy(null);
    setUseFailed(!done);
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

  // A new effect in "Meus efeitos", opened in the room's editor (see
  // CameraCustomEffectHost), on top of this popup: its publish section is there.
  const create = () => {
    const effect = createCustomCameraEffect(t("watch.watchRoom.cameraCustomDefaultName", { count: local.length + 1 }));
    if (!effect) {
      setUseFailed(true);
      return;
    }
    trackWorkshop(CAMERA_WORKSHOP_EVENTS.create);
    stopEffectTrial();
    setCameraEffect("custom", effect.id);
    markFeatureUsed(CAMERA_CUSTOM_FEATURE);
    openCustomEffectEditor(effect.id);
  };

  const primary =
    "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
  const outlined =
    "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
  const action = "w-full rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60";

  return (
    <div className={`relative flex flex-col ${inPopup ? "min-h-0 flex-1" : ""}`}>
      {inPopup && <EffectTrialBar />}
      {/* The search and the filters, as in the themes' dialog (see ThemeBrowser). */}
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-zinc-200 px-4 py-3 sm:px-5 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
            {(account ? (["all", "mine"] as const) : (["all"] as const)).map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setTab(entry)}
                aria-pressed={tab === entry}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  tab === entry
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                {entry === "all" ? t("common.discover") : t("cameraWorkshop.tabMine")}
              </button>
            ))}
          </div>
          {/* Only in the room: the editor lives there, next to the camera. */}
          {inPopup && tab === "all" && (
            <button
              type="button"
              onClick={create}
              className="ml-auto inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >
              <MdAdd className="h-4 w-4" />
              {t("cameraWorkshop.createAndPublish")}
            </button>
          )}
          {tab === "mine" && limit !== undefined && (
            <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
              {limit === null
                ? t("cameraWorkshop.countNoLimit", { count: effects.length })
                : t("cameraWorkshop.count", { count: effects.length, limit })}
            </span>
          )}
        </div>

        {tab === "all" && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex min-w-0 flex-[1_1_16rem] items-center">
              <MdSearch className="pointer-events-none absolute left-2.5 h-4 w-4 text-zinc-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("cameraWorkshop.search")}
                aria-label={t("cameraWorkshop.search")}
                maxLength={80}
                className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500 [&::-webkit-search-cancel-button]:hidden"
              />
            </label>
            <select
              value={sort}
              onChange={(e) => {
                trackWorkshop(CAMERA_WORKSHOP_EVENTS.sort);
                setSort(e.target.value as WorkshopEffectSort);
              }}
              aria-label={t("themeBrowser.sortBy")}
              className="rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs font-medium text-zinc-700 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            >
              {SORTS.map((item) => (
                <option key={item.sort} value={item.sort}>
                  {t(item.label)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className={`px-4 py-4 sm:px-5 ${inPopup ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>
        {useFailed && (
          <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {t("cameraWorkshop.useError")}
          </p>
        )}
        {failed && <p className="text-sm text-red-600 dark:text-red-400">{t("cameraWorkshop.loadError")}</p>}
        {!loading && !failed && effects.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {tab === "mine" ? t("cameraWorkshop.emptyMine") : t("cameraWorkshop.empty")}
          </p>
        )}
        {loading && effects.length === 0 && <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>}

        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
          {effects.map((effect) => {
            const copy = local.find((item) => item.sourceId === effect.id || item.publishedId === effect.id);
            const inUse = copy !== undefined && settings.custom === copy.id;
            const wasReported = reported.includes(effect.id);
            return (
              <li
                key={effect.id}
                className={`flex min-w-0 flex-col overflow-hidden rounded-xl border bg-white transition dark:bg-zinc-950 ${
                  inUse
                    ? "border-emerald-500 ring-1 ring-emerald-500"
                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                }`}
              >
                <div className="relative">
                  <Link href={`/effect/${encodeURIComponent(effect.id)}`} target={linkTarget} aria-label={effect.name} className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element -- served by the API, with its own cache */}
                    <img src={workshopPreviewUrl(effect)} alt="" loading="lazy" className="aspect-square w-full bg-zinc-800 object-cover" />
                  </Link>
                  {inUse && (
                    <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
                      {t("cameraWorkshop.inUse")}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={!account}
                    aria-label={t("cameraWorkshop.like")}
                    aria-pressed={effect.liked}
                    title={account ? t("cameraWorkshop.like") : t("cameraWorkshop.likeNeedsAccount")}
                    onClick={() => void like(effect)}
                    className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm transition hover:bg-black/75"
                  >
                    {effect.liked ? <MdFavorite className="h-3.5 w-3.5 shrink-0 text-rose-400" /> : <MdFavoriteBorder className="h-3.5 w-3.5 shrink-0" />}
                    {effect.likes}
                  </button>
                </div>

                <div className="flex flex-1 flex-col gap-1.5 border-t border-zinc-100 p-2.5 dark:border-zinc-900">
                  <div className="flex min-w-0 items-center gap-1">
                    <Link
                      href={`/effect/${encodeURIComponent(effect.id)}`}
                      target={linkTarget}
                      title={effect.name}
                      className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
                    >
                      {effect.name}
                    </Link>
                    <CopyButton
                      value={effectLink(effect.id)}
                      label={t("common.copyLink")}
                      compact
                      className="flex shrink-0 items-center rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                    />
                  </div>
                  <EffectAuthor effect={effect} onOpen={() => setProfileUserId(effect.authorId)} />
                  {effect.description && <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{effect.description}</p>}
                  <div className="mt-auto flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="inline-flex items-center gap-0.5" title={t("cameraWorkshop.uses")}>
                      <MdPeople className="h-3.5 w-3.5" />
                      {effect.uses}
                    </span>
                    {account && effect.authorId !== account.id && (
                      <button
                        type="button"
                        disabled={wasReported}
                        aria-label={t(wasReported ? "cameraWorkshop.reported" : "cameraWorkshop.report")}
                        title={t(wasReported ? "cameraWorkshop.reported" : "cameraWorkshop.report")}
                        onClick={() => setReporting(effect)}
                        className="ml-auto inline-flex items-center hover:text-red-600 disabled:text-red-600 dark:hover:text-red-400 dark:disabled:text-red-400"
                      >
                        <MdFlag className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {tab === "mine" ? (
                    <div className="flex flex-col gap-1">
                      <Link
                        href={`/effect/${encodeURIComponent(effect.id)}/panel`}
                        target={linkTarget}
                        className={`${action} ${outlined} inline-flex items-center justify-center gap-1`}
                      >
                        <MdOutlineShowChart className="h-3.5 w-3.5" />
                        {t("cameraWorkshop.panel")}
                      </Link>
                      <button
                        type="button"
                        disabled={busy === effect.id}
                        onClick={() => void unpublish(effect)}
                        className={`${action} ${outlined} text-red-600 dark:text-red-400`}
                      >
                        {t("cameraWorkshop.unpublish")}
                      </button>
                    </div>
                  ) : (
                    <>
                    {inPopup && (
                      <button
                        type="button"
                        onClick={() => {
                          if (trial?.id === effect.id) {
                            stopEffectTrial();
                            return;
                          }
                          setUseFailed(false);
                          void startEffectTrial(effect.id).then((done) => setUseFailed(!done));
                        }}
                        className={`${action} ${outlined}`}
                      >
                        {t(trial?.id === effect.id ? "cameraWorkshop.tryStop" : "cameraWorkshop.try")}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy === effect.id || copy !== undefined}
                      onClick={() => void take(effect)}
                      className={`${action} ${copy ? outlined : primary} inline-flex items-center justify-center gap-1`}
                    >
                      {copy && <MdCheck className="h-3.5 w-3.5" />}
                      {busy === effect.id
                        ? t("cameraWorkshop.downloading")
                        : copy
                          ? t("cameraWorkshop.added")
                          : t("cameraWorkshop.use")}
                    </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {tab === "all" && hasMore && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadMore()}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {loading ? t("common.loading") : t("cameraWorkshop.loadMore")}
            </button>
          </div>
        )}
      </div>

      {inPopup && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-4 py-2.5 text-[11px] text-zinc-500 sm:px-5 dark:border-zinc-800 dark:text-zinc-400">
          <span>{t("cameraWorkshop.subtitle")}</span>
          <Link href="/workshop/effects" target="_blank" className="flex items-center gap-1 font-medium underline-offset-2 transition hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
            {t("cameraWorkshop.openPage")}
            <MdOpenInNew className="h-3 w-3" />
          </Link>
        </div>
      )}

      {profileUserId && <UserProfileDialog userId={profileUserId} abovePopups={inPopup} onClose={() => setProfileUserId(null)} />}

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
    </div>
  );
}

// The popup, registered as "camera_effect_workshop" in NtPopups.tsx. A shell of its
// own instead of the library's header and footer, the same as the themes' dialog
// (see ThemeHubDialog): it also opens from inside a call, where leaving ends it.
export function CameraEffectWorkshopPopup({ closePopup }: { closePopup: (hasAction?: boolean) => void }) {
  const t = useT();
  // A try ends with the dialog: nothing stays on the camera without being added.
  useEffect(() => stopEffectTrial, []);
  return (
    <div className="flex h-[min(52rem,calc(100dvh-2.5rem))] w-[min(62rem,calc(100vw-2rem))] flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-3.5 sm:px-5 dark:border-zinc-800">
        <MdAutoAwesome className="h-5 w-5 shrink-0 text-emerald-500" />
        <h2 className="flex-1 text-base font-semibold tracking-tight">{t("cameraWorkshop.title")}</h2>
        <button type="button" onClick={() => closePopup(false)} aria-label={t("common.close")} className="-mr-1 rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200">
          <MdClose className="h-5 w-5" />
        </button>
      </div>
      <CameraEffectBrowser inPopup />
    </div>
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
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <CameraEffectBrowser />
      </div>
    </div>
  );
}

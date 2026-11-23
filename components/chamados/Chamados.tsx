"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  MdAdd,
  MdCheck,
  MdClose,
  MdForum,
  MdLink,
  MdMenuBook,
  MdMovie,
  MdOutlinedFlag,
  MdSportsEsports,
} from "react-icons/md";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { DisplayUserName } from "@/components/DisplayUserName";
import { Tooltip } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/lib/AuthContext";
import {
  CHAMADO_DURATIONS,
  CHAMADO_EVENTS,
  CHAMADO_KINDS,
  CHAMADO_NOTE_MAX,
  CHAMADO_SLOT_OPTIONS,
  CHAMADO_WHAT_MAX,
  chamadoFull,
  chamadoPath,
  chamadoSpotsLeft,
  createChamado,
  endChamado,
  patchChamado,
  refreshChamados,
  reportChamado,
  setChamadoGoing,
  trackChamado,
  useChamadosFeed,
  type Chamado,
  type ChamadoKind,
} from "@/lib/chamados";
import { verifiedBadge } from "@/lib/entitlements";
import { useT } from "@/lib/useI18n";

// The chamados on the groups home (experiment "chamados", see lib/chamados):
// a header with "Abrir chamado", then the open ones as cards, newest first
// with yours pinned at the front. Plain cards, the same as the friends' below
// them: what makes one stand out is what it says (the game, the film), set
// large.

export const CHAMADO_KIND_ICON: Record<ChamadoKind, typeof MdSportsEsports> = {
  play: MdSportsEsports,
  watch: MdMovie,
  talk: MdForum,
  study: MdMenuBook,
};

function minutesLeft(chamado: Chamado, now: number): number {
  return Math.max(0, Math.round((chamado.expiresAt - now) / 60_000));
}

/** Re-renders once a minute, for "acaba em" and "há". */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function ChamadosSection({ className = "" }: { className?: string }) {
  const t = useT();
  const { account } = useAuth();
  const { chamados } = useChamadosFeed(true);
  const [creating, setCreating] = useState(false);

  const mine = chamados?.find((c) => c.author?.id === account?.id) ?? null;
  const others = (chamados ?? []).filter((c) => c !== mine);
  const list = mine ? [mine, ...others] : others;

  return (
    <section className={`shrink-0 ${className}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t("chamados.title")}</h2>
        {chamados && chamados.length > 0 && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {chamados.length === 1 ? t("chamados.openOne") : t("chamados.openMany", { count: chamados.length })}
          </span>
        )}
        {!mine && (
          <button
            type="button"
            onClick={() => {
              trackChamado(CHAMADO_EVENTS.newOpen);
              setCreating(true);
            }}
            disabled={!account}
            title={account ? undefined : t("chamados.loginToCreate")}
            className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <MdAdd className="h-4 w-4" />
            {t("chamados.new")}
          </button>
        )}
      </div>

      {chamados === null ? (
        <ul aria-hidden className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-40 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
          ))}
        </ul>
      ) : list.length === 0 ? (
        <button
          type="button"
          onClick={() => {
            if (!account) return;
            trackChamado(CHAMADO_EVENTS.newOpen);
            setCreating(true);
          }}
          className="mt-3 w-full cursor-pointer rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
        >
          {t("chamados.empty")}
        </button>
      ) : (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-2">
          {list.map((chamado) => (
            <li key={chamado.id}>
              <ChamadoCard chamado={chamado} from="feed" />
            </li>
          ))}
        </ul>
      )}

      {creating && <NewChamadoDialog onClose={() => setCreating(false)} />}
    </section>
  );
}

/** One chamado. `from` is only for the join event: the feed's card or the chamado's own page. */
export function ChamadoCard({
  chamado,
  from,
  large = false,
  onUpdate,
}: {
  chamado: Chamado;
  from: "feed" | "page";
  large?: boolean;
  /** A fresh copy after this card changed it (the page keeps its own, outside the feed). */
  onUpdate?: (next: Chamado) => void;
}) {
  const t = useT();
  const router = useRouter();
  const { account } = useAuth();
  const now = useMinuteClock();
  const [busy, setBusy] = useState<"going" | "end" | "report" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reportAsk, setReportAsk] = useState(false);
  const [reported, setReported] = useState(false);

  const isMine = Boolean(account && chamado.author?.id === account.id);
  const imGoing = Boolean(account && chamado.going.some((user) => user.id === account.id));
  const full = chamadoFull(chamado);
  const spots = chamadoSpotsLeft(chamado);
  const Icon = CHAMADO_KIND_ICON[chamado.kind];
  const peopleIn = chamado.live?.peopleCount ?? 0;
  const left = minutesLeft(chamado, now);
  const open = chamado.status === "open" && chamado.handle !== null;

  function enter() {
    if (!chamado.handle) return;
    trackChamado(CHAMADO_EVENTS.join, { tags: { from } });
    router.push(`/watch/${chamado.handle}`);
  }

  async function toggleGoing() {
    if (!account || busy) return;
    setBusy("going");
    setError(null);
    const result = await setChamadoGoing(chamado.id, !imGoing);
    if (result.ok) {
      patchChamado(result.value);
      onUpdate?.(result.value);
    } else {
      setError(result.error);
      if (result.chamado) {
        patchChamado(result.chamado);
        onUpdate?.(result.chamado);
      }
    }
    setBusy(null);
  }

  async function end() {
    if (busy) return;
    setBusy("end");
    const result = await endChamado(chamado.id);
    if (result.ok) {
      trackChamado(CHAMADO_EVENTS.end);
      onUpdate?.({ ...chamado, status: "ended", handle: null, live: null });
      await refreshChamados();
    } else setError(result.error);
    setBusy(null);
  }

  async function report() {
    if (busy) return;
    setBusy("report");
    const result = await reportChamado(chamado.id);
    if (result.ok) {
      trackChamado(CHAMADO_EVENTS.report);
      setReported(true);
      setReportAsk(false);
    } else setError(result.error);
    setBusy(null);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${chamadoPath(chamado.id)}`);
      trackChamado(CHAMADO_EVENTS.share);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // No clipboard (an old webview): nothing to say, the link is on the page.
    }
  }

  const iconButton =
    "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";

  return (
    <article
      className={`flex h-full flex-col rounded-xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800 ${
        large ? "p-6" : "p-4"
      } ${isMine ? "ring-zinc-400 dark:ring-zinc-600" : ""}`}
    >
      <header className="flex items-center gap-2.5">
        {chamado.author && (
          <UserAvatar src={chamado.author.avatarUrl} name={chamado.author.displayName} size={28} userId={chamado.author.id} className="shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {chamado.author && (
            <DisplayUserName
              name={chamado.author.displayName}
              verified={verifiedBadge(chamado.author.flags)}
              flags={chamado.author.flags}
              color={chamado.author.nameColor}
              className="inline-flex max-w-[60%] truncate align-bottom text-sm font-medium text-zinc-900 dark:text-zinc-100"
            />
          )}{" "}
          {isMine ? t("chamados.yours") : t(`chamados.calls.${chamado.kind}`)}
        </span>
        <Tooltip content={copied ? t("chamados.copied") : t("chamados.copyLink")}>
          <button type="button" onClick={() => void copyLink()} aria-label={t("chamados.copyLink")} className={iconButton}>
            {copied ? <MdCheck className="h-4 w-4" /> : <MdLink className="h-4 w-4" />}
          </button>
        </Tooltip>
        {!isMine && account && !reported && (
          <Tooltip content={t("chamados.report")}>
            <button type="button" onClick={() => setReportAsk((v) => !v)} aria-label={t("chamados.report")} className={iconButton}>
              <MdOutlinedFlag className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </header>

      <div className="mt-3 flex items-start gap-2.5">
        <Icon className="mt-1 h-5 w-5 shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden />
        <div className="min-w-0">
          <p className={`break-words font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 ${large ? "text-2xl" : "text-lg leading-snug"}`}>
            {chamado.what}
          </p>
          {chamado.note && <p className="mt-1 break-words text-sm text-zinc-600 dark:text-zinc-400">{chamado.note}</p>}
        </div>
      </div>

      <div className="mt-auto pt-4">
        {open && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            {peopleIn > 0 ? (
              <span className="flex items-center gap-1.5">
                <span className="flex -space-x-1.5">
                  {chamado.live!.people.slice(0, 4).map((person, i) => (
                    <UserAvatar
                      key={`${person.accountId ?? person.name}-${i}`}
                      src={person.avatarUrl}
                      name={person.name}
                      size={20}
                      className="shrink-0 rounded-full ring-2 ring-white dark:ring-zinc-950"
                    />
                  ))}
                </span>
                {peopleIn === 1 ? t("chamados.inRoomOne") : t("chamados.inRoomMany", { count: peopleIn })}
              </span>
            ) : (
              <span>{t("chamados.roomEmpty")}</span>
            )}
            {chamado.goingCount > 0 && (
              <Tooltip content={chamado.going.map((user) => user.displayName).join(", ")}>
                <span className="underline decoration-dotted underline-offset-2">
                  {chamado.goingCount === 1 ? t("chamados.goingOne") : t("chamados.goingMany", { count: chamado.goingCount })}
                </span>
              </Tooltip>
            )}
            {full ? (
              <span className="font-medium text-red-600 dark:text-red-400">{t("chamados.full")}</span>
            ) : spots !== null ? (
              <span>{spots === 1 ? t("chamados.spotOne") : t("chamados.spotsMany", { count: spots })}</span>
            ) : null}
            <span className="ml-auto">{t("chamados.endsIn", { time: left < 60 ? `${left} min` : `${Math.round(left / 6) / 10} h` })}</span>
          </div>
        )}

        {reportAsk && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            {t("chamados.reportAsk")}
            <span className="flex gap-1">
              <button type="button" onClick={() => setReportAsk(false)} className="cursor-pointer rounded-md px-2 py-1 hover:bg-white dark:hover:bg-zinc-950">
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={busy === "report"}
                onClick={() => void report()}
                className="cursor-pointer rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {t("chamados.report")}
              </button>
            </span>
          </div>
        )}
        {reported && <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{t("chamados.reported")}</p>}
        {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

        {open ? (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={enter}
              disabled={full && !isMine}
              className="inline-flex flex-1 cursor-pointer items-center justify-center rounded-lg bg-zinc-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {isMine ? t("chamados.enterMine") : t("chamados.enter")}
            </button>
            {isMine ? (
              <button
                type="button"
                onClick={() => void end()}
                disabled={busy === "end"}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 ring-1 ring-zinc-300 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-900"
              >
                {busy === "end" && <ButtonSpinner />}
                {t("chamados.end")}
              </button>
            ) : account ? (
              <button
                type="button"
                onClick={() => void toggleGoing()}
                disabled={busy === "going" || (!imGoing && spots === 0)}
                aria-pressed={imGoing}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  imGoing
                    ? "bg-zinc-100 text-zinc-950 ring-1 ring-zinc-300 dark:bg-zinc-900 dark:text-zinc-50 dark:ring-zinc-700"
                    : "text-zinc-700 ring-1 ring-zinc-300 hover:bg-zinc-100 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {imGoing && <MdCheck className="h-4 w-4" />}
                {t("chamados.going")}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            {chamado.status === "expired" ? t("chamados.expired") : t("chamados.ended")}
          </p>
        )}
      </div>
    </article>
  );
}

const WHAT_PLACEHOLDER: Record<ChamadoKind, string> = {
  play: "chamados.whatPlay",
  watch: "chamados.whatWatch",
  talk: "chamados.whatTalk",
  study: "chamados.whatStudy",
};

/** The form. On success the author goes straight into the room they called people to. */
export function NewChamadoDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [kind, setKind] = useState<ChamadoKind>("play");
  const [what, setWhat] = useState("");
  const [note, setNote] = useState("");
  const [slots, setSlots] = useState<number>(4);
  const [duration, setDuration] = useState<number>(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const whatRef = useRef<HTMLInputElement | null>(null);
  const pressedBackdropRef = useRef(false);

  useEffect(() => {
    whatRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !what.trim()) return;
    setBusy(true);
    setError(null);
    const result = await createChamado({ kind, what: what.trim(), note: note.trim(), slots, durationMin: duration });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      if (result.chamado) void refreshChamados();
      return;
    }
    void refreshChamados();
    if (result.value.handle) router.push(`/watch/${result.value.handle}`);
    onClose();
  }

  const chip = (active: boolean) =>
    `cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active
        ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
        : "text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[8vh]"
      onPointerDown={(e) => {
        pressedBackdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const began = pressedBackdropRef.current;
        pressedBackdropRef.current = false;
        if (began && e.target === e.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={t("chamados.new")}
        onSubmit={submit}
        className="flex max-h-[84vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-zinc-950"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{t("chamados.new")}</h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t("chamados.newHint")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="cursor-pointer rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <Field label={t("chamados.kindLabel")}>
          <div className="grid grid-cols-4 gap-1.5">
            {CHAMADO_KINDS.map((option) => {
              const KindIcon = CHAMADO_KIND_ICON[option];
              const active = option === kind;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setKind(option)}
                  aria-pressed={active}
                  className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl px-2 py-3 text-sm font-medium transition ${
                    active
                      ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                      : "text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-900"
                  }`}
                >
                  <KindIcon className="h-5 w-5" />
                  {t(`chamados.kind.${option}`)}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={t(`chamados.whatLabel.${kind}`)}>
          <input
            ref={whatRef}
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            maxLength={CHAMADO_WHAT_MAX}
            placeholder={t(WHAT_PLACEHOLDER[kind])}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-base text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
        </Field>

        <Field label={t("chamados.noteLabel")} hint={`${note.length}/${CHAMADO_NOTE_MAX}`}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={CHAMADO_NOTE_MAX}
            rows={2}
            placeholder={t("chamados.notePlaceholder")}
            className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
        </Field>

        <Field label={t("chamados.slotsLabel")}>
          <div className="flex flex-wrap gap-1.5">
            {CHAMADO_SLOT_OPTIONS.map((option) => (
              <button key={option} type="button" onClick={() => setSlots(option)} aria-pressed={slots === option} className={chip(slots === option)}>
                {option === 0 ? t("chamados.noLimit") : option}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t("chamados.durationLabel")}>
          <div className="flex flex-wrap gap-1.5">
            {CHAMADO_DURATIONS.map((option) => (
              <button key={option} type="button" onClick={() => setDuration(option)} aria-pressed={duration === option} className={chip(duration === option)}>
                {option < 60 ? `${option} min` : `${option / 60} h`}
              </button>
            ))}
          </div>
        </Field>

        {error && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy || !what.trim()}
          className="mt-6 inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 py-3 text-base font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {busy && <ButtonSpinner />}
          {t("chamados.submit")}
        </button>
        <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">{t("chamados.submitHint")}</p>
      </form>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
        {hint && <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * The chamados as a side panel of the groups home's central (the "now"
 * layout puts it beside the room card): a header with "Abrir chamado", then
 * one row per chamado — who calls, for what, how full — with "Entrar". The
 * row itself opens the chamado's page, where the full card lives ("Tô
 * dentro", the link, report, end).
 */
export function ChamadosPanel({ className = "" }: { className?: string }) {
  const t = useT();
  const router = useRouter();
  const { account } = useAuth();
  const { chamados } = useChamadosFeed(true);
  const [creating, setCreating] = useState(false);

  const mine = chamados?.find((c) => c.author?.id === account?.id) ?? null;
  const list = mine ? [mine, ...(chamados ?? []).filter((c) => c !== mine)] : (chamados ?? []);

  function openNew() {
    if (!account) return;
    trackChamado(CHAMADO_EVENTS.newOpen);
    setCreating(true);
  }

  return (
    <section className={`flex flex-col rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800 ${className}`}>
      <div className="flex shrink-0 items-center gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t("chamados.title")}</h2>
        {chamados && chamados.length > 0 && <span className="text-xs text-zinc-500 dark:text-zinc-400">{chamados.length}</span>}
        {!mine && (
          <button
            type="button"
            onClick={openNew}
            disabled={!account}
            title={account ? undefined : t("chamados.loginToCreate")}
            className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-lg bg-zinc-950 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <MdAdd className="h-3.5 w-3.5" />
            {t("chamados.new")}
          </button>
        )}
      </div>
      <div className="-mr-2 mt-2 min-h-0 flex-1 overflow-y-auto pr-2">
        {chamados === null ? (
          <ul aria-hidden className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <li key={i} className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
            ))}
          </ul>
        ) : list.length === 0 ? (
          <button
            type="button"
            onClick={openNew}
            className="w-full cursor-pointer rounded-xl border border-dashed border-zinc-300 px-3 py-4 text-left text-sm text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
          >
            {t("chamados.empty")}
          </button>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {list.map((chamado) => {
              const isMine = Boolean(account && chamado.author?.id === account.id);
              const full = chamadoFull(chamado);
              const spots = chamadoSpotsLeft(chamado);
              const inRoom = chamado.live?.peopleCount ?? 0;
              const KindIcon = CHAMADO_KIND_ICON[chamado.kind];
              const meta = full
                ? t("chamados.full")
                : inRoom > 0
                  ? inRoom === 1
                    ? t("chamados.inRoomOne")
                    : t("chamados.inRoomMany", { count: inRoom })
                  : spots !== null
                    ? spots === 1
                      ? t("chamados.spotOne")
                      : t("chamados.spotsMany", { count: spots })
                    : t("chamados.roomEmpty");
              return (
                <li key={chamado.id}>
                  <div
                    role="link"
                    tabIndex={0}
                    onClick={() => router.push(chamadoPath(chamado.id))}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && e.key === "Enter") router.push(chamadoPath(chamado.id));
                    }}
                    className="group flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  >
                    {chamado.author ? (
                      <UserAvatar src={chamado.author.avatarUrl} name={chamado.author.displayName} size={36} userId={chamado.author.id} className="shrink-0" />
                    ) : (
                      <KindIcon className="h-9 w-9 shrink-0 p-2 text-zinc-400" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        <KindIcon className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden />
                        <span className="truncate">{chamado.what}</span>
                      </span>
                      <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {isMine ? t("chamados.yoursShort") : `${chamado.author?.displayName ?? ""} ${t(`chamados.calls.${chamado.kind}`)}`}
                        {" · "}
                        <span className={full ? "font-medium text-red-600 dark:text-red-400" : ""}>{meta}</span>
                      </span>
                    </span>
                    {chamado.handle && (
                      <button
                        type="button"
                        disabled={full && !isMine}
                        onClick={(e) => {
                          e.stopPropagation();
                          trackChamado(CHAMADO_EVENTS.join, { tags: { from: "feed" } });
                          router.push(`/watch/${chamado.handle}`);
                        }}
                        className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-300 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-950"
                      >
                        {t("chamados.enter")}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {creating && <NewChamadoDialog onClose={() => setCreating(false)} />}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { getAccountToken } from "./accountApi";
import { trackFeatureEvent, useFeature } from "./features";
import { getSignalingHttpBase } from "./roomsApi";
import { translate } from "./i18n";

// Experiment "chamados": somebody calls people to play, watch, talk or study,
// in a room made for the chamado, and everybody on the site sees it on the
// groups home's feed and may walk in. The API (sharescreen-api's
// chamadoRoutes.ts) mints the room — a chamado is never made through the
// site's "Criar sala" — keeps one open chamado per person, and takes it off
// the feed when its time runs out, its author closes it or its room empties.
//
// Extras in this first version: "Tô dentro" (hold a spot; the author is told)
// and the chamado's own link, /chamado/<id>, with a preview card.

export const CHAMADOS_FEATURE = "chamados";

export const CHAMADO_EVENTS = {
  /** "Abrir chamado" pressed (the form opened). */
  newOpen: "chamado_new",
  /** Somebody walked into a chamado's room from its card or its page. Tag `from`: feed or page. */
  join: "chamado_join",
  /** The link copied. */
  share: "chamado_share",
  /** The author closed theirs. */
  end: "chamado_end",
  /** A report sent. */
  report: "chamado_report",
  /** The chamado's own page opened (from a shared link, most of the time). */
  page: "chamado_page",
} as const;

/** Counted by the API itself: listed so the admin knows them. */
export const CHAMADO_SERVER_EVENTS = ["chamado_created", "chamado_going"] as const;

export function trackChamado(
  event: (typeof CHAMADO_EVENTS)[keyof typeof CHAMADO_EVENTS],
  extra?: { value?: number; tags?: Record<string, string> }
): void {
  trackFeatureEvent(event, { feature: CHAMADOS_FEATURE, ...extra });
}

export function useChamadosEnabled({ track }: { track: boolean }): boolean {
  return useFeature(CHAMADOS_FEATURE, { track }).enabled;
}

export type ChamadoKind = "play" | "watch" | "talk" | "study";
export const CHAMADO_KINDS: ChamadoKind[] = ["play", "watch", "talk", "study"];
export const CHAMADO_WHAT_MAX = 60;
export const CHAMADO_NOTE_MAX = 140;
export const CHAMADO_SLOT_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 0] as const;
export const CHAMADO_DURATIONS = [30, 60, 120, 240] as const;

export interface ChamadoUser {
  id: string;
  username: string;
  displayName: string;
  flags: string[];
  avatarUrl: string | null;
  nameColor: string | null;
}

export interface Chamado {
  id: string;
  kind: ChamadoKind;
  what: string;
  note: string;
  /** People in total, author included; 0 = no limit. */
  slots: number;
  createdAt: number;
  expiresAt: number;
  status: "open" | "ended" | "expired";
  /** The room, while it is open. */
  handle: string | null;
  author: ChamadoUser | null;
  going: ChamadoUser[];
  goingCount: number;
  live: { peopleCount: number; people: Array<{ name: string; avatarUrl: string | null; accountId: string | null }> } | null;
}

export function chamadoPath(id: string): string {
  return `/chamado/${encodeURIComponent(id)}`;
}

/** Full when it has a limit and the room already holds that many. */
export function chamadoFull(chamado: Chamado): boolean {
  return chamado.slots > 0 && (chamado.live?.peopleCount ?? 0) >= chamado.slots;
}

/** Spots left for "Tô dentro": the limit minus the author and those holding one. */
export function chamadoSpotsLeft(chamado: Chamado): number | null {
  if (chamado.slots === 0) return null;
  return Math.max(0, chamado.slots - 1 - chamado.goingCount);
}

function authHeaders(json = false): Record<string, string> {
  const token = getAccountToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string; chamado?: Chamado };

async function call<T>(path: string, init: RequestInit, pick: (data: Record<string, unknown>) => T): Promise<Result<T>> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}${path}`, init);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : translate("common.couldNotComplete"),
        ...(data.chamado ? { chamado: data.chamado as Chamado } : {}),
      };
    }
    return { ok: true, value: pick(data) };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

export async function fetchChamados(signal?: AbortSignal): Promise<Chamado[] | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/chamados`, { signal, headers: authHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as { chamados?: Chamado[] };
    return Array.isArray(data.chamados) ? data.chamados : [];
  } catch {
    return null;
  }
}

export function fetchChamado(id: string): Promise<Result<Chamado>> {
  return call(`/chamados/${encodeURIComponent(id)}`, { headers: authHeaders() }, (data) => data.chamado as Chamado);
}

export function createChamado(input: {
  kind: ChamadoKind;
  what: string;
  note: string;
  slots: number;
  durationMin: number;
}): Promise<Result<Chamado>> {
  return call(
    "/chamados",
    { method: "POST", headers: authHeaders(true), body: JSON.stringify(input) },
    (data) => data.chamado as Chamado
  );
}

export function endChamado(id: string): Promise<Result<true>> {
  return call(`/chamados/${encodeURIComponent(id)}/end`, { method: "POST", headers: authHeaders() }, () => true as const);
}

export function setChamadoGoing(id: string, going: boolean): Promise<Result<Chamado>> {
  return call(
    `/chamados/${encodeURIComponent(id)}/going`,
    { method: "PUT", headers: authHeaders(true), body: JSON.stringify({ going }) },
    (data) => data.chamado as Chamado
  );
}

export function reportChamado(id: string): Promise<Result<true>> {
  return call(`/chamados/${encodeURIComponent(id)}/report`, { method: "POST", headers: authHeaders() }, () => true as const);
}

// ─── The feed ─────────────────────────────────────────────────────────────

const POLL_MS = 10_000;

// One list for every component showing it, refreshed on a timer while the
// tab is visible and at once after anything this tab changed.
let feed: Chamado[] | null = null;
const listeners = new Set<(value: Chamado[] | null) => void>();
let timer: number | null = null;
let inFlight: Promise<void> | null = null;

function publish(value: Chamado[] | null) {
  feed = value;
  for (const listener of listeners) listener(value);
}

export function refreshChamados(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = fetchChamados()
    .then((list) => {
      if (list) publish(list);
      else if (feed === null) publish([]);
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Puts one chamado's fresh copy in the list (after "Tô dentro"), without waiting for the next read. */
export function patchChamado(next: Chamado): void {
  if (!feed) return;
  publish(next.status === "open" ? feed.map((c) => (c.id === next.id ? next : c)) : feed.filter((c) => c.id !== next.id));
}

function startPolling() {
  if (timer !== null || typeof window === "undefined") return;
  void refreshChamados();
  timer = window.setInterval(() => {
    if (document.visibilityState === "visible") void refreshChamados();
  }, POLL_MS);
}

function stopPolling() {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

/** The open chamados, or null until the first read. Polls while mounted and on. */
export function useChamadosFeed(enabled: boolean): { chamados: Chamado[] | null; refresh: () => Promise<void> } {
  const [value, setValue] = useState<Chamado[] | null>(feed);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setValue);
    startPolling();
    return () => {
      listeners.delete(setValue);
      if (listeners.size === 0) stopPolling();
    };
  }, [enabled]);
  const refresh = useCallback(() => refreshChamados(), []);
  return { chamados: enabled ? value : null, refresh };
}

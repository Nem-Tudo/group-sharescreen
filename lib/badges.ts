"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { getSignalingHttpBase } from "./roomsApi";

export type BadgeId =
  | "staff"
  | "bug_hunter"
  | "pro"
  | "contributor"
  | "beta_mobile"
  | "beta_tester"
  | (string & {});

export interface BadgeDefinition {
  id: string;           // Identificador único (ex: "staff", "bug_hunter")
  name: string;         // Nome visível (ex: "Staff")
  flagTag?: string;     // Tag de referência da flag (opcional)
  description: string;  // Descrição visível no perfil
  iconUrl: string;      // URL do ícone (CDN ou web)
  chipClass?: string;   // Classes Tailwind do botão/chip
  bgClass?: string;     // Classes Tailwind de fundo
  textClass?: string;   // Classes Tailwind de texto/cor
  borderClass?: string; // Classes Tailwind de borda
  requiredFlag?: string;// Flag requerida na conta (ex: "STAFF", "BUG_HUNTER")
  requiredPlan?: string;// Plano requerido (ex: "pro")
  createdAt: number;
}

// Cutoff for Beta Tester badge: all accounts created before 10/09/2026 (BRT / UTC-3).
export const BETA_TESTER_CUTOFF_MS = new Date("2026-09-08T00:00:00-03:00").getTime();

/**
 * Through the end of 18/09/2026 (BRT): any subscription started before this
 * instant earns the Apoiador Inicial badge.
 *
 * Midnight on the 19th, because "até o dia 18" includes the 18th — a cutoff
 * at the start of the 18th would quietly cost somebody a whole last day.
 *
 * Lives here so the deadline is one value: the Pro page and the modal both
 * announce it, and the day it passes they stop announcing it together.
 */
export const EARLY_SUPPORTER_CUTOFF_MS = new Date("2026-10-19T00:00:00-03:00").getTime();

export const DEFAULT_BADGES: BadgeDefinition[] = [
  {
    id: "staff",
    name: "Staff",
    flagTag: "STAFF",
    description: "Equipe do Go Live",
    iconUrl:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23f43f5e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/%3E%3Cpath d='m9 12 2 2 4-4'/%3E%3C/svg%3E",
    chipClass:
      "border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-400",
    bgClass: "bg-rose-500/15",
    textClass: "text-rose-500",
    borderClass: "border-rose-500/30",
    requiredFlag: "STAFF",
    createdAt: 1725753600000,
  },
  {
    id: "pro",
    name: "Pro",
    description: "Assinante GoLive Pro",
    iconUrl:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f59e0b'%3E%3Cpath d='M13 2 3 14h9l-1 8 10-12h-9l1-8z'/%3E%3C/svg%3E",
    chipClass:
      "border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-400",
    bgClass: "bg-amber-500/15",
    textClass: "text-amber-500",
    borderClass: "border-amber-500/30",
    requiredPlan: "pro",
    createdAt: 1725753600000,
  },
  {
    id: "bug_hunter",
    name: "Bug Hunter",
    flagTag: "BUG_HUNTER",
    description: "Quem reporta bugs",
    iconUrl:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='8' height='14' x='8' y='6' rx='4'/%3E%3Cpath d='m19 7-3 2'/%3E%3Cpath d='m5 7 3 2'/%3E%3Cpath d='m19 19-3-2'/%3E%3Cpath d='m5 19 3-2'/%3E%3Cpath d='M20 13h-4'/%3E%3Cpath d='M4 13h4'/%3E%3Cpath d='m10 4 1 2'/%3E%3Cpath d='m14 4-1 2'/%3E%3C/svg%3E",
    chipClass:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-400",
    bgClass: "bg-emerald-500/15",
    textClass: "text-emerald-500",
    borderClass: "border-emerald-500/30",
    requiredFlag: "BUG_HUNTER",
    createdAt: 1725753600000,
  },
  {
    id: "contributor",
    name: "Contribuidor",
    flagTag: "CONTRIBUITOR",
    description: "Quem faz PR no app",
    iconUrl:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236366f1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='18' cy='18' r='3'/%3E%3Ccircle cx='6' cy='6' r='3'/%3E%3Cpath d='M13 6h3a2 2 0 0 1 2 2v7'/%3E%3Cline x1='6' y1='9' x2='6' y2='21'/%3E%3C/svg%3E",
    chipClass:
      "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-400",
    bgClass: "bg-indigo-500/15",
    textClass: "text-indigo-500",
    borderClass: "border-indigo-500/30",
    requiredFlag: "CONTRIBUITOR",
    createdAt: 1725753600000,
  },
  {
    id: "beta_mobile",
    name: "Mobile Beta",
    flagTag: "BETA_MOBILE",
    description: "Quem tem o app mobile em Beta",
    iconUrl:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230ea5e9' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='14' height='20' x='5' y='2' rx='2' ry='2'/%3E%3Cpath d='M12 18h.01'/%3E%3C/svg%3E",
    chipClass:
      "border-sky-500/30 bg-sky-500/10 text-sky-600 hover:bg-sky-500/20 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-400",
    bgClass: "bg-sky-500/15",
    textClass: "text-sky-500",
    borderClass: "border-sky-500/30",
    requiredFlag: "BETA_MOBILE",
    createdAt: 1725753600000,
  },
  {
    id: "beta_tester",
    name: "Beta Tester",
    flagTag: "BETA_TESTER",
    description: "Todas as contas criadas antes do dia 10/09/2026",
    iconUrl:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a855f7' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z'/%3E%3Cpath d='m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z'/%3E%3Cpath d='M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0'/%3E%3Cpath d='M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5'/%3E%3C/svg%3E",
    chipClass:
      "border-purple-500/30 bg-purple-500/10 text-purple-600 hover:bg-purple-500/20 dark:border-purple-500/40 dark:bg-purple-500/15 dark:text-purple-400",
    bgClass: "bg-purple-500/15",
    textClass: "text-purple-500",
    borderClass: "border-purple-500/30",
    requiredFlag: "BETA_TESTER",
    createdAt: 1725753600000,
  },
];

export const BADGE_DEFINITIONS: Record<string, BadgeDefinition> = Object.fromEntries(
  DEFAULT_BADGES.map((b) => [b.id, b])
);

let cachedBadges: BadgeDefinition[] = DEFAULT_BADGES;
let isFetching = false;
const listeners = new Set<(badges: BadgeDefinition[]) => void>();

export async function fetchBadgesCatalog(signal?: AbortSignal): Promise<BadgeDefinition[]> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/badges`, { signal });
    if (!res.ok) return cachedBadges;
    const data = (await res.json()) as { badges?: BadgeDefinition[] };
    if (Array.isArray(data?.badges) && data.badges.length > 0) {
      cachedBadges = data.badges;
      listeners.forEach((listener) => listener(cachedBadges));
      return cachedBadges;
    }
  } catch {
    // Ignore network failure and keep cachedBadges
  }
  return cachedBadges;
}

export function useBadgesCatalog(): BadgeDefinition[] {
  const [badges, setBadges] = useState<BadgeDefinition[]>(cachedBadges);

  useEffect(() => {
    const listener = (newBadges: BadgeDefinition[]) => setBadges(newBadges);
    listeners.add(listener);

    if (!isFetching) {
      isFetching = true;
      fetchBadgesCatalog().finally(() => {
        isFetching = false;
      });
    }

    return () => {
      listeners.delete(listener);
    };
  }, []);

  return badges;
}

/** Checks if the current environment is running inside the mobile app shell. */
export function isMobileApp(): boolean {
  if (typeof window === "undefined") return false;
  return (
    Capacitor.isNativePlatform() ||
    window.golive?.platform === "android" ||
    (typeof navigator !== "undefined" && /GoLiveMobile/i.test(navigator.userAgent))
  );
}

/** Checks if mobile app usage was previously cached locally for a given user. */
export function isMobileBetaCached(userId?: string): boolean {
  if (typeof window === "undefined" || !userId) return false;
  try {
    return localStorage.getItem(`golive_mobile_beta_${userId}`) === "true";
  } catch {
    return false;
  }
}

/** Caches that this user has accessed GoLive from the mobile app. */
export function markMobileBeta(userId: string) {
  if (typeof window === "undefined" || !userId) return;
  try {
    localStorage.setItem(`golive_mobile_beta_${userId}`, "true");
  } catch { }
}

function userHasBadge(
  badge: BadgeDefinition,
  account: {
    id?: string;
    username?: string;
    flags?: string[];
    createdAt?: number;
    premium?: unknown;
    features?: string[];
  },
  isOwner?: boolean
): boolean {
  const flags = account.flags ?? [];
  // Whether the subscription is *paying*, which is not the same question as
  // whether the account has a subscription record.
  //
  // This used to also accept `Boolean(account.premium)`, and that was the bug:
  // the API sends `premium` for the account page to render "renova em ..." and
  // offer to cancel, so it stays on the wire long after a subscription lapses
  // — cancelled, expired, or a Pix charge whose period ended. Any of those is
  // a truthy object, so everyone who had ever subscribed kept the badge
  // forever.
  //
  // Both survivors are already the resolved answer rather than raw state. The
  // API derives "PRO" only while the subscription is entitled and never stores
  // it (see its entitlements.ts), and `verified_badge` sits on the premium
  // rung of the same ladder, so it appears in `features` under exactly the
  // same condition. Neither can outlive the thing it describes.
  const isPro =
    flags.includes("PRO") ||
    Boolean(account.features?.includes("verified_badge"));

  // Plan requirement check
  if (badge.requiredPlan) {
    if (badge.requiredPlan.toLowerCase() === "pro" && !isPro) {
      return false;
    }
  }

  // Pro badge
  if (badge.id === "pro") {
    return isPro;
  }

  // General flag-based badge created via database
  const targetFlag = badge.requiredFlag || badge.flagTag;
  if (targetFlag) {
    return flags.includes(targetFlag);
  }

  // If badge only required plan and passed plan check
  if (badge.requiredPlan) {
    return true;
  }

  return false;
}

/**
 * Returns the list of badges earned by an account.
 * Badges are determined by flags, subscription/pro status, creation date, mobile usage,
 * or custom definitions configured in the database catalog.
 */
export function getUserBadges(
  account: {
    id?: string;
    username?: string;
    flags?: string[];
    createdAt?: number;
    premium?: unknown;
    features?: string[];
  },
  isOwner?: boolean,
  catalog: BadgeDefinition[] = cachedBadges
): BadgeDefinition[] {
  const activeCatalog = catalog && catalog.length > 0 ? catalog : DEFAULT_BADGES;

  // Testing override: user @sasdasd receives all badges
  // const normalizedUsername = account.username?.replace(/^@/, "").trim().toLowerCase();
  // if (normalizedUsername === "sasdasd") {
  //   return activeCatalog;
  // }feat: Badge

  return activeCatalog.filter((badge) => userHasBadge(badge, account, isOwner));
}



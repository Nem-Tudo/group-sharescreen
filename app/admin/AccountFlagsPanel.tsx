"use client";

import { useEffect, useState } from "react";
import {
  searchAdminAccounts,
  setAccountFlags,
  type AdminAccountHit,
} from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";
import {
  DEFAULT_BADGES,
  useBadgesCatalog,
  type BadgeDefinition,
} from "@/lib/badges";
import {
  MdAdd,
  MdCheck,
  MdClose,
  MdExpandLess,
  MdExpandMore,
  MdLock,
} from "react-icons/md";

// Editing what an account is allowed to be.
//
// A dynamic selection of known flags plus arbitrary custom flags.
//
// Two flags are special, and the panel says so rather than hiding it: ADMIN
// and ADMIN_MASTER can only be changed by an ADMIN_MASTER — in *either*
// direction. Being able only to grant would still leave a screen where any
// administrator can demote every other one.

const RESTRICTED = ["ADMIN", "ADMIN_MASTER"];

interface BadgeFlagItem {
  flag: string;
  name: string;
  iconUrl: string;
  description?: string;
  bgClass?: string;
  borderClass?: string;
  chipClass?: string;
}

interface KnownFlagItem {
  flag: string;
  label: string;
  description: string;
  restricted?: boolean;
}

const SYSTEM_FLAGS: KnownFlagItem[] = [
  {
    flag: "ADMIN",
    label: "Administrador",
    description: "Acesso ao painel administrativo e comandos de moderação.",
    restricted: true,
  },
  {
    flag: "ADMIN_MASTER",
    label: "Administrador Master",
    description: "Permissão de superusuário: pode gerenciar ADMIN e ADMIN_MASTER.",
    restricted: true,
  },
];

const PLAN_FLAGS: KnownFlagItem[] = [
  {
    flag: "PRO_MAX",
    label: "Pro Max",
    description: "Nível intermediário Pro (selo dourado e limites ampliados).",
  },
  {
    flag: "PRO_ULTRA",
    label: "Pro Ultra",
    description: "Nível superior Pro (selo rubi e máxima fidelidade de transmissão).",
  },
  {
    flag: "GIFTER",
    label: "Gifter",
    description: "Concedida a usuários que presenteiam assinaturas na comunidade.",
  },
];

const STATUS_FLAGS: KnownFlagItem[] = [
  {
    flag: "VERIFIED",
    label: "Verificado",
    description: "Selo azul oficial de autenticidade no perfil e nas salas.",
  },
];

const FEATURE_FLAGS: KnownFlagItem[] = [
  {
    flag: "THEME_BANNED",
    label: "Banido de Temas",
    description: "Bloqueado de criar, publicar ou utilizar temas personalizados de sala.",
  },
  {
    flag: "BYPASS_THEME_LIMIT",
    label: "Isento Limite de Temas",
    description: "Permite criar temas de sala sem atingir limites quantitativos.",
  },
  {
    flag: "GROUP_CUSTOM_INVITE",
    label: "Convites Customizados",
    description: "Permite registrar links/URLs de convite personalizados para grupos.",
  },
  {
    flag: "GROUP_SET_RESERVED_CUSTOM_INVITES",
    label: "Definir Convites Reservados",
    description: "Permissão para atribuir URLs de convite reservadas do sistema em grupos.",
  },
  {
    flag: "BOOSTING_BYPASS_COOLDOWN",
    label: "Aura sem Espera",
    description: "Permite tirar uma aura de um grupo antes dos 3 dias mínimos que ela precisa ficar lá.",
  },
  {
    flag: "OFFICIAL_DISCORD_JOINED",
    label: "Discord Oficial",
    description: "Conta com participação confirmada no servidor oficial do Discord.",
  },
];

function extractBadgeFlag(badge: BadgeDefinition): string | null {
  const flag = badge.requiredFlag || badge.flagTag;
  if (flag) return flag.trim().toUpperCase();
  return null;
}

export function AccountFlagsPanel() {
  const t = useT();
  const catalog = useBadgesCatalog();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AdminAccountHit[]>([]);
  const [canEditAdminFlags, setCanEditAdminFlags] = useState(false);
  const [selected, setSelected] = useState<AdminAccountHit | null>(null);
  const [draft, setDraft] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [customFlag, setCustomFlag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Map of all badges for icon and metadata lookup
  const badgeMap = new Map<string, BadgeFlagItem>();

  // Populate map with defaults first
  for (const b of DEFAULT_BADGES) {
    const flag = extractBadgeFlag(b) || (b.id.toLowerCase() === "pro" ? "PRO" : null);
    if (flag) {
      badgeMap.set(flag, {
        flag,
        name: b.name,
        iconUrl: b.iconUrl,
        description: b.description,
        bgClass: b.bgClass,
        borderClass: b.borderClass,
        chipClass: b.chipClass,
      });
    }
  }

  // Enhance with live badges from database catalog
  for (const b of catalog) {
    const flag = extractBadgeFlag(b) || (b.id.toLowerCase() === "pro" ? "PRO" : null);
    if (flag) {
      badgeMap.set(flag, {
        flag,
        name: b.name,
        iconUrl: b.iconUrl,
        description: b.description,
        bgClass: b.bgClass,
        borderClass: b.borderClass,
        chipClass: b.chipClass,
      });
    }
  }

  // Selectable badge flags: all badges with an assignable flag (excludes PRO which is subscription-derived)
  const selectableBadgeFlags: BadgeFlagItem[] = [];
  const seenBadgeFlags = new Set<string>();

  // Ensure default badge flags order
  const defaultOrder = ["STAFF", "BUG_HUNTER", "CONTRIBUITOR", "BETA_MOBILE", "BETA_TESTER"];
  for (const f of defaultOrder) {
    const item = badgeMap.get(f);
    if (item && !seenBadgeFlags.has(f)) {
      seenBadgeFlags.add(f);
      selectableBadgeFlags.push(item);
    }
  }

  // Add any custom badge flags from catalog
  for (const [f, item] of badgeMap.entries()) {
    if (f !== "PRO" && !seenBadgeFlags.has(f)) {
      seenBadgeFlags.add(f);
      selectableBadgeFlags.push(item);
    }
  }

  useEffect(() => {
    if (query.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchAdminAccounts(query)
        .then((data) => {
          // Two searches in flight can land out of order; the effect is keyed
          // on the query, so a stale answer belongs to one already torn down.
          if (cancelled) return;
          setHits(data.accounts);
          setCanEditAdminFlags(data.canEditAdminFlags);
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function pick(account: AdminAccountHit) {
    setSelected(account);
    setDraft(account.flags.join(","));
    setIsMenuOpen(false);
    setCustomFlag("");
    setError(null);
    setDone(null);
  }

  const activeFlags = draft
    .split(",")
    .map((flag) => flag.trim().toUpperCase())
    .filter(Boolean);

  function toggleFlag(flag: string) {
    const normalized = flag.trim().toUpperCase();
    if (!normalized) return;
    if (RESTRICTED.includes(normalized) && !canEditAdminFlags) {
      setError(t("admin.accountFlagsPanel.youCannotTouchValue", { value: RESTRICTED.join(" nem ") }));
      return;
    }
    setError(null);
    setDone(null);
    let next: string[];
    if (activeFlags.includes(normalized)) {
      next = activeFlags.filter((f) => f !== normalized);
    } else {
      next = [...activeFlags, normalized];
    }
    setDraft(next.join(","));
  }

  function handleAddCustomFlag() {
    const normalized = customFlag.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    if (!normalized) return;
    if (RESTRICTED.includes(normalized) && !canEditAdminFlags) {
      setError(t("admin.accountFlagsPanel.youCannotTouchValue", { value: RESTRICTED.join(" nem ") }));
      return;
    }
    setError(null);
    setDone(null);
    if (!activeFlags.includes(normalized)) {
      setDraft([...activeFlags, normalized].join(","));
    }
    setCustomFlag("");
  }

  function removeFlag(flag: string) {
    const normalized = flag.trim().toUpperCase();
    if (RESTRICTED.includes(normalized) && !canEditAdminFlags) {
      setError(t("admin.accountFlagsPanel.youCannotTouchValue", { value: RESTRICTED.join(" nem ") }));
      return;
    }
    setError(null);
    setDone(null);
    setDraft(activeFlags.filter((f) => f !== normalized).join(","));
  }

  async function handleSave() {
    if (!selected || busy) return;
    const flags = draft
      .split(",")
      .map((flag) => flag.trim().toUpperCase())
      .filter(Boolean);
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const saved = await setAccountFlags(selected.id, flags);
      setSelected({ ...selected, flags: saved });
      setDraft(saved.join(","));
      setHits((current) =>
        current.map((hit) => (hit.id === selected.id ? { ...hit, flags: saved } : hit))
      );
      setDone(t("common.flagsSaved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.couldNotSave"));
    } finally {
      setBusy(false);
    }
  }

  function renderPresetButton(item: KnownFlagItem) {
    const isSelected = activeFlags.includes(item.flag);
    const isRestricted = item.restricted && !canEditAdminFlags;
    return (
      <button
        key={item.flag}
        type="button"
        onClick={() => toggleFlag(item.flag)}
        disabled={isRestricted}
        title={item.description}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
          isSelected
            ? item.restricted
              ? "border-amber-500 bg-amber-500 text-white shadow-sm hover:bg-amber-600 dark:border-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700"
              : "border-emerald-600 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 dark:border-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        } ${isRestricted ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
      >
        {isRestricted ? (
          <MdLock className="text-xs shrink-0" />
        ) : isSelected ? (
          <MdCheck className="text-sm font-bold shrink-0" />
        ) : (
          <MdAdd className="text-sm shrink-0" />
        )}
        <span className="font-mono font-semibold">{item.flag}</span>
        {item.label && (
          <span
            className={`text-[11px] ${
              isSelected ? "text-white/90" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            ({item.label})
          </span>
        )}
      </button>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {t("admin.accountFlagsPanel.accountFlags")}
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.accountFlagsPanel.findSomeoneAndEditTheFlags")}{" "}
        {canEditAdminFlags
          ? t("admin.accountFlagsPanel.asAdminMasterYouCanChange")
          : t("admin.accountFlagsPanel.adminAndAdminMasterCanOnly")}
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <label
            htmlFor="flags-search"
            className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            {t("common.person")}
          </label>
          <input
            id="flags-search"
            value={selected ? `${selected.displayName} (@${selected.username})` : query}
            onChange={(e) => {
              setSelected(null);
              setQuery(e.target.value);
            }}
            placeholder={t("common.nameOrUsername")}
            className={inputClass}
          />
          {!selected && hits.length > 0 && (
            <ul className="mt-1 flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-lg border border-zinc-200 p-1 dark:border-zinc-800">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => pick(hit)}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  >
                    <span className="block truncate text-zinc-900 dark:text-zinc-100">
                      {hit.displayName}
                    </span>
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      @{hit.username}
                      {hit.flags.length > 0 && ` · ${hit.flags.join(", ")}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!selected && query.trim().length >= 2 && hits.length === 0 && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("common.nobodyFound")}</p>
          )}
        </div>

        {selected && (
          <div className="flex flex-col gap-3">
            {/* Active flags summary bar */}
            <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  {t("admin.accountFlagsPanel.activeFlags")} ({activeFlags.length})
                </span>
                <button
                  type="button"
                  onClick={() => setIsMenuOpen((prev) => !prev)}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  {isMenuOpen ? <MdExpandLess className="text-base" /> : <MdExpandMore className="text-base" />}
                  <span>
                    {isMenuOpen
                      ? t("admin.accountFlagsPanel.closeFlags")
                      : `${t("admin.accountFlagsPanel.manageFlags")} (${activeFlags.length})`}
                  </span>
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {activeFlags.length === 0 ? (
                  <span className="text-xs italic text-zinc-400 dark:text-zinc-500">
                    {t("admin.accountFlagsPanel.none")}
                  </span>
                ) : (
                  activeFlags.map((flag) => {
                    const isRestricted = RESTRICTED.includes(flag) && !canEditAdminFlags;
                    const badge = badgeMap.get(flag);
                    return (
                      <span
                        key={flag}
                        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-mono font-medium ${
                          RESTRICTED.includes(flag)
                            ? "bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200"
                            : badge
                            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200"
                            : "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                        }`}
                      >
                        {badge && (
                          <img
                            src={badge.iconUrl}
                            alt={badge.name}
                            className="h-3.5 w-3.5 object-contain select-none pointer-events-none shrink-0"
                          />
                        )}
                        <span>{flag}</span>
                        {badge && (
                          <span className="font-sans text-[11px] font-normal opacity-75">
                            ({badge.name})
                          </span>
                        )}
                        {!isRestricted && (
                          <button
                            type="button"
                            onClick={() => removeFlag(flag)}
                            title={t("common.remove")}
                            className="text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200"
                          >
                            <MdClose className="text-xs" />
                          </button>
                        )}
                      </span>
                    );
                  })
                )}
              </div>
            </div>

            {/* Collapsible Flag Selection Menu */}
            {isMenuOpen && (
              <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                
                {/* 1. SEÇÃO DE FLAGS DE EMBLEMA (BADGES) */}
                <div>
                  <div className="mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                      {t("admin.accountFlagsPanel.badgeFlags")}
                    </h3>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {t("admin.accountFlagsPanel.badgeFlagsDesc")}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {selectableBadgeFlags.map((item) => {
                      const isSelected = activeFlags.includes(item.flag);
                      return (
                        <button
                          key={item.flag}
                          type="button"
                          onClick={() => toggleFlag(item.flag)}
                          title={item.description}
                          className={`flex items-center gap-2.5 rounded-lg border p-2 text-left transition ${
                            isSelected
                              ? "border-emerald-500 bg-emerald-50/80 text-emerald-950 shadow-sm dark:border-emerald-500/50 dark:bg-emerald-950/30 dark:text-emerald-100"
                              : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                          }`}
                        >
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border p-1 ${
                              item.bgClass || "bg-zinc-100 dark:bg-zinc-800"
                            } ${item.borderClass || "border-zinc-200 dark:border-zinc-700"}`}
                          >
                            <img
                              src={item.iconUrl}
                              alt={item.name}
                              className="h-full w-full object-contain pointer-events-none select-none"
                            />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                {item.name}
                              </span>
                              <span
                                className={`inline-flex items-center justify-center rounded-full p-0.5 ${
                                  isSelected
                                    ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950"
                                    : "text-zinc-400 dark:text-zinc-500"
                                }`}
                              >
                                {isSelected ? (
                                  <MdCheck className="text-xs font-bold" />
                                ) : (
                                  <MdAdd className="text-xs" />
                                )}
                              </span>
                            </div>
                            <span className="block truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                              {item.flag}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. SEÇÃO DE FLAGS DE SISTEMA E ADMINISTRAÇÃO */}
                <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
                  <div className="mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                      {t("admin.accountFlagsPanel.systemFlags")}
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {SYSTEM_FLAGS.map((item) => renderPresetButton(item))}
                  </div>
                  {!canEditAdminFlags && (
                    <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                      {t("admin.accountFlagsPanel.youCannotTouchValue", {
                        value: RESTRICTED.join(" nem "),
                      })}
                    </p>
                  )}
                </div>

                {/* 3. SEÇÃO DE FLAGS DE ASSINATURA E PLANOS */}
                <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
                  <div className="mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                      {t("admin.accountFlagsPanel.planFlags")}
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {PLAN_FLAGS.map((item) => renderPresetButton(item))}
                  </div>
                </div>

                {/* 4. SEÇÃO DE FLAGS DE STATUS E VERIFICAÇÃO */}
                <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
                  <div className="mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                      {t("admin.accountFlagsPanel.statusFlags")}
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_FLAGS.map((item) => renderPresetButton(item))}
                  </div>
                </div>

                {/* 5. SEÇÃO DE FLAGS DE RECURSOS E MODERAÇÃO */}
                <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
                  <div className="mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                      {t("admin.accountFlagsPanel.featureFlags")}
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {FEATURE_FLAGS.map((item) => renderPresetButton(item))}
                  </div>
                </div>

                {/* 6. ADICIONAR FLAG PERSONALIZADA / ALEATÓRIA */}
                <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
                  <label
                    htmlFor="custom-flag-input"
                    className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400"
                  >
                    {t("admin.accountFlagsPanel.addCustomFlag")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="custom-flag-input"
                      value={customFlag}
                      onChange={(e) =>
                        setCustomFlag(
                          e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "")
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddCustomFlag();
                        }
                      }}
                      placeholder={t("admin.accountFlagsPanel.customFlagPlaceholder")}
                      spellCheck={false}
                      className={`${inputClass} font-mono text-xs`}
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomFlag}
                      disabled={!customFlag.trim()}
                      className="flex items-center gap-1 rounded-lg bg-zinc-950 px-3 py-2 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                    >
                      <MdAdd className="text-base" />
                      <span>{t("admin.accountFlagsPanel.add")}</span>
                    </button>
                  </div>
                </div>

                {/* 7. EDIÇÃO MANUAL (CSV) */}
                <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
                  <label
                    htmlFor="flags-value"
                    className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400"
                  >
                    {t("admin.accountFlagsPanel.manualEdit")}
                  </label>
                  <input
                    id="flags-value"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t("admin.accountFlagsPanel.adminVerified")}
                    spellCheck={false}
                    autoCapitalize="characters"
                    className={`${inputClass} font-mono text-xs`}
                  />
                </div>
              </div>
            )}

            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">
              {/* Said plainly because the field would otherwise seem to be
                  missing one: PRO is not stored, it is derived from a paying
                  subscription on every read (see the API's toPublicAccount). */}
              {t("admin.accountFlagsPanel.proDoesNotAppearHereIt")}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={busy || draft === selected.flags.join(",")}
                className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {busy ? t("common.saving") : t("common.save")}
              </button>
              <button
                type="button"
                onClick={() => setDraft(selected.flags.join(","))}
                disabled={busy || draft === selected.flags.join(",")}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {t("common.undo")}
              </button>
              {done && (
                <span className="text-sm text-emerald-600 dark:text-emerald-500">{done}</span>
              )}
              {error && <span className="text-sm text-red-500">{error}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AccountModal, type AccountModalMode } from "@/components/AccountModal";
import { useAuth } from "@/lib/AuthContext";
import { AdminLogPanel } from "./AdminLogPanel";
import { ADMIN_SECTIONS, type AdminCan } from "./DashboardPanel";
import { AdminPermissionsPanel } from "./AdminPermissionsPanel";
import { adminPermissionsFromFlags } from "@/lib/adminPermissions";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";
import { fetchPartnerOrdersPendingCount } from "@/lib/partnerOrders";
import { PARTNER_ORDERS_CHANGED_EVENT } from "./PartnerOrdersPanel";

// How often the "Anúncios" tab asks whether an ad order is waiting for review.
const PENDING_ORDERS_POLL_MS = 30_000;

// Site administration: statistics, announcements, partners, supporters, the
// desktop update nudge, anti-spam, banned words, bans, ads, comped plans — and
// the record of everything an administrator did.
//
// Live moderation — the room list, the invisible moderation viewer and the
// camera wall — is deliberately not here. It lives in its own app
// (../sharescreen-admin), against this same API, because it is a different job
// done by a different person at a different time: this page is about the
// service's configuration, that one is about who is on it right now.
//
// There is no login form here any more, and that is the point of this version:
// being an administrator is a *flag on an account*, not a second credential.
// The page used to mint and keep a token of its own, which meant two ways to
// be signed in to one site — two expiries, and a panel that could be logged in
// while the header said nobody was. Now it reads the same session everything
// else does and checks for the flag the API already gates on (requireAdmin).

// The tab bar is generated from the sections (see DashboardPanel), with the
// log pinned last. Adding a panel is one entry there; nothing here changes.
//
// Registros is last on purpose and not alphabetically: it is a record of what
// was done, so it belongs after the doing — and it is the one tab that is read
// rather than used.
//
// Every tab is filtered by the viewer's permissions (lib/adminPermissions.ts):
// an admin sees only the jobs the master gave them. "Permissões" — who may do
// what — is ADMIN_MASTER's alone, and sits after the log.

export default function AdminPage() {
  const t = useT();
  const { account, loading } = useAuth();
  const [chosenTab, setTab] = useState<string | null>(null);
  const [accountModal, setAccountModal] = useState<AccountModalMode | null>(null);

  const isAdmin = Boolean(account?.flags.includes("ADMIN"));
  const isMaster = Boolean(account?.flags.includes("ADMIN_MASTER"));
  const flagsKey = account?.flags.join(",") ?? "";
  const permissions = useMemo(
    () => adminPermissionsFromFlags(flagsKey ? flagsKey.split(",") : []),
    [flagsKey]
  );
  const can: AdminCan = (...needed) => needed.some((permission) => permissions.has(permission));
  // The red dot on "Anúncios": self-serve ad orders (or edits) waiting for an
  // admin. Polled, and refreshed at once when the panel decides one.
  const canAds = permissions.has("ads");
  const [pendingOrders, setPendingOrders] = useState(0);
  useEffect(() => {
    if (!canAds) return;
    let cancelled = false;
    const load = () =>
      fetchPartnerOrdersPendingCount()
        .then((count) => {
          if (!cancelled) setPendingOrders(count);
        })
        .catch(() => undefined);
    void load();
    const id = setInterval(load, PENDING_ORDERS_POLL_MS);
    window.addEventListener(PARTNER_ORDERS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener(PARTNER_ORDERS_CHANGED_EVENT, load);
    };
  }, [canAds]);
  const sections = ADMIN_SECTIONS.filter((section) => section.needs.some((permission) => permissions.has(permission)));
  const tabs = [
    ...sections.map((section) => ({ id: section.id, label: section.label })),
    ...(permissions.has("logs") ? [{ id: "registros", label: translate("admin.logs") }] : []),
    ...(isMaster ? [{ id: "permissoes", label: translate("admin.permissions.tab") }] : []),
  ];
  // A tab the viewer no longer has (permissions changed under them) falls
  // back to the first one they do.
  const tab = tabs.some((entry) => entry.id === chosenTab) ? chosenTab : (tabs[0]?.id ?? null);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>
      </div>
    );
  }

  if (!account || !isAdmin) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
        <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {t("common.administration")}
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {/* Deliberately the same message either way. "You are signed in but
                not an administrator" tells somebody probing this URL which
                half they got right. */}
            {t("admin.restrictedAccess")}
          </p>
          {!account && (
            <button
              type="button"
              onClick={() => setAccountModal("login")}
              className="mt-6 w-full rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {t("common.signIn")}
            </button>
          )}
          <Link
            href="/"
            className="mt-3 block text-center text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {t("common.backToHome")}
          </Link>
          <AccountModal mode={accountModal} onModeChange={setAccountModal} />
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-black">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {t("common.admin")}
            </h1>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {t("admin.signedInAs")}{account.username}
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {t("common.home")}
          </Link>
        </div>

        {/* No "sair" button: the session here is the site's session, and
            signing out of it from this corner would also sign them out of the
            room they left open. The account menu in the header is where that
            lives, for the whole site at once. */}
        {/* Scrolls sideways rather than wrapping: a second row of tabs reads
            as two groups of tabs, and on a phone that is most of the screen
            before any content. */}
        <div className="mt-6 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id ? "page" : undefined}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition ${
                tab === entry.id
                  ? "border-zinc-950 text-zinc-950 dark:border-zinc-50 dark:text-zinc-50"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {entry.label}
              {entry.id === "ads" && pendingOrders > 0 && (
                <span
                  aria-label={t("admin.partnerOrders.pendingBadge", { count: pendingOrders })}
                  className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 align-middle text-[10px] font-bold leading-none text-white"
                >
                  {pendingOrders}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {tab === null ? (
            // An ADMIN the master has not given anything yet.
            <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              {t("admin.permissions.noneYet")}
            </p>
          ) : tab === "registros" ? (
            <AdminLogPanel />
          ) : tab === "permissoes" ? (
            <AdminPermissionsPanel />
          ) : (
            (sections.find((section) => section.id === tab) ?? sections[0]).Panel({ can })
          )}
        </div>
      </div>
    </div>
  );
}

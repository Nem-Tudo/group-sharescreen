"use client";

import { useState } from "react";
import Link from "next/link";
import { AccountModal, type AccountModalMode } from "@/components/AccountModal";
import { useAuth } from "@/lib/AuthContext";
import { AdminLogPanel } from "./AdminLogPanel";
import { ADMIN_SECTIONS } from "./DashboardPanel";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";

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
const TABS = [
  ...ADMIN_SECTIONS.map((section) => ({ id: section.id, label: section.label })),
  { id: "registros", get label() { return translate("admin.logs"); } },
];

export default function AdminPage() {
  const t = useT();
  const { account, loading } = useAuth();
  const [tab, setTab] = useState<string>(ADMIN_SECTIONS[0].id);
  const [accountModal, setAccountModal] = useState<AccountModalMode | null>(null);

  const isAdmin = Boolean(account?.flags.includes("ADMIN"));

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
          {TABS.map((entry) => (
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
            </button>
          ))}
        </div>

        <div className="mt-6">
          {tab === "registros" ? (
            <AdminLogPanel />
          ) : (
            // Falls back to the first section rather than rendering nothing:
            // the only way `tab` names no section is a stale value, and an
            // empty page is a worse answer than the default one.
            (ADMIN_SECTIONS.find((section) => section.id === tab) ?? ADMIN_SECTIONS[0]).Panel()
          )}
        </div>
      </div>
    </div>
  );
}

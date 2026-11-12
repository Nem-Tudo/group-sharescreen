"use client";

import Link from "next/link";
import { useT } from "@/lib/useI18n";
import { useSellsHere } from "@/lib/storePolicy";

// What the iOS app shows where the site would sell something (see
// lib/storePolicy.ts). Deliberately says nothing about where or how to buy:
// App Store rule 3.1.3(f) allows the app to skip Apple's in-app purchase only
// while it has no purchase and no call to action for one.

/** A whole page: /pro, /gift/…, /redeem and /partner/new inside the iOS app. */
export function NotSoldInAppPage() {
  const t = useT();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full rounded-2xl border border-black/10 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t("storePolicy.pageTitle")}</p>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("storePolicy.pageBody")}</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {t("storePolicy.home")}
        </Link>
      </div>
    </main>
  );
}

/** The body of a dialog that would have sold Pro: the Pro modal, a checkout. */
export function NotSoldInAppNotice({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div className="p-6 text-center">
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t("storePolicy.proFeatureTitle")}</p>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("storePolicy.proFeatureBody")}</p>
      <button
        type="button"
        onClick={onClose}
        className="mt-6 cursor-pointer rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {t("storePolicy.ok")}
      </button>
    </div>
  );
}

/**
 * Wraps a page that sells. Outside the iOS app it is just the page. Inside it,
 * CSS swaps the page for NotSoldInAppPage from the first paint (data-sells /
 * data-ios-only, see app/globals.css), and once hydrated the page is not even
 * mounted — so none of its checkout effects run.
 */
export function SalesPageGate({ children }: { children: React.ReactNode }) {
  const sells = useSellsHere();
  if (!sells) return <NotSoldInAppPage />;
  return (
    <>
      <div data-sells className="contents">
        {children}
      </div>
      <div data-ios-only>
        <NotSoldInAppPage />
      </div>
    </>
  );
}

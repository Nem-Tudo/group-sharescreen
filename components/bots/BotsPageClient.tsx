"use client";

import { MdAdd, MdSmartToy } from "react-icons/md";
import { BotBrowser } from "@/components/bots/BotBrowser";
import { DEVELOPERS_URL } from "@/lib/botsApi";
import { useT } from "@/lib/useI18n";

// The /bots page's body: a heading, the way to make one of your own, and the
// directory (see BotBrowser) with no group in mind — each card leads to the
// add page, which asks which of your groups.

export function BotsPageClient() {
  const t = useT();
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-12 pt-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            <MdSmartToy className="h-7 w-7 shrink-0 text-indigo-500" />
            {t("botDirectory.pageTitle")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">{t("botDirectory.pageSubtitle")}</p>
        </div>
        <a
          href={DEVELOPERS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          <MdAdd className="h-4 w-4 shrink-0" />
          {t("botDirectory.createYourOwn")}
        </a>
      </div>
      <BotBrowser variant="page" />
    </main>
  );
}

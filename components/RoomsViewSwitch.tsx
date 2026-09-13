"use client";

import Link from "next/link";
import { MdOutlineMap } from "react-icons/md";
import { GlobeIcon } from "@/components/icons";
import { useT } from "@/lib/useI18n";

/**
 * The public rooms as a list (/rooms) or on the map (/worldmap) — two views of
 * the same thing, and the two halves of the Salas tab (see MobileTabBar). The
 * map used to be reachable only from a button on the home page.
 */
export function RoomsViewSwitch({ current }: { current: "list" | "map" }) {
  const t = useT();
  const item = (active: boolean) =>
    `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active
        ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
        : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
    }`;
  return (
    <div className="flex shrink-0 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900">
      <Link href="/rooms" aria-current={current === "list" ? "page" : undefined} className={item(current === "list")}>
        <GlobeIcon className="h-4 w-4" />
        {t("mobile.list")}
      </Link>
      <Link href="/worldmap" aria-current={current === "map" ? "page" : undefined} className={item(current === "map")}>
        <MdOutlineMap className="h-4 w-4" />
        {t("mobile.map")}
      </Link>
    </div>
  );
}

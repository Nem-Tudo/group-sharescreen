"use client";

import { MdClose } from "react-icons/md";
import { useT } from "@/lib/useI18n";

/**
 * A role on somebody, as a chip in its colour — with an × to take it off when
 * that is allowed. Shared by the settings' members tab and the member profile
 * (see GroupMemberPanel), so a role looks the same wherever it is handed out.
 */
export function RoleChip({
  name,
  color,
  onRemove,
  size = "sm",
}: {
  name: string;
  color: string | null;
  onRemove?: () => void;
  /** "md" for the profile, where the chips are the point rather than a detail. */
  size?: "sm" | "md";
}) {
  const t = useT();
  const md = size === "md";
  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-full border border-zinc-200 font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300 ${
        md ? "max-w-52 py-1 pl-2 pr-2.5 text-xs" : "max-w-40 py-0.5 pl-1.5 pr-2 text-[11px]"
      }`}
    >
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("groups.groupDialogs.removeTheNameRole", { name })}
          title={t("common.removeTheRole")}
          className={`group/chip relative flex shrink-0 cursor-pointer items-center justify-center rounded-full ${
            md ? "h-3.5 w-3.5" : "h-3 w-3"
          }`}
          style={{ backgroundColor: color ?? "#99aab5" }}
        >
          <MdClose
            className={`text-white opacity-0 transition group-hover/chip:opacity-100 group-focus-visible/chip:opacity-100 ${
              md ? "h-3 w-3" : "h-2.5 w-2.5"
            }`}
          />
        </button>
      ) : (
        <span
          className={`shrink-0 rounded-full ${md ? "h-3.5 w-3.5" : "h-3 w-3"}`}
          style={{ backgroundColor: color ?? "#99aab5" }}
        />
      )}
      <span className="truncate">{name}</span>
    </span>
  );
}

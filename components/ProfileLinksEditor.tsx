"use client";

import { MdAdd, MdClose } from "react-icons/md";
import {
  MAX_PROFILE_LINKS,
  NETWORKS,
  networkMeta,
  type ProfileLink,
} from "@/lib/profileLinks";
import { useT } from "@/lib/useI18n";
import type { CSSProperties } from "react";

// The editing half of the social links (see ProfileLinksRow for the other).
//
// Deliberately a controlled list with no state of its own: the profile card
// owns the array, the same way it owns the bio and the song, so "discard the
// edit" is that card dropping one value rather than this component being told
// to reset itself.
//
// Rows are kept even while empty or wrong. An earlier shape validated on the
// way in and refused to add a row until its link parsed, which meant the only
// way to fix a typo was to delete the row and start it again — so a bad link
// stays on screen, marked, and the save is what refuses it.

const selectClass =
  "themed-field rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const inputClass =
  "themed-field min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

export function ProfileLinksEditor({
  links,
  onChange,
  disabled = false,
  fieldStyle,
  hintStyle,
}: {
  links: ProfileLink[];
  onChange: (next: ProfileLink[]) => void;
  /** True without the plan — the rows render, locked, so the perk is visible. */
  disabled?: boolean;
  /** The profile gradient's field/hint colours, passed down from the card. */
  fieldStyle?: CSSProperties;
  hintStyle?: CSSProperties;
}) {
  const t = useT();

  function update(index: number, patch: Partial<ProfileLink>) {
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  }

  function remove(index: number) {
    onChange(links.filter((_, i) => i !== index));
  }

  function add() {
    // The first network not already used, so adding three rows in a row does
    // not produce three Instagram fields somebody has to re-pick each time.
    // Falls back to the head of the list once every network is taken —
    // duplicates are allowed, this is just a better first guess.
    const used = new Set(links.map((link) => link.network));
    const next = NETWORKS.find((network) => !used.has(network.id)) ?? NETWORKS[0];
    onChange([...links, { network: next.id, url: "" }]);
  }

  return (
    <div className="flex flex-col gap-2">
      {links.map((link, index) => {
        const meta = networkMeta(link.network);
        return (
          <div key={index} className="flex items-center gap-1.5">
            <meta.Icon className="h-4 w-4 shrink-0" style={{ color: meta.color }} />
            <select
              value={link.network}
              disabled={disabled}
              onChange={(e) => update(index, { network: e.target.value })}
              aria-label={t("profileLinks.network")}
              className={selectClass}
              style={fieldStyle}
            >
              {/* A saved network this build has no entry for stays choosable
                  rather than silently switching to Instagram on the next save. */}
              {!NETWORKS.some((network) => network.id === link.network) && (
                <option value={link.network}>{link.network}</option>
              )}
              {NETWORKS.map((network) => (
                <option key={network.id} value={network.id}>
                  {network.label}
                </option>
              ))}
            </select>
            <input
              type="url"
              inputMode="url"
              value={link.url}
              disabled={disabled}
              onChange={(e) => update(index, { url: e.target.value })}
              placeholder={meta.placeholder}
              aria-label={t("profileLinks.link")}
              className={inputClass}
              style={fieldStyle}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => remove(index)}
              aria-label={t("profileLinks.remove")}
              className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <MdClose className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      {links.length < MAX_PROFILE_LINKS && (
        <button
          type="button"
          disabled={disabled}
          onClick={add}
          className="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
          style={fieldStyle}
        >
          <MdAdd className="h-4 w-4" />
          {t("profileLinks.add")}
        </button>
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-400" style={hintStyle}>
        {t("profileLinks.hint", { max: MAX_PROFILE_LINKS })}
      </p>
    </div>
  );
}

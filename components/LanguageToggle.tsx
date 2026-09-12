"use client";

import { MdOutlineLanguage } from "react-icons/md";
import { useI18n } from "@/lib/useI18n";
import { trackEvent } from "@/lib/analytics";
import {
  LOCALES,
  LOCALE_LABELS,
  isLocale,
  type LocalePreference,
} from "@/lib/i18n";

// The language switch, as a dropdown.
//
// Not the segmented control the theme above it uses, and the difference is
// the content rather than a change of mind: a theme has three options whose
// names are one short word each, while languages are written in their own
// language ("Português"), keep their full length, and are a list that grows
// every time a catalog is added. A row of buttons stops working at the fourth
// one; a dropdown does not care how many there are.
//
// A native <select> rather than a popover: this already renders inside the
// account menu's popover, and the one nested there would have to fight it for
// outside-click and focus (see the note in components/Tooltip.tsx). It also
// gets the OS picker on a phone for free, which is the better control for a
// list of names.
//
// "Automático" is a real choice rather than the absence of one, exactly as
// "Sistema" is for the theme: it follows the browser's own language list and
// keeps following it, so somebody moving between two browsers gets each one
// in its own language without touching this.

const inputClass =
  "w-full appearance-none rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-8 text-sm text-zinc-950 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

export function LanguagePicker({ className = "" }: { className?: string }) {
  const { preference, locale, setLocale, t } = useI18n();

  return (
    <div className={`relative ${className}`}>
      <MdOutlineLanguage
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500"
      />
      <select
        aria-label={t("languageToggle.siteLanguage")}
        value={preference}
        onChange={(e) => {
          const next = e.target.value;
          const chosen: LocalePreference = isLocale(next) ? next : "auto";
          setLocale(chosen);
          trackEvent("locale_changed", { locale: chosen });
        }}
        className={inputClass}
      >
        {/* On "auto" the word alone does not say which language that is right
            now, and that is the one thing somebody opening this wants to
            know — so it names the answer. */}
        <option value="auto">
          {t("languageToggle.followsTheBrowser", { language: LOCALE_LABELS[locale] })}
        </option>
        {LOCALES.map((value) => (
          <option key={value} value={value}>
            {LOCALE_LABELS[value]}
          </option>
        ))}
      </select>
      {/* The chevron the appearance-none above removed. */}
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500"
      >
        <path
          d="M6 8l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

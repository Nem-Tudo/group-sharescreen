"use client";

import { MdOutlineLanguage } from "react-icons/md";
import { useI18n } from "@/lib/useI18n";
import { trackEvent } from "@/lib/analytics";
import { LOCALES, LOCALE_LABELS, type LocalePreference } from "@/lib/i18n";

// The language switch, built to match components/ThemeToggle's segmented
// control — it sits directly under it in the account menu, and two settings
// that look like two different kinds of control read as two different kinds
// of setting when they are the same kind.
//
// "Automático" is a real choice rather than the absence of one, exactly as
// "Sistema" is for the theme: it follows the browser's own language list and
// keeps following it, so somebody who travels between two browsers gets each
// one in its own language without touching this.
//
// Every option is labelled in its own language. A picker that says "Spanish"
// to somebody who only reads Spanish is a picker for people who did not need
// it.
const OPTIONS: { value: LocalePreference; label: string }[] = [
  { value: "auto", label: "Auto" },
  ...LOCALES.map((locale) => ({ value: locale as LocalePreference, label: LOCALE_LABELS[locale] })),
];

export function LanguageSegmented({ className = "" }: { className?: string }) {
  const { preference, locale, setLocale, t } = useI18n();

  return (
    <div
      role="radiogroup"
      aria-label={t("languageToggle.siteLanguage")}
      className={`flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {OPTIONS.map(({ value, label }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            // On "auto" the label alone does not say which language that is
            // right now, and that is the one thing somebody checking this
            // setting wants to know.
            title={
              value === "auto"
                ? t("languageToggle.followsTheBrowser", { language: LOCALE_LABELS[locale] })
                : label
            }
            onClick={() => {
              setLocale(value);
              trackEvent("locale_changed", { locale: value });
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
              active
                ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {value === "auto" && <MdOutlineLanguage className="h-4 w-4 shrink-0" />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import Link from "next/link";
import { MdCheck, MdMonitor } from "react-icons/md";
import { SiteHeader } from "@/components/SiteHeader";
import { SocialLinks } from "@/components/SocialLinks";
import { useT } from "@/lib/useI18n";

const sectionClass = "mx-auto w-full max-w-3xl px-4";
const h2Class = "text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50";
const h3Class = "font-medium text-zinc-950 dark:text-zinc-50";
const bodyClass = "mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400";
const cardClass =
  "rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950";
const linkClass =
  "text-sky-700 underline underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300";
const ctaClass =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700";

/**
 * The guide behind the "transmitir tela online" search. HomeSeoContent already
 * says what GoLive is, so this page answers what comes up while actually doing
 * it (what to pick in the browser's dialog, where the sound went, what to do
 * about a black screen) rather than repeating the home in other words.
 *
 * Every string is visible on the page and the JSON-LD is built from the same
 * arrays, for the reason given in HomeSeoContent.
 */
export function ScreenGuideContent() {
  const t = useT();

  const steps = [
    { title: t("screenGuide.step1Title"), body: t("screenGuide.step1Body") },
    { title: t("screenGuide.step2Title"), body: t("screenGuide.step2Body") },
    { title: t("screenGuide.step3Title"), body: t("screenGuide.step3Body") },
    { title: t("screenGuide.step4Title"), body: t("screenGuide.step4Body") },
  ];

  const choices = [
    { title: t("screenGuide.choiceTabTitle"), body: t("screenGuide.choiceTabBody") },
    { title: t("screenGuide.choiceWindowTitle"), body: t("screenGuide.choiceWindowBody") },
    { title: t("screenGuide.choiceScreenTitle"), body: t("screenGuide.choiceScreenBody") },
  ];

  const audio = [
    { title: t("screenGuide.audioChromiumTitle"), body: t("screenGuide.audioChromiumBody") },
    { title: t("screenGuide.audioFirefoxTitle"), body: t("screenGuide.audioFirefoxBody") },
    { title: t("screenGuide.audioAppTitle"), body: t("screenGuide.audioAppBody") },
  ];

  const problems = [
    { title: t("screenGuide.problemBlackTitle"), body: t("screenGuide.problemBlackBody") },
    { title: t("screenGuide.problemPermissionTitle"), body: t("screenGuide.problemPermissionBody") },
    { title: t("screenGuide.problemNoSoundTitle"), body: t("screenGuide.problemNoSoundBody") },
    { title: t("screenGuide.problemEchoTitle"), body: t("screenGuide.problemEchoBody") },
  ];

  const faq = [
    { q: t("screenGuide.faq1Q"), a: t("screenGuide.faq1A") },
    { q: t("screenGuide.faq2Q"), a: t("screenGuide.faq2A") },
    { q: t("screenGuide.faq3Q"), a: t("screenGuide.faq3A") },
    { q: t("screenGuide.faq4Q"), a: t("screenGuide.faq4A") },
  ];

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  const howToJsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: t("screenGuide.stepsTitle"),
    totalTime: "PT1M",
    step: steps.map((step, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: step.title,
      text: step.body,
    })),
  };

  return (
    <>
      <SiteHeader />
      <main className="flex-1 bg-zinc-50 dark:bg-black">
        <section className={`${sectionClass} pt-8 pb-10`}>
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-zinc-950 sm:text-5xl dark:text-zinc-50">
            {t("screenGuide.h1")}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t("screenGuide.intro")}
          </p>
          <div className="mt-8">
            <Link href="/" className={ctaClass}>
              <MdMonitor className="h-5 w-5" />
              {t("screenGuide.cta")}
            </Link>
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
            {[t("screenGuide.perkFree"), t("screenGuide.perkNoSignup"), t("screenGuide.perkNoInstall")].map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5">
                <MdCheck className="h-4 w-4 text-emerald-500" />
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className={`${sectionClass} py-8`}>
          <h2 className={h2Class}>{t("screenGuide.stepsTitle")}</h2>
          <ol className="mt-6 space-y-3">
            {steps.map((step, i) => (
              <li key={step.title} className={`${cardClass} flex gap-3`}>
                <span
                  aria-hidden
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-700 dark:bg-sky-900 dark:text-sky-300"
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className={h3Class}>{step.title}</h3>
                  <p className={bodyClass}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className={`${sectionClass} py-8`}>
          <h2 className={h2Class}>{t("screenGuide.choiceTitle")}</h2>
          <p className={bodyClass}>{t("screenGuide.choiceIntro")}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {choices.map((item) => (
              <div key={item.title} className={cardClass}>
                <h3 className={h3Class}>{item.title}</h3>
                <p className={bodyClass}>{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={`${sectionClass} py-8`}>
          <h2 className={h2Class}>{t("screenGuide.audioTitle")}</h2>
          <p className={bodyClass}>{t("screenGuide.audioIntro")}</p>
          <div className="mt-6 space-y-3">
            {audio.map((item) => (
              <div key={item.title} className={cardClass}>
                <h3 className={h3Class}>{item.title}</h3>
                <p className={bodyClass}>{item.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm">
            <Link href="/app" className={linkClass}>
              {t("screenGuide.appLink")}
            </Link>
          </p>
        </section>

        <section className={`${sectionClass} py-8`}>
          <h2 className={h2Class}>{t("screenGuide.problemsTitle")}</h2>
          <div className="mt-6 space-y-3">
            {problems.map((item) => (
              <div key={item.title} className={cardClass}>
                <h3 className={h3Class}>{item.title}</h3>
                <p className={bodyClass}>{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={`${sectionClass} py-8`}>
          <h2 className={h2Class}>{t("screenGuide.faqTitle")}</h2>
          <div className="mt-6 space-y-3">
            {faq.map((item) => (
              <div key={item.q} className={cardClass}>
                <h3 className={h3Class}>{item.q}</h3>
                <p className={bodyClass}>{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={`${sectionClass} py-8 pb-16`}>
          <div className="rounded-3xl border border-sky-500/20 bg-sky-500/5 p-8 text-center">
            <h2 className={h2Class}>{t("screenGuide.closingTitle")}</h2>
            <p className="mx-auto mt-3 max-w-xl text-zinc-600 dark:text-zinc-400">
              {t("screenGuide.closingBody")}
            </p>
            <div className="mt-6">
              <Link href="/" className={ctaClass}>
                <MdMonitor className="h-5 w-5" />
                {t("screenGuide.cta")}
              </Link>
            </div>
          </div>
        </section>

        <footer className={`${sectionClass} pb-16 text-center text-xs text-zinc-400 dark:text-zinc-600`}>
          <SocialLinks className="mb-8" />
          <p>
            <Link
              href="/terms"
              className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              {t("common.termsOfUse")}
            </Link>
          </p>
        </footer>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }}
        />
      </main>
    </>
  );
}

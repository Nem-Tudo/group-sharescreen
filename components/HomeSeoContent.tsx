"use client";

import Link from "next/link";
import { useT } from "@/lib/useI18n";

/**
 * The part of the home page that exists for someone who has not arrived yet.
 *
 * Everything above this on app/page.tsx is a form: a heading, three buttons and
 * a name field. That is the right page for somebody who already knows what
 * GoLive is - and it is also, measured as text, about eighty words, which is
 * roughly nothing for a search engine to match a query against. Someone typing
 * "transmitir tela online" into Google was never going to be shown a page whose
 * entire copy is "GoLive" and "Criar sala", no matter how well the app behind
 * it works.
 *
 * So this section says, in prose, the things the app does: what sharing a
 * screen with a group here means, the steps to do it, and the questions people
 * actually ask before they trust a stranger's site with their camera. The
 * phrasing is deliberately the phrasing people search with ("transmitir tela
 * online", "compartilhar tela com amigos", "sem instalar nada") rather than
 * internal vocabulary alone.
 *
 * It is below the form, never in front of it: the person who came here to type
 * a room name should not have to scroll past marketing copy to reach the field,
 * and Google reads the whole document regardless of what is in the first
 * screenful.
 *
 * The FAQ is mirrored into a FAQPage JSON-LD block at the bottom of this file.
 * That mirroring is the rule Google enforces - structured data describing
 * answers that are not visible on the page is a manual-action risk - so both
 * the markup and the JSON-LD are built from one array, `faq` below, and cannot
 * drift apart.
 */
export function HomeSeoContent({ className = "" }: { className?: string }) {
  const t = useT();

  const steps = [
    { title: t("homeSeo.step1Title"), body: t("homeSeo.step1Body") },
    { title: t("homeSeo.step2Title"), body: t("homeSeo.step2Body") },
    { title: t("homeSeo.step3Title"), body: t("homeSeo.step3Body") },
  ];

  const features = [
    { title: t("homeSeo.featureScreenTitle"), body: t("homeSeo.featureScreenBody") },
    { title: t("homeSeo.featureCameraTitle"), body: t("homeSeo.featureCameraBody") },
    { title: t("homeSeo.featureVoiceTitle"), body: t("homeSeo.featureVoiceBody") },
    { title: t("homeSeo.featurePrivateTitle"), body: t("homeSeo.featurePrivateBody") },
    { title: t("homeSeo.featureFreeTitle"), body: t("homeSeo.featureFreeBody") },
    { title: t("homeSeo.featureAppTitle"), body: t("homeSeo.featureAppBody") },
  ];

  const faq = [
    { q: t("homeSeo.faq1Q"), a: t("homeSeo.faq1A") },
    { q: t("homeSeo.faq2Q"), a: t("homeSeo.faq2A") },
    { q: t("homeSeo.faq3Q"), a: t("homeSeo.faq3A") },
    { q: t("homeSeo.faq4Q"), a: t("homeSeo.faq4A") },
    { q: t("homeSeo.faq5Q"), a: t("homeSeo.faq5A") },
    { q: t("homeSeo.faq6Q"), a: t("homeSeo.faq6A") },
    { q: t("homeSeo.faq7Q"), a: t("homeSeo.faq7A") },
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
    name: t("homeSeo.howToTitle"),
    description: t("homeSeo.howToIntro"),
    totalTime: "PT1M",
    step: steps.map((step, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: step.title,
      text: step.body,
    })),
  };

  const cardClass =
    "rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950";
  const headingClass = "text-lg font-semibold text-zinc-950 dark:text-zinc-50";
  const bodyClass = "mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400";
  const linkClass =
    "text-sky-700 underline underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300";

  return (
    // <section> rather than a bare div, and every block under its own heading:
    // the outline is what a crawler walks, and a wall of <div>s reads as one
    // undifferentiated blob no matter how good the sentences are.
    <section className={`mx-auto w-full max-w-5xl ${className}`}>
      <div className={cardClass}>
        <h2 className={headingClass}>{t("homeSeo.aboutTitle")}</h2>
        <p className={bodyClass}>{t("homeSeo.aboutBody1")}</p>
        <p className={bodyClass}>{t("homeSeo.aboutBody2")}</p>
      </div>

      <div className={`${cardClass} mt-4`}>
        <h2 className={headingClass}>{t("homeSeo.howToTitle")}</h2>
        <p className={bodyClass}>{t("homeSeo.howToIntro")}</p>
        {/* Ordered, because the steps are an order - and because an <ol> is
            what lets this be a HowTo in structured data without lying. */}
        <ol className="mt-4 space-y-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-700 dark:bg-sky-900 dark:text-sky-300"
              >
                {i + 1}
              </span>
              <span>
                <strong className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {step.title}
                </strong>
                <span className="mt-1 block text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {step.body}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className={`${cardClass} mt-4`}>
        <h2 className={headingClass}>{t("homeSeo.featuresTitle")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title}>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {feature.title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className={`${cardClass} mt-4`}>
        <h2 className={headingClass}>{t("homeSeo.faqTitle")}</h2>
        {/* Plain headings and paragraphs, not <details>. A closed <details> is
            still in the DOM and Google does index it, but the answer is what a
            FAQ rich result quotes and there is no reason to make a reader click
            for what the crawler already has. */}
        <div className="mt-4 space-y-4">
          {faq.map((item) => (
            <div key={item.q}>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {item.q}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Internal links with words in them. The buttons at the top of the page
          say "Ver salas publicas"; a crawler weighs the text of a link when
          deciding what the page behind it is about, so the same destinations
          are offered again here described by what they are. */}
      <nav aria-label={t("homeSeo.exploreTitle")} className={`${cardClass} mt-4`}>
        <h2 className={headingClass}>{t("homeSeo.exploreTitle")}</h2>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <li>
            <Link href="/rooms" className={linkClass}>
              {t("homeSeo.linkRooms")}
            </Link>
          </li>
          <li>
            <Link href="/worldmap" className={linkClass}>
              {t("homeSeo.linkWorldmap")}
            </Link>
          </li>
          <li>
            <Link href="/app" className={linkClass}>
              {t("homeSeo.linkApp")}
            </Link>
          </li>
          <li>
            <Link href="/discord-bot" className={linkClass}>
              {t("homeSeo.linkDiscordBot")}
            </Link>
          </li>
          <li>
            <Link href="/pro" className={linkClass}>
              {t("homeSeo.linkPro")}
            </Link>
          </li>
          <li>
            <Link href="/badges" className={linkClass}>
              {t("homeSeo.linkBadges")}
            </Link>
          </li>
        </ul>
      </nav>

      {/* Plain <script> tags rather than next/script: these carry no behaviour,
          they only have to be in the served HTML when the crawler reads it. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }}
      />
    </section>
  );
}

"use client";

import Link from "next/link";
import { AdsterraBanner } from "@/components/AdsterraBanner";
import { FaApple, FaGithub, FaLinux, FaWindows } from "react-icons/fa";
import {
  MdCheck,
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdClose,
  MdMemory,
  MdSecurity,
  MdTune,
} from "react-icons/md";
import { SocialLinks } from "@/components/SocialLinks";
import { SiteHeader } from "@/components/SiteHeader";
import { DownloadPanel } from "./DownloadPanel";
import {
  FeatureArt,
  ParticipantArt,
  SharedScreenArt,
  type FeatureArtId,
} from "./FeatureArt";
import { translate } from "@/lib/i18n";

export const SITE_URL = "https://golive.nemtudo.me";


export const DESCRIPTION =
  translate("app.goliveAsAnApplicationLightOn");

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  get name() { return translate("app.goliveForDesktop"); },
  url: `${SITE_URL}/app`,
  description: DESCRIPTION,
  applicationCategory: "CommunicationApplication",
  operatingSystem: "Windows, macOS, Linux",
  inLanguage: "en",
  offers: { "@type": "Offer", price: "0", priceCurrency: "BRL" },
};

const BENEFITS: { title: string; body: string; art: FeatureArtId; tag?: string }[] = [
  {
    get title() { return translate("app.lighterThanTheUsualPrograms"); },
    get body() { return translate("app.noGameOverlayNoRichPresence"); },
    art: "weight",
  },
  {
    get title() { return translate("app.youChooseExactlyWhichSoundsGo"); },
    get body() { return translate("app.theListOfProgramsPlayingSound"); },
    art: "audio-pick",
  },
  {
    get title() { return translate("app.processesOnlyWhatSomeoneSees"); },
    get body() { return translate("app.eachViewerGetsTheQualityTheir"); },
    art: "quality",
  },
  {
    get title() { return translate("app.systemSoundWithNoEcho"); },
    get body() { return translate("app.inTheBrowserTheCaptureTakes"); },
    art: "echo",
    get tag() { return translate("common.windows"); },
  },
  {
    get title() { return translate("app.nativeScreenPicker"); },
    get body() { return translate("app.theSystemSOwnWindowAnd"); },
    art: "picker",
  },
  {
    get title() { return translate("app.aWindowJustForGolive"); },
    get body() { return translate("app.noGettingLostAmongTabsNo"); },
    art: "window",
  },
  {
    get title() { return translate("app.updatesItself"); },
    get body() { return translate("app.itDownloadsInTheBackgroundAnd"); },
    art: "update",
  },
];

const COMPARISON = {
  golive: [
    translate("app.opensWhenYouAreGoingTo"),
    translate("app.youCheckAppByAppWhich"),
    translate("app.peerToPeerVideoAndVoice"),
    translate("app.encodesOnlyTheQualityEachViewer"),
    translate("app.worksWithNothingInstalledRightIn"),
    translate("app.noAccountRequiredAndNoPaid"),
  ],
  others: [
    translate("app.theyTendToStartWithThe"),
    translate("app.theScreenSoundGoesWholeOr"),
    translate("app.overlayRichPresenceAndIntegrationsRunning"),
    translate("app.accountRequiredAndTheGoodFeatures"),
  ],
};

const MUTED_APPS = [
  { get name() { return translate("common.golive"); }, checked: true, locked: true },
  { get name() { return translate("common.spotify"); }, checked: true },
  { get name() { return translate("common.whatsapp"); }, checked: true },
  { get name() { return translate("common.browser"); }, checked: false },
  { get name() { return translate("app.steam"); }, checked: false },
];

const PARTICIPANTS = [
  { get name() { return translate("common.you"); }, gradient: "from-emerald-700 to-teal-900" },
  { get name() { return translate("app.maria"); }, gradient: "from-fuchsia-700 to-purple-900", speaking: true },
  { get name() { return translate("app.john"); }, gradient: "from-sky-700 to-indigo-900" },
  { get name() { return translate("app.ana"); }, gradient: "from-amber-600 to-orange-900" },
];

const PLATFORM_ROWS = [
  {
    get name() { return translate("common.windows"); },
    file: ".exe",
    Icon: FaWindows,
    get note() { return translate("app.anOrdinaryInstallerItIsThe"); },
  },
  {
    name: "macOS",
    file: ".dmg",
    Icon: FaApple,
    get note() { return translate("app.universalBinaryTheSameFileRuns"); },
  },
  {
    get name() { return translate("common.linux"); },
    file: ".AppImage",
    Icon: FaLinux,
    get note() { return translate("app.aSingleFileNoInstallationGive"); },
  },
];

const FAQ = [
  {
    get q() { return translate("app.doINeedTheAppTo"); },
    get a() { return translate("app.noTheSiteWorksFullyIn"); },
  },
  {
    get q() { return translate("app.doesItGetHeavyOverTime"); },
    get a() { return translate("app.itHasNoWayToIt"); },
  },
  {
    get q() { return translate("app.isItPaid"); },
    get a() { return translate("app.noTheAppIsFreeLike"); },
  },
  {
    get q() { return translate("app.howDoesChoosingTheSoundsWork"); },
    get a() { return translate("app.whenItIsTimeToShare"); },
  },
  {
    get q() { return translate("app.whyDoesThisOnlyWorkOn"); },
    get a() { return translate("app.becauseOnlyWindowsLetsYouCapture"); },
  },
  {
    get q() { return translate("app.doesTheAppFallBehindThe"); },
    get a() { return translate("app.noTheWindowLoadsThePublished"); },
  },
  {
    get q() { return translate("app.windowsComplainedAboutTheInstallerIs"); },
    get a() { return translate("app.theWarningAppearsBecauseTheInstaller"); },
  },
  {
    get q() { return translate("app.whatAboutMobile"); },
    get a() { return translate("app.thereIsNoMobileAppBut"); },
  },
];

const sectionClass = "mx-auto w-full max-w-5xl px-4";

const h2Class = "text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl dark:text-zinc-50";

const cardClass =
  "rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950";

const ghostButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900";

// The release tag is fetched on the server (see page.tsx) — it is the same
// answer for everybody and worth caching once, rather than a request from
// every browser that opens this page.
export function DesktopAppContent({ version }: { version: string | null }) {

  return (
    <>
      <SiteHeader />
      <div className="flex-1 bg-zinc-50 dark:bg-black">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero. The glow is a plain radial gradient rather than an image — it
          costs nothing, scales to any width and holds up in both themes. */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-40 h-[28rem] bg-[radial-gradient(60%_60%_at_50%_50%,rgba(16,185,129,0.16),transparent_70%)]"
        />
        <div
          className={`${sectionClass} relative grid gap-12 pt-8 pb-20 lg:grid-cols-2 lg:items-center lg:gap-16`}
        >
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              {translate("app.windowsMacosLinux")}
              {version && (
                <span className="font-mono font-normal text-emerald-600/70 dark:text-emerald-400/70">
                  {version}
                </span>
              )}
            </span>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance text-zinc-950 sm:text-5xl dark:text-zinc-50">
              {translate("app.lightOnTheMachineAndThe")}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
              {translate("app.sameRoomSameLinkSameAccount")}
            </p>
            <div className="mt-8">
              <DownloadPanel />
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
              {[translate("common.free"), translate("app.noSignUp"), translate("app.openSource")].map((item) => (
                <li key={item} className="inline-flex items-center gap-1.5">
                  <MdCheck className="h-4 w-4 text-emerald-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* A drawing of the app window rather than a screenshot: sharp at
              any size, correct in both themes, and nothing to re-capture
              when the interface changes. */}
          <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-950">
            <div className="flex items-center gap-2 border-b border-black/10 bg-zinc-100 px-4 py-3 dark:border-white/10 dark:bg-zinc-900">
              <span className="h-3 w-3 rounded-full bg-red-400" />
              <span className="h-3 w-3 rounded-full bg-amber-400" />
              <span className="h-3 w-3 rounded-full bg-emerald-400" />
              <span className="ml-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {translate("common.golive")}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 p-4">
              <div className="col-span-2">
                <SharedScreenArt />
              </div>
              {PARTICIPANTS.map((participant) => (
                <ParticipantArt key={participant.name} {...participant} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-black/10 px-4 py-3 text-xs dark:border-white/10">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-300">
                <MdTune className="h-3.5 w-3.5" />
                {translate("app.sound2AppsOut")}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-500/10 px-2.5 py-1 font-medium text-zinc-600 dark:text-zinc-400">
                <MdMemory className="h-3.5 w-3.5" />
                {translate("app.aWindowNothingMore")}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className={`${sectionClass} py-16`}>
        <h2 className={h2Class}>{translate("app.whatYouGetByInstalling")}</h2>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          {translate("app.theWindowLoadsTheSameSite")}
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map(({ title, body, art, tag }) => (
            // `group` so a card's drawing can react to it being hovered (the
            // update bar finishes filling); the lift is what tells a mouse
            // it found the card in the first place.
            <div
              key={title}
              className="group rounded-2xl border border-black/10 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-emerald-500/40 hover:shadow-md dark:border-white/10 dark:bg-zinc-950"
            >
              <FeatureArt id={art} />
              <div className="mt-4 flex items-start justify-between gap-2">
                <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">{title}</h3>
                {tag && (
                  <span className="mt-0.5 shrink-0 rounded-full border border-black/10 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                    {tag}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The audio control, with the picker recreated. This is the section
          the app is really sold on: everything the browser and the other
          programs cannot do about sound lives here, echo included. */}
      <section className={`${sectionClass} py-16`}>
        <div className="grid gap-10 rounded-3xl border border-black/10 bg-white p-8 shadow-sm sm:p-12 lg:grid-cols-2 lg:items-center dark:border-white/10 dark:bg-zinc-950">
          <div>
            <h2 className={h2Class}>{translate("app.nothingLeaksUnlessYouSaySo")}</h2>
            <p className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-400">
              {translate("app.inTheUsualCallProgramsThe")}
            </p>
            <ul className="mt-6 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
              <li className="flex gap-3">
                <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  <strong className="text-zinc-950 dark:text-zinc-50">{translate("app.takeOutSpotify")}</strong> {translate("app.andThatSItYourMusic")}
                </span>
              </li>
              <li className="flex gap-3">
                <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  <strong className="text-zinc-950 dark:text-zinc-50">{translate("app.takeOutWhatsapp")}</strong> {translate("app.andListenToYourAudioFreely")}
                </span>
              </li>
              <li className="flex gap-3">
                <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  <strong className="text-zinc-950 dark:text-zinc-50">{translate("app.goliveAlreadyStaysOut")}</strong>{translate("app.alwaysItIsWhatKeepsThe")}
                </span>
              </li>
            </ul>
            <p className="mt-6 text-xs text-zinc-400 dark:text-zinc-600">
              {translate("app.perProgramChoiceIsAvailableOn")}
            </p>
          </div>

          {/* Recreated from the app's own picker panel. */}
          <div className="rounded-2xl border border-black/10 bg-zinc-50 p-5 shadow-inner dark:border-white/10 dark:bg-zinc-900">
            <p className="font-semibold text-zinc-950 dark:text-zinc-50">
              {translate("app.doNotShareSoundFromThe")}
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {translate("app.appsOpenRightNowWhateverThe")}
            </p>
            <ul className="mt-4 space-y-1">
              {MUTED_APPS.map(({ name, checked, locked }) => (
                <li
                  key={name}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                    checked
                      ? "bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50"
                      : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {checked ? (
                    <MdCheckBox
                      className={`h-4 w-4 shrink-0 ${locked ? "text-zinc-400" : "text-emerald-500"}`}
                    />
                  ) : (
                    <MdCheckBoxOutlineBlank className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-600" />
                  )}
                  <span className="flex-1 font-medium">{name}</span>
                  {locked && (
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-600">
                      sempre sem som
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center gap-2 border-t border-black/10 pt-4 text-sm dark:border-white/10">
              <MdCheck className="h-4 w-4 text-emerald-500" />
              <span className="text-zinc-600 dark:text-zinc-400">{translate("app.shareScreenSound")}</span>
            </div>
          </div>
        </div>
      </section>

      {/* The weight argument, kept unnamed on the other side. */}
      <section className={`${sectionClass} py-16`}>
        <h2 className={h2Class}>{translate("app.anAppNotAWholeClient")}</h2>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          {translate("app.callProgramsHaveTurnedIntoPlatforms")}
        </p>
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-6">
            <p className="font-semibold text-emerald-700 dark:text-emerald-300">{translate("app.inTheGoliveApp")}</p>
            <ul className="mt-4 space-y-3">
              {COMPARISON.golive.map((item) => (
                <li key={item} className="flex gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                  <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white p-6 dark:border-white/10 dark:bg-zinc-950">
            <p className="font-semibold text-zinc-950 dark:text-zinc-50">
              {translate("app.inTheUsualCallPrograms")}
            </p>
            <ul className="mt-4 space-y-3">
              {COMPARISON.others.map((item) => (
                <li key={item} className="flex gap-3 text-sm text-zinc-600 dark:text-zinc-400">
                  <MdClose className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-600" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className={`${sectionClass} py-16`}>
        <h2 className={h2Class}>{translate("app.forYourSystem")}</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {PLATFORM_ROWS.map(({ name, file, Icon, note }) => (
            <div key={name} className={cardClass}>
              <div className="flex items-center gap-3">
                <Icon className="h-6 w-6 text-zinc-700 dark:text-zinc-300" />
                <div>
                  <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">{name}</h3>
                  <p className="font-mono text-xs text-zinc-400 dark:text-zinc-600">{file}</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{note}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 flex items-start gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <MdSecurity className="mt-0.5 h-4 w-4 shrink-0" />
          {translate("app.theFilesComeStraightFromThe")}
        </p>
      </section>

      <section className={`${sectionClass} py-16`}>
        <h2 className={h2Class}>{translate("common.frequentlyAskedQuestions")}</h2>
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {FAQ.map(({ q, a }) => (
            <details
              key={q}
              className="group rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-950"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-6 font-medium text-zinc-950 dark:text-zinc-50">
                {q}
                <span className="shrink-0 text-xl leading-none text-zinc-400 transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="px-6 pb-6 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {a}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className={`${sectionClass} pb-20`}>
        <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center sm:p-12">
          <h2 className={h2Class}>{translate("app.downloadAndOpen")}</h2>
          <p className="mx-auto mt-3 max-w-xl text-zinc-600 dark:text-zinc-400">
            {translate("app.yourAccountYourRoomsAndYour")}
          </p>
          <div className="mt-8 flex flex-col items-center gap-4">
            <DownloadPanel />
            <a
              href="https://github.com/Nem-Tudo/group-sharescreen"
              target="_blank"
              rel="noopener noreferrer"
              className={ghostButtonClass}
            >
              <FaGithub className="h-5 w-5" />
              {translate("app.seeTheCode")}
            </a>
          </div>
        </div>
      </section>

      <footer
        className={`${sectionClass} pb-16 text-center text-xs text-zinc-400 dark:text-zinc-600`}
      >
        <AdsterraBanner className="mb-10" />
        <SocialLinks className="mb-8" />
        <p>
          <Link
            href="/terms"
            className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {translate("common.termsOfUse")}
          </Link>
        </p>
      </footer>
      </div>
    </>
  );
}

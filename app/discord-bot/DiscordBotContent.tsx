"use client";

import Image from "next/image";
import Link from "next/link";
import { FaDiscord, FaGithub } from "react-icons/fa";
import { SocialLinks } from "@/components/SocialLinks";
import { SiteHeader } from "@/components/SiteHeader";
import {
  MdBolt,
  MdCheck,
  MdChat,
  MdCode,
  MdGroups,
  MdLink,
  MdLock,
  MdMonitor,
  MdVolumeUp,
} from "react-icons/md";
import { translate } from "@/lib/i18n";

const BOT_INVITE = "/bot";

export const SITE_URL = "https://golive.nemtudo.me";

export const DESCRIPTION =
  translate("discordBot.addTheGoliveBotToYour");

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  get name() { return translate("discordBot.goliveBotForDiscord"); },
  url: `${SITE_URL}/discord-bot`,
  description: DESCRIPTION,
  applicationCategory: "CommunicationApplication",
  operatingSystem: "Discord",
  inLanguage: "en",
  offers: { "@type": "Offer", price: "0", priceCurrency: "BRL" },
};

const STEPS = [
  {
    get title() { return translate("discordBot.someoneJoinsTheCall"); },
    get body() { return translate("discordBot.theFirstPersonToJoinAny"); },
    Icon: MdGroups,
  },
  {
    get title() { return translate("discordBot.theBotCreatesAPrivateRoom"); },
    get body() { return translate("discordBot.aNewGoliveRoomForThat"); },
    Icon: MdLock,
  },
  {
    get title() { return translate("discordBot.theLinkGoesToTheCall"); },
    get body() { return translate("discordBot.theVoiceChannelSStatusNow"); },
    Icon: MdLink,
  },
  {
    get title() { return translate("discordBot.andInTheCallSChat"); },
    get body() { return translate("discordBot.aMessageInTheVoiceChannel"); },
    Icon: MdChat,
  },
];

const BENEFITS = [
  {
    get title() { return translate("discordBot.worksOutOfTheBoxAdjust"); },
    get body() { return translate("discordBot.addedDoneTheTwoThingsIt"); },
    Icon: MdBolt,
  },
  {
    get title() { return translate("discordBot.severalScreensAtOnce"); },
    get body() { return translate("discordBot.onGoliveEveryoneInTheRoom"); },
    Icon: MdGroups,
  },
  {
    get title() { return translate("discordBot.noSignUpForWhoeverJoins"); },
    get body() { return translate("discordBot.yourMembersOpenTheLinkPick"); },
    Icon: MdCheck,
  },
  {
    get title() { return translate("discordBot.privateRoomsByDefault"); },
    get body() { return translate("discordBot.eachCallSRoomIsPrivate"); },
    Icon: MdLock,
  },
  {
    get title() { return translate("discordBot.freeAndOpenSource"); },
    get body() { return translate("discordBot.noPaidPlanNoPremiumRole"); },
    Icon: MdCode,
  },
];

const COMMANDS = [
  {
    name: "/config chat",
    option: "enabled",
    get body() { return translate("discordBot.turnsSendingTheUrlInThe"); },
  },
  {
    name: "/config status",
    option: "enabled",
    get body() { return translate("discordBot.turnsTheUrlInTheVoice"); },
  },
  {
    name: "/config show",
    get body() { return translate("discordBot.showsTheServerSCurrentConfiguration"); },
  },
];

const FAQ = [
  {
    get q() { return translate("discordBot.isTheBotPaid"); },
    get a() { return translate("discordBot.noItIsCompletelyFreeOn"); },
  },
  {
    get q() { return translate("discordBot.doIHaveToConfigureAnything"); },
    get a() { return translate("discordBot.noAsSoonAsTheBot"); },
  },
  {
    get q() { return translate("discordBot.whoCanUseTheConfigCommands"); },
    get a() { return translate("discordBot.onlyWhoeverHasTheManageServer"); },
  },
  {
    get q() { return translate("discordBot.whatPermissionsDoesItNeed"); },
    get a() { return translate("discordBot.onlyTheOnesThatMatchWhat"); },
  },
  {
    get q() { return translate("discordBot.doesWhoeverJoinsTheRoomNeed"); },
    get a() { return translate("discordBot.noJustOpenTheLinkAnd"); },
  },
  {
    get q() { return translate("discordBot.isTheRoomOpenToAnyone"); },
    get a() { return translate("discordBot.theRoomIsPrivateSoIt"); },
  },
  {
    get q() { return translate("discordBot.canIUseGoliveWithoutThe"); },
    get a() { return translate("discordBot.youCanTheBotOnlyAutomates"); },
  },
];

const SHOTS = [
  {
    src: "https://cdn.nemtudo.me/f/command/MjAyNi8wOC8yMi9JTUFHRS8wMV8yNl8yM19fMTc4NzM3Mjc4Mzk4Mi0xMjUyMDI2MDU.webp",
    width: 1040,
    height: 1109,
    get alt() { return translate("discordBot.aMessageFromTheGoliveBot"); },
    get caption() { return translate("discordBot.theMessageTheBotSendsIn"); },
  },
  {
    src: "https://cdn.nemtudo.me/f/command/MjAyNi8wOC8yMi9JTUFHRS8wMV8yN18xOF9fMTc4NzM3MjgzODY2Mi01NzkzMDE4MzQ.webp",
    width: 894,
    height: 219,
    get alt() { return translate("discordBot.aDiscordVoiceChannelShowingThe"); },
    get caption() { return translate("discordBot.andTheVoiceChannelSStatus"); },
  },
];

const sectionClass = "mx-auto w-full max-w-5xl px-4";

const h2Class = "text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl dark:text-zinc-50";

const cardClass =
  "rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950";

const inviteButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4752c4]";

const ghostButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900";

export function DiscordBotContent() {
  return (
    <>
      <SiteHeader />
      <div className="flex-1 bg-zinc-50 dark:bg-black">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero. The glow is a plain radial gradient rather than an image, so it
          costs nothing, scales to any width and reads the same in both
          themes. Behind the content and hidden from assistive tech. */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-40 h-[28rem] bg-[radial-gradient(60%_60%_at_50%_50%,rgba(88,101,242,0.18),transparent_70%)]"
        />
        <div
          className={`${sectionClass} relative grid gap-12 pt-8 pb-20 lg:grid-cols-2 lg:items-center lg:gap-16`}
        >
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#5865F2]/30 bg-[#5865F2]/10 px-3 py-1 text-xs font-semibold text-[#4752c4] dark:text-[#a5adff]">
              <FaDiscord className="h-3.5 w-3.5" />
              {translate("discordBot.discordBotFree")}
            </span>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance text-zinc-950 sm:text-5xl dark:text-zinc-50">
              {translate("discordBot.everyCallOnYourServerWith")}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
              {translate("discordBot.asSoonAsSomeoneJoinsA")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href={BOT_INVITE} className={inviteButtonClass}>
                <FaDiscord className="h-5 w-5" />
                {translate("discordBot.addToMyServer")}
              </a>
              <Link href="/" className={ghostButtonClass}>
                {translate("discordBot.getToKnowGolive")}
              </Link>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
              {[translate("discordBot.worksOutOfTheBox"), translate("discordBot.adjustableByCommand"), translate("discordBot.noCost")].map((item) => (
                <li key={item} className="inline-flex items-center gap-1.5">
                  <MdCheck className="h-4 w-4 text-emerald-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* A recreation of what a member actually sees rather than a
              screenshot: it stays sharp at any width and reflows on a phone.
              The real screenshots are further down the page. Painted dark in
              both themes on purpose — it is a picture of Discord. */}
          <div className="rounded-2xl border border-white/10 bg-[#0b0b0f] p-5 shadow-xl">
            <p className="text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
              {translate("discordBot.voiceChannels")}
            </p>
            <div className="mt-3 rounded-xl bg-white/5 p-3">
              <div className="flex items-start gap-3">
                <MdVolumeUp className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-semibold text-zinc-100">{translate("discordBot.general")}</span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-emerald-400">0:03</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-zinc-400">
                    [GoLive] g.nemtudo.me/priv-64318
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 pl-8">
                <span className="h-6 w-6 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500" />
                <span className="text-sm font-medium text-zinc-300">{translate("discordBot.nemTudo")}</span>
              </div>
            </div>

            <p className="mt-5 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
              {translate("discordBot.callChat")}
            </p>
            <div className="mt-3 flex gap-3 rounded-xl bg-white/5 p-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500">
                <MdMonitor className="h-4 w-4 text-white" />
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-zinc-100">
                  {translate("common.golive")}
                  <span className="rounded bg-[#5865F2] px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
                    APP
                  </span>
                </p>
                <p className="mt-0.5 text-sm break-words text-zinc-300">
                  {translate("discordBot.goLiveShareYourScreenIn")}{" "}
                  <span className="text-sky-400">{translate("discordBot.gNemtudoMePriv64318")}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={`${sectionClass} py-16`}>
        <h2 className={h2Class}>{translate("discordBot.howItWorks")}</h2>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          {translate("discordBot.fourStepsAndYouTakePart")}
        </p>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ title, body, Icon }, i) => (
            <li key={title} className={`${cardClass} relative`}>
              <span className="absolute top-6 right-6 font-mono text-sm text-zinc-300 dark:text-zinc-700">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#5865F2]/10 text-[#5865F2] dark:text-[#a5adff]">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold text-zinc-950 dark:text-zinc-50">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${sectionClass} py-16`}>
        <h2 className={h2Class}>{translate("discordBot.whyPutItOnYourServer")}</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map(({ title, body, Icon }) => (
            <div key={title} className={cardClass}>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold text-zinc-950 dark:text-zinc-50">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The commands. They come after the benefits on purpose: nobody needs
          them to start, so the page only brings them up once it has said what
          the bot does on its own. */}
      <section className={`${sectionClass} py-16`}>
        <div className="grid gap-10 rounded-3xl border border-black/10 bg-white p-8 shadow-sm sm:p-12 lg:grid-cols-2 lg:items-center dark:border-white/10 dark:bg-zinc-950">
          <div>
            <h2 className={h2Class}>{translate("discordBot.youCanConfigureItButYou")}</h2>
            <p className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-400">
              {translate("discordBot.theTwoThingsTheBotDoes")}
            </p>
            <ul className="mt-6 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
              <li className="flex gap-3">
                <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  {translate("discordBot.onlyWhoeverHas")}{" "}
                  <strong className="text-zinc-950 dark:text-zinc-50">{translate("discordBot.manageServer")}</strong>{" "}
                  {translate("discordBot.canUseItTheCommandsDo")}
                </span>
              </li>
              <li className="flex gap-3">
                <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  {translate("discordBot.theRepliesAreEphemeralTheyAppear")}
                </span>
              </li>
              <li className="flex gap-3">
                <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  {translate("discordBot.noChannelToCreateNoRole")}
                </span>
              </li>
            </ul>
          </div>

          {/* The command list as Discord itself shows it, dark in both themes
              for the same reason the hero mock is: it is a picture of
              Discord, not part of this page's chrome. */}
          <div className="rounded-2xl border border-white/10 bg-[#0b0b0f] p-4 shadow-xl">
            <div className="flex items-center gap-2 px-2 pb-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-sky-500">
                <MdMonitor className="h-3 w-3 text-white" />
              </span>
              <span className="text-sm font-semibold text-zinc-100">{translate("common.golive")}</span>
            </div>
            <ul className="space-y-0.5">
              {COMMANDS.map(({ name, option, body }) => (
                <li key={name} className="rounded-lg px-3 py-2.5 hover:bg-white/5">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-zinc-100">{name}</span>
                    {option && (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                        {option}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">{body}</p>
                </li>
              ))}
            </ul>
            <p className="px-3 pt-3 text-[11px] text-zinc-500">
              {translate("discordBot.bothStartSwitchedOnInEvery")}
            </p>
          </div>
        </div>
      </section>

      <section className={`${sectionClass} py-16`}>
        <h2 className={h2Class}>{translate("discordBot.inDiscordProperly")}</h2>
        {/* items-start, not the grid's default stretch: the two prints have
            very different shapes (a tall message, a one-line channel), and a
            stretched card leaves the short one floating in empty space. */}
        <div className="mt-10 grid items-start gap-6 sm:grid-cols-2">
          {SHOTS.map(({ src, width, height, alt, caption }) => (
            <figure key={src} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-950">
              <Image
                src={src}
                width={width}
                height={height}
                alt={alt}
                sizes="(max-width: 640px) 100vw, 50vw"
                className="w-full rounded-xl border border-black/10 dark:border-white/10"
              />
              <figcaption className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                {caption}
              </figcaption>
            </figure>
          ))}
        </div>
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
        <div className="rounded-3xl border border-[#5865F2]/20 bg-[#5865F2]/5 p-8 text-center sm:p-12">
          <h2 className={h2Class}>{translate("discordBot.itTakesLessThanAMinute")}</h2>
          <p className="mx-auto mt-3 max-w-xl text-zinc-600 dark:text-zinc-400">
            {translate("discordBot.addTheBotJoinACall")}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={BOT_INVITE} className={inviteButtonClass}>
              <FaDiscord className="h-5 w-5" />
              {translate("discordBot.addToMyServer")}
            </a>
            <a
              href="https://github.com/Nem-Tudo/sharescreen-discord-bot"
              target="_blank"
              rel="noopener noreferrer"
              className={ghostButtonClass}
            >
              <FaGithub className="h-5 w-5" />
              {translate("discordBot.seeTheBotSCode")}
            </a>
          </div>
        </div>
      </section>

      <footer
        className={`${sectionClass} pb-16 text-center text-xs text-zinc-400 dark:text-zinc-600`}
      >
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

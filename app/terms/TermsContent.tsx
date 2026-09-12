"use client";

import Link from "next/link";
import { AdsterraBanner } from "@/components/AdsterraBanner";
import { translate } from "@/lib/i18n";

const sectionClass = "mt-8 first:mt-0";

const h2Class = "text-lg font-semibold text-zinc-950 dark:text-zinc-50";

const pClass = "mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400";

const ulClass = "mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400";

const linkClass = "underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100";

export function TermsContent() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-2xl">
        <Link href="/" className={`text-sm font-medium text-zinc-500 ${linkClass}`}>
          {translate("common.backToGolive")}
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {translate("terms.termsOfUseAndPrivacy")}
        </h1>
        <p className={pClass}>
          {translate("terms.theseTermsExplainHowGolive")}
          <a href="https://golive.nemtudo.me" className={linkClass}>
            golive.nemtudo.me
          </a>
          {translate("terms.worksAndWhatHappensToYour")}
        </p>

        <section className={sectionClass}>
          <h2 className={h2Class}>{translate("terms.n1WhatGoliveIs")}</h2>
          <p className={pClass}>
            {translate("terms.goliveIsAFreeServiceFor")}
          </p>
          <p className={pClass}>
            {translate("terms.theAudioVideoConnectionBetweenParticipants")}
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>{translate("terms.n2Rooms")}</h2>
          <p className={pClass}>
            {translate("terms.anyoneCanCreateOrJoinA")}
          </p>
          <ul className={ulClass}>
            <li>
              <strong>{translate("common.publicRooms")}</strong> aparecem na lista de{" "}
              <Link href="/rooms" className={linkClass}>
                {translate("common.publicRooms2")}
              </Link>{" "}
              para qualquer visitante encontrar e entrar.
            </li>
            <li>
              <strong>{translate("common.privateRooms")}</strong> {translate("terms.areNotListedPubliclyButRemain")}
            </li>
          </ul>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>{translate("terms.n3AccountAndGuestUse")}</h2>
          <p className={pClass}>
            {translate("terms.youCanUseGoliveWithJust")}
          </p>
          <p className={pClass}>
            {translate("terms.youAreResponsibleForKeepingYour")}
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>{translate("terms.n4Chat")}</h2>
          <p className={pClass}>
            {translate("terms.roomsHaveATextChatWith")}
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>{translate("terms.n5RulesOfUse")}</h2>
          <p className={pClass}>{translate("terms.byUsingGoliveYouAgreeNot")}</p>
          <ul className={ulClass}>
            <li>{translate("terms.broadcastOrShareIllegalContentOr")}</li>
            <li>
              {translate("terms.broadcastOrSendInTheChat")}
            </li>
            <li>{translate("terms.useTheServiceForScamsPhishing")}</li>
            <li>
              {translate("terms.spamFloodMessagesOrTryTo")}
            </li>
            <li>{translate("terms.impersonateAnotherPersonOrEntityIn")}</li>
          </ul>
          <p className={pClass}>
            {translate("terms.sinceTheBroadcastMediaScreenCamera")}
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>{translate("terms.n6ModerationAndBans")}</h2>
          <p className={pClass}>
            {translate("terms.toKeepTheServiceUsableGolive")}
          </p>
          <ul className={ulClass}>
            <li>{translate("terms.aBannedWordFilterInThe")}</li>
            <li>
              {translate("terms.automaticBlockingOfAbusiveBehaviourE")}
            </li>
            <li>{translate("terms.banningOfAccountsAndIpAddresses")}</li>
            <li>
              {translate("terms.antiBotVerificationCloudflareTurnstileOn")}
            </li>
          </ul>
          <p className={pClass}>
            {translate("terms.thisCheckIsDoneByCloudflare")}{" "}
            <a
              className={linkClass}
              href="https://www.cloudflare.com/privacypolicy/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {translate("terms.cloudflareSPrivacyPolicy")}
            </a>
            .
          </p>
          <p className={pClass}>
            {translate("terms.accountsOrIpsMayBeSuspended")}
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>{translate("terms.n7DataWeCollect")}</h2>
          <p className={pClass}>{translate("terms.dependingOnHowYouUseGolive")}</p>
          <ul className={ulClass}>
            <li>
              <strong>{translate("terms.guestName")}</strong>{translate("terms.keptOnlyInYourBrowserLocalstorage")}
            </li>
            <li>
              <strong>{translate("terms.accountData")}</strong>{translate("terms.usernameDisplayNamePasswordStoredHashed")}
            </li>
            <li>
              <strong>{translate("terms.socialLogin")}</strong>{translate("terms.whenYouSignInWithDiscord")}
            </li>
            <li>
              <strong>{translate("common.ipAddress")}</strong>{translate("terms.usedForSecurityBansRateLimiting")}
            </li>
            <li>
              <strong>{translate("terms.chatMessages")}</strong> {translate("terms.sentInTheRoomsAsDescribed")}
            </li>
            <li>
              <strong>{translate("terms.usageData")}</strong>{translate("terms.viaAnalyticsUmamiSuchAsNavigation")}
            </li>
          </ul>
          <p className={pClass}>
            {translate("terms.theContentBroadcastByScreenCamera")}
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>{translate("terms.n8PublicStatistics")}</h2>
          <p className={pClass}>
            {translate("terms.goliveKeepsAPublicUsageStatistics")}
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>{translate("terms.n9SupportersAndPartners")}</h2>
          <p className={pClass}>
            {translate("terms.whoeverSupportsTheProjectFinanciallyMay")}
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>{translate("terms.n10MinimumAge")}</h2>
          <p className={pClass}>
            {translate("terms.goliveIsNotAimedAtChildren")}
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>{translate("terms.n11ServiceAsIs")}</h2>
          <p className={pClass}>
            {translate("terms.goliveIsOfferedFreeOfCharge")}
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>{translate("terms.n12ChangesToTheseTerms")}</h2>
          <p className={pClass}>
            {translate("terms.theseTermsMayBeUpdatedAs")}
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>13. Contato</h2>
          <p className={pClass}>
            {translate("terms.questionsRequestsAboutYourDataOr")}{" "}
            <a
              href="https://discord.gg/nemtudo"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              {translate("common.discordGgNemtudo")}
            </a>
            .
          </p>
        </section>

        <p className="mt-10 text-xs text-zinc-400 dark:text-zinc-600">
          {translate("terms.lastUpdated23August2026")}
        </p>

        <AdsterraBanner className="mt-10" />
      </main>
    </div>
  );
}

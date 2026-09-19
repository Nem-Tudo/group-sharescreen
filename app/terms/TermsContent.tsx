"use client";

import Link from "next/link";
import { translate } from "@/lib/i18n";

const sectionClass = "mt-8 first:mt-0";

const h2Class = "text-lg font-semibold text-zinc-950 dark:text-zinc-50";

const pClass = "mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400";

const ulClass = "mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400";

const linkClass = "underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100";

// A paragraph, optionally ending in a link, or a bullet list. Every string is
// a key in locales/*.json, so the three languages stay the same document.
type Block =
  | { p: string; link?: { href: string; label: string; external?: boolean } }
  | { ul: string[] };

type Section = { title: string; blocks: Block[] };

const range = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

const SECTIONS: Section[] = [
  { title: "terms.s1Title", blocks: [{ p: "terms.s1P1" }, { p: "terms.s1P2" }] },
  {
    title: "terms.s2Title",
    blocks: [
      { p: "terms.s2P1" },
      { ul: range("terms.s2L", 4) },
      { p: "terms.s2P2" },
      { p: "terms.s2P3" },
      { p: "terms.s2P4" },
      { p: "terms.s2P5" },
    ],
  },
  {
    title: "terms.s3Title",
    blocks: [
      { p: "terms.s3P1" },
      { ul: range("terms.s3L", 2) },
      { p: "terms.s3P2", link: { href: "/rooms", label: "terms.roomsLink" } },
    ],
  },
  { title: "terms.s4Title", blocks: [{ p: "terms.s4P1" }, { p: "terms.s4P2" }, { p: "terms.s4P3" }] },
  { title: "terms.s5Title", blocks: [{ p: "terms.s5P1" }, { p: "terms.s5P2" }] },
  {
    title: "terms.s6Title",
    blocks: [{ p: "terms.s6P1" }, { p: "terms.s6P2" }, { p: "terms.s6P3" }, { p: "terms.s6P4" }],
  },
  { title: "terms.s7Title", blocks: [{ p: "terms.s7P1" }, { ul: range("terms.s7L", 10) }, { p: "terms.s7P2" }] },
  {
    title: "terms.s8Title",
    blocks: [
      { p: "terms.s8P1" },
      { ul: range("terms.s8L", 4) },
      {
        p: "terms.s8P2",
        link: {
          href: "https://www.cloudflare.com/privacypolicy/",
          label: "terms.cloudflarePrivacyPolicy",
          external: true,
        },
      },
      { p: "terms.s8P3" },
      { p: "terms.s8P4" },
    ],
  },
  {
    title: "terms.s9Title",
    blocks: [
      { p: "terms.s9P1" },
      { p: "terms.s9P2" },
      { p: "terms.s9P3", link: { href: "/pro/cancelar", label: "terms.cancelLink" } },
      { p: "terms.s9P4" },
      { p: "terms.s9P5" },
    ],
  },
  { title: "terms.s10Title", blocks: [{ p: "terms.s10P1" }, { p: "terms.s10P2" }, { p: "terms.s10P3" }] },
  {
    title: "terms.s11Title",
    blocks: [
      { p: "terms.s11P1" },
      { ul: range("terms.s11L", 7) },
      { p: "terms.s11P2" },
      { p: "terms.s11P3" },
      { p: "terms.s11P4" },
    ],
  },
  { title: "terms.s12Title", blocks: [{ p: "terms.s12P1" }] },
  { title: "terms.s13Title", blocks: [{ p: "terms.s13P1" }, { p: "terms.s13P2" }] },
  { title: "terms.s14Title", blocks: [{ p: "terms.s14P1" }] },
  { title: "terms.s15Title", blocks: [{ p: "terms.s15P1" }] },
  { title: "terms.s16Title", blocks: [{ p: "terms.s16P1" }] },
  { title: "terms.s17Title", blocks: [{ p: "terms.s17P1" }, { p: "terms.s17P2" }, { p: "terms.s17P3" }] },
  { title: "terms.s18Title", blocks: [{ p: "terms.s18P1" }] },
  { title: "terms.s19Title", blocks: [{ p: "terms.s19P1" }] },
  { title: "terms.s20Title", blocks: [{ p: "terms.s20P1" }] },
  { title: "terms.s21Title", blocks: [{ p: "terms.s21P1" }, { p: "terms.s21P2" }] },
  {
    title: "terms.s22Title",
    blocks: [
      {
        p: "terms.s22P1",
        link: { href: "https://discord.gg/nemtudo", label: "common.discordGgNemtudo", external: true },
      },
    ],
  },
];

function BlockView({ block }: { block: Block }) {
  if ("ul" in block) {
    return (
      <ul className={ulClass}>
        {block.ul.map((key) => (
          <li key={key}>{translate(key)}</li>
        ))}
      </ul>
    );
  }
  const { link } = block;
  return (
    <p className={pClass}>
      {translate(block.p)}
      {link && (
        <>
          {" "}
          {link.external ? (
            <a href={link.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {translate(link.label)}
            </a>
          ) : (
            <Link href={link.href} className={linkClass}>
              {translate(link.label)}
            </Link>
          )}
          .
        </>
      )}
    </p>
  );
}

export function TermsContent() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-2xl">
        <Link href="/" className={`text-sm font-medium text-zinc-500 ${linkClass}`}>
          {translate("common.backToGolive")}
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {translate("terms.title")}
        </h1>
        <p className={pClass}>{translate("terms.intro")}</p>
        <p className={pClass}>{translate("terms.introAccept")}</p>

        <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
          <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
            {translate("terms.independenceTitle")}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-blue-800 dark:text-blue-200">
            {translate("terms.independenceBody")}
          </p>
        </div>

        <div className="mt-8">
          {SECTIONS.map((section) => (
            <section key={section.title} className={sectionClass}>
              <h2 className={h2Class}>{translate(section.title)}</h2>
              {section.blocks.map((block, i) => (
                <BlockView key={i} block={block} />
              ))}
            </section>
          ))}
        </div>

        <p className="mt-10 text-xs text-zinc-400 dark:text-zinc-600">{translate("terms.lastUpdated")}</p>
      </main>
    </div>
  );
}

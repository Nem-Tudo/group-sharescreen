import type { Metadata } from "next";
import Link from "next/link";
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
import { DownloadPanel } from "./DownloadPanel";
import {
  FeatureArt,
  ParticipantArt,
  SharedScreenArt,
  type FeatureArtId,
} from "./FeatureArt";

// Landing page for the desktop build.
//
// The pitch has two legs, and they are deliberately given equal weight: the
// app is light on the machine, and it is the only one of these programs that
// lets you choose, application by application, which sounds leave your PC.
// Echo cancellation belongs to the second leg — it is *why* GoLive itself is
// always on the excluded list — not a headline of its own.
//
// Everything claimed about the app comes from what the Electron shell
// actually does (see electron/README.md); the "light" claims come from what
// the shell deliberately is not (no overlay, no background service, no store)
// and from lib/videoQuality.ts's per-viewer encoding, documented in
// docs/qualidade-e-cascata.md. No measured number is quoted against another
// program, because none has been measured.
//
// The file itself always comes from /download, which resolves the newest
// GitHub release asset at request time — no version is pinned into this page.

const SITE_URL = "https://golive.nemtudo.me";
const RELEASES_API = "https://api.github.com/repos/Nem-Tudo/group-sharescreen/releases/latest";

const TITLE = "Baixar o app do GoLive para PC — Windows, macOS e Linux";
const DESCRIPTION =
  "O GoLive como aplicativo: leve na máquina, sem overlay nem serviço em segundo plano, e com o áudio da transmissão escolhido app por app — tire o Spotify, tire o WhatsApp, mande só o que você quer. Grátis para Windows, macOS e Linux.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "baixar golive",
    "app de transmitir tela",
    "programa leve para compartilhar tela",
    "transmitir tela com som do sistema",
    "escolher quais sons transmitir",
    "compartilhar tela sem vazar spotify",
    "compartilhar tela sem eco",
    "golive para pc",
    "golive windows",
  ],
  alternates: { canonical: "/app" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: `${SITE_URL}/app`,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "GoLive para computador",
  url: `${SITE_URL}/app`,
  description: DESCRIPTION,
  applicationCategory: "CommunicationApplication",
  operatingSystem: "Windows, macOS, Linux",
  inLanguage: "pt-BR",
  offers: { "@type": "Offer", price: "0", priceCurrency: "BRL" },
};

// Each card carries a small drawing of the thing it describes — see
// FeatureArt.tsx. The bodies are shorter than the prose elsewhere on the page
// because the drawing above them has already made half the point.
const BENEFITS: { title: string; body: string; art: FeatureArtId; tag?: string }[] = [
  {
    title: "Pesa menos que os programas de sempre",
    body: "Sem overlay de jogo, sem rich presence, sem loja, sem serviço em segundo plano o dia todo. Uma janela que abre pra transmitir e fecha quando acabou — a RAM e o processador ficam com o jogo.",
    art: "weight",
  },
  {
    title: "Você escolhe exatamente quais sons vão",
    body: "A lista dos programas tocando som agora, com uma caixinha em cada um. Tire o Spotify e sua música não vaza. Nos outros o som da tela vai inteiro (ou não vai)",
    art: "audio-pick",
  },
  {
    title: "Processa só o que alguém vê",
    body: "Cada espectador recebe a qualidade que o tile dele realmente usa, em vez de todo mundo receber 1080p pra caber numa miniatura. É o que faz uma sala grande caber numa máquina comum.",
    art: "quality",
  },
  {
    title: "Som do sistema sem eco",
    body: "Pelo navegador, a captura leva o próprio GoLive junto e as vozes da sala voltam com atraso. No app o GoLive fica sempre fora.",
    art: "echo",
    tag: "Windows",
  },
  {
    title: "Seletor de tela nativo",
    body: "O mesmo seletor de janelas e monitores do sistema, com o switch de som da tela e a lista de programas ali do lado, em vez do diálogo genérico do navegador.",
    art: "picker",
  },
  {
    title: "Janela só do GoLive",
    body: "Sem se perder entre abas, sem fechar a sala junto com o navegador, sem barra de endereço no meio da transmissão. Fica na barra de tarefas como qualquer programa.",
    art: "window",
  },
  {
    title: "Atualiza sozinho",
    body: "Baixa em segundo plano e aplica quando você fecha, sem interromper call nenhuma. E como a interface vem do site, todo recurso novo chega sem instalar nada.",
    art: "update",
  },
];

// The comparison stays deliberately unnamed. The point is the shape of these
// programs, not a claim about a particular version of a particular one — and
// "costumam" is doing real work in the right-hand column.
const COMPARISON = {
  golive: [
    "Abre quando você vai transmitir e fecha quando acabou",
    "Você marca, app por app, quais sons ficam fora da transmissão",
    "Vídeo e voz ponto a ponto entre os participantes",
    "Codifica só a qualidade que cada espectador realmente usa",
    "Funciona sem instalar nada, direto no navegador, se você preferir",
    "Sem conta obrigatória e sem versão paga",
  ],
  others: [
    "Costumam subir junto com o sistema e ficar residentes o dia todo",
    "O som da tela vai inteiro (ou não vai)",
    "Overlay, rich presence e integrações rodando mesmo quando você só quer falar",
    "Conta obrigatória, e os recursos bons costumam estar no plano pago",
  ],
};

// The picker's audio panel, recreated from the app itself: "sempre sem som"
// on GoLive is not a default anyone can change, which is the whole echo
// story in three words.
const MUTED_APPS = [
  { name: "GoLive", checked: true, locked: true },
  { name: "Spotify", checked: true },
  { name: "WhatsApp", checked: true },
  { name: "Navegador", checked: false },
  { name: "Steam", checked: false },
];

// The faces in the hero's window mock. One of them is talking, which is what
// the level meter in the corner of that tile is for.
// Deep stops rather than the bright end of each scale: these sit next to a
// dark screen tile and should read as four camera feeds, not as four neon
// swatches.
const PARTICIPANTS = [
  { name: "Você", gradient: "from-emerald-700 to-teal-900" },
  { name: "Maria", gradient: "from-fuchsia-700 to-purple-900", speaking: true },
  { name: "João", gradient: "from-sky-700 to-indigo-900" },
  { name: "Ana", gradient: "from-amber-600 to-orange-900" },
];

const PLATFORM_ROWS = [
  {
    name: "Windows",
    file: ".exe",
    Icon: FaWindows,
    note: "Instalador comum. É a única plataforma com captura do som do sistema e escolha por programa, por limitação do macOS e do Linux.",
  },
  {
    name: "macOS",
    file: ".dmg",
    Icon: FaApple,
    note: "Binário universal: o mesmo arquivo roda em Apple Silicon e Intel. Na primeira vez o macOS pede permissão de gravação de tela e o app precisa ser reaberto.",
  },
  {
    name: "Linux",
    file: ".AppImage",
    Icon: FaLinux,
    note: "Arquivo único, sem instalação: dê permissão de execução e abra.",
  },
];

const FAQ = [
  {
    q: "Preciso do app pra usar o GoLive?",
    a: "Não. O site funciona inteiro no navegador, no PC e no celular. O app existe pra quem quer escolher quais sons vão junto, o seletor de tela nativo e uma janela dedicada que não pesa na máquina.",
  },
  {
    q: "Ele fica pesado com o tempo, como os outros?",
    a: "Ele não tem por onde: não sobe com o sistema, não tem overlay de jogo, não tem loja e não deixa serviço nenhum rodando depois que você fecha a janela. O que existe é uma janela e o processo de captura de áudio, que só existe enquanto você está transmitindo com som.",
  },
  {
    q: "É pago?",
    a: "Não. O app é gratuito, como o resto do GoLive, e o código está no GitHub.",
  },
  {
    q: "Como funciona a escolha dos sons?",
    a: "Na hora de compartilhar, o app lista os programas que estão tocando som naquele momento. O que você marcar fica de fora da transmissão — você continua ouvindo normalmente, só a sala é que não recebe.",
  },
  {
    q: "Por que isso só funciona no Windows?",
    a: "Porque só o Windows deixa capturar o áudio da máquina excluindo programas específicos. No macOS e no Linux isso exigiria um dispositivo de áudio virtual, então lá o compartilhamento vai só com o vídeo.",
  },
  {
    q: "O app fica desatualizado em relação ao site?",
    a: "Não. A janela carrega o site publicado, então toda mudança de interface chega na próxima vez que você abre. Só o próprio programa (a janela, o seletor, o áudio) precisa de atualização — e ela é automática.",
  },
  {
    q: "O Windows reclamou do instalador. É seguro?",
    a: "O aviso aparece porque o instalador ainda não tem assinatura digital paga, não porque haja algo nele. O código é aberto e o arquivo vem direto dos releases do GitHub do projeto — dá pra conferir a origem antes de instalar.",
  },
  {
    q: "E no celular?",
    a: "Não existe app de celular, mas o site funciona no navegador e pode ser adicionado à tela de início: ele abre em tela cheia, como um aplicativo.",
  },
];

const sectionClass = "mx-auto w-full max-w-5xl px-4";
const h2Class = "text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl dark:text-zinc-50";
const cardClass =
  "rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950";
const ghostButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900";

// The version shown under the download button. Read from the same release
// the /download route hands out, so the two can never name different builds,
// and cached for the same reason that route caches: GitHub's unauthenticated
// API allows 60 calls an hour per IP, which here is the server's, shared by
// every visitor.
//
// Returns null on any trouble — no release published yet, rate limit, network
// — because a version line is a nicety and the page must render without it.
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "group-sharescreen-app-page",
      },
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    const release = (await res.json()) as { tag_name?: string };
    return release.tag_name ?? null;
  } catch {
    return null;
  }
}

export default async function AppPage() {
  const version = await fetchLatestVersion();

  return (
    <div className="flex-1 bg-zinc-50 dark:bg-black">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className={`${sectionClass} flex items-center justify-between gap-4 py-6`}>
        <Link
          href="/"
          className="text-sm font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← GoLive
        </Link>
        <Link
          href="/discord-bot"
          className="text-sm font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Bot para Discord
        </Link>
      </header>

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
              Windows · macOS · Linux
              {version && (
                <span className="font-mono font-normal text-emerald-600/70 dark:text-emerald-400/70">
                  {version}
                </span>
              )}
            </span>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance text-zinc-950 sm:text-5xl dark:text-zinc-50">
              Leve na máquina, e com o áudio do jeito que você quiser
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
              Mesma sala, mesmo link, mesma conta — só que sem o peso dos programas de call que
              ficam abertos o dia todo, e com uma coisa que nenhum deles faz: escolher, programa
              por programa, quais sons saem do seu PC.
            </p>
            <div className="mt-8">
              <DownloadPanel />
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
              {["Grátis", "Sem cadastro", "Código aberto"].map((item) => (
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
                GoLive
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
                Som: 2 apps fora
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-500/10 px-2.5 py-1 font-medium text-zinc-600 dark:text-zinc-400">
                <MdMemory className="h-3.5 w-3.5" />
                Uma janela, mais nada
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className={`${sectionClass} py-16`}>
        <h2 className={h2Class}>O que você ganha instalando</h2>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          A janela carrega o mesmo site — a diferença está no que ela consegue acessar da sua
          máquina, e no quanto ela não atrapalha enquanto isso.
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
            <h2 className={h2Class}>Nada vaza sem você mandar</h2>
            <p className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-400">
              Nos outros programas o som da tela é uma chave: ou vai tudo, ou não vai nada. Aqui
              você vê a lista dos programas que estão tocando som agora e marca os que devem ficar
              de fora — continuam tocando pra você, só não saem da sua máquina.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
              <li className="flex gap-3">
                <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  <strong className="text-zinc-950 dark:text-zinc-50">Tire o Spotify</strong> e
                  pronto: sua música não vai junto com a tela.
                </span>
              </li>
              <li className="flex gap-3">
                <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  <strong className="text-zinc-950 dark:text-zinc-50">Tire o WhatsApp</strong> e
                  ouça seus áudios à vontade, sem a sala inteira ouvindo junto.
                </span>
              </li>
              <li className="flex gap-3">
                <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  <strong className="text-zinc-950 dark:text-zinc-50">O GoLive já sai fora</strong>,
                  sempre — é o que evita que as vozes da sala voltem pra sala e todo mundo se ouça
                  com atraso.
                </span>
              </li>
            </ul>
            <p className="mt-6 text-xs text-zinc-400 dark:text-zinc-600">
              Escolha por programa disponível no Windows. Nas outras plataformas o compartilhamento
              vai só com o vídeo.
            </p>
          </div>

          {/* Recreated from the app's own picker panel. */}
          <div className="rounded-2xl border border-black/10 bg-zinc-50 p-5 shadow-inner dark:border-white/10 dark:bg-zinc-900">
            <p className="font-semibold text-zinc-950 dark:text-zinc-50">
              Não compartilhar som dos seguintes apps
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Apps abertos agora. O que os marcados tocarem fica de fora da transmissão — você
              continua ouvindo normalmente.
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
              <span className="text-zinc-600 dark:text-zinc-400">Compartilhar som da tela</span>
            </div>
          </div>
        </div>
      </section>

      {/* The weight argument, kept unnamed on the other side. */}
      <section className={`${sectionClass} py-16`}>
        <h2 className={h2Class}>Um app, não um cliente inteiro</h2>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Os programas de call viraram plataformas: loja, overlay, integrações, tudo carregado
          antes de você falar a primeira palavra. O GoLive é uma janela.
        </p>
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-6">
            <p className="font-semibold text-emerald-700 dark:text-emerald-300">No app do GoLive</p>
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
              Nos programas de call de sempre
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
        <h2 className={h2Class}>Para o seu sistema</h2>
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
          Os arquivos vêm direto dos releases do GitHub do projeto, e o link de download sempre
          aponta pra versão mais recente.
        </p>
      </section>

      <section className={`${sectionClass} py-16`}>
        <h2 className={h2Class}>Perguntas frequentes</h2>
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
          <h2 className={h2Class}>Baixe e abra</h2>
          <p className="mx-auto mt-3 max-w-xl text-zinc-600 dark:text-zinc-400">
            Sua conta, suas salas e seus links continuam os mesmos — o app só entra no lugar da
            aba.
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
              Ver o código
            </a>
          </div>
        </div>
      </section>

      <footer
        className={`${sectionClass} pb-16 text-center text-xs text-zinc-400 dark:text-zinc-600`}
      >
        <p>
          Desenvolvido por{" "}
          <span className="font-medium text-zinc-500 dark:text-zinc-400">@NemTudo</span> (
          <a
            href="https://discord.gg/nemtudo"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline underline-offset-2 hover:text-blue-600 dark:hover:text-blue-300"
          >
            discord.gg/nemtudo
          </a>
          ) ·{" "}
          <Link
            href="/discord-bot"
            className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Bot para Discord
          </Link>{" "}
          ·{" "}
          <Link
            href="/termos"
            className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Termos de uso
          </Link>
        </p>
      </footer>
    </div>
  );
}

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { FaDiscord, FaGithub } from "react-icons/fa";
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

// Landing page for the Discord bot. Everything it claims comes from what the
// bot actually does — someone joins a call, a private GoLive room appears,
// linked in the channel status and posted in the call's chat — so nothing
// here can promise a command or a setting that does not exist.
//
// /bot is a permanent redirect to the Discord OAuth authorize URL (see
// next.config.ts), which is why every "adicionar" button points at that short
// path instead of a client id pasted across the page: the invite stays
// re-pointable from one place.

const BOT_INVITE = "/bot";
const SITE_URL = "https://golive.nemtudo.me";

const TITLE = "Bot do GoLive para Discord — sala de transmissão automática em toda call";
const DESCRIPTION =
  "Adicione o bot do GoLive ao seu servidor e cada call ganha uma sala de transmissão de tela automática: o link aparece no status do canal e no chat da call. Grátis, funciona de cara e é ajustável por /config.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "bot discord transmitir tela",
    "bot golive discord",
    "compartilhar tela no discord",
    "bot antijanja",
    "transmissão de tela em call do discord",
    "bot de sala de transmissão",
    "alternativa ao go live do discord",
  ],
  alternates: { canonical: "/discord-bot" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: `${SITE_URL}/discord-bot`,
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

// Same shape app/layout.tsx uses for the site itself — a free application,
// stated in the terms search engines read rather than only in prose.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Bot do GoLive para Discord",
  url: `${SITE_URL}/discord-bot`,
  description: DESCRIPTION,
  applicationCategory: "CommunicationApplication",
  operatingSystem: "Discord",
  inLanguage: "pt-BR",
  offers: { "@type": "Offer", price: "0", priceCurrency: "BRL" },
};

const STEPS = [
  {
    title: "Alguém entra na call",
    body: "A primeira pessoa a entrar em qualquer canal de voz do servidor dispara tudo. Ninguém digita nada.",
    Icon: MdGroups,
  },
  {
    title: "O bot cria uma sala privada",
    body: "Uma sala nova no GoLive, daquela call, que não aparece em nenhuma lista pública.",
    Icon: MdLock,
  },
  {
    title: "O link vai pro status da call",
    body: "O status do canal de voz passa a mostrar o endereço — quem olha a lista de canais já vê onde assistir.",
    Icon: MdLink,
  },
  {
    title: "E também pro chat da call",
    body: "Uma mensagem no chat do próprio canal de voz, pra quem já está dentro entrar com um clique.",
    Icon: MdChat,
  },
];

const BENEFITS = [
  {
    title: "Funciona de cara, ajusta se quiser",
    body: "Adicionou, acabou: as duas coisas que ele faz já vêm ligadas. E se o seu servidor quiser só uma delas, são três comandos de /config — nenhum obrigatório.",
    Icon: MdBolt,
  },
  {
    title: "Várias telas ao mesmo tempo",
    body: "No GoLive todo mundo da sala pode transmitir junto — tela, câmera ou voz — e cada pessoa escolhe quem quer assistir.",
    Icon: MdGroups,
  },
  {
    title: "Sem cadastro pra quem entra",
    body: "Seus membros abrem o link, escolhem um nome e já estão dentro. Funciona direto no navegador, no PC ou no celular.",
    Icon: MdCheck,
  },
  {
    title: "Salas privadas por padrão",
    body: "A sala de cada call é privada: não é listada publicamente, só chega nela quem tem o link que o bot mandou.",
    Icon: MdLock,
  },
  {
    title: "Grátis e open source",
    body: "Sem plano pago, sem cargo premium, sem limite de servidores. O código do bot e o do site estão no GitHub.",
    Icon: MdCode,
  },
];

// The bot's whole command surface, and it really is this small: one command
// with three subcommands, both settings on by default, all of it gated behind
// Gerenciar Servidor. Kept in the same order Discord lists them.
const COMMANDS = [
  {
    name: "/config chat",
    option: "enabled",
    body: "Ativa ou desativa o envio da URL no chat da call.",
  },
  {
    name: "/config status",
    option: "enabled",
    body: "Ativa ou desativa a URL no status do canal de voz.",
  },
  {
    name: "/config show",
    body: "Mostra a configuração atual do servidor — e, de brinde, quantas pessoas estão transmitindo no GoLive agora.",
  },
];

const FAQ = [
  {
    q: "O bot é pago?",
    a: "Não. É totalmente gratuito, em quantos servidores você quiser, sem versão premium.",
  },
  {
    q: "Preciso configurar algo depois de adicionar?",
    a: "Não. Assim que o bot entra no servidor ele já passa a criar as salas sozinho, com o link indo pro status da call e pro chat dela. Configurar é opcional: /config existe pra desligar uma dessas duas coisas, ou as duas.",
  },
  {
    q: "Quem pode usar os comandos de /config?",
    a: "Só quem tem a permissão Gerenciar Servidor. As respostas do bot são efêmeras — aparecem só pra quem rodou o comando, sem poluir o chat.",
  },
  {
    q: "De quais permissões ele precisa?",
    a: "Só das que correspondem ao que ele faz: ver os canais de voz do servidor, alterar o status da call e enviar mensagem no chat dela. As permissões são apresentadas na própria tela de adicionar do Discord, antes de você confirmar.",
  },
  {
    q: "Quem entra na sala precisa de conta no GoLive?",
    a: "Não. Basta abrir o link e escolher um nome. Criar conta é opcional e serve pra guardar seu perfil, não pra assistir.",
  },
  {
    q: "A sala fica aberta pra qualquer um?",
    a: "A sala é privada, então não aparece na lista pública do GoLive. Como todo link, porém, quem receber o endereço consegue entrar — trate-o como você trataria um convite do servidor.",
  },
  {
    q: "Dá pra usar o GoLive sem o bot?",
    a: "Dá. O bot só automatiza a criação da sala: você pode criar uma na página inicial a qualquer momento e mandar o link onde quiser.",
  },
];

const SHOTS = [
  {
    src: "https://cdn.nemtudo.me/f/command/MjAyNi8wOC8yMi9JTUFHRS8wMV8yNl8yM19fMTc4NzM3Mjc4Mzk4Mi0xMjUyMDI2MDU.webp",
    width: 1040,
    height: 1109,
    alt: "Mensagem do bot GoLive no chat da call do Discord, com o link da sala e o preview do site",
    caption: "A mensagem que o bot manda no chat da call.",
  },
  {
    src: "https://cdn.nemtudo.me/f/command/MjAyNi8wOC8yMi9JTUFHRS8wMV8yN18xOF9fMTc4NzM3MjgzODY2Mi01NzkzMDE4MzQ.webp",
    width: 894,
    height: 219,
    alt: "Canal de voz do Discord exibindo o link da sala do GoLive no status da call",
    caption: "E o status do canal de voz, com o link à vista.",
  },
];

const sectionClass = "mx-auto w-full max-w-5xl px-4";
const h2Class = "text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl dark:text-zinc-50";
const cardClass =
  "rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950";
// Discord's blurple, deliberately: this is the one button on the page that
// leaves for Discord, and wearing Discord's color is what makes it read as
// "adicionar ao servidor" before anyone finishes the label.
const inviteButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4752c4]";
const ghostButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900";

export default function DiscordBotPage() {
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
        <a href={BOT_INVITE} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4752c4]">
          <FaDiscord className="h-4 w-4" />
          Adicionar ao Discord
        </a>
      </header>

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
              Bot para Discord · grátis
            </span>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance text-zinc-950 sm:text-5xl dark:text-zinc-50">
              Toda call do seu servidor com uma sala de transmissão automática
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
              Assim que alguém entra em um canal de voz, o bot cria uma sala privada no GoLive,
              coloca o link no status da call e manda no chat dela. Ninguém precisa criar, lembrar
              ou pedir nada.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href={BOT_INVITE} className={inviteButtonClass}>
                <FaDiscord className="h-5 w-5" />
                Adicionar ao meu servidor
              </a>
              <Link href="/" className={ghostButtonClass}>
                Conhecer o GoLive
              </Link>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
              {["Funciona de cara", "Ajustável por comando", "Sem custo"].map((item) => (
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
              Canais de voz
            </p>
            <div className="mt-3 rounded-xl bg-white/5 p-3">
              <div className="flex items-start gap-3">
                <MdVolumeUp className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-semibold text-zinc-100">General</span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-emerald-400">0:03</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-zinc-400">
                    [GoLive] g.nemtudo.me/priv-64318
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 pl-8">
                <span className="h-6 w-6 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500" />
                <span className="text-sm font-medium text-zinc-300">Nem Tudo</span>
              </div>
            </div>

            <p className="mt-5 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
              Chat da call
            </p>
            <div className="mt-3 flex gap-3 rounded-xl bg-white/5 p-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500">
                <MdMonitor className="h-4 w-4 text-white" />
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-zinc-100">
                  GoLive
                  <span className="rounded bg-[#5865F2] px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
                    APP
                  </span>
                </p>
                <p className="mt-0.5 text-sm break-words text-zinc-300">
                  [Go Live] Transmita tela nessa call por aqui:{" "}
                  <span className="text-sky-400">g.nemtudo.me/priv-64318</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={`${sectionClass} py-16`}>
        <h2 className={h2Class}>Como funciona</h2>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Quatro passos, e você não participa de nenhum deles.
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
        <h2 className={h2Class}>Por que colocar no servidor</h2>
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
            <h2 className={h2Class}>Dá pra configurar — mas não precisa</h2>
            <p className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-400">
              As duas coisas que o bot faz já vêm ligadas. Se o seu servidor quiser só o link no
              status, só a mensagem no chat, ou nenhum dos dois por um tempo, é um comando cada.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
              <li className="flex gap-3">
                <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  Só quem tem{" "}
                  <strong className="text-zinc-950 dark:text-zinc-50">Gerenciar Servidor</strong>{" "}
                  consegue usar — os comandos nem aparecem pros outros membros.
                </span>
              </li>
              <li className="flex gap-3">
                <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  As respostas são efêmeras: aparecem só pra quem rodou o comando, sem poluir o
                  chat.
                </span>
              </li>
              <li className="flex gap-3">
                <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  Nada de canal pra criar, cargo pra dar ou painel pra abrir. É isso e mais nada.
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
              <span className="text-sm font-semibold text-zinc-100">GoLive</span>
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
              Os dois começam ativados em todo servidor novo.
            </p>
          </div>
        </div>
      </section>

      <section className={`${sectionClass} py-16`}>
        <h2 className={h2Class}>No Discord, de verdade</h2>
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
        <div className="rounded-3xl border border-[#5865F2]/20 bg-[#5865F2]/5 p-8 text-center sm:p-12">
          <h2 className={h2Class}>Leva menos de um minuto</h2>
          <p className="mx-auto mt-3 max-w-xl text-zinc-600 dark:text-zinc-400">
            Adicione o bot, entre numa call e o link já vai estar lá.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={BOT_INVITE} className={inviteButtonClass}>
              <FaDiscord className="h-5 w-5" />
              Adicionar ao meu servidor
            </a>
            <a
              href="https://github.com/Nem-Tudo/sharescreen-discord-bot"
              target="_blank"
              rel="noopener noreferrer"
              className={ghostButtonClass}
            >
              <FaGithub className="h-5 w-5" />
              Ver o código do bot
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
            href="/app"
            className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            App para PC
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

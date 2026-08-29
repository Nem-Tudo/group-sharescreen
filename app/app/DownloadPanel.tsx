"use client";

import { useEffect, useState } from "react";
import { FaApple, FaLinux, FaWindows } from "react-icons/fa";
import { MdCheckCircle, MdDownload, MdPhoneAndroid } from "react-icons/md";
import { isDesktopApp } from "@/lib/desktop";
import { detectDownloadPlatform, type DownloadPlatform } from "@/lib/downloadTargets";
import { trackDownloadClick } from "@/lib/analytics";

// The download area of /app.
//
// Unlike components/DownloadAppButton, which renders nothing when it cannot
// offer a build, this one always renders something: the whole page is about
// the app, so a visitor arriving from a phone or already inside the app must
// still be told where they stand instead of finding an empty hero.
//
// Three states, and each is a real answer:
//   - a recognised desktop  → one big button for that machine, the other two
//                             platforms still one click away underneath;
//   - a phone / unknown     → the browser works fine, plus the same three
//                             links for when they are at a computer;
//   - inside the app itself → nothing to download, so say so.
//
// The detection is the same function /download uses, so the label and the
// file this hands over can never disagree about what "seu sistema" means.

const PLATFORMS: {
  id: DownloadPlatform;
  name: string;
  file: string;
  Icon: typeof FaWindows;
}[] = [
  { id: "win", name: "Windows", file: ".exe", Icon: FaWindows },
  { id: "mac", name: "macOS", file: ".dmg", Icon: FaApple },
  { id: "linux", name: "Linux", file: ".AppImage", Icon: FaLinux },
];

// "unknown" is a phone or anything with no build; null is "not resolved yet",
// which is also what the server renders — navigator does not exist there.
type Detected = DownloadPlatform | "unknown" | "in-app" | null;

export function DownloadPanel() {
  const [detected, setDetected] = useState<Detected>(null);

  useEffect(() => {
    // Deferred by a tick rather than set in the effect body — the cascading
    // render React 19 warns about, same gate DownloadAppButton uses.
    const id = setTimeout(() => {
      if (isDesktopApp()) {
        setDetected("in-app");
        return;
      }
      setDetected(detectDownloadPlatform(navigator.userAgent) ?? "unknown");
    }, 0);
    return () => clearTimeout(id);
  }, []);

  if (detected === "in-app") {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5">
        <p className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
          <MdCheckCircle className="h-5 w-5 shrink-0" />
          Você já está usando o app
        </p>
        <p className="mt-1 text-sm text-emerald-800/80 dark:text-emerald-200/70">
          Ele se atualiza sozinho, então não há nada pra baixar aqui.
        </p>
      </div>
    );
  }

  const main = PLATFORMS.find((p) => p.id === detected);

  return (
    <div>
      {main ? (
        <a
          href={`/download?platform=${main.id}`}
          onClick={() => trackDownloadClick("app-page", main.id)}
          className="inline-flex w-full items-center justify-center gap-2.5 rounded-xl bg-zinc-950 px-6 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-zinc-800 sm:w-auto dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          <main.Icon className="h-5 w-5 shrink-0" />
          Baixar para {main.name}
        </a>
      ) : (
        // Reserves the button's height while detection resolves, so the hero
        // does not jump a beat after load. On a phone it stays as the note.
        <div className="min-h-[3.75rem]">
          {detected === "unknown" && (
            <div className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
              <p className="flex items-center gap-2 font-semibold text-zinc-950 dark:text-zinc-50">
                <MdPhoneAndroid className="h-5 w-5 shrink-0" />
                O app é para computador
              </p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                No celular o GoLive funciona direto no navegador, sem instalar nada — e dá pra
                adicionar à tela de início como um aplicativo. Guarde esta página pra quando
                estiver no PC.
              </p>
            </div>
          )}
        </div>
      )}

      {/* The other platforms, always listed: it is how someone grabs the Mac
          installer from a Windows machine, and how anyone we detected wrong
          still reaches the right file. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {PLATFORMS.filter((p) => p.id !== detected).map(({ id, name, file, Icon }) => (
          <a
            key={id}
            href={`/download?platform=${id}`}
            onClick={() => trackDownloadClick("app-page", id)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
          >
            <Icon className="h-4 w-4 shrink-0" />
            {name}
            <span className="font-mono text-xs text-zinc-400 dark:text-zinc-600">{file}</span>
          </a>
        ))}
        <a
          href="https://github.com/Nem-Tudo/group-sharescreen/releases/latest"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-500 underline underline-offset-2 transition hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <MdDownload className="h-4 w-4 shrink-0" />
          Todos os arquivos
        </a>
      </div>
    </div>
  );
}

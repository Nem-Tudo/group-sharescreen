"use client";

import {
  MdClose,
  MdKeyboard,
  MdLogin,
  MdRestartAlt,
  MdInfoOutline,
  MdOutlineDesktopWindows,
} from "react-icons/md";
import { Tooltip } from "@/components/Tooltip";
import { ShortcutRecorder } from "@/components/ShortcutRecorder";
import {
  SHORTCUT_DEFINITIONS,
  useShortcuts,
  type ShortcutDefinition,
} from "@/lib/keyboardShortcuts";
import { isDesktopApp } from "@/lib/desktop";

export function KeyboardShortcutsModal({
  open,
  onClose,
  hasAccount,
  onRequestAccount,
}: {
  open: boolean;
  onClose: () => void;
  hasAccount: boolean;
  onRequestAccount: () => void;
}) {
  const { shortcuts, updateShortcut, resetShortcuts } = useShortcuts();

  if (!open) return null;

  const isDesktop = isDesktopApp();

  const audioShortcuts = SHORTCUT_DEFINITIONS.filter((d) => d.category === "audio");
  const videoShortcuts = SHORTCUT_DEFINITIONS.filter((d) => d.category === "video");
  const musicShortcuts = SHORTCUT_DEFINITIONS.filter((d) => d.category === "music");

  function renderGroup(title: string, list: ShortcutDefinition[], isAppOnlyCategory = false) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            {title}
          </h4>
          {/* Only outside the app. In it, this is a badge saying "apenas
              no app" on a screen that is the app, linking to a download page
              for software already running — every part of that is noise. The
              per-row "Apenas no app" placeholder below already behaves this
              way (see isAppOnlyDisabled); this was the one that did not. */}
          {isAppOnlyCategory && !isDesktop && (
            <a
              href="https://golive.nemtudo.me/app"
              target="_blank"
              rel="noopener noreferrer"
              title="Baixar aplicativo GoLive"
              style={{ width: "fit-content", textWrap: "nowrap" }}
              className="flex w-fit shrink-0 items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-indigo-700 transition hover:bg-indigo-100 hover:text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-400 dark:hover:bg-indigo-900/60 dark:hover:text-indigo-300"
            >
              <MdOutlineDesktopWindows className="h-3 w-3" />
              Apenas no app
            </a>
          )}
        </div>
        <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-zinc-50/50 dark:divide-zinc-800/80 dark:border-zinc-800 dark:bg-zinc-900/40">
          {list.map((def) => {
            const isAppOnlyDisabled = Boolean(def.appOnly && !isDesktop);
            const isDisabled = !hasAccount || isAppOnlyDisabled;
            const placeholder = isAppOnlyDisabled
              ? "Apenas no app"
              : !hasAccount
                ? "Conta necessária"
                : "Clique para gravar";
            const onDisabledClick = isAppOnlyDisabled
              ? () => window.open("https://golive.nemtudo.me/app", "_blank")
              : !hasAccount
                ? () => {
                    onClose();
                    onRequestAccount();
                  }
                : undefined;

            return (
              <div
                key={def.id}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {def.label}
                    </p>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {def.description}
                  </p>
                </div>
                <div className="shrink-0">
                  <ShortcutRecorder
                    value={shortcuts[def.id] || ""}
                    onChange={(combo) => updateShortcut(def.id, combo)}
                    disabled={isDisabled}
                    onDisabledClick={onDisabledClick}
                    placeholder={placeholder}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
              <MdKeyboard className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
                Atalhos de Teclado
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Configure teclas de atalho para controlar áudio, vídeo e música
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {!hasAccount && (
            <div className="mb-5 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/60 dark:bg-amber-950/30">
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Conta necessária
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Utilize uma conta para configurar e utilizar atalhos de teclado.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRequestAccount();
                }}
                className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                <MdLogin className="h-4 w-4" />
                Criar conta ou entrar
              </button>
            </div>
          )}

          <div className="flex flex-col gap-5">
            {/* The browser/app split is what somebody outside needs to know
                and what somebody inside has already resolved. */}
            {renderGroup(
              isDesktop ? "Áudio" : "Áudio (Navegador e Aplicativo)",
              audioShortcuts,
              false
            )}
            {renderGroup("Transmissão & Câmera", videoShortcuts, true)}
            {renderGroup("Música", musicShortcuts, true)}
          </div>

          <div className="mt-5 rounded-xl border border-zinc-200/80 bg-zinc-50 p-3.5 text-xs leading-relaxed text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
            <div className="flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
              <MdInfoOutline className="h-4 w-4 text-zinc-500 dark:text-zinc-400 shrink-0" />
              <span>Informações sobre os atalhos:</span>
            </div>
            <ul className="mt-1.5 list-disc pl-5 space-y-1">
              {/* Which shortcuts exist where, for somebody who might not have
                  the app. Inside it the answer is "all of them", so both lines
                  are answering a question that no longer arises. */}
              {!isDesktop && (
                <>
                  <li>
                    Os atalhos de áudio (microfone e fone) funcionam tanto no navegador quanto no aplicativo do computador.
                  </li>
                  <li>
                    Os atalhos de transmissão, câmera e música funcionam no{" "}
                    <a
                      href="https://golive.nemtudo.me/app"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                    >
                      aplicativo GoLive para computador
                    </a>.
                  </li>
                </>
              )}
              {/* This one stays either way — it is the only line that is about
                  what the shortcuts *do* rather than about where to get them —
                  but inside the app it does not need to name it. */}
              <li>
                {isDesktop
                  ? "Os atalhos funcionam globalmente, mesmo com o foco em outros programas ou jogos."
                  : "No aplicativo GoLive, os atalhos funcionam globalmente, mesmo com o foco em outros programas ou jogos."}
              </li>
              <li>
                Atalhos nativos do sistema (como <kbd className="font-mono font-semibold">Ctrl+C</kbd> ou <kbd className="font-mono font-semibold">Ctrl+V</kbd>) continuam funcionando normalmente.
              </li>
              <li>
                Clique com o botão direito nos botões de controle para editar o atalho rapidamente.
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3.5 dark:border-zinc-800">
          <Tooltip content={!hasAccount ? "Utilize uma conta para limpar os atalhos" : undefined}>
            <button
              type="button"
              onClick={() => {
                if (!hasAccount) {
                  onClose();
                  onRequestAccount();
                } else {
                  resetShortcuts();
                }
              }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              <MdRestartAlt className="h-4 w-4" />
              Limpar todos os atalhos
            </button>
          </Tooltip>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Concluído
          </button>
        </div>
      </div>
    </div>
  );
}


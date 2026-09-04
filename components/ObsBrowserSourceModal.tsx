"use client";

import { MdClose, MdCheck, MdContentCopy } from "react-icons/md";
import { ObsSourceIcon } from "./icons";

/**
 * Tutorial modal that opens after the OBS Browser Source link is copied.
 *
 * Follows the same visual pattern as KeyboardShortcutsModal: a fixed
 * backdrop with a centred card, click-outside-to-close, scrollable body,
 * and a "Concluído" footer button.
 */
export function ObsBrowserSourceModal({
  open,
  url,
  onClose,
}: {
  open: boolean;
  /** The full URL that was just copied to the clipboard. */
  url: string;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <span className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-white">
            <ObsSourceIcon className="h-5 w-5" />
            Link de Transmissão (Browser Source)
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Success banner */}
          <div className="mb-5 flex items-center gap-2.5 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <MdCheck className="h-5 w-5 shrink-0" />
            Link copiado para a área de transferência!
          </div>

          {/* URL preview */}
          <div className="mb-5 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-2 px-3 py-2">
              <MdContentCopy className="h-4 w-4 shrink-0 text-zinc-400" />
              <code className="min-w-0 flex-1 truncate text-xs text-zinc-600 dark:text-zinc-400">
                {url}
              </code>
            </div>
          </div>

          {/* Steps */}
          <ol className="space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                1
              </span>
              <span>
                Abra este link diretamente no <strong>navegador web</strong> ou adicione como{" "}
                <strong>&quot;Navegador&quot; (Browser Source)</strong> em seu programa de transmissão (OBS, Streamlabs, etc.).
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                2
              </span>
              <span>
                Cole o link copiado na barra de endereços ou no campo <strong>&quot;URL&quot;</strong> da fonte.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                3
              </span>
              <span>
                Defina a <strong>largura</strong> e <strong>altura</strong> desejadas
                (ex: 1920 × 1080).
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                4
              </span>
              <span>
                A transmissão aparecerá diretamente na tela do navegador ou na cena de transmissão.
              </span>
            </li>
          </ol>

          {/* Tip */}
          <div className="mt-5 space-y-2">
            <div className="rounded-xl bg-purple-500/10 px-4 py-3 text-sm text-purple-700 dark:text-purple-300">
              <strong>Segurança:</strong> Este link está vinculado à sua conta de administrador. Por privacidade e controle, a transmissão só funciona enquanto você estiver conectado nesta chamada.
            </div>
            <div className="rounded-xl bg-blue-500/10 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
              <strong>Dica:</strong> Cada transmissão da sala tem seu próprio link. Adicione várias fontes &quot;Navegador&quot; para compor sua cena com múltiplas transmissões ao mesmo tempo.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-zinc-100 px-5 py-3.5 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Concluído
          </button>
        </div>
      </div>
    </div>
  );
}


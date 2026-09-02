"use client";

import type { ReactElement, Ref } from "react";
import {
  MdKeyboard,
  MdLogin,
  MdOutlineSettings,
  MdOutlineDesktopWindows,
} from "react-icons/md";
import { Popover } from "@/components/Tooltip";
import { ShortcutRecorder } from "@/components/ShortcutRecorder";
import {
  SHORTCUT_DEFINITIONS,
  useShortcuts,
  type ShortcutAction,
} from "@/lib/keyboardShortcuts";
import { isDesktopApp } from "@/lib/desktop";

export function ShortcutQuickPopover({
  action,
  open,
  onClose,
  hasAccount,
  onRequestAccount,
  onOpenAllShortcuts,
  children,
}: {
  action: ShortcutAction;
  open: boolean;
  onClose: () => void;
  hasAccount: boolean;
  onRequestAccount: () => void;
  onOpenAllShortcuts?: () => void;
  children: ReactElement<{ ref?: Ref<Element> }>;
}) {
  const { shortcuts, updateShortcut } = useShortcuts();
  const definition = SHORTCUT_DEFINITIONS.find((d) => d.id === action);

  const isDesktop = isDesktopApp();
  const isAppOnly = Boolean(definition?.appOnly);

  const canEdit = !isAppOnly || isDesktop;

  return (
    <Popover
      open={open}
      onClose={onClose}
      placement="bottom"
      wrapperClassName="inline-flex"
      content={
        <div
          style={canEdit ? { width: "fit-content" } : undefined}
          className={`${
            canEdit ? "w-fit" : "w-72"
          } rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-950`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-800">
            <div className="flex items-center gap-1.5">
              <MdKeyboard className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
              <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Atalho: {definition?.label ?? "Ação"}
              </h3>
            </div>
            {isAppOnly && (
              <a
                href="https://golive.nemtudo.me/app"
                target="_blank"
                rel="noopener noreferrer"
                title="Baixar aplicativo GoLive"
                style={{ width: "fit-content", textWrap: "nowrap" }}
                className="flex w-fit shrink-0 items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-indigo-700 transition hover:bg-indigo-100 hover:text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-400 dark:hover:bg-indigo-900/60 dark:hover:text-indigo-300"
              >
                <MdOutlineDesktopWindows className="h-3 w-3" />
                No app
              </a>
            )}
          </div>

          <p className="mb-3 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            {definition?.description}
          </p>

          {isAppOnly && !isDesktop ? (
            <div className="flex flex-col gap-2.5">
              <a
                href="https://golive.nemtudo.me/app"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col items-center rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-center transition hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/30"
              >
                <MdOutlineDesktopWindows className="mb-1.5 h-6 w-6 text-zinc-400 transition group-hover:text-indigo-600 dark:text-zinc-500 dark:group-hover:text-indigo-400" />
                <p className="text-xs font-semibold text-zinc-800 transition group-hover:text-indigo-600 dark:text-zinc-200 dark:group-hover:text-indigo-400">
                  Disponível no aplicativo
                </p>
                <p className="mt-1 text-[11px] text-zinc-500 transition group-hover:text-zinc-700 dark:text-zinc-400 dark:group-hover:text-zinc-300">
                  Este atalho só pode ser configurado e utilizado no aplicativo GoLive. Clique para baixar.
                </p>
                <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200">
                  Baixar aplicativo
                </span>
              </a>

              {onOpenAllShortcuts && (
                <div className="border-t border-zinc-100 pt-2 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAllShortcuts();
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                  >
                    <MdOutlineSettings className="h-3.5 w-3.5" />
                    Ver todos os atalhos
                  </button>
                </div>
              )}
            </div>
          ) : !hasAccount ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-900/50 dark:bg-amber-950/30">
              <p className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-300">
                Utilize uma conta para configurar atalhos de teclado.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRequestAccount();
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-zinc-950 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                <MdLogin className="h-3.5 w-3.5" />
                Criar conta ou entrar
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex justify-between items-center">
                <ShortcutRecorder
                  value={shortcuts[action] || ""}
                  onChange={(combo) => updateShortcut(action, combo)}
                  disabled={!hasAccount}
                  onDisabledClick={
                    !hasAccount
                      ? () => {
                          onClose();
                          onRequestAccount();
                        }
                      : undefined
                  }
                />
              </div>

              {onOpenAllShortcuts && (
                <div className="border-t border-zinc-100 pt-2 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAllShortcuts();
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                  >
                    <MdOutlineSettings className="h-3.5 w-3.5" />
                    Ver todos os atalhos
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      }
    >
      {children}
    </Popover>
  );
}

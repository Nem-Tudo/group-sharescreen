"use client";

import { useSyncExternalStore, useEffect, useCallback } from "react";
import { getDesktopBridge, isDesktopApp } from "./desktop";

export type ShortcutAction =
  | "toggleDeafen"
  | "toggleMute"
  | "toggleScreenShare"
  | "toggleCamera"
  | "toggleMusicPlay"
  | "nextMusic"
  | "previousMusic";

export interface ShortcutDefinition {
  id: ShortcutAction;
  label: string;
  description: string;
  category: "audio" | "video" | "music";
  appOnly?: boolean;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: "toggleDeafen",
    label: "Escutar / Parar de escutar",
    description: "Silencia ou reativa o áudio de todos na sala",
    category: "audio",
    appOnly: false,
  },
  {
    id: "toggleMute",
    label: "Falar / Mutar",
    description: "Liga ou desliga o seu microfone",
    category: "audio",
    appOnly: false,
  },
  {
    id: "toggleScreenShare",
    label: "Iniciar / Fechar transmissão",
    description: "Inicia ou encerra o compartilhamento de tela",
    category: "video",
    appOnly: true,
  },
  {
    id: "toggleCamera",
    label: "Iniciar / Fechar câmera",
    description: "Liga ou desliga a sua câmera",
    category: "video",
    appOnly: true,
  },
  {
    id: "toggleMusicPlay",
    label: "Pausar / Play música",
    description: "Alterna entre tocar e pausar a música da sala / mídia local",
    category: "music",
    appOnly: true,
  },
  {
    id: "nextMusic",
    label: "Pular música",
    description: "Avança para a próxima faixa da música local",
    category: "music",
    appOnly: true,
  },
  {
    id: "previousMusic",
    label: "Voltar música",
    description: "Volta para a faixa anterior da música local",
    category: "music",
    appOnly: true,
  },
];

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  toggleDeafen: "",
  toggleMute: "",
  toggleScreenShare: "",
  toggleCamera: "",
  toggleMusicPlay: "",
  nextMusic: "",
  previousMusic: "",
};

const STORAGE_KEY = "golive:keyboard-shortcuts";

let memoryShortcuts: Record<ShortcutAction, string> | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

export function getStoredShortcuts(): Record<ShortcutAction, string> {
  if (typeof window === "undefined") return { ...DEFAULT_SHORTCUTS };
  if (memoryShortcuts) return memoryShortcuts;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      memoryShortcuts = { ...DEFAULT_SHORTCUTS };
      return memoryShortcuts;
    }
    const parsed = JSON.parse(raw) as Partial<Record<ShortcutAction, string>>;
    memoryShortcuts = {
      ...DEFAULT_SHORTCUTS,
      ...parsed,
    };
    return memoryShortcuts;
  } catch {
    memoryShortcuts = { ...DEFAULT_SHORTCUTS };
    return memoryShortcuts;
  }
}

export function setStoredShortcuts(shortcuts: Record<ShortcutAction, string>): void {
  memoryShortcuts = { ...shortcuts };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts));
  } catch {
    // quota exceeded or private mode
  }
  notifyListeners();
  syncDesktopShortcuts(shortcuts);
}

export function setStoredShortcut(action: ShortcutAction, combo: string): void {
  const current = getStoredShortcuts();
  setStoredShortcuts({
    ...current,
    [action]: combo,
  });
}

export function clearStoredShortcuts(): void {
  setStoredShortcuts({ ...DEFAULT_SHORTCUTS });
}

function syncDesktopShortcuts(shortcuts: Record<ShortcutAction, string>) {
  const bridge = getDesktopBridge();
  if (bridge?.setGlobalShortcuts) {
    const electronShortcuts: Record<string, string> = {};
    for (const [action, combo] of Object.entries(shortcuts)) {
      if (combo) {
        electronShortcuts[action] = shortcutToElectronAccelerator(combo);
      }
    }
    bridge.setGlobalShortcuts(electronShortcuts);
  }
}

export function subscribeShortcuts(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function useShortcuts(): {
  shortcuts: Record<ShortcutAction, string>;
  updateShortcut: (action: ShortcutAction, combo: string) => void;
  resetShortcuts: () => void;
} {
  const shortcuts = useSyncExternalStore(
    subscribeShortcuts,
    getStoredShortcuts,
    () => DEFAULT_SHORTCUTS
  );

  const updateShortcut = useCallback((action: ShortcutAction, combo: string) => {
    setStoredShortcut(action, combo);
  }, []);

  const resetShortcuts = useCallback(() => {
    clearStoredShortcuts();
  }, []);

  return {
    shortcuts,
    updateShortcut,
    resetShortcuts,
  };
}

/**
 * Converts a KeyboardEvent into a readable string like "Ctrl+Shift+M" or "F9".
 * Returns null if only modifier keys are pressed.
 */
export function eventToShortcutString(e: KeyboardEvent): string | null {
  // Ignored modifier keys when pressed alone
  if (["Control", "Shift", "Alt", "Meta", "AltGraph", "OS"].includes(e.key)) {
    return null;
  }

  const parts: string[] = [];

  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");

  let keyName = e.key;

  // Format special keys nicely
  if (keyName === " ") {
    keyName = "Espaço";
  } else if (keyName === "ArrowUp") {
    keyName = "Seta Cima";
  } else if (keyName === "ArrowDown") {
    keyName = "Seta Baixo";
  } else if (keyName === "ArrowLeft") {
    keyName = "Seta Esquerda";
  } else if (keyName === "ArrowRight") {
    keyName = "Seta Direita";
  } else if (keyName === "Escape") {
    keyName = "Esc";
  } else if (keyName.length === 1) {
    keyName = keyName.toUpperCase();
  }

  parts.push(keyName);
  return parts.join("+");
}

/**
 * Converts formatted shortcut like "Ctrl+Shift+M" to Electron Accelerator format.
 */
export function shortcutToElectronAccelerator(combo: string): string {
  if (!combo) return "";
  const parts = combo.split("+").map((part) => {
    switch (part.trim()) {
      case "Ctrl":
        return "CommandOrControl";
      case "Espaço":
        return "Space";
      case "Seta Cima":
        return "Up";
      case "Seta Baixo":
        return "Down";
      case "Seta Esquerda":
        return "Left";
      case "Seta Direita":
        return "Right";
      case "Esc":
        return "Escape";
      default:
        return part.trim();
    }
  });
  return parts.join("+");
}

/**
 * Checks if key event matches a configured shortcut string.
 */
export function matchesShortcut(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false;
  const currentCombo = eventToShortcutString(e);
  if (!currentCombo) return false;
  return currentCombo.toLowerCase() === combo.toLowerCase();
}

/**
 * Checks if a key event is a common native editing shortcut (like Ctrl+C, Ctrl+V, etc.)
 * that must continue to trigger native browser behaviors concurrently.
 */
export function isNativeBrowserShortcut(e: KeyboardEvent): boolean {
  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const modifier = isMac ? e.metaKey : e.ctrlKey;
  if (!modifier) return false;

  const key = e.key.toLowerCase();
  return ["c", "v", "x", "a", "z", "y", "f", "r", "w", "t", "p", "s"].includes(key);
}

/**
 * Global shortcut listener hook that handles both DOM keydown events and Electron IPC events.
 */
export function useGlobalShortcutListener({
  handlers,
  enabled,
}: {
  handlers: Partial<Record<ShortcutAction, () => void>>;
  enabled: boolean;
}) {
  const { shortcuts } = useShortcuts();

  // Sync shortcuts with Electron shell on startup and whenever shortcuts change
  useEffect(() => {
    if (enabled) {
      syncDesktopShortcuts(shortcuts);
    } else {
      syncDesktopShortcuts(DEFAULT_SHORTCUTS);
    }
  }, [shortcuts, enabled]);

  // Listen for Electron global shortcuts trigger from background
  useEffect(() => {
    if (!enabled) return;
    const bridge = getDesktopBridge();
    if (!bridge?.onGlobalShortcut) return;

    return bridge.onGlobalShortcut((actionName) => {
      const action = actionName as ShortcutAction;
      const handler = handlers[action];
      if (handler) {
        handler();
      }
    });
  }, [handlers, enabled]);

  // MediaSession API integration for global hardware mic keys on supporting browsers
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler(
          "togglemicrophone" as MediaSessionAction,
          () => {
            handlers.toggleMute?.();
          }
        );
        return () => {
          try {
            navigator.mediaSession.setActionHandler(
              "togglemicrophone" as MediaSessionAction,
              null
            );
          } catch {}
        };
      } catch {}
    }
  }, [handlers, enabled]);

  // Listen for browser window keydown events when web window is in focus
  useEffect(() => {
    if (!enabled) return;
    const isDesktop = isDesktopApp();

    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept if target is editable input and pressing standard alphanumeric without modifiers
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      for (const [actionKey, combo] of Object.entries(shortcuts)) {
        if (!combo) continue;
        const action = actionKey as ShortcutAction;

        // Video & music shortcuts are desktop app only
        if (!isDesktop && action !== "toggleDeafen" && action !== "toggleMute") {
          continue;
        }

        const handler = handlers[action];
        if (!handler) continue;

        if (matchesShortcut(e, combo)) {
          // If inside text field and combo has no modifiers (e.g. typing a letter 'm'), let user type normally
          if (isInput && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
            continue;
          }

          // Trigger the shortcut action
          handler();

          // If it's not a native editing key (like Ctrl+C), prevent browser default
          if (!isNativeBrowserShortcut(e)) {
            e.preventDefault();
          }
          break;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [shortcuts, handlers, enabled]);
}

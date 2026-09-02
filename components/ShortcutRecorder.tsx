"use client";

import { useState, useEffect, useRef } from "react";
import { MdClose, MdKeyboard } from "react-icons/md";
import { eventToShortcutString } from "@/lib/keyboardShortcuts";

export function ShortcutRecorder({
  value,
  onChange,
  disabled = false,
  onDisabledClick,
  placeholder = "Clique para gravar",
}: {
  value: string;
  onChange: (combo: string) => void;
  disabled?: boolean;
  onDisabledClick?: () => void;
  placeholder?: string;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [heldModifiers, setHeldModifiers] = useState<string[]>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isRecording) return;

    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      // Update held modifiers for live visual feedback
      const modifiers: string[] = [];
      if (e.ctrlKey) modifiers.push("Ctrl");
      if (e.altKey) modifiers.push("Alt");
      if (e.shiftKey) modifiers.push("Shift");
      if (e.metaKey) modifiers.push("Meta");
      setHeldModifiers(modifiers);

      // Check if escape without modifiers was pressed to cancel
      if (e.key === "Escape" && modifiers.length === 0) {
        setIsRecording(false);
        setHeldModifiers([]);
        return;
      }

      // Check if backspace without modifiers was pressed to clear
      if (e.key === "Backspace" && modifiers.length === 0) {
        onChange("");
        setIsRecording(false);
        setHeldModifiers([]);
        return;
      }

      const combo = eventToShortcutString(e);
      if (combo) {
        onChange(combo);
        setIsRecording(false);
        setHeldModifiers([]);
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      const modifiers: string[] = [];
      if (e.ctrlKey) modifiers.push("Ctrl");
      if (e.altKey) modifiers.push("Alt");
      if (e.shiftKey) modifiers.push("Shift");
      if (e.metaKey) modifiers.push("Meta");
      setHeldModifiers(modifiers);
    }

    function handleClickOutside(e: MouseEvent) {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setIsRecording(false);
        setHeldModifiers([]);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("mousedown", handleClickOutside, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [isRecording, onChange]);

  return (
    <div className="flex items-center gap-1.5">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (disabled) {
            onDisabledClick?.();
          } else {
            setIsRecording(true);
            setHeldModifiers([]);
          }
        }}
        className={`flex h-8 min-w-36 items-center justify-between gap-2 rounded-lg border px-2.5 text-xs font-medium transition ${
          disabled
            ? "border-zinc-200 bg-zinc-50 text-zinc-400 opacity-60 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-500"
            : isRecording
              ? "border-zinc-900 bg-zinc-100 text-zinc-900 ring-2 ring-zinc-900/20 dark:border-zinc-100 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-100/20"
              : value
                ? "border-zinc-300 bg-white text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                : "border-dashed border-zinc-300 bg-transparent text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
        }`}
      >
        <span className="flex items-center gap-1.5 truncate">
          <MdKeyboard className="h-3.5 w-3.5 shrink-0 opacity-70" />
          {isRecording ? (
            <span className="animate-pulse font-semibold">
              {heldModifiers.length > 0
                ? `${heldModifiers.join("+")}+...`
                : "Pressione as teclas..."}
            </span>
          ) : value ? (
            <kbd className="font-mono tracking-tight">{value}</kbd>
          ) : (
            <span className="opacity-70">{placeholder}</span>
          )}
        </span>
      </button>

      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Remover atalho"
          title="Remover atalho"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-zinc-800 dark:text-zinc-500 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <MdClose className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}


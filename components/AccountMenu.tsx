"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MdExpandMore } from "react-icons/md";
import { signalingClient } from "@/lib/signalingClient";
import { useSignaling } from "@/lib/useSignaling";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { Popover } from "@/components/Tooltip";
import { CreateAccountForm } from "@/components/CreateAccountForm";
import { LoginForm } from "@/components/LoginForm";
import { CompleteOAuthSignupForm } from "@/components/CompleteOAuthSignupForm";
import Link from "next/link";
import { AccountConnections } from "@/components/AccountConnections";
import { openDirectMessages } from "@/lib/dmWindow";
import type { OAuthResult } from "@/lib/oauthApi";

// Who you are, and everything you can do about it, in the header.
//
// All of this used to sit above the room form on the home page, which meant
// the card was two things at once: the identity you are using and the room
// you are going to. Identity belongs to the whole site rather than to that
// one form, so it moved up here and the card went back to being the form.
//
// Renders nothing until there *is* a name. Before that the home page's own
// card is doing the asking — it is the page's main job on a first visit, and
// a second way in from the corner of the header would only split it.
//
// The forms live inside the panel rather than driving the page below, so this
// component owns the whole flow and no state has to be threaded through the
// header to the page.

type PanelMode = "menu" | "rename" | "create" | "login";

const itemClass =
  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800";
const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const primaryButtonClass =
  "rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButtonClass =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

export function AccountMenu() {
  const state = useSignaling();
  const { logout } = useAuth();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PanelMode>("menu");
  const [nameInput, setNameInput] = useState("");
  // A social login that turned out to be a signup: the username step takes
  // over the whole panel, same as it took over the identity area before.
  const [oauthTicket, setOAuthTicket] = useState<
    Extract<OAuthResult, { kind: "ticket" }> | null
  >(null);

  const name = state.name;
  const isAccount = Boolean(state.account);
  const previousNameRef = useRef(name);

  // Closes the rename form once the name actually changes (success, or a
  // plain reconnect landing on the same name), without guessing at timing.
  useEffect(() => {
    if (mode === "rename" && name !== previousNameRef.current) {
      setMode("menu");
      setNameInput("");
    }
    previousNameRef.current = name;
  }, [name, mode]);

  function close() {
    setOpen(false);
    // Deferred so the panel is already gone when it snaps back to the menu —
    // otherwise the form visibly reverts during the closing animation.
    setTimeout(() => {
      setMode("menu");
      setOAuthTicket(null);
      setNameInput("");
    }, 150);
  }

  function handleRenameSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === name) return;
    trackEvent("name_change");
    signalingClient.register(trimmed);
  }

  if (!name) return null;

  const initial = name.trim().slice(0, 1).toUpperCase();

  const panel = (
    <div className="w-72 rounded-xl border border-black/10 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-zinc-950">
      {oauthTicket ? (
        <div className="p-2">
          <CompleteOAuthSignupForm
            ticket={oauthTicket.ticket}
            provider={oauthTicket.provider}
            suggestedUsername={oauthTicket.suggestedUsername}
            suggestedDisplayName={oauthTicket.suggestedDisplayName}
            onSuccess={close}
            onCancel={() => setOAuthTicket(null)}
          />
        </div>
      ) : mode === "create" ? (
        <div className="p-2">
          <CreateAccountForm
            initialDisplayName={name}
            onSuccess={close}
            onCancel={() => setMode("menu")}
            onSwitchToLogin={() => setMode("login")}
          />
        </div>
      ) : mode === "login" ? (
        <div className="p-2">
          {/* LoginForm brings its own OAuth buttons — see its render. */}
          <LoginForm
            onSuccess={close}
            onCancel={() => setMode("menu")}
            onSwitchToCreate={() => setMode("create")}
            onTicket={setOAuthTicket}
          />
        </div>
      ) : mode === "rename" ? (
        <form onSubmit={handleRenameSubmit} className="flex flex-col gap-2 p-2">
          <label
            htmlFor="account-menu-name"
            className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Novo nome
          </label>
          <input
            id="account-menu-name"
            autoFocus
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            maxLength={24}
            placeholder={name}
            className={inputClass}
          />
          {state.nameError && <p className="text-xs text-red-500">{state.nameError}</p>}
          <div className="mt-1 flex gap-2">
            <button
              type="submit"
              disabled={!nameInput.trim() || nameInput.trim() === name}
              className={`flex-1 ${primaryButtonClass}`}
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("menu");
                setNameInput("");
              }}
              className={secondaryButtonClass}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="px-3 pt-2 pb-3">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {isAccount ? "Conectado como" : "Usando nome"}
            </p>
            <p className="truncate font-semibold text-zinc-950 dark:text-zinc-50">{name}</p>
          </div>
          <div className="border-t border-black/5 pt-1 dark:border-white/5">
            {isAccount ? (
              <>
                {/* Above the connections, which are a setting about this
                    account; this is a place to go. A row here rather than in
                    the site header's nav: the header is where the *site's*
                    pages live, and a friends list is only ever about the
                    person already signed in. */}
                <button
                  type="button"
                  onClick={() => {
                    close();
                    openDirectMessages();
                  }}
                  className={itemClass}
                >
                  Mensagens
                </button>
                <Link href="/amigos" onClick={close} className={itemClass}>
                  Amigos
                </Link>
                {/* Brings its own collapsible section, so it sits in the
                    panel as one row until someone opens it. */}
                <div className="px-1 pb-1">
                  <AccountConnections />
                </div>
                <button type="button" onClick={() => { logout(); close(); }} className={itemClass}>
                  Sair da conta
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setNameInput(name);
                    setMode("rename");
                  }}
                  className={itemClass}
                >
                  Trocar nome
                </button>
                <button type="button" onClick={() => setMode("create")} className={itemClass}>
                  Criar uma conta
                </button>
                <button type="button" onClick={() => setMode("login")} className={itemClass}>
                  Já tenho uma conta
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <Popover content={panel} open={open} onClose={close} placement="bottom-end">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="ml-1 flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 py-1 pr-1.5 pl-1 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white ${
            // An account and a guest name are genuinely different things —
            // one survives this browser, the other does not — so the avatar
            // says which without spending a word on it.
            isAccount
              ? "bg-gradient-to-br from-emerald-500 to-teal-600"
              : "bg-gradient-to-br from-zinc-400 to-zinc-500"
          }`}
        >
          {initial}
        </span>
        <span className="hidden max-w-[12ch] truncate sm:inline">{name}</span>
        <MdExpandMore className="h-4 w-4 shrink-0 text-zinc-400" />
      </button>
    </Popover>
  );
}

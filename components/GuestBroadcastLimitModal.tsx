"use client";

import { MdClose } from "react-icons/md";
import { ScreenIcon, MicIcon, CheckIcon } from "./icons";

// "2 horas", "1 hora", "90 minutos" — read off whatever the server actually
// enforces rather than written into the copy, so the number in the dialog and
// the number in guestBroadcastStore.ts can never disagree.
function formatLimit(limitSeconds: number): string {
  const hours = limitSeconds / 3600;
  if (Number.isInteger(hours)) return hours === 1 ? "1 hora" : `${hours} horas`;
  return `${Math.round(limitSeconds / 60)} minutos`;
}

/**
 * Shown when somebody without an account runs out of broadcast time (the
 * server's guestBroadcastStore.ts).
 *
 * The whole job of this dialog is to not feel like a punishment, because
 * nothing was taken away — they got the two hours, and what is on the other
 * side of registering is more of the same thing for free. So it leads with
 * what still works (they are still in the room, the mic never stopped) before
 * it gets to what to do about it, and the way out is a real button rather
 * than a link somebody has to go hunting for.
 *
 * `ended` is the difference between being stopped mid-broadcast and being
 * turned away before starting one. It is only a sentence, but it is the
 * sentence that decides whether this reads as an explanation or as a
 * non-sequitur about something that never happened.
 */
export function GuestBroadcastLimitModal({
  open,
  ended,
  limitSeconds,
  onCreateAccount,
  onClose,
}: {
  open: boolean;
  ended: boolean;
  limitSeconds: number;
  onCreateAccount: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const limit = formatLimit(limitSeconds);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ScreenIcon className="h-5 w-5" />
            </span>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
              {ended
                ? `Boa transmissão! Deu ${limit} 🎉`
                : "Seu tempo de transmissão acabou"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-1 shrink-0 rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-5">
          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {ended
              ? `${limit} é o total que a gente libera pra quem ainda não tem conta, então paramos sua transmissão por aqui.`
              : `Você já usou ${limit} de transmissão, que é o total pra quem ainda não tem conta.`}{" "}
            Criar uma conta é de graça, leva menos de um minuto e tira esse
            limite — daí você transmite o quanto quiser.
          </p>

          {/* What did *not* just happen. Being cut off feels like being
              kicked out, and most of the time the person's first thought is
              that they lost the room — saying otherwise up front is worth
              more than any amount of apologising. */}
          <ul className="mt-4 space-y-2 rounded-xl bg-zinc-50 p-3.5 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <li className="flex items-start gap-2.5">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span>Você continua na sala, com todo mundo.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <MicIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span>Seu microfone não foi afetado — pode continuar conversando.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span>Criando a conta, seu nome e suas configurações ficam salvos.</span>
            </li>
          </ul>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              Agora não
            </button>
            <button
              type="button"
              onClick={onCreateAccount}
              className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              Criar conta grátis
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

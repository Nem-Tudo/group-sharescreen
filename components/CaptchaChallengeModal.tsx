"use client";

import { useEffect, useRef, useState } from "react";
import { renderTurnstile, type TurnstileWidget } from "@/lib/turnstile";
import type { CaptchaAction } from "@/lib/recaptcha";

// The challenge somebody is shown when the invisible check refused them.
//
// This exists because reCAPTCHA v3 has no way to be wrong in the user's
// favour: it scores, it refuses, and there is nothing on screen to argue
// with. A person on a VPN, in the Instagram browser, or behind a privacy
// extension could be told "verificação de segurança necessária" forever with
// nothing to actually do. This is the something to do.
export function CaptchaChallengeModal({
  error,
  action = "join_room",
  submittingLabel = "Entrando na sala...",
  onToken,
  onCancel,
}: {
  // Why the last attempt did not land — either the invisible check's reason
  // for escalating here, or a challenge answer the server rejected.
  error?: string | null;
  // Which gated action is being stood in for. The API verifies the answer
  // against this exact value, so a modal opened by the login form has to say
  // "login" or the solved challenge is refused as a replay.
  action?: CaptchaAction;
  // What to say while the answer is in flight, since that is the one line
  // here that depends on what the person was trying to do.
  submittingLabel?: string;
  onToken: (token: string) => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "submitting">(
    "loading"
  );

  // Held in a ref so the effect below can stay mounted once — re-running it
  // would tear down a challenge somebody is halfway through solving.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);
  // Same reason, and it is read once when the widget is drawn: a caller that
  // changed the action mid-challenge would be changing what the answer buys
  // out from under somebody halfway through solving it.
  const actionRef = useRef(action);
  // The live widget, so a rejected answer can put a fresh challenge back on
  // screen (see the effect below).
  const widgetRef = useRef<TurnstileWidget | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let widget: TurnstileWidget | null = null;
    let cancelled = false;

    void renderTurnstile(container, {
      action: actionRef.current,
      onToken: (token) => {
        setStatus("submitting");
        onTokenRef.current(token);
      },
      onError: () => setStatus("unavailable"),
    }).then((created) => {
      if (cancelled) {
        created?.remove();
        return;
      }
      widget = created;
      widgetRef.current = created;
      setStatus(created ? "ready" : "unavailable");
    });

    return () => {
      cancelled = true;
      widgetRef.current = null;
      widget?.remove();
    };
  }, []);

  // An answer the server refused arrives as a new `error` while this is still
  // sitting on "submitting" — and in that state the message below is
  // deliberately not rendered (a challenge in flight has no failure to report
  // yet), so left alone the person is looking at a solved tick, no
  // explanation and nothing to press. Coming back to "ready" both shows the
  // reason and, together with the reset in the effect underneath, puts a
  // fresh challenge on screen: the only thing left to do about it.
  //
  // Adjusted during render rather than in an effect because it is state that
  // simply has to follow a prop, and compared by value rather than presence:
  // every caller clears `error` back to null before retrying, so a second
  // refusal reads as a change even when it carries the same words.
  const [shownError, setShownError] = useState(error ?? null);
  if ((error ?? null) !== shownError) {
    setShownError(error ?? null);
    if (error && status === "submitting") setStatus("ready");
  }

  useEffect(() => {
    if (!error) return;
    // A solved widget shows a tick and will not produce a second token —
    // clearing it is what makes another attempt possible at all.
    widgetRef.current?.reset();
  }, [error]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-black/10 bg-white p-6 text-center shadow-xl dark:border-white/10 dark:bg-zinc-950">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            Confirme que você não é um robô
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {status === "unavailable"
              ? "Não conseguimos carregar a verificação. Desative bloqueadores de anúncios ou extensões de privacidade para este site e tente de novo."
              : "Nossa verificação automática não teve certeza de que você é uma pessoa."}
          </p>
        </div>

        {/* Kept mounted even while unavailable: the widget draws into it
            asynchronously, and unmounting the container on a slow load would
            leave the script with nowhere to render when it does arrive. */}
        <div ref={containerRef} className="flex min-h-[65px] items-center justify-center" />

        {status === "loading" && (
          <p className="text-xs text-zinc-400 dark:text-zinc-600">Carregando verificação...</p>
        )}
        {status === "submitting" && (
          <p className="text-xs text-zinc-400 dark:text-zinc-600">{submittingLabel}</p>
        )}
        {error && status !== "submitting" && (
          <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
        )}

        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

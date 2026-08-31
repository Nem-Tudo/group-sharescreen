"use client";

import { useEffect, useRef, useState } from "react";
import { renderTurnstile, type TurnstileWidget } from "@/lib/turnstile";

// The challenge somebody is shown when the invisible check refused them.
//
// This exists because reCAPTCHA v3 has no way to be wrong in the user's
// favour: it scores, it refuses, and there is nothing on screen to argue
// with. A person on a VPN, in the Instagram browser, or behind a privacy
// extension could be told "verificação de segurança necessária" forever with
// nothing to actually do. This is the something to do.
export function CaptchaChallengeModal({
  error,
  onToken,
  onCancel,
}: {
  // Why the last attempt did not land — either the invisible check's reason
  // for escalating here, or a challenge answer the server rejected.
  error?: string | null;
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let widget: TurnstileWidget | null = null;
    let cancelled = false;

    void renderTurnstile(container, {
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
      setStatus(created ? "ready" : "unavailable");
    });

    return () => {
      cancelled = true;
      widget?.remove();
    };
  }, []);

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
          <p className="text-xs text-zinc-400 dark:text-zinc-600">Entrando na sala...</p>
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

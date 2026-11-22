"use client";

import { useEffect, useState } from "react";
import { GroupLink } from "@/components/groups/GroupLink";
import { ChamadoCard } from "@/components/chamados/Chamados";
import { CHAMADO_EVENTS, fetchChamado, trackChamado, type Chamado } from "@/lib/chamados";
import { useHomePath } from "@/lib/groupsHub";
import { useT } from "@/lib/useI18n";

// The chamado behind a shared link. Read once on arrival and again every 15 s
// while open, so the people in the room and the spots left stay true while
// somebody decides.
export function ChamadoPageClient({ id }: { id: string }) {
  const t = useT();
  const homePath = useHomePath();
  const [state, setState] = useState<{ chamado: Chamado | null; error: string | null } | null>(null);

  useEffect(() => {
    trackChamado(CHAMADO_EVENTS.page);
  }, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      const result = await fetchChamado(id);
      if (!alive) return;
      setState(result.ok ? { chamado: result.value, error: null } : { chamado: null, error: result.error });
    }
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [id]);

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10 sm:py-16">
      {state === null ? (
        <div aria-hidden className="h-64 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      ) : state.chamado ? (
        <ChamadoCard chamado={state.chamado} from="page" large onUpdate={(next) => setState({ chamado: next, error: null })} />
      ) : (
        <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {t("chamados.notFound")}
        </p>
      )}
      <p className="mt-6 text-center text-sm">
        <GroupLink href={homePath} className="font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100">
          {t("chamados.seeOthers")}
        </GroupLink>
      </p>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { MdBlock, MdCheck, MdDelete, MdImage } from "react-icons/md";
import {
  deleteAdminCameraEffect,
  dismissAdminCameraEffectReports,
  fetchAdminCameraEffectReports,
  searchAdminCameraEffects,
  type AdminCameraEffectHit,
  type AdminCameraEffectReport,
} from "@/lib/adminApi";
import { fetchWorkshopEffectImages, workshopPreviewUrl } from "@/lib/cameraEffectWorkshop";

// The effects workshop's moderation: the reports waiting at the top, and a search
// under them. Taking an effect down can come with its author's right to publish
// (the themes' ban: see the API's cameraEffectRoutes). Whoever already took the
// effect keeps a copy in their browser, which nothing here can reach.

const REASONS: Record<string, string> = {
  sexual: "Conteúdo sexual",
  violence: "Violência",
  hate: "Ódio",
  harassment: "Assédio",
  copyright: "Direitos autorais",
  spam: "Spam",
  other: "Outro",
};

const BUTTON = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium";

function EffectRow({
  hit,
  reports,
  onDelete,
  onDismiss,
}: {
  hit: AdminCameraEffectHit;
  reports?: AdminCameraEffectReport[];
  onDelete: (banAuthor: boolean) => void;
  onDismiss?: () => void;
}) {
  // The preview only has a GIF's first frame, and small: judged by the real thing.
  const [images, setImages] = useState<string[] | null>(null);
  return (
    <li className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- served by the API */}
        <img src={workshopPreviewUrl(hit)} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">{hit.name}</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            @{hit.authorUsername ?? hit.authorId} · {hit.uses} usos{hit.authorBanned ? " · autor bloqueado" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchWorkshopEffectImages(hit.id).then(setImages, () => setImages([]))}
          className={`${BUTTON} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}
        >
          <MdImage className="h-3.5 w-3.5" />
          Ver imagens
        </button>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className={`${BUTTON} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>
            <MdCheck className="h-3.5 w-3.5" />
            Descartar denúncias
          </button>
        )}
        <button type="button" onClick={() => onDelete(false)} className={`${BUTTON} bg-zinc-100 text-red-600 dark:bg-zinc-800 dark:text-red-400`}>
          <MdDelete className="h-3.5 w-3.5" />
          Apagar
        </button>
        {!hit.authorBanned && (
          <button type="button" onClick={() => onDelete(true)} className={`${BUTTON} bg-red-600 text-white`}>
            <MdBlock className="h-3.5 w-3.5" />
            Apagar e bloquear autor
          </button>
        )}
      </div>
      {images && (
        <div className="flex flex-wrap gap-2">
          {images.length === 0 && <span className="text-xs text-zinc-500 dark:text-zinc-400">Nenhuma imagem: só emojis e ajustes.</span>}
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL the API checked
            <img key={i} src={src} alt="" className="max-h-40 rounded-md bg-zinc-200 object-contain dark:bg-zinc-800" />
          ))}
        </div>
      )}
      {reports && (
        <ul className="flex flex-col gap-0.5 rounded-md bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
          {reports.map((report, i) => (
            <li key={i}>
              <span className="font-medium">{REASONS[report.reason] ?? report.reason}</span>
              {report.reporterUsername ? ` · @${report.reporterUsername}` : ""}
              {report.note ? `: ${report.note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function CameraEffectModerationPanel() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AdminCameraEffectHit[]>([]);
  const [queue, setQueue] = useState<Awaited<ReturnType<typeof fetchAdminCameraEffectReports>>>([]);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((err: unknown) => setError(err instanceof Error ? err.message : "Falhou"), []);

  useEffect(() => {
    let stale = false;
    fetchAdminCameraEffectReports().then((next) => {
      if (!stale) setQueue(next);
    }, fail);
    return () => {
      stale = true;
    };
  }, [fail]);

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      searchAdminCameraEffects(query).then((next) => {
        if (stale) return;
        setHits(next);
        setError(null);
      }, fail);
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, fail]);

  const remove = async (id: string, banAuthor: boolean) => {
    try {
      await deleteAdminCameraEffect(id, banAuthor);
      setHits((current) => current.filter((item) => item.id !== id));
      setQueue((current) => current.filter((item) => item.effect.id !== id));
    } catch (err) {
      fail(err);
    }
  };

  const dismiss = async (id: string) => {
    try {
      await dismissAdminCameraEffectReports(id);
      setQueue((current) => current.filter((item) => item.effect.id !== id));
    } catch (err) {
      fail(err);
    }
  };

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Workshop de efeitos de câmera</h2>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <h3 className="mt-3 text-xs font-semibold text-zinc-700 dark:text-zinc-300">Denúncias abertas ({queue.length})</h3>
      {queue.length === 0 ? (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Nenhuma denúncia esperando.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {queue.map(({ effect, reports }) => (
            <EffectRow
              key={effect.id}
              hit={effect}
              reports={reports}
              onDelete={(banAuthor) => void remove(effect.id, banAuthor)}
              onDismiss={() => void dismiss(effect.id)}
            />
          ))}
        </ul>
      )}

      <h3 className="mt-4 text-xs font-semibold text-zinc-700 dark:text-zinc-300">Buscar</h3>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Nome, id ou autor"
        className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
      />
      <ul className="mt-3 flex flex-col gap-3">
        {hits.map((hit) => (
          <EffectRow key={hit.id} hit={hit} onDelete={(banAuthor) => void remove(hit.id, banAuthor)} />
        ))}
      </ul>
    </section>
  );
}

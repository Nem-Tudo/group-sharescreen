"use client";

import { useEffect, useState } from "react";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupName } from "@/components/groups/GroupName";
import {
  deleteAdminGroup,
  searchAdminGroups,
  setAdminGroupFlags,
  suspendAdminGroup,
  unsuspendAdminGroup,
  type AdminGroupHit,
} from "@/lib/adminApi";

// The site's hand on a group: its flags (the same open-ended list an account
// has — VERIFIED is the badge), suspending it (out of use for everybody in it
// until lifted, nothing deleted) and deleting it for good.
//
// Every one of these goes through /admin, so the log records who did it (see
// the "Registros" tab).

const KNOWN_FLAGS = ["VERIFIED"];

const card = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";
const inputClass =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const primaryButton =
  "rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButton =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function GroupsPanel() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AdminGroupHit[] | null>(null);
  const [selected, setSelected] = useState<AdminGroupHit | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The newest groups with nothing typed; a search once there is.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        searchAdminGroups(query)
          .then((groups) => {
            if (!cancelled) setHits(groups);
          })
          .catch((err: Error) => {
            if (!cancelled) setError(err.message);
          });
      },
      query.trim() ? 250 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function replace(group: AdminGroupHit) {
    setSelected(group);
    setHits((current) => current?.map((hit) => (hit.id === group.id ? group : hit)) ?? current);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className={card}>
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Grupos</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Procure pelo nome ou pelo ID (o que aparece em /groups/…). Sem nada digitado, os mais novos.
        </p>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
          placeholder="Nome ou ID do grupo"
          className={`${inputClass} mt-3`}
        />
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        {hits === null ? (
          <p className="mt-3 text-xs text-zinc-500">Carregando…</p>
        ) : hits.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Nenhum grupo encontrado.</p>
        ) : (
          <ul className="mt-3 flex max-h-80 flex-col gap-0.5 overflow-y-auto rounded-lg border border-zinc-200 p-1 dark:border-zinc-800">
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => setSelected(hit)}
                  aria-current={selected?.id === hit.id ? "true" : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                    selected?.id === hit.id ? "bg-zinc-100 dark:bg-zinc-900" : ""
                  }`}
                >
                  <GroupIcon name={hit.name} iconUrl={hit.iconUrl} seed={hit.id} size={32} className="shrink-0 rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm text-zinc-900 dark:text-zinc-100">
                      <GroupName name={hit.name} flags={hit.flags} className="min-w-0" badgeClassName="h-3.5 w-3.5" />
                      {hit.suspension && <StatusTag tone="amber">Suspenso</StatusTag>}
                    </span>
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {hit.owner.username ? `@${hit.owner.username}` : hit.owner.displayName} · {hit.memberCount}{" "}
                      {hit.memberCount === 1 ? "membro" : "membros"} · {hit.visibility === "public" ? "público" : "privado"}
                      {hit.flags.length > 0 && ` · ${hit.flags.join(", ")}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <GroupDetail
          key={selected.id}
          group={selected}
          onChange={replace}
          onDeleted={() => {
            setHits((current) => current?.filter((hit) => hit.id !== selected.id) ?? current);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

function StatusTag({ tone, children }: { tone: "amber" | "zinc"; children: React.ReactNode }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        tone === "amber"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      {children}
    </span>
  );
}

function GroupDetail({
  group,
  onChange,
  onDeleted,
}: {
  group: AdminGroupHit;
  onChange: (group: AdminGroupHit) => void;
  onDeleted: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <div className="flex items-start gap-3">
          <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={56} className="shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-2 text-base font-semibold text-zinc-950 dark:text-zinc-50">
              <GroupName name={group.name} flags={group.flags} className="min-w-0" badgeClassName="h-4 w-4" />
              {group.suspension && <StatusTag tone="amber">Suspenso</StatusTag>}
              <StatusTag tone="zinc">{group.visibility === "public" ? "Público" : "Privado"}</StatusTag>
            </p>
            {group.description && (
              <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{group.description}</p>
            )}
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              <dt>ID</dt>
              <dd className="font-mono text-zinc-700 dark:text-zinc-300">{group.id}</dd>
              <dt>Dono</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">
                {group.owner.displayName}
                {group.owner.username && ` (@${group.owner.username})`}
              </dd>
              <dt>Membros</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">{group.memberCount}</dd>
              <dt>Salas</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">{group.channelCount}</dd>
              <dt>Criado</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">{formatDate(group.createdAt)}</dd>
            </dl>
          </div>
        </div>
      </div>

      <FlagsCard group={group} onChange={onChange} />
      <SuspensionCard group={group} onChange={onChange} />
      <DeleteCard group={group} onDeleted={onDeleted} />
    </div>
  );
}

function FlagsCard({ group, onChange }: { group: AdminGroupHit; onChange: (group: AdminGroupHit) => void }) {
  // Exactly what is stored, in its order — saving it unchanged is a no-op.
  const [draft, setDraft] = useState(group.flags.join(","));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const unchanged = draft === group.flags.join(",");

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const flags = draft
        .split(",")
        .map((flag) => flag.trim().toUpperCase())
        .filter(Boolean);
      const saved = await setAdminGroupFlags(group.id, flags);
      onChange(saved);
      setDraft(saved.flags.join(","));
      setMessage({ ok: true, text: "Flags salvas." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Falha ao salvar." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Flags do grupo</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Separadas por vírgula, como as de uma conta. Conhecidas: {KNOWN_FLAGS.join(", ")} (o selo de verificado).
      </p>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="VERIFIED"
        spellCheck={false}
        autoCapitalize="characters"
        className={`${inputClass} mt-3 font-mono`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={busy || unchanged} className={primaryButton}>
          {busy ? "Salvando..." : "Salvar"}
        </button>
        <button
          type="button"
          onClick={() => setDraft(group.flags.join(","))}
          disabled={busy || unchanged}
          className={secondaryButton}
        >
          Desfazer
        </button>
        {message && (
          <span className={`text-sm ${message.ok ? "text-emerald-600 dark:text-emerald-500" : "text-red-500"}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

function SuspensionCard({ group, onChange }: { group: AdminGroupHit; onChange: (group: AdminGroupHit) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<AdminGroupHit>) {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falhou.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Suspensão</h3>
      {group.suspension ? (
        <>
          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-medium">Suspenso desde {formatDate(group.suspension.at)}</p>
            <p className="mt-0.5 text-xs">
              {group.suspension.reason ? `Motivo: ${group.suspension.reason}` : "Sem motivo informado."}
            </p>
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Ninguém consegue abrir, escrever, entrar em chamada nem entrar no grupo. Os membros só podem sair.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => unsuspendAdminGroup(group.id))}
              className={primaryButton}
            >
              {busy ? "Removendo..." : "Remover suspensão"}
            </button>
            {error && <span className="text-sm text-red-500">{error}</span>}
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Deixa o grupo inutilizável até a suspensão ser removida: ninguém abre, escreve, entra em chamada ou entra
            nele, e quem estiver numa chamada é tirado dela. Nada é apagado. Os membros veem o motivo.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder="Motivo (opcional, aparece para os membros)"
            className={`${inputClass} mt-3 resize-none`}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => suspendAdminGroup(group.id, reason.trim()))}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Suspendendo..." : "Suspender grupo"}
            </button>
            {error && <span className="text-sm text-red-500">{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function DeleteCard({ group, onDeleted }: { group: AdminGroupHit; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteAdminGroup(group.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-red-200 bg-white p-4 dark:border-red-900/60 dark:bg-zinc-950">
      <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">Excluir grupo</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Apaga para sempre: o grupo, as salas, todas as mensagens, os membros e os convites. Não dá pra desfazer.
      </p>
      {confirming ? (
        <div className="mt-3 flex flex-col gap-2">
          <label className="text-xs text-zinc-600 dark:text-zinc-400">
            Digite <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{group.name}</span> para
            confirmar
          </label>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} className={inputClass} autoFocus />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || typed.trim() !== group.name.trim()}
              onClick={() => void remove()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Excluindo..." : "Excluir para sempre"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setTyped("");
              }}
              className={secondaryButton}
            >
              Cancelar
            </button>
            {error && <span className="text-sm text-red-500">{error}</span>}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          Excluir grupo
        </button>
      )}
    </div>
  );
}

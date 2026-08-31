"use client";

import { useMemo, useState } from "react";
import {
  EVAL_FIELDS,
  EVAL_STRING_OPS,
  EVAL_BOOL_OPS,
  evalFieldDef,
  sendClientEval,
  type EvalClause,
  type EvalFilter,
  type EvalOp,
  type EvalResult,
} from "@/lib/adminApi";

// Sends a snippet of JavaScript to run on the connected clients a filter
// selects (see the API's /admin/eval and adminEval.ts). The most dangerous
// control in the panel — arbitrary code on other people's tabs — so it is
// styled as such and gated behind an explicit "I understand" toggle before
// the run button does anything.

type Row = EvalClause & { id: number };

// A filter clause needs a stable key for React across edits; the server only
// ever sees {field, op, value}.
let nextRowId = 1;
function newRow(): Row {
  return { id: nextRowId++, field: EVAL_FIELDS[0].key, op: "eq", value: "" };
}

function opsFor(field: string) {
  const def = evalFieldDef(field);
  return def?.kind === "bool" ? EVAL_BOOL_OPS : EVAL_STRING_OPS;
}

// Whether this op takes a value at all — "exists" does not, so its input is
// hidden rather than sitting there doing nothing.
function opTakesValue(op: EvalOp): boolean {
  return op !== "exists";
}

export function EvalPanel() {
  const [code, setCode] = useState("");
  const [combine, setCombine] = useState<"and" | "or">("and");
  const [rows, setRows] = useState<Row[]>([]);
  const [armed, setArmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EvalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filter = useMemo<EvalFilter>(
    () => ({ combine, clauses: rows.map(({ field, op, value }) => ({ field, op, value })) }),
    [combine, rows]
  );

  function updateRow(id: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        // Switching to a field whose kind no longer offers the current op
        // would leave an impossible pair; snap the op back to the first valid
        // one for the new field.
        if (patch.field && !opsFor(patch.field).some((o) => o.value === next.op)) {
          next.op = opsFor(patch.field)[0].value;
        }
        return next;
      })
    );
  }

  async function run() {
    if (!armed || running || !code.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await sendClientEval(code, filter));
      // Re-arm each time: one press, one broadcast. Leaving it armed invites
      // a second accidental run of code still sitting in the box.
      setArmed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar.");
    } finally {
      setRunning(false);
    }
  }

  const noFilter = rows.length === 0;

  return (
    <div className="rounded-xl border border-red-300 bg-red-50/40 p-4 dark:border-red-900/60 dark:bg-red-950/20">
      <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">
        Executar código nos clientes
      </h2>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        Envia um trecho de JavaScript para rodar no navegador dos clientes conectados que passarem
        pelos filtros. Roda no escopo global de cada aba, imediatamente. É a ação mais poderosa do
        painel — não há como desfazer depois de enviado.
      </p>

      <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Código
      </label>
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={5}
        spellCheck={false}
        placeholder={`// ex:\nconsole.log("olá", location.pathname);\nlocalStorage.removeItem("sharescreen:algumaCoisa");`}
        className="mt-1 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Filtros de destino
        </span>
        {rows.length > 1 && (
          <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 text-xs dark:border-zinc-700">
            {(["and", "or"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setCombine(mode)}
                className={`px-2.5 py-1 font-medium transition ${
                  combine === mode
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {mode === "and" ? "E (todos)" : "OU (qualquer)"}
              </button>
            ))}
          </div>
        )}
      </div>

      {noFilter ? (
        <p className="mt-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Sem filtros: o código roda em <strong>todos</strong> os clientes conectados.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {rows.map((row, index) => {
            const def = evalFieldDef(row.field);
            const ops = opsFor(row.field);
            const isBool = def?.kind === "bool";
            return (
              <div key={row.id} className="flex flex-wrap items-center gap-1.5">
                {index > 0 && (
                  <span className="w-8 shrink-0 text-[11px] font-semibold uppercase text-zinc-400 dark:text-zinc-600">
                    {combine === "and" ? "e" : "ou"}
                  </span>
                )}
                <select
                  value={row.field}
                  onChange={(e) => updateRow(row.id, { field: e.target.value })}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  {EVAL_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select
                  value={row.op}
                  onChange={(e) => updateRow(row.id, { op: e.target.value as EvalOp })}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  {ops.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {opTakesValue(row.op) &&
                  (isBool ? (
                    <select
                      value={row.value === "false" ? "false" : "true"}
                      onChange={(e) => updateRow(row.id, { value: e.target.value })}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    >
                      <option value="true">sim</option>
                      <option value="false">não</option>
                    </select>
                  ) : def?.options ? (
                    <select
                      value={row.value || def.options[0]}
                      onChange={(e) => updateRow(row.id, { value: e.target.value })}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    >
                      {def.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={row.value ?? ""}
                      onChange={(e) => updateRow(row.id, { value: e.target.value })}
                      placeholder={def?.placeholder}
                      className="min-w-[8rem] flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  ))}
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                  aria-label="Remover filtro"
                  className="rounded-md px-2 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, newRow()])}
        className="mt-2 rounded-md border border-dashed border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        + Adicionar filtro
      </button>

      <label className="mt-4 flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={armed}
          onChange={(e) => setArmed(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Entendo que isso roda código arbitrário no navegador de outras pessoas e não pode ser
          desfeito.
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={!armed || running || !code.trim()}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Enviando..." : "Executar nos clientes"}
        </button>
        {result && (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Enviado para <strong>{result.matched}</strong> de {result.total}{" "}
            {result.total === 1 ? "cliente conectado" : "clientes conectados"}.
          </span>
        )}
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    </div>
  );
}

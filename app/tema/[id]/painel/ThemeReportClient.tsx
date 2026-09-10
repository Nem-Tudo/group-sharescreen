"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BsCoin } from "react-icons/bs";
import {
  MdOutlineAddCircleOutline,
  MdOutlineFavoriteBorder,
  MdOutlineMeetingRoom,
  MdOutlinePeopleAlt,
  MdOutlinePodcasts,
  MdOutlineRemoveCircleOutline,
  MdOutlineShowChart,
} from "react-icons/md";
import {
  FunnelChart,
  SplitBar,
  StatTile,
  TimeSeriesChart,
  bucketFullLabel,
  formatCount,
} from "@/app/anuncio/[token]/charts";
import {
  THEME_REPORT_RANGES,
  ThemeReportDeniedError,
  fetchThemeReport,
  formatPoints,
  type ThemeReport,
  type ThemeReportBucket,
  type ThemeReportRange,
} from "@/lib/themeReport";
import { gradientCss, isDarkTheme } from "@/lib/roomThemes";

// A theme's dashboard, for the person who made it.
//
// Built on the advertiser report's own charts (see app/anuncio/[token]) rather
// than beside them: they are the same job — somebody who made a thing wanting
// to know how it is doing — and two pages that answer it in two visual
// languages is how a site stops looking like one site.
//
// What is different is what the numbers *are*. An advertiser's report is about
// events that already happened; a theme is worn, so half of this is a gauge
// rather than a tally: how many people have it on right now, how many of those
// are online, how many rooms are wearing it. Those live at the top, because
// they are the ones that change while somebody is looking.

const POLL_INTERVAL_MS = 4000;

const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function relativeSeconds(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 5) return "agora mesmo";
  if (seconds < 60) return `há ${seconds}s`;
  return `há ${Math.round(seconds / 60)}min`;
}

export function ThemeReportClient({ id }: { id: string }) {
  const [range, setRange] = useState<ThemeReportRange>("24h");
  // undefined = the first load has not landed. A failed *poll* keeps the last
  // report on screen: numbers four seconds old beat a blank page.
  const [report, setReport] = useState<ThemeReport | undefined>(undefined);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const data = await fetchThemeReport(id, range, controller.signal);
        if (cancelled) return;
        setReport(data);
        setUpdatedAt(Date.now());
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ThemeReportDeniedError) {
          setDenied(true);
          return;
        }
        setError("Sem conexão — mostrando os últimos números.");
      }
      // Scheduled only once the previous one settled, so a slow connection
      // cannot end up racing itself and landing answers out of order.
      if (!cancelled) timer = setTimeout(load, POLL_INTERVAL_MS);
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [id, range]);

  if (denied) {
    return (
      <main className="mx-auto w-full max-w-md grow px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
          Este painel não é seu
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Só quem criou um tema vê os números dele.
        </p>
        <Link
          href="/workshop"
          className="mt-4 inline-block rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
        >
          Ver o Descobrir
        </Link>
      </main>
    );
  }

  if (!report) {
    return (
      <main className="mx-auto w-full max-w-5xl grow px-4 py-16">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando…</p>
      </main>
    );
  }

  const { theme, live, totals, window: win } = report;
  const dropped = Math.max(0, totals.adopters - live.wearing);
  const lastBucket = win.buckets[win.buckets.length - 1];
  const { palette, accent } = theme.spec;

  return (
    // The same palette the advertiser's report declares, and for the same
    // reason: the charts read these and hardcode no colour of their own.
    <main className="report-viz mx-auto w-full max-w-5xl grow px-4 py-6 sm:px-6">
      <style>{`
        .report-viz {
          --surface: #ffffff;
          --hairline: #e4e4e7;
          --track: #f0efec;
          --grid: #ececea;
          --ink-1: #09090b;
          --ink-2: #52525b;
          --ink-3: #a1a1aa;
          --series-1: #2a78d6;
          --series-2: #eb6834;
          --series-3: #1baf7a;
          --ordinal-1: #1c5cab;
          --ordinal-2: #2a78d6;
          --ordinal-3: #5598e7;
        }
        [data-theme="dark"] .report-viz {
          --surface: #0c0c0e;
          --hairline: #27272a;
          --track: #26262a;
          --grid: #242428;
          --ink-1: #fafafa;
          --ink-2: #a1a1aa;
          --ink-3: #71717a;
          --series-1: #3987e5;
          --series-2: #d95926;
          --series-3: #199e70;
          --ordinal-1: #86b6ef;
          --ordinal-2: #5598e7;
          --ordinal-3: #2a78d6;
        }
      `}</style>

      {/* ── Cabeçalho ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* The theme itself, at thumbnail size. A dashboard about a look
              should show the look — otherwise it is a page of numbers about a
              name. */}
          <span
            className="flex h-12 w-12 shrink-0 overflow-hidden rounded-xl border"
            style={{
              borderColor: palette.border,
              background: gradientCss(theme.spec) ?? palette.page,
            }}
          >
            {[palette.surface, palette.raised, accent].map((colour, index) => (
              <span key={index} className="h-full flex-1" style={{ background: colour }} />
            ))}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
              Painel do tema
            </p>
            <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-[var(--ink-1)]">
              {theme.name}
            </h1>
            <p className="mt-1 text-xs text-[var(--ink-3)]">
              Criado em {dateTimeFormat.format(theme.createdAt)} ·{" "}
              {isDarkTheme(theme.spec) ? "escuro" : "claro"}
              {theme.price > 0 ? ` · ${formatPoints(theme.price)} pontos` : " · grátis"}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {theme.published ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              No Descobrir
            </span>
          ) : (
            <span className="rounded-full bg-zinc-500/10 px-2.5 py-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              Privado
            </span>
          )}
          <span className="text-[11px] text-[var(--ink-3)]">
            {error ?? `Atualizado ${relativeSeconds(Math.max(0, now - updatedAt))}`}
          </span>
        </div>
      </header>

      {/* ── Agora ─────────────────────────────────────────────────────── */}
      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold text-[var(--ink-1)]">Agora</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Usando"
            icon={<MdOutlinePeopleAlt />}
            accent="--series-3"
            value={formatCount(live.wearing)}
            hint="Contas com o seu tema escolhido neste momento"
          />
          <StatTile
            label="Online agora"
            icon={<MdOutlinePodcasts />}
            accent="--series-1"
            value={formatCount(live.online)}
            hint="Dessas, quantas estão com o GoLive aberto"
          />
          <StatTile
            label="Salas com o tema"
            icon={<MdOutlineMeetingRoom />}
            accent="--series-2"
            value={formatCount(live.rooms)}
            hint="Salas ao vivo em que alguém colocou o seu tema para todos"
          />
          <StatTile
            label="Ficaram com ele"
            icon={<MdOutlineShowChart />}
            value={totals.retention === null ? "—" : `${Math.round(totals.retention * 100)}%`}
            hint="De todo mundo que já usou, quantos ainda estão usando"
          />
        </div>
      </section>

      {/* ── Sempre ────────────────────────────────────────────────────── */}
      <section className="mt-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--ink-1)]">Desde o começo</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Pessoas diferentes"
            icon={<MdOutlinePeopleAlt />}
            accent="--series-1"
            value={formatCount(totals.adopters)}
            hint="Gente distinta que colocou o tema pelo menos uma vez"
          />
          <StatTile
            label="Vezes que puseram"
            icon={<MdOutlineAddCircleOutline />}
            accent="--series-3"
            value={formatCount(totals.applies)}
            hint="Inclui quem tirou e voltou a colocar"
          />
          <StatTile
            label="Vezes que tiraram"
            icon={<MdOutlineRemoveCircleOutline />}
            accent="--series-2"
            value={formatCount(totals.removes)}
            hint="Trocar por outro tema também conta aqui"
          />
          <StatTile
            label="Curtidas"
            icon={<MdOutlineFavoriteBorder />}
            value={formatCount(totals.likes)}
            hint="Uma por pessoa"
          />
        </div>
      </section>

      {/* Only for a theme that is actually sold. A row of zeroes about money
          on a free theme is a page telling somebody about a business they are
          not in. */}
      {theme.price > 0 && (
        <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Vendas"
            icon={<BsCoin />}
            accent="--series-3"
            value={formatCount(totals.sales)}
            hint="Quantas pessoas compraram o tema"
          />
          <StatTile
            label="Pontos ganhos"
            icon={<BsCoin />}
            accent="--series-1"
            value={formatPoints(totals.earned)}
            hint="A sua parte das vendas, já creditada"
          />
        </section>
      )}

      {/* ── Ao longo do tempo ─────────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--ink-1)]">Ao longo do tempo</h2>
          <div className="flex gap-1 rounded-lg bg-[var(--track)] p-0.5">
            {THEME_REPORT_RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                aria-pressed={range === option.value}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  range === option.value
                    ? "bg-[var(--surface)] text-[var(--ink-1)] shadow-sm"
                    : "text-[var(--ink-2)] hover:text-[var(--ink-1)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-[var(--ink-3)]">
          {formatCount(win.people)} pessoa{win.people === 1 ? "" : "s"} colocaram o tema neste
          período.
        </p>
        <div className="mt-3">
          <TimeSeriesChart<ThemeReportBucket>
            buckets={win.buckets}
            step={win.step}
            series={{
              label: "Colocaram o tema",
              valueOf: (bucket) => bucket.applies,
              color: "--series-1",
            }}
            emptyLabel="Ninguém colocou o tema neste período."
          />
        </div>
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-[var(--ink-2)]">Tiraram</p>
          <TimeSeriesChart<ThemeReportBucket>
            buckets={win.buckets}
            step={win.step}
            series={{
              label: "Tiraram o tema",
              valueOf: (bucket) => bucket.removes,
              color: "--series-2",
            }}
            emptyLabel="Ninguém tirou o tema neste período."
          />
        </div>
        {/* Only when there is a last bucket to name. The fallback used to be
            `Date.now()`, which is a clock read during render — a value React
            cannot know changed, and one this line does not need: with no
            buckets there is nothing to say about the last one. */}
        {lastBucket && (
          <p className="mt-2 text-[11px] text-[var(--ink-3)]">
            Cada ponto é {win.step === "hour" ? "uma hora" : "um dia"} — o último vai até{" "}
            {bucketFullLabel(lastBucket.t, win.step)}.
          </p>
        )}
      </section>

      {/* ── O caminho ─────────────────────────────────────────────────── */}
      <section className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--ink-1)]">Do primeiro clique até agora</h2>
          <p className="mt-1 text-xs text-[var(--ink-3)]">
            Quanta gente sobra em cada passo.
          </p>
          <div className="mt-3">
            <FunnelChart
              stages={[
                {
                  label: "Já usaram",
                  value: totals.adopters,
                  hint: "Pessoas diferentes que colocaram o tema alguma vez",
                },
                {
                  label: "Ainda usando",
                  value: live.wearing,
                  hint: "Continuam com ele escolhido",
                },
                {
                  label: "Online agora",
                  value: live.online,
                  hint: "E estão com o GoLive aberto neste momento",
                },
              ]}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--ink-1)]">Quem ficou e quem saiu</h2>
          <p className="mt-1 text-xs text-[var(--ink-3)]">
            Das pessoas que já colocaram o tema alguma vez.
          </p>
          <div className="mt-4">
            <SplitBar
              parts={[
                { label: "Ficaram", value: live.wearing, color: "var(--series-3)" },
                { label: "Saíram", value: dropped, color: "var(--series-2)" },
              ]}
            />
          </div>
          {totals.adopters === 0 && (
            <p className="mt-3 text-xs text-[var(--ink-3)]">
              Ninguém usou o tema ainda.
              {theme.published
                ? " Ele já está no Descobrir."
                : " Publique no Descobrir para que outras pessoas possam usar."}
            </p>
          )}
        </div>
      </section>

      <p className="mt-4 text-[11px] text-[var(--ink-3)]">
        Os números de &quot;Agora&quot; são contados no momento em que a página pergunta e mudam
        sozinhos. Ninguém além de você vê este painel, e ele nunca mostra *quem* está usando o seu
        tema — apenas quantos.
      </p>
    </main>
  );
}

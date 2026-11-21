"use client";

// Faithful re-drawings of GoLive's screens, made from the code of the time
// (no screenshot was ever committed). Drawn at 960×600 and scaled by
// ScaledStage. The old screens keep their original Portuguese: they are
// pictures of what was on screen, not text of this page.

const zincBtn = "rounded-lg bg-zinc-950 px-4 py-2.5 text-center font-medium text-white";
const zincInput = "rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-400";

/** Commit 2a4990d "first" (17/08 21:49), then 88c5d3e "name and icon" (18/08 01:13). */
export function Day1Landing() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-50 font-[family-name:var(--font-geist-sans)]">
      <main className="w-[448px] rounded-2xl border border-black/10 bg-white p-8 shadow-sm">
        <h1 className="relative h-8 text-2xl font-semibold tracking-tight text-zinc-950">
          <span className="ou-old absolute left-0 top-0">ShareScreen</span>
          <span className="ou-new invisible absolute left-0 top-0 flex items-center gap-2">
            <img src="/icon.png" alt="" className="h-7 w-7 rounded-lg" />
            GoLive
          </span>
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Compartilhe sua tela com quem estiver na mesma sala, sem cadastro.</p>
        <div className="mt-8 flex flex-col gap-3">
          <label className="text-sm font-medium text-zinc-700">Escolha seu nome</label>
          <div className={zincInput}>Ex: Maria</div>
          <div className={`mt-2 ${zincBtn}`}>Confirmar nome</div>
        </div>
      </main>
    </div>
  );
}

/** Commit 30eee0e (19/08 15:07): the launch-day landing, with the live counter. */
export function LaunchLanding() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-zinc-50 font-[family-name:var(--font-geist-sans)]">
      <span className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-600 shadow-sm">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="ou-count tabular-nums">0</span> pessoas em salas agora
      </span>
      <main className="w-[448px] rounded-2xl border border-black/10 bg-white p-8 shadow-sm">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950">
          <img src="/icon.png" alt="" className="h-7 w-7 rounded-lg" />
          GoLive
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Compartilhe sua tela com quem estiver na mesma sala, sem cadastro.</p>
        <p className="mt-2 text-sm font-medium text-blue-600 underline">Ver salas públicas ativas</p>
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-sm text-zinc-500">
            Conectado como <span className="font-semibold text-zinc-900">Maria</span>
          </p>
          <label className="text-sm font-medium text-zinc-700">Para qual sala você quer ir ou criar?</label>
          <div className={zincInput}>Ex: reuniao-time</div>
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <span className="h-4 w-4 rounded border border-zinc-400" />
            Sala privada (não aparece na lista de salas públicas)
          </label>
          <div className={`mt-1 ${zincBtn}`}>Entrar na sala</div>
        </div>
      </main>
      <p className="text-xs text-zinc-500">
        Desenvolvido por <span className="font-semibold">@NemTudo</span> (discord.gg/nemtudo)
      </p>
    </div>
  );
}

const OLD_PEOPLE = ["Maria (você)", "João", "Ana", "Pedro"];

/** The day-1 WatchRoom (2a4990d): header, 16:9 black tiles, "Participantes" sidebar. */
export function OldRoom() {
  return (
    <div className="flex h-full w-full flex-col bg-zinc-50 font-[family-name:var(--font-geist-sans)]">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Sala</p>
            <p className="text-lg font-semibold text-zinc-950">reuniao-time</p>
          </div>
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">4 pessoas</span>
        </div>
        <div className="flex gap-2">
          <span className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700">Trocar de sala</span>
          <span className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white">Compartilhar tela</span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="grid flex-1 grid-cols-2 content-start gap-4 p-6">
          {["João", "Ana"].map((name) => (
            <div key={name} className="relative aspect-video overflow-hidden rounded-xl bg-black">
              <span className="absolute left-3 top-3 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">ao vivo</span>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 text-sm font-medium text-white">
                {name}
              </div>
            </div>
          ))}
        </div>
        <aside className="w-64 border-l border-zinc-200 bg-white p-4">
          <p className="text-sm font-semibold text-zinc-900">Participantes</p>
          <ul className="mt-3 space-y-2 text-sm text-zinc-700">
            {OLD_PEOPLE.map((p, i) => (
              <li key={p} className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${i === 1 || i === 2 ? "bg-emerald-500" : "bg-zinc-300"}`} />
                {p}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

const TILES = [
  { name: "Maria", bg: "linear-gradient(135deg,#1e3a8a,#7c3aed)", art: "game", speaking: true },
  { name: "João", bg: "linear-gradient(135deg,#0f172a,#1e293b)", art: "code", speaking: false },
  { name: "Ana", bg: "linear-gradient(135deg,#9d174d,#f97316)", art: "cam", speaking: false },
  { name: "Pedro", bg: "linear-gradient(135deg,#065f46,#0ea5e9)", art: "movie", speaking: false },
];

function TileArt({ art }: { art: string }) {
  if (art === "code") {
    return (
      <div className="absolute inset-4 space-y-1.5 font-mono text-[9px]">
        {[70, 45, 82, 30, 64, 52, 76].map((w, i) => (
          <div key={i} className="h-1.5 rounded" style={{ width: `${w}%`, background: ["#818cf8", "#34d399", "#f472b6", "#fbbf24"][i % 4], opacity: 0.8 }} />
        ))}
      </div>
    );
  }
  if (art === "game") {
    return (
      <>
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-[#14532d]" />
        <div className="absolute bottom-[33%] left-[20%] h-8 w-6 rounded-sm bg-[#fbbf24]" />
        <div className="absolute bottom-[33%] right-[25%] h-14 w-10 rounded-t-full bg-[#166534]" />
        <div className="absolute right-[12%] top-[14%] h-8 w-8 rounded-full bg-[#fde68a]" />
      </>
    );
  }
  if (art === "cam") {
    return (
      <div className="absolute inset-0 flex items-end justify-center">
        <div className="mb-[-10%] h-[62%] w-[42%] rounded-t-full bg-[#fde3cf]" />
        <div className="absolute bottom-[38%] h-[36%] w-[26%] rounded-full bg-[#fde3cf]" />
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center text-4xl">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-xl text-white">▶</span>
    </div>
  );
}

/** Today's room, in broad strokes: group rail, tiles, call bar, chat. */
export function NewRoom() {
  return (
    <div className="flex h-full w-full bg-[#0d1117] font-[family-name:var(--font-jakarta)] text-white">
      <nav className="flex w-[64px] flex-col items-center gap-3 border-r border-white/5 bg-[#0a0d12] py-4">
        <img src="/icon.png" alt="" className="h-10 w-10 rounded-2xl" />
        <div className="h-px w-8 bg-white/10" />
        {["#6366f1", "#f43f5e", "#f59e0b", "#10b981"].map((c) => (
          <span key={c} className="h-10 w-10 rounded-2xl" style={{ background: c }} />
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-white/40">🔊</span>
            <span className="font-bold">sala-da-galera</span>
            <span className="rounded-full bg-[#f43f5e] px-2 py-0.5 text-[10px] font-bold">AO VIVO</span>
          </div>
          <span className="flex -space-x-2">
            {["#818cf8", "#f472b6", "#34d399", "#fbbf24"].map((c) => (
              <span key={c} className="h-7 w-7 rounded-full border-2 border-[#0d1117]" style={{ background: c }} />
            ))}
          </span>
        </header>
        <div className="grid flex-1 grid-cols-2 gap-3 px-5">
          {TILES.map((tile) => (
            <div
              key={tile.name}
              className={`relative overflow-hidden rounded-2xl ${tile.speaking ? "ring-[3px] ring-emerald-400" : ""}`}
              style={{ background: tile.bg }}
            >
              <TileArt art={tile.art} />
              <span className="absolute bottom-2 left-2 rounded-lg bg-black/50 px-2 py-1 text-xs font-semibold backdrop-blur">
                {tile.name}
              </span>
              <span className="absolute right-2 top-2 rounded-md bg-black/40 px-1.5 py-0.5 text-[10px] font-bold">1080p · 60</span>
            </div>
          ))}
        </div>
        <div className="flex justify-center py-4">
          <div className="flex items-center gap-2 rounded-2xl bg-[#161b22] px-3 py-2">
            {["🎙️", "📷", "🖥️", "😀", "⋯"].map((icon, i) => (
              <span
                key={icon}
                className={`flex h-11 w-11 items-center justify-center rounded-xl text-lg ${i === 2 ? "bg-[#6366f1]" : "bg-white/10"}`}
              >
                {icon}
              </span>
            ))}
            <span className="ml-1 flex h-11 w-14 items-center justify-center rounded-xl bg-[#f43f5e] text-lg">📞</span>
          </div>
        </div>
      </div>
      <aside className="flex w-[250px] flex-col border-l border-white/5 bg-[#0a0d12] p-4">
        <p className="text-sm font-bold">Chat</p>
        <div className="mt-3 flex flex-1 flex-col justify-end gap-3 text-[12.5px]">
          {[
            { n: "Ana", c: "#f472b6", m: "kkkkk essa jogada" },
            { n: "João", c: "#34d399", m: "aumenta o volume aí" },
            { n: "Pedro", c: "#fbbf24", m: "🔥🔥🔥" },
          ].map((msg) => (
            <div key={msg.n} className="flex gap-2">
              <span className="h-7 w-7 shrink-0 rounded-full" style={{ background: msg.c }} />
              <div>
                <p className="font-bold" style={{ color: msg.c }}>
                  {msg.n}
                </p>
                <p className="text-white/80">{msg.m}</p>
              </div>
            </div>
          ))}
          <div className="h-20 rounded-xl bg-[linear-gradient(135deg,#f472b6,#818cf8)] opacity-80" />
          <div className="rounded-xl bg-white/5 px-3 py-2.5 text-white/40">Conversar na sala…</div>
        </div>
      </aside>
    </div>
  );
}

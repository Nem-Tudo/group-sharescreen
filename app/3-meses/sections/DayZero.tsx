"use client";

import { useRef } from "react";
import { useT } from "@/lib/useI18n";
import { gsap, useGSAP, MOTION_OK } from "../gsap";
import { SceneTitle } from "../shared";

type Line = { kind: "cmd"; text: string; at?: string } | { kind: "out"; text: string; color: string };

export function DayZeroSection() {
  const t = useT();
  const ref = useRef<HTMLElement>(null);

  const lines: Line[] = [
    { kind: "cmd", text: "npx create-next-app@latest sharescreen" },
    { kind: "out", text: "✔ Success! Created sharescreen", color: "#34d399" },
    { kind: "cmd", text: 'git commit -m "Initial commit from Create Next App"', at: "21:30" },
    { kind: "cmd", text: 'git commit -m "first"', at: "21:49" },
    { kind: "out", text: `→ ${t("anniversary.day0.firstWorks")}`, color: "#fbbf24" },
    { kind: "cmd", text: 'git commit -m "add turn server"', at: "22:25" },
    { kind: "cmd", text: 'git commit -m "feat: open mic"', at: "22:54" },
    { kind: "cmd", text: 'git commit -m "feat: mobile responsive"', at: "23:13" },
  ];

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const targets = gsap.utils.toArray<HTMLElement>(".d0-type");
        const full = targets.map((el) => el.textContent ?? "");
        const rows = gsap.utils.toArray<HTMLElement>(".d0-row");
        gsap.set(rows, { autoAlpha: 0 });
        const tl = gsap.timeline({ scrollTrigger: { trigger: ".d0-term", start: "top 75%", once: true } });
        rows.forEach((row, i) => {
          const el = targets[i];
          const text = full[i];
          const typed = row.dataset.kind === "cmd";
          tl.set(row, { autoAlpha: 1 });
          if (typed) {
            const state = { n: 0 };
            el.textContent = "";
            tl.to(state, {
              n: text.length,
              duration: Math.min(1.1, text.length * 0.028),
              ease: "none",
              onUpdate: () => {
                el.textContent = text.slice(0, Math.round(state.n));
              },
            });
            const at = row.querySelector(".d0-at");
            if (at) tl.fromTo(at, { autoAlpha: 0, x: -8 }, { autoAlpha: 1, x: 0, duration: 0.2 });
          } else {
            tl.fromTo(row, { x: -10 }, { x: 0, duration: 0.25 }, "+=0.15");
          }
          tl.to({}, { duration: 0.12 });
        });
      });
    },
    { scope: ref }
  );

  return (
    <section ref={ref} data-scene="day0" className="relative px-4 py-24 sm:px-8 sm:py-32">
      <SceneTitle kicker={t("anniversary.day0.kicker")} title={t("anniversary.day0.title")} />
      <div className="mx-auto mt-12 grid max-w-6xl items-start gap-12 lg:grid-cols-[1fr_1.3fr]">
        <div className="relative">
          <p data-reveal className="text-lg leading-relaxed text-[var(--a-mute)]">
            {t("anniversary.day0.p1")}
          </p>
        </div>

        <div data-reveal className="d0-term overflow-hidden rounded-lg border border-[var(--a-line)] bg-[#05070d] shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
          <div className="flex items-center gap-2 border-b border-[var(--a-line)] bg-white/5 px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
            <span className="ml-3 truncate font-mono text-xs text-white/50">~/dev/sharescreen — bash</span>
          </div>
          <div className="min-h-[300px] space-y-2 p-4 font-mono text-[12px] leading-relaxed sm:p-5 sm:text-[13.5px]">
            {lines.map((line, i) => (
              <div key={i} className="d0-row flex flex-wrap items-baseline gap-x-2" data-kind={line.kind}>
                {line.kind === "cmd" ? (
                  <>
                    <span className="shrink-0 text-[#818cf8]">~/dev $</span>
                    <span className="d0-type break-all text-white">{line.text}</span>
                    {line.at && (
                      <span className="d0-at ml-auto shrink-0 rounded-md bg-white/10 px-1.5 text-[11px] text-white/60">
                        17/08 {line.at}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="d0-type" style={{ color: line.color }}>
                    {line.text}
                  </span>
                )}
              </div>
            ))}
            <div className="anniv-caret text-[#818cf8]">~/dev $</div>
          </div>
        </div>
      </div>
    </section>
  );
}

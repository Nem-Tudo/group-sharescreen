"use client";

import { useRef } from "react";
import { useT } from "@/lib/useI18n";
import { gsap, useGSAP, MOTION_OK } from "../gsap";
import { SceneTitle } from "../shared";
import { TEAM } from "../historyData";

// The people behind the site, as three camera feeds on the control-room wall:
// each one switches on like an old monitor when the wall comes into view, then
// its lower third (name, handle, role) slides in. Pointing at a feed puts it
// "on air". Photos come from TEAM[].photo; until then the feed shows initials.

export function TeamSection() {
  const t = useT();
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        // Played on its own clock once the wall is in view, not scrubbed.
        const tl = gsap.timeline({ scrollTrigger: { trigger: ".tm-wall", start: "top 75%", once: true } });
        tl.fromTo(
          ".tm-feed",
          { scaleY: 0.012, scaleX: 0.6, filter: "brightness(3)" },
          { scaleY: 1, scaleX: 1, filter: "brightness(1)", duration: 0.55, ease: "expo.out", stagger: 0.18 }
        ).fromTo(
          ".tm-lower > *",
          { xPercent: -110, autoAlpha: 0 },
          { xPercent: 0, autoAlpha: 1, duration: 0.45, ease: "power3.out", stagger: 0.08 },
          "-=0.25"
        );
      });
    },
    { scope: ref }
  );

  return (
    <section ref={ref} data-scene="team" className="relative px-4 py-28 sm:px-8 sm:py-36">
      <SceneTitle kicker={t("anniversary.team.kicker")} title={t("anniversary.team.title")} sub={t("anniversary.team.sub")} color="var(--a-amber)" />

      <ul className="tm-wall mx-auto mt-14 grid max-w-6xl gap-x-6 gap-y-10 sm:grid-cols-3">
        {TEAM.map((person, i) => {
          const initials = person.name
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2);
          return (
            <li key={person.id} className="group">
              <p className="anniv-mono mb-2 flex items-center justify-between text-[11px] uppercase text-[var(--a-mute)]">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-white/25 transition-colors group-hover:bg-[var(--a-tally)]" aria-hidden="true" />
                  CAM {i + 1}
                </span>
                <span className="text-[var(--a-tally)] opacity-0 transition-opacity group-hover:opacity-100">{t("anniversary.team.live")}</span>
              </p>
              <div
                className="tm-feed relative aspect-[4/5] overflow-hidden rounded-sm border border-white/10 transition-[border-color] group-hover:border-[var(--a-tally)]"
                style={{ background: `radial-gradient(circle at 50% 35%, ${person.color}55, #0b0c10 70%)` }}
              >
                {person.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={person.photo} alt={person.name} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                ) : (
                  <span className="anniv-display absolute inset-0 flex items-center justify-center pb-16 text-[7rem] leading-none text-white/90" aria-hidden="true">
                    {initials}
                  </span>
                )}
                <div className="anniv-scanlines opacity-60" />
                {/* Where the feed comes from, like a news locator */}
                <p className="anniv-mono absolute left-3 top-3 bg-black/70 px-2 py-1 text-[10px] uppercase leading-tight text-white/85">
                  {t("anniversary.team.from", { place: person.place })}
                </p>
                <div className="tm-lower absolute inset-x-0 bottom-4 flex flex-col items-start pr-4">
                  <p className="anniv-display bg-[var(--a-ink)] px-3 py-1.5 text-2xl text-[var(--a-bg)] sm:text-[1.7rem]">{person.name}</p>
                  <p className="anniv-mono px-3 py-1 text-[11px] font-semibold uppercase text-white" style={{ background: person.color }}>
                    @{person.handle} · {t(`anniversary.team.role.${person.role}`)}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

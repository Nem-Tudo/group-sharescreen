"use client";

import { useRef } from "react";
import { useT } from "@/lib/useI18n";
import { gsap, ScrollTrigger, useGSAP, MOTION_OK } from "./gsap";
import { Mascot, type MascotMood } from "./Mascot";
import { ROUTE, FOCUS, easeWalk, forwardTimes, keepOnScreen, placeAt, segmentAt, type Box, type Point, type WalkStop } from "./walkRoute";

// Livinho walking along the page (route in walkRoute.ts). Where he is comes
// from the scroll alone; only his legs settle by themselves when the scroll
// stops. With less motion asked for, he stays put in the top-right corner.

/** Pixels walked per radian of the step cycle. */
const STRIDE = 16;
/** How high a foot lifts, in the drawing's units. */
const LIFT = 10;

interface Resolved {
  stop: WalkStop;
  el: Element;
}

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

/** The point `at` of the way along an SVG path, on screen. */
function pointOnPath(el: Element, at: number): Point | undefined {
  if (!(el instanceof SVGPathElement)) return undefined;
  const matrix = el.getScreenCTM();
  if (!matrix) return undefined;
  const p = el.getPointAtLength(at * el.getTotalLength());
  const q = new DOMPoint(p.x, p.y).matrixTransform(matrix);
  return { x: q.x, y: q.y };
}

export function MascotWalker({
  mood,
  speech,
  speechKey,
  visible,
  onPoke,
}: {
  mood: MascotMood;
  speech: string;
  /** A new key says the line again. */
  speechKey: string;
  visible: boolean;
  /** Called on a click; true when that click was the easter egg (he spins). */
  onPoke: () => boolean;
}) {
  const t = useT();
  const walker = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useGSAP(() => {
    const host = walker.current;
    const body = button.current;
    const page = host?.closest(".anniv");
    if (!host || !body || !page) return;

    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      host.dataset.mode = "walk";
      let stops: Resolved[] = [];
      let times: number[] = [];
      let size = { w: body.offsetWidth, h: body.offsetHeight };

      const screen = () => ({ w: document.documentElement.clientWidth, h: window.innerHeight });

      const spot = (r: Resolved): Point => {
        const scr = screen();
        const onPath = r.stop.side === "path" ? pointOnPath(r.el, r.stop.at ?? 0) : undefined;
        return placeAt(r.stop, boxOf(r.el), size, scr, onPath);
      };

      // When each stop is reached, in page scroll. Measured again on every
      // ScrollTrigger refresh (resize, fonts, the numbers landing, a late pin).
      const measure = () => {
        size = { w: body.offsetWidth, h: body.offsetHeight };
        const vh = window.innerHeight;
        const scrollY = window.scrollY;
        const pins = ScrollTrigger.getAll().filter((st) => st.pin);
        const found: Resolved[] = [];
        const at: number[] = [];
        for (const stop of ROUTE) {
          const matches = page.querySelectorAll(stop.el);
          const nth = stop.nth ?? 0;
          const el = matches[nth < 0 ? matches.length + nth : nth];
          if (!el) continue;
          let time: number | null = null;
          if (stop.span) {
            const ref = page.querySelector(stop.span.el) ?? el;
            const r = ref.getBoundingClientRect();
            const top = r.top + scrollY;
            const from = top + stop.span.from[0] * r.height - stop.span.from[1] * vh;
            const to = top + stop.span.to[0] * r.height - stop.span.to[1] * vh;
            time = from + (stop.at ?? 0) * (to - from);
          } else if (stop.through !== undefined) {
            const pin = pins.find((st) => st.pin?.contains(el));
            if (pin) time = pin.start + stop.through * (pin.end - pin.start);
          }
          if (time === null) {
            // When his spot beside the anchor crosses the focus line.
            const p = spot({ stop, el });
            time = scrollY + p.y + size.h / 2 - vh * FOCUS;
          }
          found.push({ stop, el });
          at.push(time);
        }
        stops = found;
        times = forwardTimes(at);
        update();
      };

      // The step: legs, a little hop and lean, eyes towards where he goes.
      // Driven by the distance walked, so it stops when the scroll stops.
      const pose = { l: 0, r: 0, hop: 0, lean: 0, look: 0 };
      const showPose = () => {
        host.style.setProperty("--leg-l", pose.l.toFixed(2));
        host.style.setProperty("--leg-r", pose.r.toFixed(2));
        host.style.setProperty("--hop", `${pose.hop.toFixed(2)}px`);
        host.style.setProperty("--lean", `${pose.lean.toFixed(2)}deg`);
        host.style.setProperty("--look", pose.look.toFixed(2));
      };
      // One tween, restarted from wherever the pose is (a new one per scroll
      // event would pile up in the GSAP context).
      const settle = gsap.to(pose, {
        l: 0,
        r: 0,
        hop: 0,
        lean: 0,
        look: 0,
        duration: 0.3,
        delay: 0.15,
        ease: "power2.out",
        paused: true,
        onUpdate: showPose,
      });
      let last: Point | null = null;
      let walked = 0;
      let say = "";

      const update = () => {
        if (stops.length === 0) return;
        const scr = screen();
        const { from, to, t: progress } = segmentAt(times, window.scrollY);
        const a = keepOnScreen(spot(stops[from]), stops[from].stop.side, size, scr);
        let p = a;
        if (to !== from) {
          const b = keepOnScreen(spot(stops[to]), stops[to].stop.side, size, scr);
          const k = stops[to].stop.steady ? progress : easeWalk(progress);
          p = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        }
        host.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;

        // His line goes on the side with more room.
        const nextSay = p.x + size.w / 2 < scr.w / 2 ? "right" : "left";
        if (nextSay !== say) {
          say = nextSay;
          host.dataset.say = say;
        }

        if (last) {
          const mx = p.x - last.x;
          const my = p.y - last.y;
          const moved = Math.abs(mx) + Math.abs(my) * 0.4;
          if (moved > 0.3) {
            walked += moved;
            const phase = Math.sin(walked / STRIDE);
            const facing = Math.abs(mx) > 0.3 ? Math.sign(mx) : pose.look >= 0 ? 1 : -1;
            settle.pause();
            pose.l = Math.max(0, phase) * LIFT;
            pose.r = Math.max(0, -phase) * LIFT;
            pose.hop = -Math.abs(phase) * 3;
            pose.lean = facing * 5;
            pose.look = facing;
            showPose();
            settle.invalidate().restart(true);
          }
        }
        last = p;
      };

      ScrollTrigger.addEventListener("refresh", measure);
      const tracker = ScrollTrigger.create({ start: 0, end: "max", onUpdate: update });
      measure();

      return () => {
        ScrollTrigger.removeEventListener("refresh", measure);
        tracker.kill();
        settle.kill();
        delete host.dataset.mode;
        delete host.dataset.say;
        host.style.transform = "";
        for (const name of ["--leg-l", "--leg-r", "--hop", "--lean", "--look"]) host.style.removeProperty(name);
      };
    });
  });

  const poke = () => {
    const spin = onPoke();
    if (button.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap
        .timeline()
        .to(button.current, { y: -50, rotate: spin ? 360 : 0, duration: 0.28, ease: "power2.out" })
        .to(button.current, { y: 0, duration: 0.5, ease: "bounce.out" })
        .set(button.current, { rotate: 0 });
    }
  };

  return (
    // data-mode / data-say are set from the effect only, so a re-render never undoes them.
    <div ref={walker} className="anniv-walker">
      <div className={`transition-opacity duration-500 ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <div className="anniv-walker-body">
          <button
            ref={button}
            type="button"
            onClick={poke}
            aria-label={t("anniversary.mascot.label")}
            className={`block w-[50px] cursor-pointer sm:w-[84px] ${visible ? "pointer-events-auto" : "pointer-events-none"}`}
          >
            <Mascot mood={mood} />
          </button>
        </div>
        <p key={speechKey} className="anniv-bubble anniv-bubble-brief anniv-walker-say" role="status">
          {speech}
        </p>
      </div>
    </div>
  );
}

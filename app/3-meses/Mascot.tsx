"use client";

import { useId, type ReactNode } from "react";

// Livinho, the "3 meses" page's mascot: a little screen that is always live.
// Drawn here in SVG so every mood is a few swapped shapes, and the idle motion
// (bobbing, blinking, the REC light) is plain CSS in anniversary.css — GSAP
// only does the one-off jumps.

export type MascotMood = "happy" | "wave" | "think" | "love" | "sweat" | "shock" | "sleep" | "party";

export function Mascot({ mood, className = "" }: { mood: MascotMood; className?: string }) {
  const id = useId().replace(/:/g, "");
  const body = `anniv-body-${id}`;
  const screen = `anniv-screen-${id}`;
  const waving = mood === "wave" || mood === "party";

  return (
    <svg viewBox="-20 -24 160 184" className={`anniv-mascot ${className}`} data-mood={mood} aria-hidden="true">
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="0.55" stopColor="#c026d3" />
          <stop offset="1" stopColor="#fb7185" />
        </linearGradient>
        <radialGradient id={screen} cx="0.35" cy="0.25" r="1">
          <stop offset="0" stopColor="#1e2541" />
          <stop offset="1" stopColor="#090c18" />
        </radialGradient>
      </defs>

      <g className="anniv-mascot-bob">
        {/* Legs */}
        <g fill="#312e81">
          <g className="anniv-mascot-leg-l">
            <rect x="38" y="98" width="10" height="18" rx="5" />
            <ellipse cx="41" cy="117" rx="11" ry="6" />
          </g>
          <g className="anniv-mascot-leg-r">
            <rect x="72" y="98" width="10" height="18" rx="5" />
            <ellipse cx="79" cy="117" rx="11" ry="6" />
          </g>
        </g>

        {/* Left arm (always relaxed) */}
        <g className="anniv-mascot-arm-l">
          <path d="M12 64 Q-4 72 -2 88" stroke="#a5b4fc" strokeWidth="7" strokeLinecap="round" fill="none" />
          <circle cx="-2" cy="90" r="7" fill="#e0e7ff" />
        </g>

        {/* Antenna + REC light */}
        <path d="M60 24 L60 6" stroke="#c7d2fe" strokeWidth="4" strokeLinecap="round" />
        <circle cx="60" cy="4" r="6.5" fill="#f43f5e" className="anniv-mascot-rec" />

        {/* Body */}
        <rect x="8" y="22" width="104" height="82" rx="24" fill={`url(#${body})`} />
        <rect x="8" y="22" width="104" height="82" rx="24" fill="none" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="2" />
        <rect x="19" y="32" width="82" height="58" rx="15" fill={`url(#${screen})`} />
        <path d="M27 38 Q40 34 52 36" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="3" strokeLinecap="round" fill="none" />
        <text x="60" y="100.5" textAnchor="middle" fontSize="7" fontWeight="800" fill="#ffffff" fillOpacity="0.9" letterSpacing="1.5" fontFamily="system-ui, sans-serif">
          LIVE
        </text>

        {/* Face */}
        <Face mood={mood} />

        {/* Right arm: waves on wave/party */}
        <g className={waving ? "anniv-mascot-arm-r anniv-mascot-waving" : "anniv-mascot-arm-r"}>
          <path d={waving ? "M108 62 Q124 52 126 36" : "M108 64 Q124 72 122 88"} stroke="#a5b4fc" strokeWidth="7" strokeLinecap="round" fill="none" />
          <circle cx={waving ? 126 : 122} cy={waving ? 33 : 90} r="7" fill="#e0e7ff" />
        </g>

        {/* Extras */}
        {mood === "party" && (
          <g transform="rotate(-18 34 22)">
            <path d="M22 26 L34 -6 L46 26 Z" fill="#fbbf24" />
            <path d="M26 16 L42 16 M29 8 L39 8" stroke="#f43f5e" strokeWidth="3" />
            <circle cx="34" cy="-8" r="4.5" fill="#34d399" />
          </g>
        )}
        {mood === "sweat" && (
          <path className="anniv-mascot-drop" d="M104 30 Q110 40 104 46 Q98 40 104 30 Z" fill="#7dd3fc" />
        )}
        {mood === "sleep" && (
          <g className="anniv-mascot-zzz" fill="#c7d2fe" fontWeight="900" fontFamily="system-ui, sans-serif">
            <text x="104" y="22" fontSize="14">z</text>
            <text x="114" y="10" fontSize="18">Z</text>
            <text x="126" y="-4" fontSize="22">Z</text>
          </g>
        )}
        {mood === "think" && (
          <text x="112" y="20" fontSize="24" fontWeight="900" fill="#fbbf24" fontFamily="system-ui, sans-serif" className="anniv-mascot-zzz">
            ?
          </text>
        )}
        {mood === "love" && (
          <path className="anniv-mascot-zzz" d="M112 14 C112 8 120 6 122 12 C124 6 132 8 132 14 C132 20 122 26 122 26 C122 26 112 20 112 14 Z" fill="#fb7185" />
        )}
      </g>
    </svg>
  );
}

function Face({ mood }: { mood: MascotMood }) {
  const eye = "#7dd3fc";
  let eyes: ReactNode;
  let mouth: ReactNode;

  switch (mood) {
    case "shock":
      eyes = (
        <>
          <circle cx="44" cy="56" r="10" fill="#ffffff" />
          <circle cx="76" cy="56" r="10" fill="#ffffff" />
          <circle cx="44" cy="57" r="4" fill="#0f172a" />
          <circle cx="76" cy="57" r="4" fill="#0f172a" />
        </>
      );
      mouth = <ellipse cx="60" cy="78" rx="6" ry="7" fill="#fb7185" />;
      break;
    case "sleep":
      eyes = (
        <>
          <path d="M36 58 Q44 64 52 58" stroke={eye} strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M68 58 Q76 64 84 58" stroke={eye} strokeWidth="4" strokeLinecap="round" fill="none" />
        </>
      );
      mouth = <ellipse cx="60" cy="76" rx="4" ry="3" fill="#fb7185" opacity="0.8" />;
      break;
    case "love":
      eyes = (
        <>
          <path d="M37 54 C37 49 43 48 44 52 C45 48 51 49 51 54 C51 59 44 63 44 63 C44 63 37 59 37 54 Z" fill="#fb7185" />
          <path d="M69 54 C69 49 75 48 76 52 C77 48 83 49 83 54 C83 59 76 63 76 63 C76 63 69 59 69 54 Z" fill="#fb7185" />
        </>
      );
      mouth = <path d="M50 72 Q60 82 70 72" stroke="#fda4af" strokeWidth="4" strokeLinecap="round" fill="none" />;
      break;
    case "sweat":
      eyes = (
        <>
          <ellipse className="anniv-mascot-eye" cx="44" cy="56" rx="5.5" ry="7.5" fill={eye} />
          <ellipse className="anniv-mascot-eye" cx="76" cy="56" rx="5.5" ry="7.5" fill={eye} />
          <path d="M36 44 L50 48 M84 44 L70 48" stroke={eye} strokeWidth="3" strokeLinecap="round" />
        </>
      );
      mouth = (
        <path d="M46 78 Q50 74 54 78 Q58 82 62 78 Q66 74 70 78 Q74 82 76 78" stroke="#fda4af" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      );
      break;
    case "party":
    case "happy":
      eyes = (
        <>
          <path d="M36 60 Q44 50 52 60" stroke={eye} strokeWidth="4.5" strokeLinecap="round" fill="none" />
          <path d="M68 60 Q76 50 84 60" stroke={eye} strokeWidth="4.5" strokeLinecap="round" fill="none" />
        </>
      );
      mouth = <path d="M47 70 Q60 86 73 70 Z" fill="#fb7185" stroke="#fda4af" strokeWidth="2" strokeLinejoin="round" />;
      break;
    case "think":
      eyes = (
        <>
          <ellipse className="anniv-mascot-eye" cx="46" cy="54" rx="5.5" ry="7.5" fill={eye} />
          <ellipse className="anniv-mascot-eye" cx="78" cy="54" rx="5.5" ry="7.5" fill={eye} />
        </>
      );
      mouth = <path d="M52 76 L68 74" stroke="#fda4af" strokeWidth="4" strokeLinecap="round" />;
      break;
    default:
      eyes = (
        <>
          <ellipse className="anniv-mascot-eye" cx="44" cy="56" rx="5.5" ry="7.5" fill={eye} />
          <ellipse className="anniv-mascot-eye" cx="76" cy="56" rx="5.5" ry="7.5" fill={eye} />
        </>
      );
      mouth = <path d="M50 72 Q60 82 70 72" stroke="#fda4af" strokeWidth="4" strokeLinecap="round" fill="none" />;
  }

  return (
    <g className="anniv-mascot-face">
      {eyes}
      <circle cx="31" cy="72" r="5" fill="#fb7185" opacity="0.45" />
      <circle cx="89" cy="72" r="5" fill="#fb7185" opacity="0.45" />
      {mouth}
    </g>
  );
}

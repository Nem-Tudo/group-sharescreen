// The face on a payment's confirmation: somebody delighted, in a party hat.
//
// Drawn rather than an image, for the same reasons as PlanBand. The white edge
// makes it a sticker, because it has to stand out on all three plan colours,
// one of which is about the same yellow as the face.
//
// Moved by .golive-happy-art and .golive-happy-bit in globals.css.

const BITS = [
  { x: 14, y: 40, width: 7, height: 12, rotate: -24, fill: "#ffffff" },
  { x: 100, y: 28, width: 7, height: 12, rotate: 28, fill: "#ffffff" },
  { x: 8, y: 84, width: 6, height: 10, rotate: 18, fill: "#a7f3d0" },
  { x: 107, y: 78, width: 6, height: 10, rotate: -32, fill: "#fbcfe8" },
  { x: 25, y: 16, width: 6, height: 10, rotate: 40, fill: "#fbcfe8" },
  { x: 90, y: 104, width: 6, height: 10, rotate: 52, fill: "#a7f3d0" },
];

export function PurchaseHappyArt({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 120 120" className={className}>
      <defs>
        <linearGradient id="golive-happy-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe873" />
          <stop offset="1" stopColor="#ffb300" />
        </linearGradient>
      </defs>

      {BITS.map((bit, index) => (
        <rect
          key={index}
          className="golive-happy-bit"
          style={{ animationDelay: `${index * 0.22}s` }}
          x={bit.x}
          y={bit.y}
          width={bit.width}
          height={bit.height}
          rx="1.5"
          fill={bit.fill}
          transform={`rotate(${bit.rotate} ${bit.x + bit.width / 2} ${bit.y + bit.height / 2})`}
        />
      ))}

      <g className="golive-happy-art">
        {/* The sticker's edge, behind the head and the hat alike. */}
        <circle cx="60" cy="72" r="39" fill="#ffffff" />
        <path
          d="M60 7 L82 44 L38 44 Z"
          fill="#ffffff"
          stroke="#ffffff"
          strokeWidth="9"
          strokeLinejoin="round"
          transform="rotate(12 60 44)"
        />

        <circle cx="60" cy="72" r="34" fill="url(#golive-happy-face)" />

        {/* The hat, tipped: a party, not a uniform. */}
        <g transform="rotate(12 60 44)">
          <path d="M60 9 L80 44 L40 44 Z" fill="#ec4899" />
          <path d="M53.4 20.5 L66.6 20.5 L71.2 28.6 L48.8 28.6 Z" fill="#fde047" />
          <path d="M44.6 36 L75.4 36 L80 44 L40 44 Z" fill="#22d3ee" />
          <circle cx="60" cy="9" r="6" fill="#fde047" stroke="#ffffff" strokeWidth="2.5" />
        </g>

        {/* Eyes shut with joy. */}
        <path d="M40 69 Q47 59 54 69" fill="none" stroke="#5b3300" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M66 69 Q73 59 80 69" fill="none" stroke="#5b3300" strokeWidth="4.5" strokeLinecap="round" />

        <ellipse cx="36" cy="79" rx="6.5" ry="4.5" fill="#fb7185" opacity="0.6" />
        <ellipse cx="84" cy="79" rx="6.5" ry="4.5" fill="#fb7185" opacity="0.6" />

        {/* The grin: mouth, then tongue, then teeth on top of both. */}
        <path d="M42 76 Q60 72 78 76 Q75 99 60 99 Q45 99 42 76 Z" fill="#7a2410" />
        <ellipse cx="60" cy="93" rx="10.5" ry="6.5" fill="#fb7185" />
        <path d="M42 76 Q60 72 78 76 Q77.4 80.5 76.3 83 Q60 79.5 43.7 83 Q42.6 80.5 42 76 Z" fill="#ffffff" />
      </g>
    </svg>
  );
}

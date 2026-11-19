// The personal recap's "fun" side, kept apart from React so it can be tested:
// which everyday comparison fits a number of hours, and which GoLive "style"
// a person's figures add up to. Texts are picked by key in the page
// (locales: anniversary.recap.*).

export interface Comparison {
  /** The text key under anniversary.recap.cmp.* */
  key: string;
  /** How many of that thing — always at least 1 when a comparison is returned. */
  n: number;
}

interface Unit {
  key: string;
  /** How long one of them lasts, in hours. */
  hours: number;
}

/** Biggest unit first: the first one the time fills at least once wins. */
const CALL_UNITS: Unit[] = [
  { key: "flights", hours: 10 }, // São Paulo → Lisbon
  { key: "matches", hours: 1.5 }, // a football match
  { key: "episodes", hours: 0.75 }, // a series episode
  { key: "songs", hours: 3.5 / 60 },
];
const SHARE_UNITS: Unit[] = [
  { key: "movies", hours: 2 },
  { key: "games", hours: 0.5 }, // a 30-minute match of something
  { key: "songs", hours: 3.5 / 60 },
];
const MIC_UNITS: Unit[] = [
  { key: "podcasts", hours: 1 },
  { key: "songs", hours: 3.5 / 60 },
];

function compare(hours: number, units: Unit[]): Comparison | null {
  if (!(hours > 0)) return null;
  for (const unit of units) {
    const n = Math.floor(hours / unit.hours);
    if (n >= 1) return { key: unit.key, n };
  }
  return null;
}

export const compareCall = (hours: number) => compare(hours, CALL_UNITS);
export const compareShare = (hours: number) => compare(hours, SHARE_UNITS);
export const compareMic = (hours: number) => compare(hours, MIC_UNITS);

/** "Typing one message a minute, that is N hours of typing." Whole hours, or null under one. */
export function typingHours(messages: number): number | null {
  const hours = Math.floor(messages / 60);
  return hours >= 1 ? hours : null;
}

export type RecapStyle = "streamer" | "talker" | "listener" | "typist" | "starter";

/**
 * The one style a person's numbers lean to the most, each measured in hours
 * so they compare: screen sharing, talking, listening (time in calls with the
 * mic off) and typing (a message a minute). Under half an hour of everything
 * is "just starting".
 */
export function recapStyle(figures: {
  callHours: number;
  shareHours: number;
  micHours: number;
  messages: number;
}): RecapStyle {
  const scores: [RecapStyle, number][] = [
    ["streamer", figures.shareHours],
    ["talker", figures.micHours],
    ["listener", Math.max(0, figures.callHours - figures.micHours) * 0.8],
    ["typist", figures.messages / 60],
  ];
  let best: [RecapStyle, number] = ["starter", 0.5];
  for (const score of scores) if (score[1] > best[1]) best = score;
  return best[0];
}

/** Share of accounts made after this one (0–100, whole): "you got here before X% of people". */
export function earlierThanPercent(accountNumber: number, total: number): number {
  if (total <= 1 || accountNumber < 1) return 0;
  return Math.max(0, Math.floor(((total - accountNumber) / total) * 100));
}

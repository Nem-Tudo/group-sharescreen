// Everything on the "3 meses" page that is not read from the API: dates and
// figures taken from the git history of the seven repositories (first commit
// 2026-08-17 21:30 BRT) and from what the team remembers. Texts live in
// locales/*.json under `anniversary.*`; this file holds keys, dates and numbers.

/** The first line of code. */
export const FIRST_COMMIT_AT = "2026-08-17T21:30:00-03:00";

/** The "first 72 hours", told as a chat log. `at` is shown as written. */
export const FIRST_HOURS: { at: string; key: string; tag?: "pr" | "live" }[] = [
  { at: "17/08 21:30", key: "h01" },
  { at: "17/08 21:49", key: "h02" },
  { at: "17/08 22:54", key: "h03" },
  { at: "18/08 00:20", key: "h04", tag: "live" },
  { at: "18/08 01:13", key: "h05" },
  { at: "18/08 03:58", key: "h06" },
  { at: "18/08 12:31", key: "h07" },
  { at: "18/08 13:04", key: "h08" },
  { at: "18/08 21:53", key: "h09", tag: "pr" },
  { at: "19/08 01:00", key: "h10", tag: "pr" },
  { at: "19/08 03:48", key: "h11" },
  { at: "19/08 15:07", key: "h12", tag: "live" },
];

/** Placement on the sign-up curve: the day, as days after FIRST day (17/08). */
export interface Milestone {
  date: string; // "MM-DD", 2026
  key: string;
  emoji: string;
  /** Pinned on the sign-up curve too. */
  pin?: boolean;
}

export const TIMELINE: Milestone[] = [
  { date: "08-17", key: "firstCommit", emoji: "🐣" },
  { date: "08-18", key: "chat", emoji: "💬" },
  { date: "08-18", key: "noise", emoji: "🎧" },
  { date: "08-19", key: "accounts", emoji: "🪪" },
  { date: "08-23", key: "watchTogether", emoji: "🍿" },
  { date: "08-25", key: "desktop", emoji: "🖥️", pin: true },
  { date: "08-26", key: "worldmap", emoji: "🗺️" },
  { date: "08-31", key: "android", emoji: "🤖" },
  { date: "09-02", key: "pro", emoji: "💎", pin: true },
  { date: "09-03", key: "friends", emoji: "🤝" },
  { date: "09-08", key: "calls", emoji: "📞" },
  { date: "09-10", key: "themes", emoji: "🎨" },
  { date: "09-11", key: "groups", emoji: "🏰", pin: true },
  { date: "09-12", key: "bots", emoji: "🤖", pin: true },
  { date: "09-18", key: "clips", emoji: "🎬" },
  { date: "09-24", key: "transcripts", emoji: "🌎" },
  { date: "10-02", key: "tools", emoji: "🧰" },
  { date: "10-14", key: "msstore", emoji: "🪟", pin: true },
  { date: "10-17", key: "events", emoji: "🏙️", pin: true },
  { date: "10-27", key: "effects", emoji: "🪄" },
  { date: "10-31", key: "discord", emoji: "🎮" },
  { date: "10-31", key: "rename", emoji: "🔤" },
  { date: "11-14", key: "remote", emoji: "🕹️", pin: true },
  { date: "11-17", key: "comments", emoji: "📝" },
];

/** Commits per ISO week, sharescreen + sharescreen-api. W34 starts Mon 17/08. */
export const COMMITS_PER_WEEK: { week: string; commits: number }[] = [
  { week: "17/08", commits: 241 },
  { week: "24/08", commits: 166 },
  { week: "31/08", commits: 166 },
  { week: "07/09", commits: 338 },
  { week: "14/09", commits: 362 },
  { week: "21/09", commits: 80 },
  { week: "28/09", commits: 52 },
  { week: "05/10", commits: 4 },
  { week: "12/10", commits: 56 },
  { week: "19/10", commits: 29 },
  { week: "26/10", commits: 175 },
  { week: "02/11", commits: 19 },
  { week: "09/11", commits: 82 },
  { week: "16/11", commits: 92 },
];

export const DEV_STATS = {
  commits: 2043,
  repos: 7,
  lateNightPercent: 48,
  peakHourCommits: 204,
  morningCommits: 6,
  busiestDay: "31/10",
  busiestDayCommits: 89,
  linesOfCode: 390_000,
  desktopFrom: "1.0.12",
  desktopTo: "1.1.12",
};

/** Hard figures that the database never kept. */
export const HARD_FIGURES = {
  /** 20/08: people reconnecting at once when the API would not come back up. */
  reconnecting: 2000,
  /** Most WebSocket connections held at once, as of 19/11. The API keeps the live one (anniversaryPeak.ts); this is the fallback. */
  sockets: 14302,
};

/**
 * The team ("Nossa equipe"). `photo` is a path under public/ (e.g.
 * "/aniversario/equipe/nemtudo.jpg"); null shows the initials instead.
 */
export const TEAM: { id: string; name: string; handle: string; role: "ceo" | "dev" | "support"; place: string; color: string; photo: string | null }[] = [
  { id: "nemtudo", name: "Gustavo Felipe", handle: "NemTudo", role: "ceo", place: "Santa Rita do Sapucaí, Minas Gerais", color: "#ff3b2f", photo: "/aniversario/equipe/nemtudo.jpg" },
  { id: "commandbat", name: "Tiago", handle: "Commandbat", role: "dev", place: "São José do Rio Preto, São Paulo", color: "#4c86ff", photo: "/aniversario/equipe/commandbat.jpg" },
  { id: "g4buh", name: "Gabriela", handle: "G4buh", role: "support", place: "Porto, Portugal", color: "#2fbf71", photo: "/aniversario/equipe/g4buh.jpg" },
  { id: "aeeryin", name: "Izzabella", handle: "Aeeryin", role: "support", place: "Içara, Santa Catarina", color: "#a855f7", photo: null },
];

/** The bug wall. `date` is shown as written. */
export const BUGS: { date: string; key: string; emoji: string; commit?: string }[] = [
  { date: "31/08", key: "electron3x", emoji: "🔁", commit: "fix: electron loading 3 times" },
  { date: "14/09", key: "deploy5x", emoji: "🚀", commit: "fix deploy (x5)" },
  { date: "14/09", key: "antivirus", emoji: "🛡️", commit: "fix: antivirus" },
  { date: "29/09", key: "grayScreen", emoji: "🌫️", commit: "fix: gray screen" },
  { date: "23/10", key: "memoryLeak", emoji: "🧠", commit: "fix: memory leak (se funcionar)" },
  { date: "29/10", key: "flippedCam", emoji: "🙃", commit: "fix camera rotation in effect" },
  { date: "31/10", key: "sixReleases", emoji: "📦", commit: "1.0.22 → 1.0.28" },
  { date: "04/11", key: "ghostLeave", emoji: "👻", commit: "fix: socket lost connection" },
  { date: "19/11", key: "micTwice", emoji: "🎙️", commit: "Never open the microphone twice while it is still starting" },
  { date: "19/11", key: "freePro", emoji: "💸" },
];

/** Day index (0 = 17/08) of a "MM-DD" date in 2026. */
export function dayIndex(date: string): number {
  const start = Date.UTC(2026, 7, 17);
  const [month, day] = date.split("-").map(Number);
  return Math.round((Date.UTC(2026, month - 1, day) - start) / 86_400_000);
}

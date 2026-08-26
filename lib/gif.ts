export type GifResult = {
  id: string;
  title: string;
  previewUrl: string;
  previewWidth: number;
  previewHeight: number;
  url: string;
  width: number;
  height: number;
};

const RECENT_GIFS_KEY = "sharescreen:recentGifs";
const MAX_RECENT = 12;

export function getRecentGifs(): GifResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_GIFS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addRecentGif(gif: GifResult): void {
  if (typeof window === "undefined") return;
  try {
    const current = getRecentGifs().filter((g) => g.id !== gif.id);
    current.unshift(gif);
    localStorage.setItem(RECENT_GIFS_KEY, JSON.stringify(current.slice(0, MAX_RECENT)));
  } catch {}
}

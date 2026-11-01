// Whether this browser is new to GoLive — what decides that the blue "NOVO"
// badges and tips stay quiet (everything is new to somebody who just
// arrived) and that the room tour is due.
//
// Decided by NEWCOMER_INIT_SCRIPT, inline in app/layout.tsx, before any
// bundle runs. It used to be read at module evaluation (sharescreen:deviceId
// or sharescreen:features already there?), but Next loads client chunks as
// they stream in: a component in an earlier chunk had already minted the
// device id by the time lib/roomTour and lib/clipsMode were evaluated, so a
// brand-new browser looked like a returning one — tour marked "done" before
// it could start, and tips shown to people who had never been here.

const FIRST_VISIT_KEY = "sharescreen:firstVisit";
const ROOM_TOUR_KEY = "sharescreen:roomTour";

/** How long a browser counts as new: what it met in this window was never news to it. */
export const NEWCOMER_MS = 7 * 24 * 60 * 60 * 1000;

// A browser with anything of ours in storage was here before this key
// existed: "0", never a newcomer. Otherwise this is its first page, and the
// room tour becomes due.
export const NEWCOMER_INIT_SCRIPT = `(function(){try{var s=localStorage,k=${JSON.stringify(
  FIRST_VISIT_KEY
)};if(s.getItem(k)!==null)return;var old=false;for(var i=0;i<s.length;i++){var n=s.key(i);if(n&&n.indexOf("sharescreen:")===0){old=true;break;}}s.setItem(k,old?"0":String(Date.now()));if(!old)s.setItem(${JSON.stringify(
  ROOM_TOUR_KEY
)},"pending");}catch(e){}})();`;

let cached: number | null = null;

/** When this browser first opened GoLive; 0 when it predates the record. */
function firstVisit(): number {
  if (cached !== null) return cached;
  let value = 0;
  try {
    const raw = window.localStorage.getItem(FIRST_VISIT_KEY);
    // Missing means storage refused the script's write: nothing here can be
    // remembered anyway, so behave as before rather than hide everything.
    value = raw === null ? 0 : Number(raw) || 0;
  } catch {
    value = 0;
  }
  cached = value;
  return value;
}

/** Whether this browser first opened GoLive before `time`. False on the server. */
export function arrivedBefore(time: number): boolean {
  if (typeof window === "undefined") return false;
  return firstVisit() < time;
}

/** Whether this browser arrived within the last NEWCOMER_MS. False on the server. */
export function isNewcomer(): boolean {
  if (typeof window === "undefined") return false;
  const first = firstVisit();
  return first > 0 && Date.now() - first < NEWCOMER_MS;
}

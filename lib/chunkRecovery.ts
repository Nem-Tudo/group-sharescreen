// Recovery for a JavaScript bundle chunk that fails to load.
//
// The failure this exists for, observed in production under load:
//
//   GET /_next/static/chunks/2uxphilh3g1fz.js  ->  408, body: text/html
//   Refused to execute script ... MIME type ('text/html') is not executable
//
// One chunk answered with an error page instead of JavaScript. Nothing else is
// wrong — the HTML arrives, the CSS applies, the page paints — but React never
// hydrates, so no effect ever runs: no API call, no connection, no button, no
// state. The page just sits there looking like it is loading forever. Every
// recovery affordance the app has is itself built out of effects, which is
// exactly what a hydration failure takes away, so nothing in the React tree can
// possibly help here.
//
// This runs as a plain inline <script> in the document instead, the same way
// THEME_INIT_SCRIPT does and for the same reason: it has to work when none of
// the bundle does.
//
// It is deliberately NOT a general "page looks stuck, reload it" watchdog. It
// fires only on a script element that actually failed, because the cause is
// usually an origin under strain — and a timer that reloads on suspicion would
// have thousands of clients hammering a server that is already struggling,
// which is how a slow site becomes a down one.

// Attempts are counted in sessionStorage so a genuinely broken deploy cannot
// turn this into a reload loop. Two is enough for a transient hiccup; past
// that the page renders as it is, and the manual "recarregar" link on the
// landing page (revealed by CSS, so it survives the same failure) takes over.
const MAX_ATTEMPTS = 2;
// Attempts older than this are forgotten, so a failure today does not spend
// the budget for one next week.
const ATTEMPT_WINDOW_MS = 60_000;
// Reload after a short, randomised delay. The randomisation is the important
// half: a chunk 408 under load hits many clients at once, and reloading them
// all on the same tick is a synchronised retry storm against the exact server
// that just failed to answer.
const RETRY_MIN_MS = 500;
const RETRY_SPREAD_MS = 2500;

const STORAGE_KEY = "sharescreen:chunkReload";

// ES5, no imports, no optional chaining: this is inlined into the document and
// runs before anything has been transpiled or loaded on its behalf.
export const CHUNK_RECOVERY_SCRIPT = `(function(){try{
var K=${JSON.stringify(STORAGE_KEY)},MAX=${MAX_ATTEMPTS},W=${ATTEMPT_WINDOW_MS};
var fired=false;
window.addEventListener("error",function(e){
var el=e&&e.target;
if(fired||!el||el.tagName!=="SCRIPT")return;
var src=el.src||"";
if(src.indexOf("/_next/static/")===-1)return;
fired=true;
var n=0,at=0;
try{var raw=sessionStorage.getItem(K);if(raw){var p=JSON.parse(raw);n=p.n||0;at=p.at||0;}}catch(x){}
var now=Date.now();
if(now-at>W)n=0;
if(n>=MAX)return;
try{sessionStorage.setItem(K,JSON.stringify({n:n+1,at:now}));}catch(x){}
setTimeout(function(){location.reload();},${RETRY_MIN_MS}+Math.random()*${RETRY_SPREAD_MS});
},true);
}catch(e){}})();`;

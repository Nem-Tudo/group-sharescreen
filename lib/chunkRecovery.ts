// Recovery for a JavaScript bundle chunk that fails to load.
//
// The failure this exists for, observed in production under load:
//
//   GET /_next/static/chunks/2uxphilh3g1fz.js  ->  408, body: text/html
//   Refused to execute script ... MIME type ('text/html') is not executable
//
// and, during a deploy (2026-11-15):
//
//   GET /_next/static/chunks/3bhablnesy2eo.js  ->  503, body: application/json
//
// The second one is the frontend's two instances (see deploy.yml): they are
// rebuilt one after the other, and while one is building — minutes, not
// seconds — the load balancer still sends it a share of the requests, which
// Square Cloud answers with a 503 in JSON. The HTML came from the instance
// that was up; some of its chunks went to the one that was not.
//
// One chunk answered with an error page instead of JavaScript. Nothing else is
// wrong — the HTML arrives, the CSS applies, the page paints — but React never
// hydrates, so no effect ever runs: no API call, no connection, no button, no
// state. The page just sits there on its loading skeleton forever. Every
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
// turn this into an endless reload loop. It used to give up after two quick
// tries, which a hiccup survives but a deploy does not: both reloads landed in
// the minutes one instance spends rebuilding, and the page stayed on its
// skeleton for good. Now the waits grow — a couple of seconds at first, a
// minute at the end — which together cover a deploy (about four minutes), and
// stay gentle on a server that is struggling: the later a retry, the rarer.
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 45_000, 60_000, 60_000];
// Attempts older than this are forgotten, so a failure today does not spend
// the budget for one next week.
const ATTEMPT_WINDOW_MS = 15 * 60_000;
// Each wait is spread by up to this much either way. The spread is the
// important half: a failing chunk hits many clients at once, and reloading
// them all on the same tick is a synchronised retry storm against the exact
// server that just failed to answer.
const RETRY_JITTER = 0.3;

const STORAGE_KEY = "sharescreen:chunkReload";

// ES5, no imports, no optional chaining: this is inlined into the document and
// runs before anything has been transpiled or loaded on its behalf.
//
// While it waits it says so, in a small line at the bottom of the screen —
// otherwise a minute-long wait looks exactly like the stuck page it is
// fixing. Plain DOM and inline styles, for the same reason as the rest.
export const CHUNK_RECOVERY_SCRIPT = `(function(){try{
var K=${JSON.stringify(STORAGE_KEY)},D=${JSON.stringify(RETRY_DELAYS_MS)},W=${ATTEMPT_WINDOW_MS},J=${RETRY_JITTER};
var fired=false;
function say(ms){try{
var l=(navigator.language||"pt").slice(0,2);
var s=Math.max(1,Math.round(ms/1000));
var t=l==="en"?"Go Live is updating — trying again in "+s+" s":l==="es"?"Go Live se está actualizando — reintentando en "+s+" s":"O Go Live está atualizando — tentando de novo em "+s+" s";
var d=document.createElement("div");
d.setAttribute("role","status");
d.textContent=t;
d.style.cssText="position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:999px;background:rgba(24,24,27,.92);color:#fafafa;font:500 13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35)";
(document.body||document.documentElement).appendChild(d);
}catch(x){}}
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
if(n>=D.length)return;
try{sessionStorage.setItem(K,JSON.stringify({n:n+1,at:now}));}catch(x){}
var wait=D[n]*(1-J+Math.random()*2*J);
say(wait);
setTimeout(function(){location.reload();},wait);
},true);
}catch(e){}})();`;

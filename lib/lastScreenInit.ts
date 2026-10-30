// The rules lib/lastScreen.ts reopens the app by, kept out of that module
// because it is "use client" and app/layout.tsx (a server component) needs the
// inline script below as a plain string.

export const LAST_SCREEN_STORAGE_KEY = "golive:lastScreen";
export const LAST_SCREEN_SESSION_KEY = "golive:lastScreenRestored";
// This device's choice, set on /me. On unless turned off.
export const REOPEN_LAST_SCREEN_KEY = "golive:reopenLastScreen";

// Addresses that join something, or only exist to hand a result over and move
// on (a login callback, a claim link), and so must not be the first thing a
// launch opens.
export const NEVER_RESTORE = [
  "/watch/",
  "/stream/",
  "/obs/",
  "/cam/",
  "/oauth",
  "/oauth2",
  "/desktop/",
  "/invite/",
  "/gift/",
  "/ads",
  "/ad/",
  "/download",
];

// The same decision as takeScreenToRestore, taken before the home page paints
// or hydrates. Done from an effect, a launch drew the whole home page, ran it,
// and only then moved to the screen it was going to show all along. Here the
// home page is hidden and left while it is still being parsed.
//
// Shell detection without the bundle: Electron's preload defines window.golive
// before any page script, and Capacitor injects its bridge into <head> on
// Android. The page stays hidden for at most a few seconds, in case the
// navigation never happens.
export const LAST_SCREEN_INIT_SCRIPT = `(function(){try{var w=window,C=w.Capacitor;if(!w.golive&&!(C&&C.getPlatform&&C.getPlatform()==="android"))return;var ss=sessionStorage,ls=localStorage;if(ss.getItem(${JSON.stringify(
  LAST_SCREEN_SESSION_KEY
)}))return;ss.setItem(${JSON.stringify(LAST_SCREEN_SESSION_KEY)},"1");if(ls.getItem(${JSON.stringify(
  REOPEN_LAST_SCREEN_KEY
)})==="0")return;var l=w.location;if(l.pathname!=="/"||l.search||l.hash)return;var p=ls.getItem(${JSON.stringify(
  LAST_SCREEN_STORAGE_KEY
)});if(!p||p==="/"||p.charAt(0)!=="/"||p.charAt(1)==="/")return;var n=p.split(/[?#]/)[0],b=${JSON.stringify(
  NEVER_RESTORE
)};for(var i=0;i<b.length;i++){if(n===b[i].replace(/\\/$/,"")||n.indexOf(b[i])===0)return;}var d=document.documentElement;d.style.visibility="hidden";setTimeout(function(){d.style.visibility="";},4000);l.replace(p);}catch(e){}})();`;

// Stops iOS from zooming the whole page in when a text box is focused.
//
// Mobile Safari zooms to any field whose text is smaller than 16px, so that
// what you type is legible — a rule written for desktop sites opened on a
// phone. On an app-shaped layout it is the wrong call: the page comes back
// zoomed and scrolled, the header and the composer are off-screen, and
// closing the keyboard does not always undo it. GoLive's own layout already
// sizes its text for a phone, so there is nothing to rescue.
//
// The fix is `maximum-scale=1` on the viewport, which is only added on iOS —
// on Android the same value would disable pinch-zoom outright, and there is
// no problem there to be worth that. On iOS 10 and later pinch-zoom is
// explicitly *not* affected: WebKit stopped letting a page block the user's
// own gesture, while still honouring the limit for the zoom it performs by
// itself. So this takes away the automatic zoom and leaves the deliberate
// one, which is the whole intent.
//
// Runs as an inline script for the same reason THEME_INIT_SCRIPT does: the
// meta tag has to be right before the first field is ever focused, and that
// can happen before React has hydrated. Written as plain ES5 for the same
// reason — no bundle exists yet when it runs.
//
// It edits the tag Next renders from app/layout.tsx's `viewport` export
// rather than replacing it, so `interactiveWidget` and anything added there
// later survive.
export const IOS_VIEWPORT_SCRIPT = `(function(){try{var n=navigator;var ua=n.userAgent||"";var ios=/iphone|ipad|ipod/i.test(ua)||(/Macintosh/.test(ua)&&n.maxTouchPoints>1);if(!ios)return;var m=document.querySelector('meta[name="viewport"]');if(!m)return;var c=m.getAttribute("content")||"";if(/maximum-scale/.test(c))return;m.setAttribute("content",c+(c?",":"")+"maximum-scale=1");}catch(e){}})();`;

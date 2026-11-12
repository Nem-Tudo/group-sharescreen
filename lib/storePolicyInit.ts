// Inline, before the first paint: marks <html data-app-shell="ios"> inside the
// iOS app so CSS can hide everything marked data-sells (app/globals.css)
// before React exists. See lib/storePolicy.ts for why the iOS app sells
// nothing. Kept apart from that file because the root layout, a server
// component, has to import this string.
export const STORE_POLICY_INIT_SCRIPT = `(function(){try{var C=window.Capacitor,ios=(C&&C.getPlatform&&C.getPlatform()==="ios")||/GoLiveApp\\/ios/.test(navigator.userAgent||"");if(ios)document.documentElement.setAttribute("data-app-shell","ios");}catch(e){}})();`;

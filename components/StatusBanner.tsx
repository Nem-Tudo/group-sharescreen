"use client";

import { usePathname } from "next/navigation";
import { MdErrorOutline } from "react-icons/md";
import { useSiteStatus } from "@/lib/siteStatus";

// "O site está instável agora" — above everything, red, and with no way to
// close it.
//
// It sits above the announcement bar on purpose. That one is whatever the
// admin wants to say today; this one is the reason nothing is working, and if
// both are up the second question is only worth reading after the first is
// answered.
//
// No dismiss control, and that is the whole design: an outage is not news the
// reader is done with after seeing it once. Every refusal they are about to
// hit for the next hour — a room that will not open, a login that hangs — is
// explained by this sentence, and a bar they closed at the start of it would
// leave them debugging their own wifi instead. It costs nothing when there is
// no outage, because then it renders nothing at all.
export function StatusBanner() {
  const status = useSiteStatus();
  const pathname = usePathname();

  // Same exclusion the announcement bar makes, for a much sharper reason: a
  // browser source is somebody's livestream, and a red bar across the top of
  // it would be burned into their recording — in front of an audience that
  // cannot act on it anyway.
  if (pathname?.startsWith("/stream") || pathname?.startsWith("/obs")) return null;
  if (!status.apiError) return null;

  return (
    <div
      // A live region: this appears without anybody doing anything, and on a
      // screen reader an unannounced change to the top of the page is a change
      // nobody hears. "assertive" because it is the reason their next action
      // is going to fail.
      role="alert"
      aria-live="assertive"
      className="flex items-center justify-between gap-3 bg-red-600 px-4 py-2.5 text-sm font-medium text-white"
    >
      <p className="flex min-w-0 flex-1 items-center gap-2 break-words">
        <MdErrorOutline className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{status.message}</span>
      </p>
      {status.button && (
        <a
          href={status.button.href}
          // Both attributes, not just the first: `noopener` is what keeps the
          // opened page from reaching back through window.opener, and this
          // href comes from a file rather than from our own code.
          {...(status.button.newTab
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          className="shrink-0 rounded-md border border-white/70 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10"
        >
          {status.button.label}
        </a>
      )}
    </div>
  );
}

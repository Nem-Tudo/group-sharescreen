"use client";

import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { useGroupNavigation } from "@/lib/groupNavigation";

/**
 * A link to somewhere under /groups that gets there without a server round
 * trip — see lib/groupNavigation. A real `<a href>`, so everything a link does
 * still works: middle-click, Ctrl/⌘-click and "open in new tab" go to the
 * browser as usual, and only a plain click is taken over.
 *
 * Deliberately not next/link: its prefetch would ask the server for the very
 * payload this exists to never wait for.
 */
export function GroupLink({
  href,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const navigation = useGroupNavigation();
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    e.preventDefault();
    navigation.push(href);
  }
  return <a href={href} onClick={handleClick} {...rest} />;
}

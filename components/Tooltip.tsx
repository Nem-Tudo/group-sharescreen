"use client";

import Tippy from "@tippyjs/react";
import type { TippyProps } from "@tippyjs/react";
import {
  cloneElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";

import "tippy.js/dist/tippy.css";
import "tippy.js/animations/shift-away.css";

// The two @tippyjs/react wrappers every hint and every click-opened panel in
// the app goes through — `Tooltip` for the hover/focus bubble that used to be
// a native `title` attribute, `Popover` for the dropdowns and pickers that
// used to be a hand-rolled `absolute` panel plus a full-screen click catcher.
//
// Both render into a portal on <body>, so a panel opened from inside a
// scrolling column (the chat box, the participants drawer) is no longer
// clipped by it, and both flip/shift themselves to stay on screen instead of
// running off the edge on a phone. The look lives in globals.css as the
// "golive" (bubble) and "golive-panel" (transparent shell) tippy themes.

type Placement = NonNullable<TippyProps["placement"]>;

export function Tooltip({
  content,
  children,
  placement = "top",
  delay = [200, 0],
  interactive = false,
  wrapperClassName,
}: {
  // Falsy content renders the trigger untouched — mirrors how a conditional
  // `title={cond ? "..." : undefined}` used to simply not show anything.
  content: ReactNode;
  children: ReactElement;
  placement?: Placement;
  delay?: TippyProps["delay"];
  // Lets the bubble itself be hovered — only needed when it holds a link.
  interactive?: boolean;
  // Set to wrap the trigger in a span before handing it to Tippy: a disabled
  // button fires no pointer events of its own, so without a wrapper its
  // tooltip would never open. The value is the wrapper's own classes, since
  // it has to carry whatever layout the trigger had (e.g. "flex w-full").
  wrapperClassName?: string;
}) {
  if (content === null || content === undefined || content === false || content === "") {
    return children;
  }

  return (
    <Tippy
      content={content}
      placement={placement}
      delay={delay}
      interactive={interactive}
      theme="golive"
      animation="shift-away"
      duration={[120, 80]}
      // A phone has no hover state: a long press shows the hint, and a plain
      // tap still just does what the control does.
      touch={["hold", 400]}
      maxWidth={280}
    >
      {wrapperClassName === undefined ? (
        children
      ) : (
        <span className={wrapperClassName}>{children}</span>
      )}
    </Tippy>
  );
}

export function Popover({
  content,
  open,
  onClose,
  children,
  placement = "bottom-end",
  offset = [0, 8],
  tooltip,
  wrapperClassName,
}: {
  content: ReactNode;
  open: boolean;
  // Fired on a click outside the panel and on Escape — the trigger's own
  // click keeps toggling `open` itself, which Tippy deliberately does not
  // count as an outside click.
  onClose: () => void;
  // The trigger. Cloned to capture its DOM node, so it must be an element
  // that takes a ref (any intrinsic tag) and must not need a ref of its own.
  children: ReactElement<{ ref?: Ref<Element> }>;
  placement?: Placement;
  offset?: [number, number];
  // Optional hover hint for an icon-only trigger. Both tippys attach to the
  // same node through `reference` rather than by nesting a <Tooltip> around
  // the trigger, which would leave the outer one with no element to anchor
  // to. Suppressed while the panel is open, so the two never stack up.
  tooltip?: ReactNode;
  // Same idea as Tooltip's prop of the same name: anchor to a wrapping span
  // instead of to the trigger itself. Needed when the trigger can be
  // disabled (it fires no pointer events of its own then, so its hover hint
  // would never open), and when the trigger sits in a slot whose layout
  // classes have to stay on a wrapper — the value carries them.
  wrapperClassName?: string;
}) {
  // State, not a ref: the tippys can only be created once the trigger's node
  // exists, and a ref alone would not re-render to tell us that it does.
  const [anchor, setAnchor] = useState<Element | null>(null);
  // Must keep the same identity for the life of the component: React
  // re-runs a ref callback whenever its identity changes, and a fresh arrow
  // per render would mean detach/attach — so a setState — on every single
  // render, which is a render loop rather than a performance detail.
  const captureAnchor = useCallback((node: Element | null) => {
    setAnchor(node);
  }, []);

  // Held in a ref so a caller may pass an inline arrow without resubscribing
  // the key listener on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      {wrapperClassName === undefined ? (
        cloneElement(children, { ref: captureAnchor })
      ) : (
        <span ref={captureAnchor} className={wrapperClassName}>
          {children}
        </span>
      )}
      {anchor && (
        <>
          <Tippy
            reference={anchor}
            content={content}
            visible={open}
            onClickOutside={() => onCloseRef.current()}
            interactive
            placement={placement}
            offset={offset}
            theme="golive-panel"
            animation="shift-away"
            duration={[150, 100]}
            // The panels size themselves (w-64, w-80, ...); Tippy's 350px
            // default would quietly cap the wider ones.
            maxWidth="none"
            popperOptions={{
              modifiers: [
                { name: "preventOverflow", options: { padding: 8 } },
                // Flip to the opposite side when the chosen one has no room,
                // rather than letting preventOverflow shove the panel back
                // over the element it is pointing at. Without a fallback list
                // Popper only tries the mirror side; a panel anchored to a row
                // in a narrow column needs the perpendicular ones too.
                {
                  name: "flip",
                  options: { fallbackPlacements: ["top", "bottom", "right", "left"] },
                },
              ],
            }}
          />
          {tooltip ? (
            <Tippy
              reference={anchor}
              content={tooltip}
              disabled={open}
              placement="top"
              delay={[200, 0]}
              theme="golive"
              animation="shift-away"
              duration={[120, 80]}
              touch={["hold", 400]}
              maxWidth={280}
            />
          ) : null}
        </>
      )}
    </>
  );
}

"use client";

import { useEffect } from "react";

// Shakes an element for as long as `active` is true.
//
// Used by the payment dialogs while a charge is being created (see
// PixChargeModal, GiftPlanDialog, ProModal): the dialog trembles and refuses
// to close until the API answers, so nobody walks away from a charge that is
// being created at Mercado Pago with no screen left to show its code on.
//
// The Web Animations API rather than a CSS class, because of the popup
// library. It gives its <dialog> an entrance through the `animation`
// property, and a class setting `animation` would replace it — and then
// *restart* it when the class came off, so the dialog would pop open a second
// time the moment the API answered. `element.animate` never touches that
// property. The frames move `translate` and `rotate`, the individual
// transform properties, so they add to whatever `transform` the element has
// instead of overwriting it.

const FRAMES: Keyframe[] = [
  { translate: "0 0", rotate: "0deg" },
  { translate: "-4px 1px", rotate: "-0.7deg" },
  { translate: "4px -1px", rotate: "0.7deg" },
  { translate: "-3px 0", rotate: "-0.5deg" },
  { translate: "3px 1px", rotate: "0.5deg" },
  { translate: "-2px -1px", rotate: "-0.3deg" },
  { translate: "2px 0", rotate: "0.3deg" },
  { translate: "-1px 1px", rotate: "0deg" },
  { translate: "0 0", rotate: "0deg" },
];

/**
 * @param getTarget Resolves the element when the shake starts — a function
 *   rather than a ref, because one caller shakes an element it does not render
 *   (the popup library's <dialog> around its content).
 */
export function useShake(getTarget: () => Element | null | undefined, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const target = getTarget();
    if (!target || typeof target.animate !== "function") return;
    // Nobody who asked their system for less motion gets a trembling dialog;
    // the disabled buttons and "Gerando…" still say what is happening.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const animation = target.animate(FRAMES, { duration: 450, iterations: Infinity });
    return () => animation.cancel();
    // getTarget is read when the shake starts, not tracked: callers pass an
    // inline function, and restarting the animation on every render would
    // make it stutter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

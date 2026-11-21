"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

// GSAP is imported only from this folder, so only the "3 meses" route ships it.
gsap.registerPlugin(ScrollTrigger, useGSAP);

/** Animations that move things around run only for people who did not ask for less motion. */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
export const MOTION_REDUCED = "(prefers-reduced-motion: reduce)";

export { gsap, ScrollTrigger, useGSAP };

/** True when the viewer asked for less motion; every GSAP tween then jumps straight to its end state. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

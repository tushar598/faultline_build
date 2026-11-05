"use client";
import { gsap } from "gsap";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./reducedMotion";

/** Eases from the previous value to the new one when the chain value changes. The final text is always the exact
 *  formatted bigint; only the in-between frames are approximations. */
export function AnimatedNumber({ value, format, className = "" }: { value: bigint; format: (v: bigint) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<bigint | null>(null);
  const formatRef = useRef(format);
  // React renders only the first text; every later frame is written by the effect, so React and GSAP never fight.
  const [initial] = useState(() => format(value));
  useLayoutEffect(() => {
    formatRef.current = format;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prev.current;
    prev.current = value;
    if (from === null || from === value || prefersReducedMotion()) {
      el.textContent = formatRef.current(value);
      return;
    }
    const proxy = { v: Number(from) };
    const tween = gsap.to(proxy, {
      v: Number(value),
      duration: 0.9,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = formatRef.current(BigInt(Math.round(proxy.v)));
      },
      onComplete: () => {
        el.textContent = formatRef.current(value);
      },
    });
    return () => {
      tween.kill();
      el.textContent = formatRef.current(value);
    };
  }, [value]);

  return (
    <span ref={ref} className={`num ${className}`}>
      {initial}
    </span>
  );
}

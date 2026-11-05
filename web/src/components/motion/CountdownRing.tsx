"use client";
import { gsap } from "gsap";
import { useEffect, useRef } from "react";
import { formatClock } from "@/lib/format";
import { prefersReducedMotion } from "./reducedMotion";

const R = 44;
const C = 2 * Math.PI * R;

/** Ring that empties as the challenge window runs out (effective time; frozen while the trigger is paused). */
export function CountdownRing({ remaining, total, paused, size = 128 }: { remaining: number; total: number; paused: boolean; size?: number }) {
  const arc = useRef<SVGCircleElement>(null);
  const frac = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;

  useEffect(() => {
    if (!arc.current) return;
    const offset = C * (1 - frac);
    if (prefersReducedMotion()) gsap.set(arc.current, { strokeDashoffset: offset });
    else gsap.to(arc.current, { strokeDashoffset: offset, duration: 0.9, ease: "none", overwrite: true });
  }, [frac]);

  const tone = paused ? "stroke-warning-500" : remaining === 0 ? "stroke-success-500" : "stroke-accent-500";
  const label = paused ? "Clock stopped (paused)" : remaining === 0 ? "Window complete" : "Challenge window ends in";
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${label}: ${formatClock(remaining)}`}>
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth="6" className="stroke-neutral-100" />
        <circle
          ref={arc}
          cx="50"
          cy="50"
          r={R}
          fill="none"
          strokeWidth="6"
          strokeLinecap="butt"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          transform="rotate(-90 50 50)"
          className={tone}
        />
        <text x="50" y="54" textAnchor="middle" className="num fill-neutral-900 text-[13px] font-semibold">
          {formatClock(remaining)}
        </text>
      </svg>
      <div className="text-sm">
        <div className="font-medium text-neutral-900">{label}</div>
        <div className="num text-xs text-neutral-700">Window length {formatClock(total)} of unpaused time</div>
      </div>
    </div>
  );
}

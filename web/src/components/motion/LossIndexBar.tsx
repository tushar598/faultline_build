"use client";
import { gsap } from "gsap";
import { useEffect, useRef } from "react";
import { formatBps } from "@/lib/format";
import { AnimatedNumber } from "./AnimatedNumber";
import { prefersReducedMotion } from "./reducedMotion";

/** Loss index L (0 to 10,000 bps) as a number and a bar; both ease when an execute raises L. */
export function LossIndexBar({ bps, large = false }: { bps: number; large?: boolean }) {
  const fill = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!fill.current) return;
    const width = `${Math.min(100, bps / 100)}%`;
    if (prefersReducedMotion()) gsap.set(fill.current, { width });
    else gsap.to(fill.current, { width, duration: 1.1, ease: "power2.out", overwrite: true });
  }, [bps]);
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <AnimatedNumber value={BigInt(bps)} format={(v) => Number(v).toLocaleString("en-US")} className={large ? "text-3xl font-semibold text-neutral-900" : "text-xl font-semibold text-neutral-900"} />
        <span className="text-sm font-medium text-neutral-700">bps</span>
        <span className="num text-sm text-neutral-700">({(bps / 100).toFixed(2)}% of principal written down)</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-sm bg-neutral-100" role="meter" aria-valuemin={0} aria-valuemax={10000} aria-valuenow={bps} aria-label={`Loss index ${formatBps(bps)}`}>
        <div ref={fill} className="h-full bg-error-500" style={{ width: `${Math.min(100, bps / 100)}%` }} />
      </div>
      <div className="num mt-1 flex justify-between text-[11px] text-neutral-700">
        <span>0</span>
        <span>5,000</span>
        <span>10,000 bps</span>
      </div>
    </div>
  );
}

"use client";
import { gsap } from "gsap";
import { Check } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion } from "./reducedMotion";

export type StepState = "done" | "active" | "waiting" | "stopped";
export type Step = { key: string; title: string; state: StepState; body: ReactNode };

const DOT: Record<StepState, string> = {
  done: "border-accent-600 bg-accent-600 text-white",
  active: "border-accent-600 bg-white text-accent-600",
  waiting: "border-neutral-300 bg-white text-neutral-500",
  stopped: "border-neutral-500 bg-neutral-100 text-neutral-700",
};

/** Vertical steps of the replay; a step that turns done fades its marker and text in once (no looping motion). */
export function ReplayTimeline({ steps }: { steps: Step[] }) {
  const refs = useRef(new Map<string, HTMLLIElement>());
  const seen = useRef(new Map<string, StepState>());
  useEffect(() => {
    for (const s of steps) {
      const before = seen.current.get(s.key);
      seen.current.set(s.key, s.state);
      const el = refs.current.get(s.key);
      if (!el || before === undefined || before === s.state || prefersReducedMotion()) continue;
      gsap.fromTo(el, { opacity: 0.35, y: 6 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" });
    }
  }, [steps]);
  return (
    <ol className="relative">
      {steps.map((s, i) => (
        <li
          key={s.key}
          ref={(el) => {
            if (el) refs.current.set(s.key, el);
          }}
          className="relative flex gap-3 pb-5 last:pb-0"
        >
          {i < steps.length - 1 && <span aria-hidden className={`absolute top-6 left-[11px] h-[calc(100%-1.25rem)] w-px ${s.state === "done" ? "bg-accent-600" : "bg-neutral-200"}`} />}
          <span aria-hidden className={`num relative z-10 flex size-6 shrink-0 items-center justify-center rounded-sm border text-xs font-semibold ${DOT[s.state]}`}>
            {s.state === "done" ? <Check className="size-3.5" strokeWidth={2.5} /> : i + 1}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className={`text-sm font-semibold ${s.state === "waiting" ? "text-neutral-700" : "text-neutral-900"}`}>
              {s.title}
              <span className="sr-only"> ({s.state})</span>
            </div>
            <div className="mt-1 text-sm text-neutral-800">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

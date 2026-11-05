import { Check } from "lucide-react";
import { milestones } from "@/lib/phase";
import type { BondSnapshot } from "@/lib/types";
import { Timestamp } from "../ui/Timestamp";

/** The schedule as evenly spaced steps (the real durations differ by orders of magnitude, so no time axis). */
export function ScheduleTimeline({ s, now }: { s: BondSnapshot; now: number }) {
  const list = milestones(s);
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Bond schedule">
      {list.map((m) => {
        const done = now >= m.at;
        return (
          <li key={m.key} className={`rounded-md border px-3 py-2.5 ${done ? "border-neutral-200 bg-neutral-50" : "border-neutral-200 bg-white"}`}>
            <div className="flex items-center gap-2 text-xs font-medium text-neutral-800">
              <span aria-hidden className={`flex size-4 items-center justify-center rounded-sm border ${done ? "border-accent-600 bg-accent-600 text-white" : "border-neutral-400 bg-white"}`}>
                {done && <Check className="size-3" strokeWidth={2.5} />}
              </span>
              {m.label}
              <span className="sr-only">{done ? "(passed)" : "(upcoming)"}</span>
            </div>
            <Timestamp unix={m.at} className="mt-1 block text-xs text-neutral-700" />
          </li>
        );
      })}
    </ol>
  );
}

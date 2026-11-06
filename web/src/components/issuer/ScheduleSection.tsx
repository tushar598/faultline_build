"use client";
import { Card } from "@/components/ui/Card";
import { Note } from "@/components/ui/Notes";
import { Stat } from "@/components/ui/Stat";
import { Tag } from "@/components/ui/Tag";
import { formatAmount, formatBps, formatDuration } from "@/lib/format";
import { scheduleWarnings, validateSchedule, type ScheduleDraft } from "@/lib/issuer/schedule";
import { fromIstInput, toIstInput } from "@/lib/issuer/time";
import { formatIst } from "@/lib/format";
import { Field } from "./Field";

/** Step b: schedule and economics, with the constructor rules enforced and the reserve the sponsor must fund. */
export function ScheduleSection({ draft, onChange, chainNow, mode, locked, onReset }: { draft: ScheduleDraft; onChange: (d: ScheduleDraft) => void; chainNow: number; mode: "local" | "testnet"; locked: boolean; onReset: () => void }) {
  const v = validateSchedule(draft);
  const errors = v.ok ? {} : v.errors;
  const warnings = v.ok ? scheduleWarnings(v.value, chainNow, mode) : [];
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch });
  const time = (f: "issuanceStart" | "issuanceEnd" | "riskStart" | "maturity", label: string) => (
    <Field id={`s-${f}`} type="datetime-local" label={`${label} (IST)`} value={toIstInput(draft[f])} onChange={(x) => set({ [f]: fromIstInput(x) } as Partial<ScheduleDraft>)} error={errors[f]} hint={Number.isFinite(draft[f]) ? formatIst(draft[f]) : undefined} />
  );
  const secs = (f: "graceSec" | "challengeWindowSec", label: string, hint: string) => (
    <Field
      id={`s-${f}`}
      label={label}
      value={Number.isFinite(draft[f]) ? String(draft[f]) : ""}
      onChange={(x) => set({ [f]: /^\d{1,9}$/.test(x.trim()) ? Number(x.trim()) : NaN } as Partial<ScheduleDraft>)}
      error={errors[f]}
      unit="s"
      hint={Number.isFinite(draft[f]) && draft[f] > 0 ? `${formatDuration(draft[f])}. ${hint}` : hint}
    />
  );
  return (
    <Card
      title="b. Schedule and economics"
      subtitle={`Checked against the FaultlinePool and FaultlineTrigger constructors before anything is sent. Chain time now: ${formatIst(chainNow)}.`}
      action={
        <div className="flex items-center gap-2">
          {!locked && (
            <button type="button" onClick={onReset} className="text-xs text-accent-600 hover:underline">
              Restart from chain time
            </button>
          )}
          {v.ok ? <Tag tone="success">Valid</Tag> : <Tag tone="error">Fix the fields</Tag>}
        </div>
      }
    >
      <fieldset disabled={locked} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {time("issuanceStart", "Issuance start")}
          {time("issuanceEnd", "Issuance end")}
          {time("riskStart", "Risk period start")}
          {time("maturity", "Maturity")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {secs("graceSec", "Grace after maturity", "Above 0, at most 365 days.")}
          {secs("challengeWindowSec", "Challenge window", "Above 0, at most 30 days.")}
          <Field id="s-coupon" label="Coupon" value={draft.couponBps} onChange={(x) => set({ couponBps: x })} error={errors.couponBps} unit="bps / year" />
          <Field id="s-cap" label="Cap" value={draft.cap} onChange={(x) => set({ cap: x })} error={errors.cap} unit="USD" />
          <Field id="s-min" label="Minimum ticket" value={draft.minTicket} onChange={(x) => set({ minTicket: x })} error={errors.minTicket} unit="USD" />
        </div>
        <p className="text-xs text-neutral-700">Stablecoin and bond both use 6 decimals: one bond unit is one stablecoin base unit (1 USD nominal).</p>
        {v.ok && (
          <div className="grid gap-5 rounded-md border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-3">
            <Stat label="Required coupon reserve for the full cap" value={formatAmount(v.requiredReserve)} unit="USD" emphasis hint="pool.requiredReserve(cap), rounded up; the sponsor funds it before anyone can invest" />
            <Stat label="Risk period" value={formatDuration(Number(v.value.maturity - v.value.riskStart))} hint={`${formatBps(v.value.couponBps)} a year on the original notional`} />
            <Stat label="Submission deadline without pauses" value={formatIst(Number(v.value.maturity + v.value.grace))} hint="A trigger pause moves it later (D2)" />
          </div>
        )}
        {warnings.map((w) => (
          <Note key={w} tone="warning">
            {w}
          </Note>
        ))}
        {mode === "testnet" && (
          <Note tone="info" title="Demo profile">
            The starting values are the testnet demo profile (wall clock, minutes). A production-like bond uses a 48 to 72 hour window, a 1 to 3 year term and 30 days of grace (ARCHITECTURE §12.1).
          </Note>
        )}
      </fieldset>
    </Card>
  );
}

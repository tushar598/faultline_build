"use client";
import { Card } from "@/components/ui/Card";
import { Hex } from "@/components/ui/Hex";
import { Note } from "@/components/ui/Notes";
import { Tag } from "@/components/ui/Tag";
import { ACCEPTED_MAG_TYPES, bhujReplayOffset, buildTerms, type TermsDraft } from "@/lib/issuer/terms";
import { CodeBlock, Field } from "./Field";
import { CurvePreview } from "./CurvePreview";

/** Step a: trigger terms, canonical JSON, termsHash and the payout curve. */
export function TermsSection({ draft, onChange, chainId, riskStart, locked }: { draft: TermsDraft; onChange: (d: TermsDraft) => void; chainId: number; riskStart: number; locked: boolean }) {
  const built = buildTerms(draft, chainId);
  const errors = built.ok ? {} : built.errors;
  const set = (patch: Partial<TermsDraft>) => onChange({ ...draft, ...patch });
  const replayAllowed = chainId === 31337 || chainId === 296;
  return (
    <Card title="a. Trigger terms" subtitle="Hashed into termsHash, an immutable of the trigger and signed in every attestation (ARCHITECTURE §6.3)." action={built.ok ? <Tag tone="success">Valid</Tag> : <Tag tone="error">Fix the fields</Tag>}>
      <fieldset disabled={locked} className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-neutral-900">Insured box (decimal degrees, WGS84)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field id="t-minLat" label="Min latitude" value={draft.minLat} onChange={(v) => set({ minLat: v })} error={errors.minLat} unit="N" />
              <Field id="t-maxLat" label="Max latitude" value={draft.maxLat} onChange={(v) => set({ maxLat: v })} error={errors.maxLat} unit="N" />
              <Field id="t-minLon" label="Min longitude" value={draft.minLon} onChange={(v) => set({ minLon: v })} error={errors.minLon} unit="E" />
              <Field id="t-maxLon" label="Max longitude" value={draft.maxLon} onChange={(v) => set({ maxLon: v })} error={errors.maxLon} unit="E" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field id="t-depth" label="Max depth" value={draft.maxDepthKm} onChange={(v) => set({ maxDepthKm: v })} error={errors.maxDepthKm} unit="km" hint="Deeper events never count." />
            <Field id="t-cooling" label="Cooling period" value={draft.coolingHours} onChange={(v) => set({ coolingHours: v })} error={errors.coolingHours} unit="hours" hint="Age of a reviewed record before it counts." />
            <Field id="t-floor" label="Curve floor (0% loss at)" value={draft.floorMag} onChange={(v) => set({ floorMag: v })} error={errors.floorMag} unit="M" />
            <Field id="t-ceil" label="Curve ceiling (100% loss at)" value={draft.ceilMag} onChange={(v) => set({ ceilMag: v })} error={errors.ceilMag} unit="M" />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-800">Magnitude types (moment magnitude only, D10)</p>
            <div className="flex flex-wrap gap-3">
              {ACCEPTED_MAG_TYPES.map((m) => (
                <label key={m} className="inline-flex items-center gap-1.5 text-sm text-neutral-900">
                  <input type="checkbox" checked={draft.magTypes.includes(m)} onChange={(e) => set({ magTypes: e.target.checked ? [...draft.magTypes, m] : draft.magTypes.filter((x) => x !== m) })} className="accent-accent-600" />
                  <span className="font-mono text-xs">{m}</span>
                </label>
              ))}
            </div>
            {errors.magTypes && <p className="mt-1 text-xs text-error-700">{errors.magTypes}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-neutral-800">
              <span className="mb-1 block">Mode</span>
              <select
                id="t-mode"
                value={draft.mode}
                onChange={(e) => set({ mode: e.target.value as TermsDraft["mode"], timeOffsetSec: e.target.value === "live" ? "0" : String(bhujReplayOffset(riskStart)) })}
                className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900"
              >
                <option value="live">live (real earthquakes)</option>
                <option value="replay" disabled={!replayAllowed}>
                  replay (historical record, D10)
                </option>
              </select>
              {errors.mode && <span className="mt-1 block text-error-700">{errors.mode}</span>}
            </label>
            {draft.mode === "replay" && (
              <Field id="t-offset" label="Replay time offset" value={draft.timeOffsetSec} onChange={(v) => set({ timeOffsetSec: v })} error={errors.timeOffsetSec} unit="s" hint={<button type="button" className="text-accent-600 hover:underline" onClick={() => set({ timeOffsetSec: String(bhujReplayOffset(riskStart)) })}>Place Bhuj (usp000a8ds) 60 s after riskStart</button>} />
            )}
          </div>
          {draft.mode === "replay" && (
            <Note tone="warning" title="Replay terms are for demos only">
              A replayed historical record is shifted into the risk period by the offset. Allowed only on the local chain and Hedera testnet (D14); the dashboard marks the bond REPLAY.
            </Note>
          )}
        </div>
        <div className="space-y-4">
          {built.ok ? (
            <>
              <div>
                <p className="mb-1 text-xs font-medium text-neutral-800">termsHash = keccak256(utf8(JCS(terms))), computed with shared/ts</p>
                <Hex value={built.value.hash} full />
              </div>
              <CodeBlock label="Canonical terms JSON (RFC 8785)" code={built.value.json} />
              <CurvePreview floorMagX100={built.value.terms.floorMagX100} ceilMagX100={built.value.terms.ceilMagX100} />
            </>
          ) : (
            <Note tone="info" title="No termsHash yet">
              The canonical JSON and termsHash appear when every field is valid.
            </Note>
          )}
        </div>
      </fieldset>
    </Card>
  );
}

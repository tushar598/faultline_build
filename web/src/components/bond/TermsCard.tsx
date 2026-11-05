import { CheckCircle2, XCircle } from "lucide-react";
import { formatBps, formatDuration, formatUnits } from "@/lib/format";
import type { BondSnapshot, VerifiedTerms } from "@/lib/types";
import { DefinitionList } from "../ui/DefinitionList";
import { Hex } from "../ui/Hex";
import { Note } from "../ui/Notes";
import { Tag } from "../ui/Tag";

/** Trigger terms, shown only when their hash equals the trigger's immutable termsHash; bond economics from the pool. */
export function TermsCard({ s, terms }: { s: BondSnapshot; terms: VerifiedTerms | null }) {
  const t = terms?.matchesChain ? terms.terms : null;
  const items = [
    {
      term: "termsHash",
      value: (
        <span className="flex flex-wrap items-center gap-2">
          <Hex value={s.terms.termsHash} />
          {terms === null ? (
            <Tag tone="neutral">Terms file not available</Tag>
          ) : terms.matchesChain ? (
            <Tag tone="success">
              <CheckCircle2 aria-hidden className="size-3" /> Terms file matches chain
            </Tag>
          ) : (
            <Tag tone="error">
              <XCircle aria-hidden className="size-3" /> Terms file does not match
            </Tag>
          )}
        </span>
      ),
    },
    ...(t
      ? [
          { term: "Box", value: `${t.box.minLat.toFixed(1)} to ${t.box.maxLat.toFixed(1)} N, ${t.box.minLon.toFixed(1)} to ${t.box.maxLon.toFixed(1)} E (Kutch, Gujarat)` },
          { term: "Depth limit", value: `${t.maxDepthKm} km or shallower` },
          { term: "Payout curve", value: `Linear, M${(t.floorMagX100 / 100).toFixed(1)} = 0 bps to M${(t.ceilMagX100 / 100).toFixed(1)} = 10,000 bps, rounded down` },
          { term: "Magnitude types", value: t.magTypes.join(", ") },
          { term: "USGS status", value: "reviewed only, after a cooling period of " + formatDuration(t.coolingPeriodSec) },
          { term: "Aggregation", value: "Sum of event losses, capped at 10,000 bps" },
          {
            term: "Mode",
            value: t.mode === "replay" ? (
              <span className="flex flex-wrap items-center gap-2">
                <Tag tone="warning">REPLAY</Tag>
                <span className="text-xs text-neutral-700">Historical record shifted by {t.timeOffsetSec.toLocaleString("en-US")} s into the risk period (D10)</span>
              </span>
            ) : (
              <Tag tone="success">Live</Tag>
            ),
          },
        ]
      : []),
    { term: "Coupon", value: `${formatBps(s.terms.couponBps)} per year on original notional, paid at redemption` },
    { term: "Cap", value: formatUnits(s.terms.cap) },
    { term: "Minimum ticket", value: formatUnits(s.terms.minTicket) },
    { term: "Challenge window", value: `${formatDuration(s.terms.challengeWindow)} of unpaused time` },
  ];
  return (
    <div className="space-y-3">
      {terms && !terms.matchesChain && (
        <Note tone="error" title="Terms not shown">
          The terms file on hand hashes to a different value than the trigger&apos;s termsHash, so its box and curve are not displayed.
        </Note>
      )}
      <DefinitionList items={items} />
    </div>
  );
}

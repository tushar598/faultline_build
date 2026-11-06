import { ADVISORY_TEXT } from "@/lib/advisory";
import { consensusSeconds, formatBps } from "@/lib/format";
import type { HcsEntry } from "@/lib/types";
import { EmptyState } from "../ui/Notes";
import { Tag } from "../ui/Tag";
import { Timestamp } from "../ui/Timestamp";
import { SignedCheck } from "./SignedCheck";

/** Every message on the topic for this trigger, in consensus order, with its D16 signature check. */
export function HcsLogTable({ entries, source }: { entries: HcsEntry[]; source: string }) {
  if (entries.length === 0) return <EmptyState>No messages for this trigger on {source} yet.</EmptyState>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-neutral-200 text-xs text-neutral-700">
          <tr>
            <th scope="col" className="px-5 py-2 text-right font-medium">Seq</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Consensus time (IST)</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Kind</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Content</th>
            <th scope="col" className="px-5 py-2 text-left font-medium">Signature</th>
          </tr>
        </thead>
        <tbody className="num divide-y divide-neutral-100">
          {entries.map((h) => {
            const m = h.message;
            return (
              <tr key={h.sequenceNumber}>
                <td className="px-5 py-2 text-right align-top">{h.sequenceNumber}</td>
                <td className="px-3 py-2 align-top text-xs whitespace-nowrap">
                  <Timestamp unix={consensusSeconds(h.consensusTimestamp)} />
                  {h.payer && <div className="text-neutral-700">payer {h.payer}</div>}
                </td>
                <td className="px-3 py-2 align-top">
                  {m?.kind === "faultline.attestation" ? <Tag tone="accent">Attestation</Tag> : m?.kind === "faultline.advisory" ? <Tag tone="error">Advisory: veto</Tag> : <Tag tone="neutral">Unreadable</Tag>}
                </td>
                <td className="px-3 py-2 align-top text-xs">
                  {m?.kind === "faultline.attestation" && (
                    <>
                      <span className="font-mono">{m.usgsId}</span>, nonce {m.attestation.nonce}, {formatBps(m.attestation.lossBps)}, mode {m.mode}
                      {m.usgsId.startsWith("synthetic-") && <span className="ml-1.5"><Tag tone="warning">SYNTHETIC</Tag></span>}
                    </>
                  )}
                  {m?.kind === "faultline.advisory" && (
                    <>
                      <span className="font-mono">{m.usgsId}</span>: {ADVISORY_TEXT[m.reason]}
                    </>
                  )}
                  {!m && h.parseError}
                </td>
                <td className="px-5 py-2 align-top">
                  <SignedCheck ok={h.signedByOracle} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import { hashscan, type NetworkConfig } from "@/config/networks";
import { realTimeOf, type EventInfo } from "@/lib/eventInfo";
import { formatBps, formatIst, formatMagnitude } from "@/lib/format";
import { DefinitionList } from "../ui/DefinitionList";
import { Hex } from "../ui/Hex";
import { Tag } from "../ui/Tag";
import { Timestamp } from "../ui/Timestamp";
import { SignedCheck } from "./SignedCheck";

/** Everything the trustee needs to judge one event. Replayed chain times are never shown as real dates (D10). */
export function EventDetails({ info, net }: { info: EventInfo; net: NetworkConfig }) {
  const r = info.record;
  const origin = realTimeOf(r.observedAt, info);
  const updated = realTimeOf(r.usgsUpdatedAt, info);
  const submitted = info.logs.find((l) => l.name === "AttestationSubmitted");
  return (
    <DefinitionList
      items={[
        {
          term: "USGS event id",
          value: info.usgsId ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{info.usgsId}</span>
              {info.synthetic ? <Tag tone="warning">SYNTHETIC, not a real USGS event</Tag> : <Tag tone="info">USGS ComCat id</Tag>}
            </span>
          ) : (
            "Not named by any oracle-signed HCS message yet"
          ),
        },
        { term: "eventId", value: <Hex value={r.eventId} /> },
        { term: "Magnitude", value: formatMagnitude(r.magnitudeX100) },
        { term: "Loss of this event", value: formatBps(r.lossBps, true) },
        {
          term: "Origin time",
          value:
            info.mode === "replay" ? (
              <span>
                {origin !== null ? <Timestamp unix={origin} /> : "Unknown"} <span className="text-xs text-neutral-700">(real origin time)</span>
                <span className="block text-xs text-neutral-700">
                  On chain shifted by the replay offset (D10).{" "}
                  <span tabIndex={0} className="cursor-help underline decoration-dotted" title={`Raw on-chain observedAt (seconds, replayed, not a real date): ${r.observedAt}`}>
                    Raw value
                  </span>
                </span>
              </span>
            ) : info.mode === "live" ? (
              <Timestamp unix={r.observedAt} />
            ) : (
              <span className="text-xs text-neutral-700" title={`Raw on-chain observedAt (seconds): ${r.observedAt}`}>
                Not shown as a date until an oracle-signed HCS message gives the mode
              </span>
            ),
        },
        {
          term: "USGS record updated",
          value:
            updated !== null ? (
              <span>
                {formatIst(updated)} <span className="text-xs text-neutral-700">{info.mode === "replay" ? "(real update time of the record)" : ""}</span>
              </span>
            ) : (
              <span className="text-xs text-neutral-700" title={`Raw on-chain usgsUpdatedAt (seconds): ${r.usgsUpdatedAt}`}>
                Not shown as a date: the replay offset is unknown
              </span>
            ),
        },
        { term: "Nonce", value: r.nonce },
        { term: "dataHash", value: <Hex value={r.dataHash} /> },
        {
          term: "HCS messages",
          value: info.attestations.length ? (
            <ul className="space-y-1">
              {info.attestations.map((h) => (
                <li key={h.sequenceNumber} className="flex flex-wrap items-center gap-2">
                  <span className="num text-xs">
                    Sequence {h.sequenceNumber}, nonce {h.message.attestation.nonce}, {formatBps(h.message.attestation.lossBps)}
                  </span>
                  <SignedCheck ok={h.signedByOracle} />
                </li>
              ))}
            </ul>
          ) : (
            "No attestation message on the topic for this event"
          ),
        },
        { term: "Submitted in", value: submitted ? <Hex value={submitted.txHash} href={hashscan(net, "transaction", submitted.txHash)} /> : "Unknown" },
      ]}
    />
  );
}

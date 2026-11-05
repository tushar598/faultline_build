import { OctagonAlert } from "lucide-react";
import { ADVISORY_TEXT } from "@/lib/advisory";
import type { EventInfo } from "@/lib/eventInfo";
import { consensusSeconds } from "@/lib/format";
import { Timestamp } from "../ui/Timestamp";
import { SignedCheck } from "./SignedCheck";

/** D15: the oracle cannot revise a pending event to zero, so it publishes a signed advisory and the trustee decides. */
export function AdvisoryAlert({ info }: { info: EventInfo }) {
  if (info.advisories.length === 0) return null;
  const last = info.advisories.at(-1)!;
  return (
    <div role="alert" className="rounded-md border-2 border-error-500 bg-error-50 p-4 text-error-800">
      <div className="flex items-start gap-2.5">
        <OctagonAlert aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
        <div className="min-w-0 text-sm">
          <p className="text-base font-semibold">Oracle advises veto</p>
          <p className="mt-0.5">
            The USGS record for {info.usgsId ?? "this event"} no longer passes the trigger rule: {ADVISORY_TEXT[last.message.reason]}. The oracle cannot submit a zero loss, so the veto is the trustee&apos;s decision.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="num">HCS sequence {last.sequenceNumber}</span>
            <span>·</span>
            <Timestamp unix={consensusSeconds(last.consensusTimestamp)} />
            <SignedCheck ok={last.signedByOracle} />
          </div>
        </div>
      </div>
    </div>
  );
}

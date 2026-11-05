// One-line descriptions of decoded logs for the activity tables. Amounts come straight from the event arguments.
import { formatBps, formatMagnitude, formatUnits, formatUsd, shortHex } from "./format";
import type { LogEntry } from "./types";

const big = (x: unknown) => (typeof x === "bigint" ? x : BigInt(String(x)));
const addr = (x: unknown) => shortHex(String(x));

export function describeLog(l: LogEntry, names: Map<string, string> = new Map()): string {
  const a = l.args;
  const ev = (id: unknown) => names.get(String(id)) ?? shortHex(String(id));
  switch (l.name) {
    case "CouponsFunded":
      return `Sponsor ${addr(a.sponsor)} funded the coupon reserve with ${formatUsd(big(a.amount))}`;
    case "Invested":
      return `${addr(a.investor)} invested ${formatUsd(big(a.units))} and received ${formatUnits(big(a.units))}`;
    case "LossApplied":
      return `Loss index raised from ${formatBps(big(a.previousBps))} to ${formatBps(big(a.newBps))}; sponsor credited ${formatUsd(big(a.sponsorCredit))}`;
    case "Redeemed":
      return `${addr(a.holder)} redeemed ${formatUnits(big(a.units))}: ${formatUsd(big(a.principal))} principal + ${formatUsd(big(a.coupon))} coupon credited`;
    case "Claimed":
      return `${addr(a.account)} claimed ${formatUsd(big(a.amount))}`;
    case "ExcessSwept":
      return `Unused reserve of ${formatUsd(big(a.amount))} credited to the sponsor`;
    case "DustSwept":
      return `Final dust of ${formatUsd(big(a.amount))} credited to the sponsor`;
    case "AttestationSubmitted":
      return `Attestation for ${ev(a.eventId)} submitted: ${formatMagnitude(big(a.magnitudeX100))}, ${formatBps(big(a.lossBps))}, nonce ${String(a.nonce)}`;
    case "AttestationRevised":
      return `Attestation for ${ev(a.eventId)} revised: nonce ${String(a.oldNonce)} to ${String(a.newNonce)}, ${formatBps(big(a.oldBps))} to ${formatBps(big(a.newBps))}; window restarted`;
    case "EventVetoed":
      return `Trustee ${addr(a.trustee)} vetoed ${ev(a.eventId)}`;
    case "EventExecuted":
      return `${ev(a.eventId)} executed: ${formatBps(big(a.lossBps))} applied, loss index now ${formatBps(big(a.newCumulativeBps))}`;
    case "EventSuperseded":
      return `${ev(a.eventId)} superseded: the bond was already fully written down`;
    case "TriggerPaused":
      return `Trigger paused by ${addr(a.by)}; the challenge clock stopped`;
    case "TriggerUnpaused":
      return `Trigger unpaused by ${addr(a.by)} after ${String(a.pausedFor)} s`;
    case "OracleRotated":
      return `Oracle rotated from ${addr(a.oldOracle)} to ${addr(a.newOracle)}`;
    case "Transfer": {
      const zero = /^0x0{40}$/i;
      if (zero.test(String(a.from))) return `Bond mint: ${formatUnits(big(a.value))} to ${addr(a.to)}`;
      if (zero.test(String(a.to))) return `Bond burn: ${formatUnits(big(a.value))} from ${addr(a.from)}`;
      return `Bond transfer: ${formatUnits(big(a.value))} from ${addr(a.from)} to ${addr(a.to)}`;
    }
    default:
      return l.name;
  }
}

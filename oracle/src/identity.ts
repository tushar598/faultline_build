// D8 without trusting the local ledger alone (security review SEC-08): before a record is treated as a NEW event, every
// one of its USGS ids is looked up on chain as eventIdOf(id). USGS lists only ids of the same quake in `properties.ids`,
// so any of them already known to the trigger means this record IS that event, even when the ledger file was lost or
// the oracle runs on a fresh machine. Two different on-chain events behind one record is a conflict (refuse, as D8).
import { eventIdOf } from "../../shared/ts/attestation.js";
import type { Status } from "./abi.js";
import type { Lookup } from "./ledger.js";

export type Identity = Lookup & { recoveredFromChain?: boolean };

export async function resolveIdentity(ids: string[], ledger: Lookup, chainStatus: (eventId: string) => Promise<Status>): Promise<Identity> {
  if (ledger.kind !== "new") return ledger;
  const onChain: string[] = [];
  for (const id of ids) {
    const eventId = eventIdOf(id);
    if ((await chainStatus(eventId)) !== "None" && !onChain.includes(eventId)) onChain.push(eventId);
  }
  if (onChain.length === 0) return { kind: "new" };
  if (onChain.length > 1) return { kind: "conflict", eventIds: onChain };
  return { kind: "known", eventId: onChain[0]!, newIds: ids, recoveredFromChain: true };
}

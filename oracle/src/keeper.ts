// Keeper: executes every PENDING event whose challenge window is complete (windowRemaining == 0) while the trigger is
// not paused. Anyone may call execute. Event ids come from the trigger's AttestationSubmitted logs (from
// config.fromBlock) plus the oracle's ledger. Each execute is simulated first; an event that ends Superseded (the
// loss index was already 10000) is a normal outcome, not an error.
import type { Contract, JsonRpcProvider } from "ethers";
import type { Status } from "./abi.js";
import { eventRecord, linkText } from "./chain.js";
import type { EvmSender } from "./hederaEvm.js";
import type { Ledger } from "./ledger.js";
import { log } from "./log.js";
import { describe, send } from "./submit.js";

export type KeeperView = { eventId: string; status: Status; windowRemaining: number };

/** Pure selection: Pending, window complete, trigger not paused. */
export function selectExecutable(views: KeeperView[], paused: boolean): string[] {
  if (paused) return [];
  return views.filter((v) => v.status === "Pending" && v.windowRemaining === 0).map((v) => v.eventId);
}

export async function knownEventIds(trigger: Contract, fromBlock: number, ledger?: Ledger): Promise<string[]> {
  const logs = await trigger.queryFilter(trigger.getEvent("AttestationSubmitted"), fromBlock);
  const ids = new Set<string>(logs.map((l) => (l as unknown as { args: { eventId: string } }).args.eventId));
  for (const e of ledger?.entries() ?? []) ids.add(e.eventId);
  return [...ids];
}

export type KeeperResult = { eventId: string; outcome: string; status?: Status; txHash?: string };

export async function keeperOnce(args: { chainId: bigint; provider: JsonRpcProvider; trigger: Contract; triggerAsRelayer: Contract; fromBlock: number; ledger?: Ledger; evm?: EvmSender }): Promise<KeeperResult[]> {
  const ids = await knownEventIds(args.trigger, args.fromBlock, args.ledger);
  const views: KeeperView[] = [];
  for (const id of ids) {
    const r = await eventRecord(args.trigger, id);
    views.push({ eventId: id, status: r.status, windowRemaining: r.status === "Pending" ? Number(await args.trigger.getFunction("windowRemaining")(id)) : 0 });
  }
  const paused: boolean = await args.trigger.getFunction("paused")();
  const pending = views.filter((v) => v.status === "Pending");
  const ready = selectExecutable(views, paused);
  log.info(`keeper: ${ids.length} known events, ${pending.length} pending, ${ready.length} ready${paused ? " (trigger PAUSED: nothing executes)" : ""}`, {
    waiting: pending.filter((v) => !ready.includes(v.eventId)).map((v) => ({ eventId: v.eventId, windowRemaining: v.windowRemaining })),
  });
  const out: KeeperResult[] = [];
  for (const id of ready) {
    const r = await send(args.triggerAsRelayer, "execute", [id], args.evm);
    const after = await eventRecord(args.trigger, id);
    if (args.ledger?.get(id)) args.ledger.update(id, (e) => (e.chainStatus = after.status));
    const hash = r.kind === "not-sent" ? undefined : r.hash;
    log[r.kind === "mined" ? "info" : "error"](`keeper: execute ${id}: ${describe(r)} → ${after.status}${hash ? ` — ${linkText(args.chainId, hash)}` : ""}`);
    out.push({ eventId: id, outcome: describe(r), status: after.status, ...(hash ? { txHash: hash } : {}) });
  }
  return out;
}

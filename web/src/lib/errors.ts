// Maps contract custom errors and wallet failures to plain English for the user. The revert data can sit anywhere in
// an ethers / EIP-1193 / JSON-RPC error (Hardhat over HTTP nests it, MetaMask wraps it), so the walker searches.
import { ERRORS_IFACE, STATUS } from "./abi";
import { formatUsd } from "./format";

export type DecodedError = { kind: "contract"; name: string; args: readonly unknown[] } | { kind: "rejected" } | { kind: "other"; message: string };

const SELECTOR = /^0x[0-9a-fA-F]{8}/;

/** Finds revert data in an error object (nested `data`, `error`, `info`, `cause`, …) or in its message text. */
export function findRevertData(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  const walk = (x: unknown, depth: number): string | undefined => {
    if (!x || typeof x !== "object" || seen.has(x) || depth > 6) return undefined;
    seen.add(x);
    const o = x as Record<string, unknown>;
    if (typeof o.data === "string" && SELECTOR.test(o.data)) return o.data;
    for (const k of ["data", "error", "info", "cause", "parent", "value", "payload"]) {
      const found = walk(o[k], depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  const found = walk(err, 0);
  if (found) return found;
  const msg = messageOf(err);
  return /return data: (0x[0-9a-fA-F]{8,})/.exec(msg)?.[1] ?? /reverted with data "(0x[0-9a-fA-F]{8,})"/.exec(msg)?.[1];
}

function messageOf(err: unknown): string {
  if (typeof err === "string") return err;
  const o = err as { shortMessage?: string; message?: string } | null;
  return String(o?.shortMessage ?? o?.message ?? err);
}

function isRejection(err: unknown): boolean {
  const seen = new Set<unknown>();
  const walk = (x: unknown, depth: number): boolean => {
    if (!x || typeof x !== "object" || seen.has(x) || depth > 4) return false;
    seen.add(x);
    const o = x as Record<string, unknown>;
    if (o.code === "ACTION_REJECTED" || o.code === 4001) return true;
    return ["error", "info", "cause"].some((k) => walk(o[k], depth + 1));
  };
  return walk(err, 0);
}

/** Decodes an error from a call or transaction. */
export function decodeError(err: unknown): DecodedError {
  if (isRejection(err)) return { kind: "rejected" };
  const data = findRevertData(err);
  if (data) {
    try {
      const parsed = ERRORS_IFACE.parseError(data);
      if (parsed) return { kind: "contract", name: parsed.name, args: parsed.args.toArray() };
    } catch {
      /* not one of ours */
    }
    return { kind: "contract", name: `unknown error ${data.slice(0, 10)}`, args: [] };
  }
  const named = /custom error '(\w+)\(/.exec(messageOf(err));
  if (named) return { kind: "contract", name: named[1]!, args: [] };
  return { kind: "other", message: messageOf(err) };
}

const usd = (x: unknown) => (typeof x === "bigint" ? formatUsd(x) : "the required amount");

/** Plain message for each custom error of FaultlinePool, FaultlineTrigger and the bond (ATS v8 names). */
const MESSAGES: Record<string, (args: readonly unknown[]) => string> = {
  // FaultlinePool
  NotInitialized: () => "The pool is not set up yet: the admin has not wired the trigger.",
  OnlySponsor: () => "Only the sponsor wallet can fund the coupon reserve.",
  OnlyTrigger: () => "Only the trigger contract can apply a loss.",
  SupplyMismatch: () => "Safety stop: the bond supply is above the pool's books, so payouts are blocked.",
  ZeroAmount: () => "Enter an amount above zero.",
  IssuanceClosed: () => "The issuance window is closed.",
  IssuanceNotOpen: () => "The issuance window has not opened yet.",
  BelowMinTicket: (a) => `The minimum ticket is ${usd(a[1])}.`,
  CapExceeded: (a) => `The bond cap would be exceeded: only ${usd(a[1])} of units are left.`,
  CouponReserveInsufficient: (a) => `The sponsor's coupon reserve does not cover this subscription yet (has ${usd(a[0])}, needs ${usd(a[1])}).`,
  UnexpectedTransferAmount: () => "The stablecoin transfer moved a different amount than requested.",
  RedemptionNotOpen: () => "Redemption is not open: it opens after the submission deadline, and never while the trigger is paused.",
  EventPending: () => "An event is pending in its challenge window. Redemption waits until it is vetoed or executed.",
  NothingToRedeem: () => "This wallet holds no bond units.",
  NothingToClaim: () => "Nothing to claim for this wallet.",
  SupplyNotZero: () => "Units are still outstanding. Dust can be swept only after every unit is redeemed.",
  NotKycForToken: () => "This wallet does not have KYC for the stablecoin.",
  HtsCallFailed: (a) => `The Hedera token service returned code ${String(a[0])}.`,
  RiskPeriodNotStarted: () => "The risk period has not started.",
  LossNotIncreasing: () => "The loss index can only go up.",
  RedemptionStarted: () => "Redemption has already started.",
  // FaultlineTrigger
  InvalidSignature: () => "The attestation is not signed by the current oracle.",
  AttestationExpired: () => "The attestation's deadline has passed.",
  ObservedOutsideRiskPeriod: () => "The event's origin time is outside the risk period.",
  TermsMismatch: () => "The attestation was made for different trigger terms.",
  LossOutOfRange: () => "The loss is outside 1 to 10,000 bps.",
  FullyWrittenDown: () => "The bond is already fully written down.",
  SubmissionClosed: () => "Submissions are closed: the submission deadline has passed.",
  EventFinalised: (a) => `This event is already final (${STATUS[Number(a[1])] ?? "final"}) and cannot be submitted again.`,
  StaleRevision: () => "A revision needs a higher nonce and a newer USGS update.",
  NotPending: () => "This event is not pending.",
  WindowOpen: () => "The challenge window is still running.",
  WindowClosed: () => "The challenge window has ended, so a veto is no longer possible.",
  IsPaused: () => "The trigger is paused.",
  NotPaused: () => "The trigger is not paused.",
  AccessControlUnauthorizedAccount: () => "This wallet does not have the role this action needs.",
  // ATS bond
  InvalidKycStatus: () => "This wallet does not have KYC on the bond.",
  MaxSupplyReached: () => "The bond has reached its maximum supply.",
  AccountHasNoRoles: () => "The pool is missing an ATS role on the bond.",
  InsufficientBalance: () => "The bond balance is too low.",
};

/** One sentence the user can act on. */
export function plainError(err: unknown): string {
  const d = decodeError(err);
  if (d.kind === "rejected") return "You rejected the request in your wallet.";
  if (d.kind === "contract") return MESSAGES[d.name]?.(d.args) ?? `The contract rejected the call (${d.name}).`;
  const m = d.message.toLowerCase();
  if (m.includes("insufficient funds")) return "The wallet does not have enough native currency for the fee.";
  if (m.includes("network changed") || m.includes("chain")) return "The wallet is on another network. Switch it to this dashboard's network.";
  if (m.includes("failed to fetch") || m.includes("econnrefused") || m.includes("could not detect network")) return "The RPC endpoint did not answer.";
  return d.message.length > 200 ? `${d.message.slice(0, 200)}…` : d.message;
}

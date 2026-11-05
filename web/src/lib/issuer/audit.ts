// The end-of-launch checks of the issuer page, read-only: the bond role audit (SEC-20; the same list as
// scripts/lib/bondAudit.ts, which needs Node, so test/issuer.audit.test.ts pins this copy to it), the D4 deploy rules,
// the D5 wiring, the schedule and terms the contracts hold, the supply guard and solvency, and the creation code each
// deployment carried compared with the repo build.
import { Contract, keccak256, type Provider } from "ethers";
import { POOL_ABI, TRIGGER_ABI } from "@/lib/abi";
import { ATS_ROLES } from "./ats";
import type { Schedule } from "./schedule";

/** Roles nobody may hold on a Faultline bond (scripts/lib/bondAudit.ts FORBIDDEN_ROLES). */
export const FORBIDDEN_ROLES: Record<string, { id: string; why: string }> = {
  ROLE_AGENT: { id: ATS_ROLES.AGENT, why: "mints and burns like the pool" },
  ROLE_ADJUSTMENT_BALANCE: { id: ATS_ROLES.ADJUSTMENT_BALANCE, why: "rescales every balance (D4)" },
  ROLE_CORPORATE_ACTION: { id: "0xa1acfc499025c99f55059195e6276f639d34a18aad7b8121b9192b7f438c55cd", why: "schedules a balance adjustment that anyone can trigger" },
  ROLE_MATURITY_REDEEMER: { id: "0x433f48f8aca23480f6ab07666cbc9131d32a0b4672033453f65e18f4dd390523", why: "burns a holder's units with fullRedeemAtMaturity" },
  ROLE_PAUSER: { id: ATS_ROLES.PAUSER, why: "a paused bond blocks controllerRedeem and mint (S2)" },
  ROLE_LOCKER: { id: "0xd327cd9a2be405896f3d4584b3b437d798833cc4aa0aafb34c870659c0d47184", why: "locks units out of balanceOf (D9)" },
  ROLE_CLEARING: { id: "0xd0fe259e861ec493f60fb83851f1a173155b0f2acc3da153de2a23fb0ad26db6", why: "activates clearing, which stops transfers and holds (D9)" },
  ROLE_TREX_OWNER: { id: "0xd9e1264632ee9a37e8673a0c55a0a1d8b38c758e843084168ee08cd2d1f7e6f0", why: "sets the compliance contract ATS calls on every burn and transfer" },
  ROLE_FREEZE_MANAGER: { id: "0x71ae38482e1ab1c28e767d64766d686215b490c8c1bd7dfe6b101525187c2155", why: "freezes units out of balanceOf" },
};

const BOND_AUDIT_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleMemberCount(bytes32 role) view returns (uint256)",
  "function isControllable() view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
];

/** `warn`: a recommendation, not a rule; a failed warning does not fail the audit. */
export type Check = { label: string; ok: boolean; detail?: string; warn?: boolean };

/** The audit passes when every check holds or is only a warning. */
export const auditPassed = (checks: Check[]) => checks.every((c) => c.ok || c.warn);

/** D17 backup trustee: a rule when the step ran (the grant must have landed), a warning when it was skipped. */
export function backupTrusteeCheck(backup: string | undefined, holds: boolean | null, skipped: boolean): Check {
  const label = "backup trustee holds TRUSTEE_ROLE (D17)";
  if (skipped || !backup) return { label, ok: false, warn: true, detail: "skipped: with one trustee key, losing it removes veto and pause" };
  return { label, ok: holds === true, detail: backup };
}

type BondRoles = { hasRole(role: string, account: string): Promise<boolean>; getRoleMemberCount(role: string): Promise<bigint>; isControllable(): Promise<boolean> };

/** scripts/lib/bondAudit.ts auditBondRoles, one check per rule so the page can show each line. */
export async function bondRoleChecks(bond: BondRoles, pool: string): Promise<Check[]> {
  const out: Check[] = [];
  for (const [name, role] of [["ROLE_ISSUER", ATS_ROLES.ISSUER], ["ROLE_CONTROLLER", ATS_ROLES.CONTROLLER]] as const) {
    const count = await bond.getRoleMemberCount(role);
    const has = await bond.hasRole(role, pool);
    out.push({ label: `${name} is held by the pool alone`, ok: count === 1n && has, detail: `${count} member(s), pool ${has ? "holds it" : "does not hold it"}` });
  }
  for (const [name, { id, why }] of Object.entries(FORBIDDEN_ROLES)) {
    const members = await bond.getRoleMemberCount(id);
    out.push({ label: `${name} has no member`, ok: members === 0n, detail: members === 0n ? undefined : `${members} member(s): ${why}` });
  }
  const controllable = await bond.isControllable();
  out.push({ label: "The bond is controllable (controllerRedeem works)", ok: controllable });
  return out;
}

export type AuditInput = {
  provider: Provider;
  bond: string;
  pool: string;
  trigger: string;
  stablecoin: string;
  sponsor: string;
  oracle: string;
  trustee: string;
  admin: string;
  /** "" when none was listed; `backupSkipped` when the optional step was skipped. */
  backupTrustee?: string;
  backupSkipped: boolean;
  termsHash: string;
  schedule: Schedule;
  /** keccak256 of the repo build's creation code, and of what each deployment transaction carried. */
  build: { pool: string; trigger: string };
  deployed: { pool?: string; trigger?: string };
};

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Every check of the launch; never throws for a failed rule (only for a failed read). */
export async function launchChecks(i: AuditInput): Promise<Check[]> {
  const bond = new Contract(i.bond, BOND_AUDIT_ABI, i.provider);
  const pool = new Contract(i.pool, POOL_ABI, i.provider);
  const trigger = new Contract(i.trigger, TRIGGER_ABI, i.provider);
  const roles = await bondRoleChecks(bond as unknown as BondRoles, i.pool);
  const [pTrigger, pBond, pStable, pSponsor, iStart, iEnd, rStart, mat, grace, coupon, cap, minTicket, issued, redeemed, solvent] = await Promise.all([
    pool.trigger(), pool.bond(), pool.stablecoin(), pool.sponsor(), pool.issuanceStart(), pool.issuanceEnd(), pool.riskStart(), pool.maturity(), pool.grace(),
    pool.couponBps(), pool.cap(), pool.minTicket(), pool.unitsIssued(), pool.unitsRedeemed(), pool.isSolvent(),
  ]);
  const [tPool, tTerms, tWindow, tOracle, trusteeRole, adminRole] = await Promise.all([
    trigger.pool(), trigger.termsHash(), trigger.challengeWindow(), trigger.oracle(), trigger.TRUSTEE_ROLE(), trigger.DEFAULT_ADMIN_ROLE(),
  ]);
  const [isTrustee, isAdmin, trusteeAdmin, supply, decimals, backupHolds] = await Promise.all([
    trigger.hasRole(trusteeRole, i.trustee), trigger.hasRole(adminRole, i.admin), trigger.getRoleAdmin(trusteeRole), bond.totalSupply(), bond.decimals(),
    i.backupTrustee && !i.backupSkipped ? trigger.hasRole(trusteeRole, i.backupTrustee) : Promise.resolve(null),
  ]);
  const s = i.schedule;
  const books = (issued as bigint) - (redeemed as bigint);
  const wiring: Check[] = [
    { label: "pool.trigger() is the new trigger (D5)", ok: eq(pTrigger, i.trigger) },
    { label: "trigger.pool() is the new pool (D5)", ok: eq(tPool, i.pool) },
    { label: "pool.bond() and pool.stablecoin() are the chosen tokens", ok: eq(pBond, i.bond) && eq(pStable, i.stablecoin) },
    { label: "pool.sponsor() is the chosen sponsor", ok: eq(pSponsor, i.sponsor) },
    { label: "trigger.termsHash() equals the termsHash of the terms above", ok: eq(tTerms, i.termsHash), detail: tTerms },
    { label: "trigger.oracle() is the chosen oracle signer", ok: eq(tOracle, i.oracle) },
    { label: "the trustee holds TRUSTEE_ROLE, and TRUSTEE_ROLE administers itself (D17)", ok: isTrustee && trusteeAdmin === trusteeRole },
    backupTrusteeCheck(i.backupTrustee, backupHolds as boolean | null, i.backupSkipped),
    { label: "the admin holds DEFAULT_ADMIN_ROLE on the trigger", ok: isAdmin },
    {
      label: "the pool holds the schedule and economics entered above",
      ok: iStart === s.issuanceStart && iEnd === s.issuanceEnd && rStart === s.riskStart && mat === s.maturity && grace === s.grace && Number(coupon) === s.couponBps && cap === s.cap && minTicket === s.minTicket,
    },
    { label: "trigger.challengeWindow() is the window entered above", ok: tWindow === s.challengeWindow },
    { label: "the bond has 6 decimals (1 unit = 1 stablecoin base unit)", ok: Number(decimals) === 6 },
    { label: "supply guard: bond.totalSupply() <= unitsIssued - unitsRedeemed (D4, D18)", ok: (supply as bigint) <= books, detail: `${supply} <= ${books}` },
    { label: "pool.isSolvent()", ok: Boolean(solvent) },
  ];
  const code: Check[] = [
    { label: "FaultlinePool creation code on chain equals the repo build", ok: !!i.deployed.pool && eq(i.deployed.pool, i.build.pool), detail: `build ${i.build.pool}; sent ${i.deployed.pool ?? "unknown"}` },
    { label: "FaultlineTrigger creation code on chain equals the repo build", ok: !!i.deployed.trigger && eq(i.deployed.trigger, i.build.trigger), detail: `build ${i.build.trigger}; sent ${i.deployed.trigger ?? "unknown"}` },
  ];
  return [...roles, ...wiring, ...code];
}

/** keccak256 of the creation code a deployment transaction carried: its input minus the ABI-encoded constructor args. */
/** Never throws: a relay that answers from the mirror node can lag, so it retries for about 20 s, then gives up. */
export async function sentInitcodeKeccak(provider: Provider, txHash: string | undefined, initcodeLength: number): Promise<string | undefined> {
  if (!txHash) return undefined;
  for (let i = 0; i < 8; i++) {
    try {
      const tx = await provider.getTransaction(txHash);
      if (tx) {
        if (tx.to !== null) return undefined;
        const bytes = 2 + initcodeLength * 2;
        return tx.data.length >= bytes ? keccak256(tx.data.slice(0, bytes)) : undefined;
      }
    } catch {
      // retried below
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return undefined;
}

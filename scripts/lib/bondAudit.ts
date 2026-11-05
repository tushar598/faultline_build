// Post-deploy mitigations for the bond admin (SEC-02 stays accepted, see docs/SECURITY-TEST-REPORT.md). The pool cannot see
// the ATS role table, so a deploy script must read it: `auditBondRoles` lists every role that could move the supply, burn
// units or stop controllerRedeem. `handOverBondAdmin` moves DEFAULT_ADMIN_ROLE to a multisig or timelock. ATS refuses to let
// the last admin renounce (`CannotRenounceSoleAdmin`, simulated on FLDMO), so the only way out is grant first, then revoke.
// Role ids are ATS v8.0.0 `constants/roles.sol`.
import { ROLES } from "../../test/helpers/roles";

export const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Roles that nobody may hold on a Faultline bond, and what each one could do. */
export const FORBIDDEN_ROLES: Record<string, { id: string; why: string }> = {
  ROLE_AGENT: { id: ROLES.AGENT, why: "mints and burns like the pool" },
  ROLE_ADJUSTMENT_BALANCE: { id: ROLES.ADJUSTMENT_BALANCE, why: "rescales every balance (D4)" },
  ROLE_CORPORATE_ACTION: { id: "0xa1acfc499025c99f55059195e6276f639d34a18aad7b8121b9192b7f438c55cd", why: "schedules a balance adjustment that anyone can trigger" },
  ROLE_MATURITY_REDEEMER: { id: "0x433f48f8aca23480f6ab07666cbc9131d32a0b4672033453f65e18f4dd390523", why: "burns a holder's units with fullRedeemAtMaturity" },
  ROLE_PAUSER: { id: ROLES.PAUSER, why: "a paused bond blocks controllerRedeem and mint (S2)" },
  ROLE_LOCKER: { id: "0xd327cd9a2be405896f3d4584b3b437d798833cc4aa0aafb34c870659c0d47184", why: "locks units out of balanceOf (D9)" },
  ROLE_CLEARING: { id: "0xd0fe259e861ec493f60fb83851f1a173155b0f2acc3da153de2a23fb0ad26db6", why: "activates clearing, which stops transfers and holds (D9)" },
  ROLE_TREX_OWNER: { id: "0xd9e1264632ee9a37e8673a0c55a0a1d8b38c758e843084168ee08cd2d1f7e6f0", why: "sets the compliance contract ATS calls on every burn and transfer" },
  ROLE_FREEZE_MANAGER: { id: "0x71ae38482e1ab1c28e767d64766d686215b490c8c1bd7dfe6b101525187c2155", why: "freezes units out of balanceOf" },
};

type BondRoles = {
  hasRole(role: string, account: string): Promise<boolean>;
  getRoleMemberCount(role: string): Promise<bigint>;
  isControllable(): Promise<boolean>;
};

/** Every problem with the bond's role table; empty means the audit passed. */
export async function auditBondRoles(bond: BondRoles, pool: string): Promise<string[]> {
  const problems: string[] = [];
  for (const [name, role] of [["ROLE_ISSUER", ROLES.ISSUER], ["ROLE_CONTROLLER", ROLES.CONTROLLER]] as const) {
    if ((await bond.getRoleMemberCount(role)) !== 1n || !(await bond.hasRole(role, pool))) problems.push(`${name} must be held by the pool alone`);
  }
  for (const [name, { id, why }] of Object.entries(FORBIDDEN_ROLES)) {
    const members = await bond.getRoleMemberCount(id);
    if (members !== 0n) problems.push(`${name} has ${members} member(s): ${why}`);
  }
  if (!(await bond.isControllable())) problems.push("the bond is not controllable, so redeem can never work");
  return problems;
}

type BondAdmin = BondRoles & {
  grantRole(role: string, account: string): Promise<{ wait(): Promise<unknown> }>;
  revokeRole(role: string, account: string): Promise<{ wait(): Promise<unknown> }>;
};

/**
 * Two-step handover. The caller must hold DEFAULT_ADMIN_ROLE on `bond` and is `current`. The new admin is checked before
 * the old one goes, so a failure can never leave the bond with no admin.
 */
export async function handOverBondAdmin(bond: BondAdmin, current: string, next: string): Promise<void> {
  if (next.toLowerCase() === current.toLowerCase()) throw new Error("the new bond admin must differ from the current one");
  await (await bond.grantRole(DEFAULT_ADMIN_ROLE, next)).wait();
  if (!(await bond.hasRole(DEFAULT_ADMIN_ROLE, next))) throw new Error("the new bond admin did not receive the role");
  await (await bond.revokeRole(DEFAULT_ADMIN_ROLE, current)).wait();
  if ((await bond.getRoleMemberCount(DEFAULT_ADMIN_ROLE)) !== 1n) throw new Error("the bond must end with exactly one admin");
}

// ATS role ids, read from the single Solidity source (contracts/interfaces/IAtsBond.sol) so tests never drift.
import fs from "node:fs";
import path from "node:path";

export const IATSBOND_SOL = path.join(__dirname, "..", "..", "contracts", "interfaces", "IAtsBond.sol");

/** Every `bytes32 constant NAME = 0x…;` in IAtsBond.sol. */
export function parseRoleConstants(source = fs.readFileSync(IATSBOND_SOL, "utf8")): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/^bytes32 constant (ROLE_\w+) = (0x[0-9a-fA-F]{64});/gm)) out[m[1]] = m[2];
  return out;
}

const r = parseRoleConstants();
export const ROLES = {
  DEFAULT_ADMIN: "0x" + "00".repeat(32),
  ISSUER: r.ROLE_ISSUER,
  CONTROLLER: r.ROLE_CONTROLLER,
  AGENT: r.ROLE_AGENT,
  ADJUSTMENT_BALANCE: r.ROLE_ADJUSTMENT_BALANCE,
  KYC: r.ROLE_KYC,
  PAUSER: r.ROLE_PAUSER,
} as const;

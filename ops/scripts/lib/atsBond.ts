// The ATS v8 bond shape both Faultline testnet runs deploy through the factory (S1 shape, faultline docs/LESSONS.md S1):
// Luhn-valid ISIN (US + "FLS" + 6 clock digits + check digit), 6 decimals, nominal 1 USD (100 with 2 decimals),
// maxSupply = the pool cap, controllable, internal KYC, single partition, Reg S / NONE. rbacs: DEFAULT_ADMIN,
// SSI_MANAGER, KYC → the admin. Nobody gets ROLE_ISSUER, ROLE_AGENT or ROLE_PAUSER (D4; the pool gets ISSUER +
// CONTROLLER after its deploy). Date reasoning: scripts/smoke/smoke-2-bond.ts.
import { hexlify, toUtf8Bytes } from "ethers";
import { BLR, BOND_CONFIG_ID, ROLES, makeIsin } from "./common.js";

export type BondShape = { name: string; symbol: string; info: string; admin: string; cap: bigint; startDelaySec: number; maturityMin: number };

/** Factory.deployBond arguments for a bond whose dates are relative to `nowSec` (latest block time). */
export function bondArgs(nowSec: number, b: BondShape) {
  const startingDate = nowSec + b.startDelaySec;
  const maturityDate = nowSec + b.maturityMin * 60;
  const isin = makeIsin("US", "FLS" + String(nowSec).slice(-6));
  const security = {
    resolver: BLR,
    maxSupply: b.cap,
    resolverProxyConfiguration: { key: BOND_CONFIG_ID, version: 1n },
    erc20MetadataInfo: { name: b.name, symbol: b.symbol, isin, decimals: 6 },
    rbacs: [
      { role: ROLES.DEFAULT_ADMIN, members: [b.admin] },
      { role: ROLES.SSI_MANAGER, members: [b.admin] },
      { role: ROLES.KYC, members: [b.admin] },
    ],
    externalPauses: [],
    externalControlLists: [],
    externalKycLists: [],
    compliance: "0x0000000000000000000000000000000000000000",
    identityRegistry: "0x0000000000000000000000000000000000000000",
    arePartitionsProtected: false,
    isMultiPartition: false,
    isControllable: true,
    isWhiteList: false,
    clearingActive: false,
    internalKycActivated: true,
    erc20VotesActivated: false,
  };
  const bondDetails = { currency: hexlify(toUtf8Bytes("USD")), nominalValue: 100n, nominalValueDecimals: 2, startingDate: BigInt(startingDate), maturityDate: BigInt(maturityDate) };
  const regulation = { regulationType: 1, regulationSubType: 0, additionalSecurityData: { countriesControlListType: true, listOfCountries: "", info: b.info } };
  return { args: [{ security, bondDetails, proceedRecipients: [], proceedRecipientsData: [] }, regulation], isin, startingDate, maturityDate };
}

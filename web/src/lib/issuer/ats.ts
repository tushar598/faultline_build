// ATS v8 facts for the issuer page: role ids (contracts/interfaces/IAtsBond.sol and ATS v8.0.0 constants/roles.sol), the
// testnet factory and resolver (docs/reference/ats.md, ops/scripts/lib/common.ts), the ABIs (ops/abi, copied from the
// ATS v8.0.0 source by spike S1) and the deployBond arguments of both testnet runs (ops/scripts/lib/atsBond.ts), so a
// bond launched from the page has the shape the smoke run and the full demo proved. test/issuer.ats.test.ts checks the
// ids and addresses against those files.
import { hexlify, toUtf8Bytes } from "ethers";
import atsBondAbi from "../../../../ops/abi/AtsBond.json";
import atsFactoryAbi from "../../../../ops/abi/AtsFactory.json";

export const ATS_FACTORY = "0xd1F118A40f3b02883D35909eF2517e7EDd78379d"; // ATS v8 factory proxy 0.0.9213391
export const ATS_BLR = "0xBA2D5FC2083A0b8f164c50e65d782087fBA18E0a"; // ATS v8 BLR proxy 0.0.9212226
export const ATS_BOND_CONFIG_ID = "0x0000000000000000000000000000000000000000000000000000000000000002";

export const ATS_ROLES = {
  DEFAULT_ADMIN: "0x0000000000000000000000000000000000000000000000000000000000000000",
  ISSUER: "0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f",
  CONTROLLER: "0xb4d2b850c3ed8a234d390d5c157bbb1824883213c335ffe2a0f0761bb168713e",
  AGENT: "0x9830aa071a741c08855dd42130bdb0ff50f7bdf5a4b72f12181eefded0c6542b",
  ADJUSTMENT_BALANCE: "0xb246506a8ded65dd6360e8ce033fd9462936d1be64fb9f85c5f60d28cd3ca6da",
  KYC: "0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc",
  SSI_MANAGER: "0x3120494a82251fe85b0403877539486dbfcf0f94c20741a3229cfad31f625ee1",
  PAUSER: "0x3cb8b459fdb6e7dc3d2a2aa529e530f885d45e03584adb438423209c86a2731f",
} as const;

export const ATS_BOND_ABI = atsBondAbi as readonly object[];
export const ATS_FACTORY_ABI = atsFactoryAbi as readonly object[];

/** Same check digit as ATS contracts/factory/isinValidator.sol: Luhn over the letter-to-number expansion. */
export function isinChecksum(body11: string): number {
  const digits = body11
    .toUpperCase()
    .split("")
    .map((c) => (c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c))
    .join("");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) d *= 2;
    sum += d > 9 ? Math.floor(d / 10) + (d % 10) : d;
  }
  return (10 - (sum % 10)) % 10;
}

export function makeIsin(country: string, nsin9: string): string {
  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z0-9]{9}$/.test(nsin9)) throw new Error("bad ISIN parts");
  const body = country + nsin9;
  return body + isinChecksum(body);
}

export type AtsBondShape = { name: string; symbol: string; info: string; admin: string; cap: bigint; startingDate: number; maturityDate: number; isinSeed: number };

/**
 * Factory.deployBond arguments: 6 decimals, nominal 1 USD (100 with 2 decimals), maxSupply = the pool cap, controllable,
 * internal KYC, single partition, Reg S. rbacs: DEFAULT_ADMIN, SSI_MANAGER and KYC to the admin; nobody gets ROLE_ISSUER,
 * ROLE_AGENT or ROLE_PAUSER (D4: the pool gets ISSUER + CONTROLLER after its deploy). ISIN: US + "FLI" + 6 digits of
 * `isinSeed` + check digit ("FLI" marks a bond launched from the issuer page; the scripts use "FLS").
 */
export function atsBondArgs(b: AtsBondShape) {
  const isin = makeIsin("US", "FLI" + String(b.isinSeed).padStart(6, "0").slice(-6));
  const security = {
    resolver: ATS_BLR,
    maxSupply: b.cap,
    resolverProxyConfiguration: { key: ATS_BOND_CONFIG_ID, version: 1n },
    erc20MetadataInfo: { name: b.name, symbol: b.symbol, isin, decimals: 6 },
    rbacs: [
      { role: ATS_ROLES.DEFAULT_ADMIN, members: [b.admin] },
      { role: ATS_ROLES.SSI_MANAGER, members: [b.admin] },
      { role: ATS_ROLES.KYC, members: [b.admin] },
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
  const bondDetails = { currency: hexlify(toUtf8Bytes("USD")), nominalValue: 100n, nominalValueDecimals: 2, startingDate: BigInt(b.startingDate), maturityDate: BigInt(b.maturityDate) };
  const regulation = { regulationType: 1, regulationSubType: 0, additionalSecurityData: { countriesControlListType: true, listOfCountries: "", info: b.info } };
  return { args: [{ security, bondDetails, proceedRecipients: [], proceedRecipientsData: [] }, regulation] as const, isin };
}

// Networks the dashboard can read. Only public data lives here: RPC URLs, contract addresses, topic ids. Local
// addresses change on every deploy, so the local entry is completed at run time from oracle/config.local.json (read by
// the /api/local/config route handler). Testnet entities come from docs/DEPLOYMENTS.md ("Full demo").
import { kutchTerms, type Terms } from "@/lib/shared";

export type NetworkId = "local" | "testnet";

export type NetworkConfig = {
  id: NetworkId;
  label: string;
  chainId: number;
  rpcUrl: string;
  /** Tried in order after `rpcUrl` when it does not answer eth_chainId (testnet: the relays in the Hedera docs). */
  rpcFallbacks?: string[];
  /** FaultlineTrigger; the pool and every other address are read from it. */
  trigger: string | null;
  hcs: { mode: "mock"; topicId: string | null } | { mode: "mirror"; topicId: string; mirrorUrl: string };
  /** Event logs: eth_getLogs on the node, or the mirror node's REST API (Hashio limits log ranges). */
  logs: { mode: "rpc"; fromBlock: number } | { mode: "mirror"; mirrorUrl: string };
  /** The terms behind termsHash, checked against the chain before they are shown. */
  terms: Terms | null;
  explorer: { name: string; baseUrl: string } | null;
  pollMs: number;
  nativeCurrency: { name: string; symbol: string; decimals: number };
};

export const LOCAL_BASE: NetworkConfig = {
  id: "local",
  label: "Local Hardhat node",
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
  trigger: null,
  hcs: { mode: "mock", topicId: null },
  logs: { mode: "rpc", fromBlock: 0 },
  terms: null,
  explorer: null,
  pollMs: 2_000,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

const MIRROR = "https://testnet.mirrornode.hedera.com";

/** The full testnet demo bond of this repo (2026-11-05, docs/DEPLOYMENTS.md "Full demo"): D17 build, new FLH_* accounts,
 *  Flow A (a SYNTHETIC event, paused and vetoed) and Flow B (the real Bhuj record, executed), read only. */
export const TESTNET: NetworkConfig = {
  id: "testnet",
  label: "Hedera testnet",
  chainId: 296,
  // Hashio and thirdweb are the hosted relays the Hedera docs list without an API key; both allow browser CORS.
  // NEXT_PUBLIC_TESTNET_RPC_URL puts another read-only relay first.
  rpcUrl: process.env.NEXT_PUBLIC_TESTNET_RPC_URL || "https://testnet.hashio.io/api",
  rpcFallbacks: ["https://testnet.hashio.io/api", "https://296.rpc.thirdweb.com"],
  trigger: "0xD51E0712C1849818c3919195034539E041b3405c",
  hcs: { mode: "mirror", topicId: "0.0.11330395", mirrorUrl: MIRROR },
  logs: { mode: "mirror", mirrorUrl: MIRROR },
  terms: kutchTerms("replay", 813436806),
  explorer: { name: "HashScan", baseUrl: "https://hashscan.io/testnet" },
  pollMs: 8_000,
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
};

/** Entities and transactions recorded in docs/DEPLOYMENTS.md ("Full demo"), for the Evidence view. */
export const TESTNET_EVIDENCE = {
  title: "Testnet full demo (2026-11-05)",
  entities: [
    { label: "FaultlinePool", id: "0.0.11330416", evm: "0x6d84cb8d063424850347eE1ebc1399885320597e", kind: "contract" },
    { label: "FaultlineTrigger", id: "0.0.11330420", evm: "0xD51E0712C1849818c3919195034539E041b3405c", kind: "contract" },
    { label: "ATS v8 bond FLDMO (Faultline Demo Bond)", id: "0.0.11330397", evm: "0x4DdEBa59E3b8e5e62bD3f3872571EE4779C8f173", kind: "contract" },
    { label: "HTS stablecoin fUSD (Faultline Test USD)", id: "0.0.11329874", evm: "0x0000000000000000000000000000000000aCe152", kind: "token" },
    { label: "HCS topic (submit key oracle, admin key trustee, payer relayer)", id: "0.0.11330395", evm: null, kind: "topic" },
  ],
  transactions: [
    { label: "Primary trustee grants TRUSTEE_ROLE to the backup trustee (D17)", hash: "0x713de6dadab43e396b7eb8ed971080450d3d322c4d68d5411cd838413a5a20d6" },
    { label: "Sponsor fundCoupons(1.000000)", hash: "0xcb41b35b0798b76b4754ac42815c3d5801d04c26f4383dfeb8d0e517ad8732f8" },
    { label: "Investor A invest(300.000000)", hash: "0x6f1080bcb1dddbc6dd1885a59c206dc90100f89b3a11491b754e41e12a612311" },
    { label: "Investor B invest(200.000000)", hash: "0x5783b1bd0681181e11854b1e2531a0c6e1588299ad3d8e60cb821244d4859ccf" },
    { label: "Oracle submit, SYNTHETIC synthetic-kutch-testnet-a (5,000 bps)", hash: "0xc9076911ebaab2803b8eb9d37e0ff1408277b4000dc45690a1fb403fa55dba38" },
    { label: "Trustee pause (114 s left in the 120 s window)", hash: "0x9c19d11a28047f26bf62074f37817bfbbfd449f13fc250c20c6ccd1fdc2ee171" },
    { label: "Trustee veto of the SYNTHETIC event, while paused", hash: "0x07e25a965ab8792e9c62948183217576d1ac24632a1cf50352bdd3b39d735caa" },
    { label: "Admin unpause (paused 45 s)", hash: "0xa6f5ca6911b9321037fa382178991d81cbe3bdf7388b9003dd2070eaa679e1da" },
    { label: "Same signature re-submitted: reverts EventFinalised", hash: "0x12b9c4f7ef45bf60225d3cfdb68b846ae5a1692dd470ce0942c7e1ac52cdf066" },
    { label: "Oracle submit, Bhuj usp000a8ds live record (7,000 bps)", hash: "0x3da26e2aacb38f009b244dfebe34fddcde87924f749fa447203d80fd1e58d0ae" },
    { label: "Oracle keeper execute (L 0 to 7,000 bps)", hash: "0x010bf61d17e0ae07b80e29d6d2fb71d4c0b96c462939713e249df40fe435ac5c" },
  ],
} as const;

export function hashscan(net: NetworkConfig, kind: "contract" | "token" | "topic" | "transaction" | "account", id: string): string | null {
  return net.explorer ? `${net.explorer.baseUrl}/${kind}/${id}` : null;
}

/** Starting values of the issuer page on Hedera testnet: the FLH_* accounts and fUSD (docs/ACCOUNTS.md,
 *  docs/DEPLOYMENTS.md). Public addresses only; every field stays editable. */
export const TESTNET_ISSUER_DEFAULTS = {
  sponsor: "0x457DC9004E8e68FFEbed749C18Ed27F94Ca66FE3",
  oracle: "0x90A59Def9432C863A76F995Cd1eE57a881bb5a76",
  trustee: "0x965eB9d778a912b23e467ba28490927b25E655ee",
  stablecoin: "0x0000000000000000000000000000000000aCe152",
  topicPayer: "0x2f9A68d7880c9052A7Dac59aFe5b8223CF2eD5Db",
  kycKeyHolder: "0xbF89BCE061513D4763047D5F5A16846F149Ca248",
  backupTrustee: "0xD66383855628a46A3E300ad889E9dF2eA9c5A0B0",
} as const;

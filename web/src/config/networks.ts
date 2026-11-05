// Networks the dashboard can read. Only public data lives here: RPC URLs, contract addresses, topic ids. Local
// addresses change on every deploy, so the local entry is completed at run time from oracle/config.local.json (read by
// the /api/local/config route handler). Testnet entities come from docs/DEPLOYMENTS.md once the fresh testnet
// deployment exists (Part 7); until then the testnet entry has no trigger, no topic and no terms, and the views say so.
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

/** The fresh testnet deployment (Part 7). NOT DEPLOYED YET: trigger, topic and terms are filled in from
 *  docs/DEPLOYMENTS.md after the owner runs the deploy scripts. Nothing from the old deployment is reused. */
export const TESTNET: NetworkConfig = {
  id: "testnet",
  label: "Hedera testnet",
  chainId: 296,
  // Hashio and thirdweb are the hosted relays the Hedera docs list without an API key; both allow browser CORS.
  // NEXT_PUBLIC_TESTNET_RPC_URL puts another read-only relay first.
  rpcUrl: process.env.NEXT_PUBLIC_TESTNET_RPC_URL || "https://testnet.hashio.io/api",
  rpcFallbacks: ["https://testnet.hashio.io/api", "https://296.rpc.thirdweb.com"],
  trigger: null, // Part 7
  hcs: { mode: "mirror", topicId: "", mirrorUrl: MIRROR }, // topic id: Part 7
  logs: { mode: "mirror", mirrorUrl: MIRROR },
  terms: null, // kutchTerms("replay", <offset of the new deployment>): Part 7
  explorer: { name: "HashScan", baseUrl: "https://hashscan.io/testnet" },
  pollMs: 8_000,
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
};

/** Entities and transactions of the fresh testnet deployment, for the Evidence view. Empty until Part 7 records
 *  them in docs/DEPLOYMENTS.md. */
export const TESTNET_EVIDENCE: {
  title: string;
  entities: readonly { label: string; id: string | null; evm: string | null; kind: "contract" | "token" | "topic" }[];
  transactions: readonly { label: string; hash: string }[];
} = {
  title: "Testnet deployment (not deployed yet)",
  entities: [],
  transactions: [],
};

export function hashscan(net: NetworkConfig, kind: "contract" | "token" | "topic" | "transaction" | "account", id: string): string | null {
  return net.explorer ? `${net.explorer.baseUrl}/${kind}/${id}` : null;
}

/** Starting values of the issuer page on Hedera testnet: the new FLH_* accounts and the new stablecoin, filled in from
 *  docs/ACCOUNTS.md in Part 7. Public addresses only; every field stays editable. Empty until then. */
export const TESTNET_ISSUER_DEFAULTS = {
  sponsor: "",
  oracle: "",
  trustee: "",
  stablecoin: "",
  topicPayer: "",
  kycKeyHolder: "",
  backupTrustee: "",
} as const;

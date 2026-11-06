// Shared bits for the issuer-page helpers (web /issuer): the steps a browser wallet cannot sign, run from ops/ with keys
// from the global Hardhat 3 keystore. Written 2026-11-03, NOT testnet-verified.
//
// Same safety model as scripts/lib/common.ts: dry run by default; EXECUTE=1 only by the owner; a key is resolved from
// the keystore (the owner types the password) only with EXECUTE=1, held in memory, checked against the address the
// issuer page expects, and never printed or written. Accounts are named by their network in hardhat.config.ts
// (flhDeployer, flhTrustee, flhOracle, flhRelayer, …): add a network there for any other keystore entry.
import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { PrivateKey } from "@hashgraph/sdk";
import { getAddress, isAddress } from "ethers";
import { KEY_FOR, ROOT, type SignerNetwork } from "../lib/common.js";
import { mirror } from "../lib/hedera.js";

/** `name` from the environment as a hardhat.config.ts network that holds a keystore key. */
export function networkEnv(name: string, fallback: SignerNetwork): SignerNetwork {
  const v = process.env[name] ?? fallback;
  if (!(v in KEY_FOR)) throw new Error(`${name}=${v} is not a keystore network in ops/hardhat.config.ts (${Object.keys(KEY_FOR).join(", ")})`);
  return v as SignerNetwork;
}

/** A required EVM address from the environment, checksummed. */
export function addressEnv(name: string): string {
  const v = process.env[name];
  if (!v || !isAddress(v)) throw new Error(`${name} must be an EVM address (got ${v ?? "nothing"})`);
  return getAddress(v);
}

/** The SDK key behind `network`, checked to derive to `expected`. EXECUTE only; never printed. */
export async function keyFor(network: SignerNetwork, expected: string): Promise<PrivateKey> {
  const net = hre.config.networks[network] as unknown as { accounts: { get(): Promise<string> }[] };
  const raw = await net.accounts[0].get();
  const key = PrivateKey.fromStringECDSA(raw.startsWith("0x") ? raw.slice(2) : raw);
  const evm = getAddress("0x" + key.publicKey.toEvmAddress());
  if (evm !== getAddress(expected)) throw new Error(`${KEY_FOR[network]} derives to ${evm}, not ${expected}; nothing sent`);
  return key;
}

type MirrorAccount = { account: string; evm_address: string | null; key: { _type: string; key: string } | null };
/** Hedera id (0.0.x) of an EVM address: an account, else a contract. Undefined when the mirror node knows neither. */
export async function hederaIdOf(evm: string): Promise<{ id: string; kind: "account" | "contract" } | undefined> {
  const a = await mirror<MirrorAccount>(`/api/v1/accounts/${evm}`);
  if (a?.account) return { id: a.account, kind: "account" };
  const c = await mirror<{ contract_id: string }>(`/api/v1/contracts/${evm}`);
  return c?.contract_id ? { id: c.contract_id, kind: "contract" } : undefined;
}

/** `0.0.x` or a long-zero EVM address (`0x000…00ace152`) → `0.0.x`. */
export function tokenIdOf(v: string): string {
  if (/^0\.0\.\d+$/.test(v)) return v;
  if (isAddress(v) && /^0x0{24}/i.test(v)) return `0.0.${BigInt(v)}`;
  throw new Error(`TOKEN must be 0.0.x or a long-zero EVM address (got ${v})`);
}

/** Result file for one helper run (public data only: ids, keys' public halves, statuses). */
export function saveResult(name: string, data: Record<string, unknown>): string {
  const dir = path.join(ROOT, "out", "issuer");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 2) + "\n");
  return file;
}

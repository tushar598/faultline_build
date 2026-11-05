// Keys come ONLY from the environment of the current terminal session, typed by the owner with `read -s`:
//   read -s ORACLE_PRIVATE_KEY && export ORACLE_PRIVATE_KEY      # signs attestations and advisories (HCS submit key, D16)
//   read -s RELAYER_PRIVATE_KEY && export RELAYER_PRIVATE_KEY    # pays EVM and HCS fees (D16)
// They are never read from a file, never printed and never logged; only addresses are shown.
//
// Local chain only (chainId 31337): HARDHAT_ACCOUNT_ORACLE=<i> / HARDHAT_ACCOUNT_RELAYER=<i> pick account i of
// Hardhat's PUBLIC default test mnemonic. Any key that belongs to that mnemonic is refused on every other chain,
// so a test key can never sign a testnet or mainnet attestation.
import { HDNodeWallet, Mnemonic, Wallet } from "ethers";

/** Hardhat's documented default mnemonic (public, test-only; every Hardhat user has these accounts). */
const HARDHAT_TEST_MNEMONIC = "test test test test test test test test test test test junk";
const HARDHAT_ACCOUNTS = 20;
export const LOCAL_CHAIN_ID = 31_337n;

let testAccounts: { address: string; key: string }[] | undefined;
function hardhatAccounts(): { address: string; key: string }[] {
  if (!testAccounts) {
    const root = HDNodeWallet.fromSeed(Mnemonic.fromPhrase(HARDHAT_TEST_MNEMONIC).computeSeed());
    testAccounts = Array.from({ length: HARDHAT_ACCOUNTS }, (_, i) => {
      const w = root.derivePath(`m/44'/60'/0'/0/${i}`);
      return { address: w.address, key: w.privateKey };
    });
  }
  return testAccounts;
}

/** True when `address` is one of Hardhat's default test accounts. */
export const isHardhatTestAccount = (address: string) => hardhatAccounts().some((a) => a.address.toLowerCase() === address.toLowerCase());

export type Role = "oracle" | "relayer";
const ENV: Record<Role, { key: string; index: string }> = {
  oracle: { key: "ORACLE_PRIVATE_KEY", index: "HARDHAT_ACCOUNT_ORACLE" },
  relayer: { key: "RELAYER_PRIVATE_KEY", index: "HARDHAT_ACCOUNT_RELAYER" },
};

/** The wallet for `role` on `chainId` (not connected). Throws, without echoing any key material, when it is missing,
 *  malformed, or a Hardhat test key outside chainId 31337. */
export function walletFor(role: Role, chainId: bigint, env: NodeJS.ProcessEnv = process.env): Wallet {
  const { key, index } = ENV[role];
  let wallet: Wallet;
  if (env[key]) {
    try {
      wallet = new Wallet(env[key]!.trim());
    } catch {
      throw new Error(`${key} is not a valid private key (value not shown)`);
    }
  } else if (env[index] !== undefined) {
    if (chainId !== LOCAL_CHAIN_ID) throw new Error(`${index} (Hardhat test accounts) is only allowed on chainId 31337, not ${chainId}`);
    const i = Number(env[index]);
    const acct = Number.isInteger(i) ? hardhatAccounts()[i] : undefined;
    if (!acct) throw new Error(`${index} must be an integer 0..${HARDHAT_ACCOUNTS - 1}`);
    wallet = new Wallet(acct.key);
  } else {
    throw new Error(`no ${role} key: set ${key} with \`read -s ${key} && export ${key}\`${chainId === LOCAL_CHAIN_ID ? ` (or ${index}=<i> on the local chain)` : ""}`);
  }
  if (chainId !== LOCAL_CHAIN_ID && isHardhatTestAccount(wallet.address)) {
    throw new Error(`${role} key ${wallet.address} is a public Hardhat test account; refused on chainId ${chainId}`);
  }
  return wallet;
}

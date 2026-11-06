// Hardhat 3 config for the Faultline testnet operator scripts (ops/), with one network per FLH_* keystore name
// (docs/ACCOUNTS.md). The repo root stays Hardhat 2; this folder has its own node_modules and never compiles contracts
// (the scripts read the root build in ../artifacts).
import type { HardhatUserConfig } from "hardhat/config";
import { configVariable } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatKeystore from "@nomicfoundation/hardhat-keystore";

// Keys come only from the global Hardhat 3 keystore (~/Library/Preferences/hardhat-nodejs/keystore.json), never from a
// file in this repo. A key is resolved (and the keystore password asked) only when a script runs with EXECUTE=1 or with
// CHECK_KEYS=1 in a preflight. Every signer is one of the FLH_* accounts.
const RPC = "https://testnet.hashio.io/api";

const config: HardhatUserConfig = {
  plugins: [hardhatEthers, hardhatKeystore],
  solidity: {
    version: "0.8.28",
    settings: { evmVersion: "cancun", optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    // Read-only: no key, never prompts for the keystore password. Every script runs on it; signers come from signerFor().
    testnetRead: { type: "http", chainType: "l1", url: RPC, chainId: 296 },
    // Faultline accounts (docs/ACCOUNTS.md). These networks only resolve a key from the
    // keystore for signerFor(); every request goes through a plain ethers provider.
    flhDeployer: { type: "http", chainType: "l1", url: RPC, chainId: 296, accounts: [configVariable("FLH_DEPLOYER_PRIVATE_KEY")] },
    flhTrustee: { type: "http", chainType: "l1", url: RPC, chainId: 296, accounts: [configVariable("FLH_TRUSTEE_PRIVATE_KEY")] },
    flhOracle: { type: "http", chainType: "l1", url: RPC, chainId: 296, accounts: [configVariable("FLH_ORACLE_PRIVATE_KEY")] },
    flhSponsor: { type: "http", chainType: "l1", url: RPC, chainId: 296, accounts: [configVariable("FLH_SPONSOR_PRIVATE_KEY")] },
    flhInvestorA: { type: "http", chainType: "l1", url: RPC, chainId: 296, accounts: [configVariable("FLH_INVESTOR_A_PRIVATE_KEY")] },
    flhInvestorB: { type: "http", chainType: "l1", url: RPC, chainId: 296, accounts: [configVariable("FLH_INVESTOR_B_PRIVATE_KEY")] },
    // Oracle relayer (D16): pays HCS and EVM fees for the oracle.
    flhRelayer: { type: "http", chainType: "l1", url: RPC, chainId: 296, accounts: [configVariable("FLH_RELAYER_PRIVATE_KEY")] },
    // Backup trustee (D17).
    flhTrusteeBackup: { type: "http", chainType: "l1", url: RPC, chainId: 296, accounts: [configVariable("FLH_TRUSTEE_BACKUP_PRIVATE_KEY")] },
  },
};

export default config;

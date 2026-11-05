import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";

// Testnet key comes only from the current terminal session (never a file in this repo):
//   read -s HEDERA_TESTNET_PK && export HEDERA_TESTNET_PK
const testnetKey = process.env.HEDERA_TESTNET_PK;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      // OpenZeppelin 5.6 uses MCOPY, so "shanghai" fails to compile. ATS v8 also builds with
      // 0.8.28 + cancun and runs on Hedera testnet. See docs/LESSONS.md.
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      hardfork: "cancun",
    },
    hederaTestnet: {
      url: process.env.HEDERA_TESTNET_RPC ?? "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: testnetKey ? [testnetKey] : [],
      timeout: 120_000,
    },
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
  mocha: {
    timeout: 120_000,
  },
};

export default config;

// Deploys the oracle's local world on a running Hardhat node and writes oracle/config.local.json + oracle/terms/local.json.
//   npm run node                                               # terminal 1
//   npx hardhat run scripts/deploy-local.ts --network localhost  # terminal 2
// MOCK-TESTED, LOCAL ONLY (see scripts/lib/oracle-local.ts).
import { deployOracleWorld } from "./lib/oracle-local";

deployOracleWorld(console.log).then(
  ({ trigger }) => console.log(`\ntrigger ${trigger} — next: cd oracle && HARDHAT_ACCOUNT_ORACLE=3 HARDHAT_ACCOUNT_RELAYER=4 npm run verify-config`),
  (e) => {
    console.error(e);
    process.exitCode = 1;
  },
);

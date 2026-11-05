// Sets up the dashboard's live demo on a running Hardhat node (HANDOVER §10 step 7). MOCK-TESTED, LOCAL ONLY:
// MockBond / MockUSD / MockHTS, the file mock of HCS, Hardhat test accounts for the oracle and relayer.
//   npm run node                                                        # terminal 1
//   npx hardhat run scripts/dashboard-demo-local.ts --network localhost  # terminal 2
//   npm run web:dev                                                     # terminal 3, open http://localhost:3000/replay
// What it does: deploys the local world (oracle/config.local.json, which the dashboard reads) with a short challenge
// window you can watch run out (DEMO_WINDOW_SEC, default 300 s; the LOCAL profile's 48 h stays for every e2e), moves
// chain time past the replayed events, then runs the oracle CLI:
//   1. Bhuj usp000a8ds (REAL USGS record, replay --offline) → HCS attestation + submit → Pending, 7000 bps.
//   2. unless DEMO_ADVISORY=0: synthetic-kutch-3 (SYNTHETIC) → Pending 3000 bps, then its revision outside the box →
//      a signed D15 advisory on HCS ("trustee should veto"); nothing is submitted for it.
// The node then mines a block every 2 s (like Hedera) so chain time keeps moving while you watch.
// The rest happens in the dashboard (trustee veto, execute after the window) or with `npm --prefix oracle run keeper`.
import { network } from "hardhat";
import { latest, travelTo, usd } from "./lib/e2e";
import { deployOracleWorld, runOracleCli } from "./lib/oracle-local";

const DAY = 86_400n;

async function main() {
  const window = BigInt(process.env.DEMO_WINDOW_SEC ?? "300");
  if (window < 10n || window > 7n * DAY) throw new Error(`DEMO_WINDOW_SEC ${window} must be between 10 s and 7 days`);
  const { w, trigger, topicId } = await deployOracleWorld(console.log, { challengeWindow: window });

  // Bhuj is replayed to riskStart + 10 d, synthetic-kutch-3 to + 35 d: both must be in the past to be attested.
  await travelTo(w.s.riskStart + 36n * DAY);
  console.log(`\nchain time moved to riskStart + 36 days (${await latest()})`);
  runOracleCli(["verify-config"]);
  runOracleCli(["replay", "--usgs-event", "usp000a8ds", "--offline"]);
  if (process.env.DEMO_ADVISORY !== "0") {
    runOracleCli(["replay", "--fixture", "synthetic-kutch-3.geojson"]);
    runOracleCli(["replay", "--fixture", "synthetic-kutch-3-revised-outside-box.geojson"]);
  }

  // A Hardhat node mines only on a transaction, so chain time (and every challenge window) would stand still while the
  // dashboard watches. One block every 2 s makes it behave like Hedera (a block about every 2 s); automine stays on.
  // The oracle CLIs above block this process, so the node may have closed the idle keep-alive socket: the first request
  // can fail with ECONNRESET under load. It changes nothing on the node, so one retry is safe.
  await network.provider.send("evm_setIntervalMining", [2_000]).catch((e: { code?: string }) => {
    if (e.code !== "ECONNRESET") throw e;
    return network.provider.send("evm_setIntervalMining", [2_000]);
  });

  const pending = await w.trigger.pendingCount();
  console.log(`\n=== dashboard demo ready (mock-tested, local only) ===`);
  console.log(`  trigger ${trigger}, mock HCS topic ${topicId}, ${pending} pending, window ${window} s of unpaused time`);
  console.log(`  units issued ${usd(await w.pool.unitsIssued())} USD (A 5,000 / B 3,000 / C 2,000), L ${await w.pool.appliedLossBps()} bps`);
  console.log(`  wallets (Hardhat test accounts, import into MetaMask for chain 31337): admin #0, sponsor #1, trustee #2 (backup #8), investors A/B/C #5/#6/#7`);
  console.log(`  next: watch /replay and /trustee; veto the SYNTHETIC event as the trustee; after the window press Execute`);
  console.log(`        (or: cd oracle && HARDHAT_ACCOUNT_ORACLE=3 HARDHAT_ACCOUNT_RELAYER=4 npm run keeper -- --once)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

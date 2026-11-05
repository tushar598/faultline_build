// Runs the three local end-to-end flows (scripts/lib/e2e.ts) and prints a summary.
// MOCK-TESTED, LOCAL ONLY: real FaultlinePool + FaultlineTrigger, MockBond (not ATS), MockUSD + MockHTS (not HTS).
//   npm run e2e:local                                   # in-process Hardhat chain
//   npm run node   # other terminal, then:
//   npx hardhat run scripts/e2e-local.ts --network localhost
import { runAll, usd } from "./lib/e2e";

async function main() {
  const results = await runAll();
  console.log("\n=== Summary (mock-tested, local only) ===");
  for (const r of results) {
    console.log(`${r.flow}: L ${r.L} bps, sponsor credited ${usd(r.sponsorCredited)} (claimed ${usd(r.sponsorClaimed)} incl. unused reserve), leftover ${usd(r.leftover)}`);
    for (const [h, v] of Object.entries(r.holders)) console.log(`  ${h}: ${usd(v.units)} units → ${usd(v.principal)} principal + ${usd(v.coupon)} coupon`);
    console.log(`  paid out ${usd(r.paidOut)} == deposits ${usd(r.deposits)} + coupon reserve ${usd(r.couponReserve)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

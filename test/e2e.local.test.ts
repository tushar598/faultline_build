// The three local end-to-end flows of scripts/lib/e2e.ts (which assert invariants after every step themselves),
// checked here against numbers computed independently from ARCHITECTURE §3.4/§5.
// MOCK-TESTED, LOCAL ONLY: real FaultlinePool + FaultlineTrigger; MockBond is not ATS, MockUSD/MockHTS are not HTS.
import { expect } from "chai";
import { LOCAL, TICKETS, flowA, flowB, flowC, type FlowResult } from "../scripts/lib/e2e";

const BPS = 10_000n;
const SCALE = 10n ** 18n;
const YEAR = 365n * 86_400n;
const quiet = () => undefined;
const U = TICKETS.A + TICKETS.B + TICKETS.C;
const RESERVE = (U * LOCAL.couponBps) / BPS; // 600 USD: exact for a 365-day term
/** Coupon index growth for `dt` seconds at loss `L` (§3.4). */
const acc = (L: bigint, dt: bigint) => ((BPS - L) * LOCAL.couponBps * dt * SCALE) / (BPS * BPS * YEAR);

function expectBooks(r: FlowResult, L: bigint, index: bigint) {
  expect(r.L).to.equal(L);
  expect(r.units).to.equal(U);
  expect(r.sponsorCredited).to.equal((U * L) / BPS);
  expect(r.couponReserve).to.equal(RESERVE);
  let holdersTotal = 0n;
  for (const h of ["A", "B", "C"] as const) {
    const b = TICKETS[h];
    expect(r.holders[h].units, h).to.equal(b);
    expect(r.holders[h].principal, `${h} principal`).to.equal((b * (BPS - L)) / BPS);
    expect(r.holders[h].coupon, `${h} coupon`).to.equal((b * index) / SCALE);
    holdersTotal += r.holders[h].principal + r.holders[h].coupon;
  }
  expect(r.paidOut).to.equal(r.deposits + r.couponReserve);
  expect(r.deposits).to.equal(U);
  expect(r.sponsorClaimed).to.equal(r.paidOut - holdersTotal); // collateral credit + unused reserve + dust
  expect(r.leftover).to.equal(0n);
}

describe("local e2e (mock-tested, local only)", () => {
  it("Flow A — Bhuj submitted, paused, vetoed while paused, replay rejected; 0 % loss, full 6 % coupon", async () => {
    const r = await flowA(quiet);
    expectBooks(r, 0n, acc(0n, r.maturity - r.riskStart));
    expect(r.holders.A.coupon).to.equal(300_000_000n); // 5,000 USD × 6 %
    expect(r.sponsorClaimed).to.equal(0n);
  });

  it("Flow B — Bhuj 7000 then SYNTHETIC M7.2 2000 in grace: L = 9000; second loss after maturity leaves coupons unchanged", async () => {
    const r = await flowB(quiet);
    const [t1] = r.executedAt;
    expect(r.executedAt.length).to.equal(2);
    expectBooks(r, 9_000n, acc(0n, t1 - r.riskStart) + acc(7_000n, r.maturity - t1));
    expect(r.sponsorCredited).to.equal(9_000_000_000n);
    expect(r.holders.A.principal).to.equal(500_000_000n);
  });

  it("Flow C — Bhuj + SYNTHETIC M7.5 + SYNTHETIC M7.3 pending together: L capped at 10000, third Superseded", async () => {
    const r = await flowC(quiet);
    const [t1, t2] = r.executedAt;
    expect(r.executedAt.length).to.equal(2); // the third was Superseded
    expectBooks(r, 10_000n, acc(0n, t1 - r.riskStart) + acc(7_000n, t2 - t1));
    for (const h of ["A", "B", "C"] as const) expect(r.holders[h].principal).to.equal(0n);
    expect(r.sponsorCredited).to.equal(U); // all collateral
  });
});

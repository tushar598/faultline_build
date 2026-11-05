// RT-01 / SEC-15 (High, fixed by D18): a KYC'd holder burns its own units through ATS `redeem` (no role). Before D18 the
// pool's strict supply guard then reverted SupplyMismatch for everyone; the guard now reverts only when supply is ABOVE the
// books, and `isSolvent` counts the real supply. These tests state the fixed behaviour and D18's two accepted downsides.
// Mock-tested: MockBond copies ATS v8 Burn.redeem, simulated on the real FLDMO and FLSPK bonds (never mined; RT-02 mines it).
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import fc from "fast-check";
import { USD } from "./helpers/fixtures";
import { ROLES } from "./helpers/roles";
import { travelTo } from "./helpers/time";
import { A_UNITS, B_UNITS, MIN_TICKET, expectInvariants, investedPoolFixture, loss, readyPoolFixture } from "./helpers/pool";

const PARTITION_1 = ethers.zeroPadValue("0x01", 32);
const FC_RUNS = Number(process.env.FC_RUNS ?? 25);

/** Past the deadline, one base unit burned by `investor` with the real-shaped holder call. */
async function burnedAfterDeadlineFixture() {
  const f = await investedPoolFixture();
  await f.bond.connect(f.investor).redeem(1n, "0x");
  await travelTo(f.deadline + 1n);
  return f;
}

describe("SEC-15 — a holder's self-burn against the supply guard (fixed by D18)", () => {
  describe("ATS holder burn paths lower totalSupply with no role (mock of ATS v8, simulated on testnet)", () => {
    const paths = {
      "redeem(uint256,bytes)": async (f: Awaited<ReturnType<typeof investedPoolFixture>>) => f.bond.connect(f.investor).redeem(1n, "0x"),
      redeemByPartition: async (f: Awaited<ReturnType<typeof investedPoolFixture>>) => f.bond.connect(f.investor).redeemByPartition(PARTITION_1, 1n, "0x"),
      "redeemFrom (approved spender)": async (f: Awaited<ReturnType<typeof investedPoolFixture>>) => {
        await f.bond.connect(f.investor).approve(f.stranger.address, 1n);
        return f.bond.connect(f.stranger).redeemFrom(f.investor.address, 1n, "0x");
      },
      "operatorRedeemByPartition (authorised operator)": async (f: Awaited<ReturnType<typeof investedPoolFixture>>) => {
        await f.bond.connect(f.investor).authorizeOperator(f.stranger.address);
        return f.bond.connect(f.stranger).operatorRedeemByPartition(PARTITION_1, f.investor.address, 1n, "0x", "0x");
      },
    };
    for (const [name, burn] of Object.entries(paths)) {
      it(`${name} drops the supply by 1 and no longer locks another holder`, async () => {
        const f = await loadFixture(investedPoolFixture);
        const before = await f.bond.totalSupply();
        await burn(f);
        expect(await f.bond.totalSupply()).to.equal(before - 1n);
        await travelTo(f.deadline + 1n);
        await expect(f.pool.connect(f.investor2).redeem()).to.emit(f.pool, "Redeemed");
        await expectInvariants(f, { burned: true });
      });
    }
  });

  describe("after a burn every operation stays open", () => {
    it("the other holder redeems its full value", async () => {
      const f = await loadFixture(burnedAfterDeadlineFixture);
      const [principal, coupon] = await f.pool.effectiveValue(f.investor2.address);
      await expect(f.pool.connect(f.investor2).redeem()).to.emit(f.pool, "Redeemed").withArgs(f.investor2.address, B_UNITS, principal, coupon);
      expect(await f.pool.claimable(f.investor2.address)).to.equal(principal + coupon);
      await expectInvariants(f, { burned: true });
    });
    it("the burner redeems what it has left, and nothing for the burned unit", async () => {
      const f = await loadFixture(burnedAfterDeadlineFixture);
      await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
      const [principal, coupon] = await f.pool.effectiveValue(f.investor.address);
      expect(principal + coupon).to.equal(0n);
      expect(await f.pool.unitsRedeemed()).to.equal(A_UNITS - 1n);
      await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.pool, "NothingToRedeem");
    });
    it("sweepExcess releases the unused reserve", async () => {
      const f = await loadFixture(burnedAfterDeadlineFixture);
      await expect(f.pool.sweepExcess()).to.emit(f.pool, "ExcessSwept");
      expect(await f.pool.claimable(f.sponsor.address)).to.be.gt(0n);
      await expectInvariants(f, { swept: true, burned: true });
    });
    it("invest stays open during issuance, and cap and reserve keep counting on unitsIssued", async () => {
      const f = await loadFixture(readyPoolFixture);
      await travelTo(f.s.issuanceStart);
      await f.pool.connect(f.investor).invest(MIN_TICKET);
      await f.bond.connect(f.investor).redeem(1n, "0x");
      await expect(f.pool.connect(f.investor2).invest(MIN_TICKET)).to.emit(f.pool, "Invested");
      expect(await f.pool.unitsIssued()).to.equal(2n * MIN_TICKET);
      expect(await f.bond.totalSupply()).to.equal(2n * MIN_TICKET - 1n);
      await expectInvariants(f, { burned: true });
    });
    it("books close: every holder paid, sponsor gets the rest, supply and pool reach zero, isSolvent stays true", async () => {
      const f = await loadFixture(burnedAfterDeadlineFixture);
      await f.pool.connect(f.investor).redeem();
      await f.pool.connect(f.investor2).redeem();
      expect(await f.bond.totalSupply()).to.equal(0n);
      expect(await f.pool.unitsIssued() - (await f.pool.unitsRedeemed())).to.equal(1n); // the books keep the burned unit
      await f.pool.sweepDust();
      expect(await f.pool.isSolvent()).to.equal(true);
      for (const who of [f.investor, f.investor2, f.sponsor]) await f.pool.connect(who).claim();
      expect(await f.usd.balanceOf(await f.pool.getAddress())).to.equal(0n);
      expect(await f.pool.isSolvent()).to.equal(true);
    });
    it("a burn before, between and after two losses leaves every holder paid in full", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.connect(f.investor).redeem(USD(1), "0x");
      await loss(f, 3_000);
      await f.bond.connect(f.investor2).redeem(USD(1), "0x");
      await loss(f, 7_000);
      await f.bond.connect(f.investor).redeem(USD(1), "0x");
      await travelTo(f.deadline + 1n);
      await expectInvariants(f, { burned: true });
      for (const who of [f.investor, f.investor2]) await f.pool.connect(who).redeem();
      await f.pool.sweepDust();
      for (const who of [f.investor, f.investor2, f.sponsor]) await f.pool.connect(who).claim();
      expect(await f.usd.balanceOf(await f.pool.getAddress())).to.equal(0n);
    });
    it("repeated burns change nothing: the lever is gone", async () => {
      const f = await loadFixture(burnedAfterDeadlineFixture);
      await f.bond.connect(f.investor).redeem(1n, "0x");
      await f.bond.connect(f.investor2).redeem(1n, "0x");
      await expect(f.pool.connect(f.investor2).redeem()).to.emit(f.pool, "Redeemed");
      await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
    });
  });

  describe("D4 still stops supply going up", () => {
    it("a foreign mint with no burn reverts SupplyMismatch", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.test_adjustBalance(f.investor.address, 1n);
      await travelTo(f.deadline + 1n);
      const expected = A_UNITS + B_UNITS;
      await expect(f.pool.connect(f.investor2).redeem()).to.be.revertedWithCustomError(f.pool, "SupplyMismatch").withArgs(expected + 1n, expected);
      await expect(f.pool.sweepExcess()).to.be.revertedWithCustomError(f.pool, "SupplyMismatch").withArgs(expected + 1n, expected);
    });
    it("a foreign mint one unit above the burned amount reverts", async () => {
      const f = await loadFixture(burnedAfterDeadlineFixture);
      await f.bond.test_adjustBalance(f.investor.address, 2n);
      await expect(f.pool.connect(f.investor2).redeem()).to.be.revertedWithCustomError(f.pool, "SupplyMismatch");
    });
    it("exactly equal supply passes the boundary: the guard is `>`, not `>=`", async () => {
      const f = await loadFixture(investedPoolFixture);
      await travelTo(f.deadline + 1n);
      expect(await f.bond.totalSupply()).to.equal(A_UNITS + B_UNITS);
      await expect(f.pool.connect(f.investor).redeem()).to.emit(f.pool, "Redeemed");
    });
  });

  describe("accepted downsides of D18", () => {
    it("downside 1: a foreign mint up to the burned amount is NOT detected; honest holders are still paid in full and the sponsor bears it", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.connect(f.investor).redeem(USD(1), "0x"); // the investor burns 1 USD
      await f.bond.grantRole(ROLES.ISSUER, f.admin.address);
      await f.bond.mint(f.buyer.address, USD(1)); // needs a bond role D4 forbids
      await travelTo(f.deadline + 1n);
      await expect(f.pool.connect(f.buyer).redeem()).to.emit(f.pool, "Redeemed"); // not stopped
      const paid = await f.pool.claimable(f.buyer.address);
      expect(paid).to.be.gt(USD(1)); // principal + coupon of units the buyer never paid for
      for (const who of [f.investor, f.investor2]) await f.pool.connect(who).redeem();
      await f.pool.sweepDust();
      for (const who of [f.buyer, f.investor, f.investor2, f.sponsor]) await f.pool.connect(who).claim();
      expect(await f.usd.balanceOf(await f.pool.getAddress())).to.equal(0n);
    });
    it("downside 1, widest form: after sweepDust a masked mint has no reserve behind it, so whoever claims last is short, a slow holder included", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.connect(f.investor).redeem(USD(1), "0x");
      await travelTo(f.deadline + 1n);
      for (const who of [f.investor, f.investor2]) await f.pool.connect(who).redeem(); // both credited, neither claimed
      await f.pool.sweepDust();
      await f.bond.grantRole(ROLES.ISSUER, f.admin.address);
      await f.bond.mint(f.buyer.address, USD(1));
      await f.pool.connect(f.buyer).redeem(); // the books still show 1 USD outstanding, so the guard passes
      expect(await f.pool.isSolvent(), "isSolvent reports the hole").to.equal(false);
      await f.pool.connect(f.buyer).claim();
      await f.pool.connect(f.sponsor).claim();
      await f.pool.connect(f.investor).claim();
      await expect(f.pool.connect(f.investor2).claim()).to.be.reverted; // the last claimant carries the hole
    });
    it("downside 2: burned collateral stays reserved through sweepExcess and reaches the sponsor only through sweepDust", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.connect(f.investor).redeem(USD(1), "0x");
      await travelTo(f.deadline + 1n);
      await f.pool.sweepExcess();
      const swept = await f.pool.claimable(f.sponsor.address);
      await f.pool.connect(f.investor).redeem();
      await f.pool.sweepExcess();
      expect(await f.pool.claimable(f.sponsor.address)).to.equal(swept); // investor2 outstanding, burned value still held back
      await expect(f.pool.sweepDust()).to.be.revertedWithCustomError(f.pool, "SupplyNotZero");
      await f.pool.connect(f.investor2).redeem();
      await f.pool.sweepDust();
      expect((await f.pool.claimable(f.sponsor.address)) - swept).to.be.gte(USD(1));
    });
  });

  describe("what the burn does not do", () => {
    it("claim of an existing credit still works, and no stablecoin moves to the burner", async () => {
      const f = await loadFixture(investedPoolFixture);
      await loss(f, 3_000);
      await f.bond.connect(f.investor).redeem(1n, "0x");
      const usd = await f.usd.balanceOf(f.investor.address);
      await expect(f.pool.connect(f.sponsor).claim()).to.emit(f.pool, "Claimed");
      expect(await f.usd.balanceOf(f.investor.address)).to.equal(usd);
      expect(await f.pool.claimable(f.investor.address)).to.equal(0n);
      await expectInvariants(f, { burned: true });
    });
    it("a burn raises no one's payout: effective value falls with the balance and the pool stays solvent", async () => {
      const f = await loadFixture(investedPoolFixture);
      const [before] = await f.pool.effectiveValue(f.investor.address);
      await f.bond.connect(f.investor).redeem(USD(1), "0x");
      const [after] = await f.pool.effectiveValue(f.investor.address);
      expect(after).to.equal(before - USD(1));
      expect(await f.pool.isSolvent()).to.equal(true);
    });
    it("a bond pause stops the burn (IsPaused, after the compliance checks), but it is no defence: it also blocks the pool's controllerRedeem", async () => {
      const f = await loadFixture(investedPoolFixture);
      await f.bond.pause();
      await expect(f.bond.connect(f.investor).redeem(1n, "0x")).to.be.revertedWithCustomError(f.bond, "IsPaused");
      await expect(f.bond.connect(f.stranger).redeem(1n, "0x")).to.be.revertedWithCustomError(f.bond, "InvalidKycStatus");
      await travelTo(f.deadline + 1n);
      await expect(f.pool.connect(f.investor).redeem()).to.be.revertedWithCustomError(f.bond, "IsPaused");
    });
  });

  it("property (fast-check, on-chain): after any burn of any size, by either holder, the other holder redeems in full", async () => {
    const seed = Number(process.env.FC_SEED ?? Date.now() & 0x7fffffff);
    console.log(`      fast-check seed ${seed}, runs ${FC_RUNS} (FC_SEED, FC_RUNS)`);
    const f = await loadFixture(investedPoolFixture);
    await travelTo(f.deadline + 1n);
    const baseline = await ethers.provider.send("evm_snapshot", []);
    let snapshot = baseline;
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.bigInt({ min: 1n, max: A_UNITS }), async (useA, amount) => {
        await ethers.provider.send("evm_revert", [snapshot]);
        snapshot = await ethers.provider.send("evm_snapshot", []);
        const burner = useA ? f.investor : f.investor2;
        const other = useA ? f.investor2 : f.investor;
        await f.bond.connect(burner).redeem(amount, "0x");
        const [principal, coupon] = await f.pool.effectiveValue(other.address);
        await expect(f.pool.connect(other).redeem()).to.emit(f.pool, "Redeemed");
        expect(await f.pool.claimable(other.address)).to.equal(principal + coupon);
      }),
      { numRuns: FC_RUNS, seed },
    );
    await ethers.provider.send("evm_revert", [snapshot]);
  });
});

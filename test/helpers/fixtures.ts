// Deploys the local mocks. MockHTS is placed at the HTS system contract address 0x167 with setCode
// (runtime code only; MockHTS is stateless and reads flags from MockUSD).
import { ethers } from "hardhat";
import { setCode } from "@nomicfoundation/hardhat-network-helpers";
import { ROLES } from "./roles";

export const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
export const USD = (whole: number | bigint) => BigInt(whole) * 10n ** 6n; // 6 decimals, stablecoin and bond
export const MAX_SUPPLY = USD(10_000);

/** Copies MockHTS runtime code to 0x167 and returns it typed at that address. */
export async function placeMockHts() {
  const impl = await ethers.deployContract("MockHTS");
  await setCode(HTS_ADDRESS, await ethers.provider.getCode(await impl.getAddress()));
  return ethers.getContractAt("MockHTS", HTS_ADDRESS);
}

/** Admin = treasury/key holder of MockUSD and DEFAULT_ADMIN + KYC + PAUSER on MockBond (like the S1 rbacs). */
export async function deployMocksFixture() {
  const [admin, investor, other, sponsor] = await ethers.getSigners();
  const usd = await ethers.deployContract("MockUSD", [USD(1_000_000)]);
  const bond = await ethers.deployContract("MockBond", [admin.address, MAX_SUPPLY, true]);
  await bond.grantRole(ROLES.KYC, admin.address);
  await bond.grantRole(ROLES.PAUSER, admin.address);
  const hts = await placeMockHts();
  const caller = await ethers.deployContract("RawCaller");
  return { admin, investor, other, sponsor, usd, bond, hts, caller };
}

/** Associates `who` with MockUSD, grants KYC and sends it `amount` from the treasury (associate → KYC → fund). */
export async function onboardUsd(
  usd: Awaited<ReturnType<typeof deployMocksFixture>>["usd"],
  who: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  amount: bigint,
) {
  await usd.connect(who).associate();
  await usd.grantKyc(who.address);
  if (amount > 0n) await usd.transfer(who.address, amount);
}

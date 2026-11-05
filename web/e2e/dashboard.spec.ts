// Dashboard smoke test on a local Hardhat node (MOCK-TESTED, LOCAL ONLY): deploys the demo world (Bhuj replay pending,
// SYNTHETIC kutch-3 pending with a D15 advisory), then drives every view: the trustee vetoes the advised event through
// the UI, anyone executes Bhuj after the window, and the replay and investor views show L = 7000 and the write-down.
// Screenshots land in web/e2e/screenshots (gitignored).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { gasLimitFor } from "../src/lib/gas";
import { ACCOUNTS, connectNodeWallet, sentTxs } from "./wallet";

const REPO = path.resolve(__dirname, "../..");
const SHOTS = path.join(__dirname, "screenshots");
const WINDOW_SEC = 90;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  execFileSync("npx", ["hardhat", "run", "scripts/dashboard-demo-local.ts", "--network", "localhost"], { cwd: REPO, env: { ...process.env, DEMO_WINDOW_SEC: String(WINDOW_SEC) }, stdio: "inherit" });
});

async function open(page: Page, route: string, account?: number) {
  if (account !== undefined) await connectNodeWallet(page, account);
  await page.goto(route);
  await expect(page.getByText("Mock Faultline Bond")).toBeVisible();
}
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

// Presence alone proves nothing: without an explicit limit ethers fills `gas` with the bare estimate, the limit that ran
// out of gas on testnet (step 9), so the sent gas must be the buffered value.
async function expectBufferedGas(page: Page) {
  const sent = await sentTxs(page);
  expect(sent).toHaveLength(1);
  const { gas, estimate } = sent[0];
  expect(gas, "the wallet transaction carries a gas limit").toBeDefined();
  expect(estimate, "the dashboard estimated the gas first").toBeDefined();
  expect(BigInt(gas!)).toBe(gasLimitFor(BigInt(estimate!)));
  expect(BigInt(gas!)).toBeGreaterThan(BigInt(estimate!));
}

test("overview: replay badge, pending events, pool books", async ({ page }) => {
  await open(page, "/");
  await expect(page.getByText("REPLAY").first()).toBeVisible();
  await expect(page.getByText("2 pending events", { exact: true })).toBeVisible();
  await expect(page.getByText("Terms file matches chain")).toBeVisible();
  await expect(page.getByText("10,000.000000 units").first()).toBeVisible();
  await expect(page.getByText(/^Stablecoin: mUSD/)).toBeVisible();
  await expect(page.getByText("mUSD", { exact: true })).toHaveCount(0); // amounts are in USD everywhere
  await expect(page.getByText("Local chain time is simulated (time travel); HCS times are real.").first()).toBeVisible();
  await shot(page, "1-overview");
});

test("trustee: D15 advisory, veto through the wallet", async ({ page }) => {
  await open(page, "/trustee", ACCOUNTS.trustee);
  await expect(page.getByText("Connected: trustee")).toBeVisible();
  const advised = page.locator("section", { hasText: "Oracle advises veto" });
  await expect(advised.getByText("the epicentre moved outside the insured box")).toBeVisible();
  await expect(advised.getByText("Signed by oracle").first()).toBeVisible();
  await expect(advised.getByText(/^Window ends in \d/)).toBeVisible();
  await expect(advised.getByText("(real origin time)")).toBeVisible();
  await expect(page.getByText(/effective time 1,/)).toHaveCount(0); // raw seconds only in tooltips
  await shot(page, "4-trustee-pending");
  await advised.getByRole("button", { name: "Veto event" }).click();
  await expect(page.getByRole("status").getByText("Done")).toBeVisible();
  await expectBufferedGas(page);
  await expect(page.getByRole("row", { name: /synthetic-kutch-3.*Vetoed/ })).toBeVisible();
});

test("investor: ATS balance next to effective value; redemption closed with a reason", async ({ page }) => {
  await open(page, "/investor", ACCOUNTS.investorA);
  await expect(page.getByText("ATS balance", { exact: true })).toBeVisible();
  await expect(page.getByText("5,000.000000").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Redeem all units" })).toBeDisabled();
  await expect(page.getByText(/Redemption opens after the submission deadline/)).toBeVisible();
  await expect(page.getByText("The issuance window is closed.")).toBeVisible();
  await shot(page, "2-investor-before");
});

test("sign out holds across a reload; sign in restores the wallet", async ({ page }) => {
  await open(page, "/investor", ACCOUNTS.investorA);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with wallet" })).toBeVisible();
  await expect(page.getByText("ATS balance", { exact: true })).toBeHidden();
  // The test wallet keeps answering eth_accounts, as a wallet without wallet_revokePermissions would.
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in with wallet" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in with wallet" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByText("ATS balance", { exact: true })).toBeVisible();
});

test("sponsor: reserve and closed funding window", async ({ page }) => {
  await open(page, "/sponsor", ACCOUNTS.sponsor);
  await expect(page.getByText("Coupon funding closed at the end of issuance.")).toBeVisible();
  await expect(page.getByText("Covers the full cap")).toBeVisible();
  await shot(page, "3-sponsor-before");
});

test("execute Bhuj after the window: L 0 to 7000, sponsor credited, holders written down", async ({ page }) => {
  test.setTimeout((WINDOW_SEC + 120) * 1000);
  await open(page, "/trustee", ACCOUNTS.relayer);
  const bhuj = page.locator("section", { hasText: "usp000a8ds" }).filter({ has: page.getByRole("button", { name: "Execute" }) });
  await expect(bhuj.getByRole("button", { name: "Execute" })).toBeEnabled({ timeout: (WINDOW_SEC + 60) * 1000 });
  await bhuj.getByRole("button", { name: "Execute" }).click();
  await expect(page.getByRole("status").getByText("Done")).toBeVisible();
  await expectBufferedGas(page);

  await page.goto("/replay");
  await expect(page.getByText("Record hashes to the on-chain dataHash")).toBeVisible();
  await expect(page.getByText("Local chain time is simulated (time travel); HCS times are real.")).toBeVisible();
  await expect(page.getByText("L 0 bps to 7,000 bps")).toBeVisible();
  await expect(page.getByText("7,000.000000 USD of collateral credited to the sponsor, claimable now.")).toBeVisible();
  await page.waitForTimeout(1500); // let the number easing finish before the screenshot
  await shot(page, "5-replay-after-execute");
});

test("investor after the write-down: ATS balance unchanged, effective principal 30%", async ({ page }) => {
  await open(page, "/investor", ACCOUNTS.investorA);
  await expect(page.getByText(/Principal 1,500\.000000 USD \+ accrued coupon/)).toBeVisible();
  await expect(page.getByText("Why the two numbers differ")).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "6-investor-after");
});

test("sponsor after the write-down: 7,000 USD claimable with the sponsor wallet", async ({ page }) => {
  await open(page, "/sponsor", ACCOUNTS.sponsor);
  await expect(page.getByRole("button", { name: "Claim", exact: true })).toBeEnabled();
  await expect(page.getByText("The connected wallet is not the sponsor")).toHaveCount(0);
  await page.waitForTimeout(1500);
  await shot(page, "7-sponsor-after");
});

test("evidence: HCS log with oracle signatures; overview after", async ({ page }) => {
  await open(page, "/evidence");
  await expect(page.getByText("Advisory: veto")).toBeVisible();
  await expect(page.getByText("Signed by oracle")).toHaveCount(3);
  await shot(page, "8-evidence");
  await page.goto("/");
  await expect(page.getByText("Loss index raised from 0 bps to 7,000 bps; sponsor credited 7,000.000000 USD")).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "9-overview-after");
});

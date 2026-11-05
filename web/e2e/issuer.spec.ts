// Issuer page on a local Hardhat node (MOCK-TESTED, LOCAL ONLY): launches a full bond through /issuer with the TEST-ONLY
// node wallet (account #0, the MockUSD admin of the local world), checks every wallet transaction carried gas =
// estimate x 1.3, that the audit passes, then opens the overview of the new bond through the header's Bond selector.
// Screenshots land in web/e2e/screenshots (gitignored).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { gasLimitFor } from "../src/lib/gas";
import { ACCOUNTS, connectNodeWallet, sentTxs } from "./wallet";

const REPO = path.resolve(__dirname, "../..");
const SHOTS = path.join(__dirname, "screenshots");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  // A fresh local world: the issuer page reads its MockUSD (stablecoin) and the node's unlocked test accounts.
  execFileSync("npx", ["hardhat", "run", "scripts/deploy-local.ts", "--network", "localhost"], { cwd: REPO, stdio: "inherit" });
});

/** Every transaction the test wallet sent carried the buffered gas limit, not the bare estimate. */
async function expectBufferedGas(page: Page, atLeast: number) {
  const sent = await sentTxs(page);
  expect(sent.length).toBeGreaterThanOrEqual(atLeast);
  for (const { gas, estimate } of sent) {
    expect(gas, "the wallet transaction carries a gas limit").toBeDefined();
    expect(BigInt(gas!)).toBe(gasLimitFor(BigInt(estimate!)));
  }
}

test("issuer: launch a bond on the local node, audit passes, overview opens the new bond", async ({ page }) => {
  await connectNodeWallet(page, ACCOUNTS.admin);
  await page.goto("/issuer");
  await expect(page.getByRole("heading", { name: "Issuer" })).toBeVisible();
  await expect(page.getByText("Local chain, mock tokens")).toBeVisible();
  // Defaults come from the node: sponsor #1 and the world's MockUSD.
  await expect(page.locator("#p-sponsor")).not.toHaveValue("");
  await expect(page.locator("#p-stable")).not.toHaveValue("");
  await expect(page.getByText(/^0x[0-9a-f]{64}$/).first()).toBeVisible(); // termsHash
  await expect(page.getByText("Required coupon reserve for the full cap")).toBeVisible();
  await expect(page.getByText("600.000000").first()).toBeVisible(); // 10,000 USD x 6 % x 1 year

  // A rule the page enforces before anything is sent: maturity before riskStart.
  const maturity = await page.locator("#s-maturity").inputValue();
  await page.locator("#s-maturity").fill("2001-01-01T00:00");
  await expect(page.getByText("Maturity must be after the risk period starts (riskStart < maturity).")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start the launch" })).toBeDisabled();
  await page.locator("#s-maturity").fill(maturity);
  await shot(page, "issuer-1-form");

  await page.getByRole("button", { name: "Start the launch" }).click();
  await expect(page.getByText(/steps finished/)).toBeVisible();
  await expect(page.locator('[data-step="topic"]').getByText("Skipped")).toBeVisible();

  const runAsAdmin = async (ids: string[]) => {
    for (const id of ids) {
      const row = page.locator(`[data-step="${id}"]`);
      await row.getByRole("button", { name: "Run with wallet" }).click();
      await expect(row.getByText("Done", { exact: true })).toBeVisible({ timeout: 60_000 });
    }
  };
  await runAsAdmin(["bond", "issuerRole", "bondKyc", "pool", "trigger"]);

  // Backup trustee (D17): the admin wallet is refused before anything is sent; the trustee wallet grants the role.
  const backup = page.locator('[data-step="backupTrustee"]');
  await expect(backup.getByRole("button", { name: "Skip" })).toBeVisible();
  const sentBefore = (await sentTxs(page)).length;
  await backup.getByRole("button", { name: "Run with wallet" }).click();
  await expect(backup.getByText(/Only the trustee 0x[0-9a-fA-F]{40} can grant TRUSTEE_ROLE/)).toBeVisible();
  expect((await sentTxs(page)).length).toBe(sentBefore);
  await shot(page, "issuer-2-launch-progress");
  const trusteePage = await page.context().newPage(); // same browser context: same stored launch
  await connectNodeWallet(trusteePage, ACCOUNTS.trustee);
  await trusteePage.goto("/issuer");
  const trusteeRow = trusteePage.locator('[data-step="backupTrustee"]');
  await trusteeRow.getByRole("button", { name: "Run with wallet" }).click();
  await expect(trusteeRow.getByText("Done", { exact: true })).toBeVisible({ timeout: 60_000 });
  const trusteeSent = await sentTxs(trusteePage);
  expect(trusteeSent).toHaveLength(1);
  expect(BigInt(trusteeSent[0]!.gas!)).toBe(gasLimitFor(BigInt(trusteeSent[0]!.estimate!)));
  await trusteePage.close();

  await page.reload(); // pick up the trustee page's progress from storage
  await expect(backup.getByText("Done", { exact: true })).toBeVisible();
  await runAsAdmin(["initialize", "poolHtsKyc", "roles", "investorHtsKyc"]);
  // Resumable: a reload keeps the progress.
  await page.reload();
  await expect(page.locator('[data-step="roles"]').getByText("Done", { exact: true })).toBeVisible();

  const audit = page.locator('[data-step="audit"]');
  await audit.getByRole("button", { name: "Run checks" }).click();
  await expect(audit.getByText(/^All \d+ checks passed$/)).toBeVisible({ timeout: 60_000 });
  await expect(audit.getByText("FaultlinePool creation code on chain equals the repo build")).toBeVisible();
  await expect(audit.locator("li", { hasText: "backup trustee holds TRUSTEE_ROLE (D17)" }).getByText("PASS")).toBeVisible();
  await expect(audit.getByText("FAIL")).toHaveCount(0);
  await expect(page.getByText("Audit passed")).toBeVisible();
  await expect(page.getByLabel("Deployment config entry")).toContainText('"termsHash"');
  await shot(page, "issuer-3-done");

  await page.getByRole("button", { name: "Open this bond in the dashboard" }).click();
  await expect(page).toHaveURL(/\/$/);
  const select = page.getByLabel("Bond shown in every view");
  await expect(select).toBeVisible();
  await expect(select.locator("option:checked")).toHaveText(/^My deployment: FLKB 0x/);
  await expect(page.getByText("Terms file matches chain")).toBeVisible();
  await expect(page.getByText("0.000000 units").first()).toBeVisible(); // nothing invested in the new bond yet
  await expect(page.getByText("REPLAY", { exact: true })).toHaveCount(0); // live terms
  await shot(page, "issuer-4-overview-new-bond");

  // Back to the built-in bond: the local world's 10,000 units.
  await select.selectOption("");
  await expect(page.getByText("10,000.000000 units").first()).toBeVisible();
});

test("issuer: every wallet transaction of a launch carries gas = estimate x 1.3", async ({ page }) => {
  await connectNodeWallet(page, ACCOUNTS.admin);
  await page.goto("/issuer");
  // A fresh browser context: no stored launch. Send the first three steps of a new one without reloading.
  await expect(page.locator("#p-sponsor")).not.toHaveValue("");
  await page.getByRole("button", { name: "Start the launch" }).click();
  for (const id of ["bond", "issuerRole", "bondKyc"]) {
    const row = page.locator(`[data-step="${id}"]`);
    await row.getByRole("button", { name: "Run with wallet" }).click();
    await expect(row.getByText("Done", { exact: true })).toBeVisible({ timeout: 60_000 });
  }
  await expectBufferedGas(page, 4); // MockBond deploy, ROLE_KYC grant, two investor KYC grants
  await page.getByRole("button", { name: "Reset launch" }).click();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByRole("button", { name: "Start the launch" })).toBeVisible();
});

// Issuer page: ATS facts, MockUSD fragments, the bond role audit copy and the ops/ steps, pinned to their sources.
import fs from "node:fs";
import path from "node:path";
import { Interface, Wallet, getAddress } from "ethers";
import { describe, expect, it } from "vitest";
import { ATS_BLR, ATS_BOND_ABI, ATS_FACTORY, ATS_FACTORY_ABI, ATS_ROLES, atsBondArgs, isinChecksum, makeIsin } from "@/lib/issuer/ats";
import { FORBIDDEN_ROLES, auditPassed, backupTrusteeCheck, bondRoleChecks } from "@/lib/issuer/audit";
import { MOCK_USD_ABI } from "@/lib/issuer/build";
import { checkTopic, evmOfKey, htsTokenId, kycCommand, topicCommand, topicMemo } from "@/lib/issuer/opsSteps";
import { fromUtcInput, toUtcInput } from "@/lib/issuer/time";
import { FORBIDDEN_ROLES as SCRIPT_FORBIDDEN } from "../../scripts/lib/bondAudit";
import { ROLES as TEST_ROLES } from "../../test/helpers/roles";

const REPO = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(REPO, p), "utf8");

describe("ATS facts vs their sources", () => {
  it("role ids equal contracts/interfaces/IAtsBond.sol (through test/helpers/roles) and the ops scripts", () => {
    for (const k of ["ISSUER", "CONTROLLER", "AGENT", "ADJUSTMENT_BALANCE", "KYC", "PAUSER", "DEFAULT_ADMIN"] as const) expect(ATS_ROLES[k]).toBe(TEST_ROLES[k]);
    const common = read("ops/scripts/lib/common.ts");
    for (const [k, v] of Object.entries(ATS_ROLES)) expect(common, k).toContain(`${k}: "${v}"`);
  });

  it("factory, resolver and bond config id equal ops/scripts/lib/common.ts", () => {
    const common = read("ops/scripts/lib/common.ts");
    expect(common).toContain(`FACTORY = "${ATS_FACTORY}"`);
    expect(common).toContain(`BLR = "${ATS_BLR}"`);
  });

  it("the ABIs carry every function the issuer page calls", () => {
    const bond = new Interface(ATS_BOND_ABI as never);
    for (const f of ["addIssuer", "isIssuer", "grantKyc", "getKycStatusFor", "applyRoles", "hasRole", "getRoleMemberCount", "isControllable"]) expect(bond.getFunction(f), f).not.toBeNull();
    const factory = new Interface(ATS_FACTORY_ABI as never);
    expect(factory.getFunction("deployBond")).not.toBeNull();
    expect(factory.getEvent("BondDeployed")).not.toBeNull();
  });

  it("deployBond arguments encode, with a Luhn-valid ISIN, 6 decimals, nominal 1 USD and no ROLE_ISSUER for anyone", () => {
    const admin = getAddress("0x" + "11".repeat(20));
    const { args, isin } = atsBondArgs({ name: "Faultline Kutch Bond", symbol: "FLKB", info: "test", admin, cap: 10_000_000_000n, startingDate: 1_800_000_120, maturityDate: 1_800_003_000, isinSeed: 1_800_000_000 });
    expect(isin).toMatch(/^USFLI000000\d$/);
    expect(isinChecksum(isin.slice(0, 11))).toBe(Number(isin[11]));
    const data = new Interface(ATS_FACTORY_ABI as never).encodeFunctionData("deployBond", args as never);
    expect(data.startsWith("0x")).toBe(true);
    const sec = args[0].security;
    expect(sec.erc20MetadataInfo.decimals).toBe(6);
    expect(args[0].bondDetails.nominalValue).toBe(100n);
    expect(args[0].bondDetails.nominalValueDecimals).toBe(2);
    expect(sec.rbacs.map((r) => r.role)).toEqual([ATS_ROLES.DEFAULT_ADMIN, ATS_ROLES.SSI_MANAGER, ATS_ROLES.KYC]);
    expect(sec.isControllable && sec.internalKycActivated && !sec.isMultiPartition).toBe(true);
  });

  it("ISIN check digit matches a known real ISIN (US0378331005)", () => {
    expect(makeIsin("US", "037833100")).toBe("US0378331005");
  });

  it("MockUSD fragments equal the compiled artifact", () => {
    const full = new Interface(JSON.parse(read("artifacts/contracts/mocks/MockUSD.sol/MockUSD.json")).abi);
    new Interface(MOCK_USD_ABI as unknown as string[]).forEachFunction((f) => expect(full.getFunction(f.selector)?.format("full"), f.name).toBe(f.format("full")));
  });
});

describe("bond role audit copy", () => {
  it("lists exactly the roles and ids of scripts/lib/bondAudit.ts", () => {
    expect(Object.fromEntries(Object.entries(FORBIDDEN_ROLES).map(([k, v]) => [k, v.id]))).toEqual(Object.fromEntries(Object.entries(SCRIPT_FORBIDDEN).map(([k, v]) => [k, v.id])));
  });

  it("passes only when the pool alone holds ISSUER and CONTROLLER, no forbidden role has a member and the bond is controllable", async () => {
    const pool = "0x" + "22".repeat(20);
    const bond = (over: Record<string, bigint> = {}, controllable = true) => ({
      hasRole: async (_r: string, a: string) => a === pool,
      getRoleMemberCount: async (r: string) => over[r] ?? (r === ATS_ROLES.ISSUER || r === ATS_ROLES.CONTROLLER ? 1n : 0n),
      isControllable: async () => controllable,
    });
    expect((await bondRoleChecks(bond(), pool)).every((c) => c.ok)).toBe(true);
    expect((await bondRoleChecks(bond({ [ATS_ROLES.ISSUER]: 2n }), pool)).filter((c) => !c.ok).map((c) => c.label)).toEqual(["ROLE_ISSUER is held by the pool alone"]);
    expect((await bondRoleChecks(bond({ [ATS_ROLES.AGENT]: 1n }), pool)).find((c) => !c.ok)?.label).toBe("ROLE_AGENT has no member");
    expect((await bondRoleChecks(bond({}, false), pool)).find((c) => !c.ok)?.label).toMatch(/controllable/);
  });
});

describe("backup trustee audit check", () => {
  it("a rule when the step ran, a warning that does not fail the audit when it was skipped", () => {
    const B = "0x" + "33".repeat(20);
    expect(backupTrusteeCheck(B, true, false)).toMatchObject({ ok: true });
    expect(backupTrusteeCheck(B, false, false)).toMatchObject({ ok: false });
    expect(backupTrusteeCheck(B, false, false).warn).toBeUndefined();
    expect(backupTrusteeCheck(B, null, true)).toMatchObject({ ok: false, warn: true });
    expect(backupTrusteeCheck("", null, false)).toMatchObject({ ok: false, warn: true });
    const pass = { label: "x", ok: true };
    expect(auditPassed([pass, backupTrusteeCheck(B, null, true)])).toBe(true);
    expect(auditPassed([pass, backupTrusteeCheck(B, false, false)])).toBe(false);
  });
});

describe("ops/ steps", () => {
  const oracle = Wallet.createRandom();
  const trustee = Wallet.createRandom();

  it("commands carry the values, checksummed, for the root npm scripts", () => {
    const t = topicCommand({ oracle: oracle.address.toLowerCase(), trustee: trustee.address, payer: trustee.address, memo: topicMemo("FLKB") });
    expect(t.dryRun).toBe(`SUBMIT_EVM=${oracle.address} ADMIN_EVM=${trustee.address} PAYER_EVM=${trustee.address} MEMO=faultline-flkb npm run ops:issuer:topic`);
    expect(t.execute).toBe(`EXECUTE=1 ${t.dryRun}`);
    const k = kycCommand({ stablecoin: "0x0000000000000000000000000000000000ace152", accounts: [oracle.address, trustee.address], kycKeyHolder: trustee.address });
    expect(k?.dryRun).toBe(`TOKEN=0.0.11329874 ACCOUNTS=${oracle.address},${trustee.address} KYC_EVM=${trustee.address} npm run ops:issuer:kyc`);
    expect(kycCommand({ stablecoin: oracle.address, accounts: [trustee.address], kycKeyHolder: trustee.address })).toBeNull();
    expect(kycCommand({ stablecoin: "0x0000000000000000000000000000000000ace152", accounts: [], kycKeyHolder: trustee.address })).toBeNull();
  });

  it("the npm scripts the commands name exist at the root and in ops/", () => {
    const root = JSON.parse(read("package.json")).scripts;
    const ops = JSON.parse(read("ops/package.json")).scripts;
    expect(root["ops:issuer:topic"]).toBe("npm --prefix ops run issuer:topic");
    expect(root["ops:issuer:kyc"]).toBe("npm --prefix ops run issuer:kyc");
    expect(ops["issuer:topic"]).toContain("scripts/issuer/hcs-topic.ts");
    expect(ops["issuer:kyc"]).toContain("scripts/issuer/hts-kyc.ts");
  });

  it("HTS token ids and ECDSA keys from the mirror node", () => {
    expect(htsTokenId("0x0000000000000000000000000000000000aCe152")).toBe("0.0.11329874");
    expect(htsTokenId(oracle.address)).toBeNull();
    const compressed = oracle.signingKey.compressedPublicKey.slice(2);
    expect(evmOfKey({ _type: "ECDSA_SECP256K1", key: compressed })).toBe(oracle.address);
    expect(evmOfKey({ _type: "ED25519", key: compressed })).toBeNull();
  });

  it("the topic check passes only for submit key = oracle and admin key = trustee", async () => {
    const key = (w: typeof oracle) => ({ _type: "ECDSA_SECP256K1", key: w.signingKey.compressedPublicKey.slice(2) });
    const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
    const good = await checkTopic("https://m", "0.0.5", { oracle: oracle.address, trustee: trustee.address }, reply({ submit_key: key(oracle), admin_key: key(trustee), memo: "x", deleted: false }));
    expect(good.ok).toBe(true);
    const swapped = await checkTopic("https://m", "0.0.5", { oracle: oracle.address, trustee: trustee.address }, reply({ submit_key: key(trustee), admin_key: key(oracle), memo: "x", deleted: false }));
    expect(swapped.ok).toBe(false);
    expect((await checkTopic("https://m", "0.0.5", { oracle: oracle.address, trustee: trustee.address }, reply({}, 404))).ok).toBe(false);
    expect((await checkTopic("https://m", "5", { oracle: oracle.address, trustee: trustee.address })).lines[0]).toMatch(/0\.0\.x/);
  });
});

describe("UTC date fields", () => {
  it("round-trip in UTC and refuse impossible dates", () => {
    expect(toUtcInput(1_800_000_000)).toBe("2027-01-15T08:00:00");
    expect(fromUtcInput("2027-01-15T08:00:00")).toBe(1_800_000_000);
    expect(fromUtcInput("2027-01-15T08:00")).toBe(1_800_000_000);
    expect(fromUtcInput("2027-02-30T00:00")).toBeNaN();
    expect(fromUtcInput("2027-01-15T24:00")).toBeNaN();
    expect(fromUtcInput("")).toBeNaN();
  });
});

describe("IST date fields", () => {
  it("round-trip in IST (UTC+05:30)", async () => {
    const { fromIstInput, toIstInput } = await import("@/lib/issuer/time");
    expect(toIstInput(1_793_962_510)).toBe("2026-11-06T16:25:10");
    expect(fromIstInput("2026-11-06T16:25:10")).toBe(1_793_962_510);
    expect(fromIstInput("2026-02-30T00:00")).toBeNaN();
  });
});
